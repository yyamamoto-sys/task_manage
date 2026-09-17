// supabase/functions/backup-daily/index.ts
//
// 【設計意図】
// 日次バックアップのフェーズ2（Edge Function）。正本は docs/dev/backup-design.md（rev4）§3。
// この関数の役割は「DB側の3関数（backup_begin / backup_snapshot / backup_finalize）を
// 正しい順序で呼び、その結果を Storage へ置き、backup_objects に記録するだけ」の薄い層。
// JSON の組み立て・仕分け・圧縮は一切ここでやらない（すべて DB 側の関数が担う）。
//
// 【🔴 最重要：backup_snapshot の戻り値は「文字列として受け取り、一切パースしない」】
// 素朴に supabase-js の `supabase.rpc("backup_snapshot", ...)` を使うと、内部で
// `fetch().then(r => r.json())` が呼ばれ、戻り値は一度 JS オブジェクトへパースされてしまう。
// そのオブジェクトを Storage へ書き込むには再度 `JSON.stringify()` が必要になり、これは
// 「パースして組み立て直す」ことに他ならない（キー順・数値表現が変わりうる上、大きな
// jsonb に対して JSON.parse/stringify を両方行うのは CPU 時間上限2秒に対して不要な負荷）。
// そのため backup_snapshot の呼び出しだけは、PostgREST の RPC エンドポイントへ直接
// `fetch()` し、レスポンスボディを `response.text()` で「文字列のまま」受け取る
// （`callRpcRaw()`）。この文字列（bodyText）は一度も JSON.parse されず、そのまま
// Storage へ put する。backup_begin / backup_finalize は戻り値が小さい構造化データ
// （run_id・group_ids の配列／削除対象パスの配列）なので、通常どおり supabase-js の
// `.rpc()` を使ってよい（パース済みオブジェクトとして扱う必要があるため）。
//
// 【設計判断：backup_objects.taken_at は「この実行の開始時刻」を1つだけ使う】
// backup_snapshot が返す jsonb 本文には meta.taken_at（DB側のnow()）が入っているが、
// これを読むには bodyText を JSON.parse する必要があり、上記の「一切パースしない」方針に
// 反する。そのため、この Edge Function 自身が実行開始時に1回だけ `new Date()` を取得し
// （runTimestamp）、full・部署別すべてのスナップショットの taken_at・保存先パスの日付
// （JST）にこの1つの値を使う。1回の実行は数秒で終わるため、DB側のnow()との差は実務上
// 無視できる。
//
// 【設計判断：backup_objects.path は "backups/<scope>/....json" の形（バケット名を含む
// 表記）で保存し、Storage への実際のキー（バケット内相対パス）は "backups/" を外したもの
// を使う】
// docs/dev/backup-design.md §5・§6 のテーブル定義コメントが `path` 列の例として
// "backups/full/2026-09-16.json" を示しているため、これに合わせて保存する。Storage の
// `storage.from("backups")` は既にバケットをスコープしているため、実際にアップロード・
// 削除するキーは "full/2026-09-16.json"（"backups/" を除いたもの）にする。
// `toStorageKey()` がこの変換を1箇所で担う。
//
// 【認証】
// - x-cron-secret ヘッダが BACKUP_CRON_SECRET と一致（pg_cron からの定期実行）
// - または、Authorization: Bearer <JWT> が有効かつ、そのJWTのメールに一致する members行が
//   is_super_admin=true（管理画面からの手動実行）
// どちらでもなければ401（CLAUDE.md Section 15：エラーメッセージにステータスコードを含める）。
//
// 【必要な Edge Function secrets】
//   SUPABASE_URL（自動設定）/ SUPABASE_SERVICE_ROLE_KEY / BACKUP_CRON_SECRET /
//   TEAMS_WEBHOOK_URL（notify-deadlines と同じ変数名を流用。失敗・一部失敗の通知用）/
//   ALLOWED_ORIGINS（2026-09-17追記。CORS。本番に設定済み）
// 【任意の secret】
//   APP_VERSION（省略可。設定していれば backup_snapshot の meta.app_version に記録される。
//   未設定なら null を渡し、DB側の jsonb_strip_nulls によって meta から省かれる）
//
// 【2026-09-17追記：CORS対応（ai-consult/index.ts の ALLOWED_ORIGINS 方式をそのまま踏襲）】
// 管理画面「バックアップ」タブの手動実行ボタンがブラウザから直接この Function を呼ぶため、
// CORS プリフライト（OPTIONS）に応答できないと呼び出しがブロックされる（2026-09-17に
// フェーズ4実装時点で未対応と判明・統括の指示で追加）。
// 🔴🔴 最重要：pg_cron（pg_net の net.http_post）からの呼び出しには Origin ヘッダーが
// 存在しない（req.headers.get("origin") は null）。CORS処理はこの null を必須の分岐条件
// にしていない——getCorsHeaders(null) は ALLOWED_ORIGINS の先頭要素（無ければ "*"）を
// 返すだけで、リクエストの処理自体を拒否・分岐させない。CORSヘッダーはブラウザだけが見る
// レスポンスのメタ情報であり、pg_net のようなサーバー間呼び出しはこれを一切検証しない
// ため、Origin の有無に関わらず本体の処理（認証・スナップショット取得・保存等）は
// 今までどおり実行される。また pg_net は常に直接 POST するため OPTIONS 分岐にも入らない
// （OPTIONS はブラウザのプリフライトのみが送る）。この2点により、既存の cron 経路は
// 一切変更されない。
//
// 【1部署の失敗が他に波及しないこと】
// 部署ごとの処理は個別に try/catch し、失敗しても次の部署の処理へ進む。1件でも失敗があれば
// 実行全体の status を "partial"（全滅なら "failed"）にする。
//
// 【docs/dev/backup-design.md §3 のフロー1〜8との対応（報告にも記載）】
//   [1] backup_begin                → Deno.serve内「[1] backup_begin」ブロック
//   [2] full の snapshot→put        → Deno.serve内「[2] full」ブロック（snapshotAndStore）
//   [3] 部署ごとの snapshot→put     → Deno.serve内「[3] 部署ごと」ブロック（for + snapshotAndStore）
//   [4] backup_finalize             → Deno.serve内「[4] backup_finalize」ブロック
//   [5] 削除＋deleted_at更新        → Deno.serve内「[5] 削除対象を...」ブロック
//   [6] Teams通知（failed/partial） → Deno.serve内「[6] 通知」ブロック（notifyTeams）
//
// 【2026-09-17・フェーズ4追記：週次サマリ（新しいcronは増やさない）】
//   [7] 週次サマリ（JSTで月曜のみ）→ Deno.serve内「[7] 週次サマリ」ブロック
//       （sendWeeklyBackupSummaryIfMonday）。既存の[1]〜[6]の処理フローは無変更。
//
// 【デプロイはしない。ファイルを作るだけ（山本さんが supabase functions deploy する）】

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "backups";

// ===== CORS（ai-consult/index.ts と同じ ALLOWED_ORIGINS 方式。新しい流儀を発明しない） =====
// 🔴 origin が null（Originヘッダー無し＝pg_cron/pg_net からの呼び出し）でも、この関数は
// 何も拒否しない。「$originがALLOWED_ORIGINSに含まれるか」で分岐するのはあくまで
// "どの値をAccess-Control-Allow-Originに載せるか"だけであり、載せる値が決まらない
// （null・未一致）場合も ALLOWED_ORIGINS の先頭要素（無ければ "*"）にフォールバックする
// だけで、リクエストの処理自体は続行される。
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://localhost:4173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    // x-cron-secret はこのFunction自身が認証に使うヘッダーのため、ai-consultの一覧に
    // 追加して含める（backup-export-urls/index.tsと同じ一覧）。
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ===== JST日付（バックアップ起動はUTC 18:00=JST翌3:00。backup-design.md §6と同じ考え方） =====
function jstDateStr(reference: Date): string {
  const jst = new Date(reference.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 🔴 corsHeadersは呼び出しごと（リクエストのOriginに応じた値）に決まるため引数で受け取る
// （2026-09-17追記でCORS対応。以前は固定のContent-Typeヘッダーのみだった）。
function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// "backups/full/2026-09-16.json" → "full/2026-09-16.json"（Storageバケット内の実キー）
function toStorageKey(path: string): string {
  return path.startsWith(`${BUCKET}/`) ? path.slice(BUCKET.length + 1) : path;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// backup_snapshot の戻り値（jsonb）を「文字列のまま」受け取るための直接RPC呼び出し。
// supabase-js の .rpc() は内部で response.json() を呼びパースしてしまうため使わない
// （このファイル冒頭コメント参照）。
async function callRpcRaw(
  supabaseUrl: string,
  serviceRoleKey: string,
  fnName: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { ok: false; status: number; text: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };
  return { ok: true, text };
}

async function notifyTeams(webhookUrl: string | null, messageText: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // notify-deadlinesと同じPower Automate経路・同じ骨格（messageText＋mentions）で送る。
      // 本関数はメンション対象が無いため mentions は常に空配列。
      body: JSON.stringify({ messageText, mentions: [] }),
    });
  } catch (e) {
    // Teams通知自体の失敗はバックアップ結果を左右しない（ベストエフォート）。
    console.error(`Teams notify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ===== [7] 週次サマリ（フェーズ4・§8）=====
// 🔴 新しい cron は増やさない。この日次実行の最後で「JSTで月曜なら」だけ送る。
// JST判定は jstDateStr() と同じ「+9時間してからUTC値として読む」変換を再利用する
// （同じ計算を書き直さない）。0=日曜, 1=月曜, ... 6=土曜（Date.getUTCDay()の仕様どおり）。
function isJstMonday(reference: Date): boolean {
  const jst = new Date(reference.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCDay() === 1;
}

// 週次サマリの取得・送信に失敗しても、日次バックアップ自体の成否（このFunctionのレスポンス）
// には一切影響させない（呼び出し側はtry/catchで包み、失敗してもログに残すだけで握りつぶす）。
async function sendWeeklyBackupSummaryIfMonday(
  supabase: SupabaseClient,
  webhookUrl: string | null,
  reference: Date,
): Promise<void> {
  if (!isJstMonday(reference)) return;

  const sevenDaysAgoIso = new Date(reference.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 直近7日分の実行記録（日次1回＋手動実行分を見込んで余裕を持った上限）。
  const { data: recentRuns, error: runsError } = await supabase
    .from("backup_runs")
    .select("status, bytes_written, orphan_counts, deleted_count")
    .gte("started_at", sevenDaysAgoIso)
    .limit(200);
  if (runsError) {
    console.error(`weekly summary: backup_runs query failed: ${runsError.message}`);
    return;
  }

  const rows: {
    status: string;
    bytes_written: number | null;
    orphan_counts: Record<string, number> | null;
    deleted_count: number | null;
  }[] = recentRuns ?? [];

  const successCount = rows.filter((r) => r.status === "success").length;
  const totalBytes = rows.reduce((sum, r) => sum + (r.bytes_written ?? 0), 0);
  const totalDeleted = rows.reduce((sum, r) => sum + (r.deleted_count ?? 0), 0);
  const totalOrphans = rows.reduce((sum, r) => {
    const counts = r.orphan_counts;
    if (!counts) return sum;
    return sum + Object.values(counts).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
  }, 0);

  // 二次保管（backup_exports）の最終取得日。フェーズ5未実施でテーブルが空、
  // または一度も成功していなければ「未設定」と書く（docs/dev/backup-design.md §8）。
  const { data: lastExportRows, error: exportError } = await supabase
    .from("backup_exports")
    .select("reported_at")
    .eq("status", "success")
    .order("reported_at", { ascending: false })
    .limit(1);
  if (exportError) {
    console.error(`weekly summary: backup_exports query failed: ${exportError.message}`);
  }
  const lastExportDate =
    !exportError && lastExportRows && lastExportRows.length > 0
      ? jstDateStr(new Date(lastExportRows[0].reported_at as string))
      : "未設定";

  const megaBytes = (totalBytes / (1024 * 1024)).toFixed(1);

  await notifyTeams(
    webhookUrl,
    [
      `📅 日次バックアップ 週次サマリ（直近7日）`,
      `成功回数：${successCount}件`,
      `容量：約${megaBytes}MB`,
      `孤児件数：${totalOrphans}件`,
      `削除件数：${totalDeleted}件`,
      `二次保管の最終取得日：${lastExportDate}`,
    ].join("\n"),
  );
}

type SnapshotResult = { ok: true } | { ok: false; error: string };

// [2]/[3] 共通：1件のスナップショットを取得してStorageへput・backup_objectsへINSERTする。
async function snapshotAndStore(
  supabase: SupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  opts: {
    scope: "full" | "group";
    groupId: string | null;
    runId: number;
    appVersion: string | null;
    path: string;
    takenAtIso: string;
  },
): Promise<SnapshotResult> {
  const rpcResult = await callRpcRaw(supabaseUrl, serviceRoleKey, "backup_snapshot", {
    p_scope: opts.scope,
    p_group_id: opts.groupId,
    p_run_id: opts.runId,
    p_app_version: opts.appVersion,
  });
  if (!rpcResult.ok) {
    return {
      ok: false,
      error: `backup_snapshot failed (${rpcResult.status}): ${rpcResult.text.slice(0, 500)}`,
    };
  }

  // 🔴 rpcResult.text は backup_snapshot の戻り値（jsonb）をそのまま文字列で受け取ったもの。
  // ここから先、この文字列を一切パース・加工せず Storage へ put する。
  const bodyText = rpcResult.text;
  const bytes = new TextEncoder().encode(bodyText).length;
  const storageKey = toStorageKey(opts.path);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storageKey, new Blob([bodyText], { type: "application/json" }), {
      upsert: true, // 同日の手動実行・再実行に対する冪等性（backup-design.md §5）
      contentType: "application/json",
    });
  if (uploadError) {
    return { ok: false, error: `storage upload failed: ${uploadError.message}` };
  }

  // backup_objects.sha256 は「このファイル本体」の全文ハッシュ（二次保管での転送後照合用。
  // §7）。backup_snapshot が返す meta.sha256（tables部だけのハッシュ）とは対象範囲が異なる
  // 別の値であり、意図的に区別している。
  const fileHash = await sha256Hex(bodyText);

  const { error: insertError } = await supabase.from("backup_objects").insert({
    path: opts.path,
    run_id: opts.runId,
    scope: opts.scope,
    group_id: opts.groupId,
    taken_at: opts.takenAtIso,
    bytes,
    sha256: fileHash,
    retention: ["daily"], // backup-design.md §6：INSERT時点で明示する
  });
  if (insertError) {
    // ファイル自体はStorageに保存済みだが台帳に記録できていない状態。次回のfinalizeの
    // 世代管理対象からは漏れる（孤立ファイルとして残る）ため、その旨をエラーに含める。
    return {
      ok: false,
      error: `backup_objects insert failed（ファイルは保存済み: ${opts.path}）: ${insertError.message}`,
    };
  }

  return { ok: true };
}

Deno.serve(async (req: Request) => {
  // ===== CORS（2026-09-17追記）=====
  // origin が無い（pg_cronからの呼び出し）場合も getCorsHeaders は例外を投げず、
  // 後続の認証・処理はそのまま続行する（このファイル冒頭の🔴🔴コメント参照）。
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // OPTIONS はブラウザのCORSプリフライトのみが送る（pg_netは直接POSTするためこの分岐に
  // 入らない＝cron経路への影響は無い）。
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const CRON_SECRET = Deno.env.get("BACKUP_CRON_SECRET");
  const TEAMS_WEBHOOK_URL = Deno.env.get("TEAMS_WEBHOOK_URL") ?? null;
  const APP_VERSION = Deno.env.get("APP_VERSION") ?? null;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(
      { error: "server misconfigured", status: 500, detail: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
      500,
      corsHeaders,
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ===== 認証：x-cron-secret 一致 または super-admin の JWT =====
  let trigger: "cron" | "manual" = "cron";
  let triggeredBy: string | null = null;

  const providedSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && providedSecret === CRON_SECRET) {
    trigger = "cron";
  } else {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return json({ error: "Unauthorized", status: 401 }, 401, corsHeaders);
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.email) {
      return json({ error: "Unauthorized", status: 401, detail: userError?.message }, 401, corsHeaders);
    }

    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, is_super_admin")
      .eq("email", userData.user.email)
      .eq("is_deleted", false)
      .maybeSingle();
    if (memberError) {
      return json({ error: "Unauthorized", status: 401, detail: memberError.message }, 401, corsHeaders);
    }
    if (!member || !member.is_super_admin) {
      return json({ error: "Unauthorized", status: 401 }, 401, corsHeaders);
    }
    trigger = "manual";
    triggeredBy = member.id as string;
  }

  // 実行全体で1つだけ使う基準時刻（このファイル冒頭コメント参照）。
  const runTimestamp = new Date();
  const dateStr = jstDateStr(runTimestamp);
  const takenAtIso = runTimestamp.toISOString();

  // ===== [1] backup_begin =====
  const { data: beginRows, error: beginError } = await supabase.rpc("backup_begin", {
    p_trigger: trigger,
    p_triggered_by: triggeredBy,
  });
  if (beginError || !beginRows || beginRows.length === 0) {
    return json(
      { error: "backup_begin failed", status: 500, detail: beginError?.message },
      500,
      corsHeaders,
    );
  }
  const runId: number = beginRows[0].run_id;
  const groupIds: string[] = beginRows[0].group_ids ?? [];

  type ObjectResult = { scope: "full" | "group"; groupId: string | null; ok: boolean; error?: string };
  const objectResults: ObjectResult[] = [];

  // ===== [2] full =====
  const fullPath = `${BUCKET}/full/${dateStr}.json`;
  const fullResult = await snapshotAndStore(supabase, SUPABASE_URL, SERVICE_ROLE_KEY, {
    scope: "full",
    groupId: null,
    runId,
    appVersion: APP_VERSION,
    path: fullPath,
    takenAtIso,
  });
  objectResults.push({
    scope: "full",
    groupId: null,
    ok: fullResult.ok,
    error: fullResult.ok ? undefined : fullResult.error,
  });

  // ===== [3] 部署ごと（1部署の失敗が他に波及しないよう個別にtry/catch） =====
  for (const groupId of groupIds) {
    const groupPath = `${BUCKET}/by-group/${groupId}/${dateStr}.json`;
    try {
      const result = await snapshotAndStore(supabase, SUPABASE_URL, SERVICE_ROLE_KEY, {
        scope: "group",
        groupId,
        runId,
        appVersion: APP_VERSION,
        path: groupPath,
        takenAtIso,
      });
      objectResults.push({
        scope: "group",
        groupId,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    } catch (e) {
      objectResults.push({
        scope: "group",
        groupId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ===== status決定 =====
  const successCount = objectResults.filter((r) => r.ok).length;
  let status: "success" | "partial" | "failed";
  let errorMessage: string | null = null;
  if (successCount === 0) {
    status = "failed";
    errorMessage = "全てのスナップショットの保存に失敗しました";
  } else if (successCount < objectResults.length) {
    status = "partial";
    errorMessage = `一部のスナップショットの保存に失敗しました（成功 ${successCount}/${objectResults.length}）`;
  } else {
    status = "success";
  }

  // ===== [4] backup_finalize =====
  const { data: deletePaths, error: finalizeError } = await supabase.rpc("backup_finalize", {
    p_run_id: runId,
    p_status: status,
    p_error_message: errorMessage,
  });
  if (finalizeError) {
    // finalize自体の失敗はバックアップ実行の成否とは別に、必ず知らせる（静かに失敗させない）。
    await notifyTeams(
      TEAMS_WEBHOOK_URL,
      `⚠ バックアップの後片付け（backup_finalize）に失敗しました（run_id=${runId}）: ${finalizeError.message}`,
    );
  }

  // ===== [5] 削除対象をStorage APIで削除し、成功したものだけ deleted_at を更新 =====
  const pathsToDelete: string[] = deletePaths ?? [];
  const deletedPaths: string[] = [];
  if (pathsToDelete.length > 0) {
    const storageKeys = pathsToDelete.map((p) => toStorageKey(p));
    const { data: removed, error: removeError } = await supabase.storage.from(BUCKET).remove(storageKeys);
    if (removeError) {
      // 削除に失敗したパスは deleted_at を更新しない＝次回のfinalizeでも再び削除対象として
      // 返り続ける（backup-design.md §6の🔴に明記された想定どおりの挙動）。
      console.error(`storage remove failed: ${removeError.message}`);
    } else {
      const removedKeys = new Set((removed ?? []).map((r) => r.name));
      for (const p of pathsToDelete) {
        if (removedKeys.has(toStorageKey(p))) deletedPaths.push(p);
      }
    }
  }
  if (deletedPaths.length > 0) {
    const { error: updateError } = await supabase
      .from("backup_objects")
      .update({ deleted_at: new Date().toISOString() })
      .in("path", deletedPaths);
    if (updateError) {
      console.error(`backup_objects.deleted_at update failed: ${updateError.message}`);
    }
  }

  // ===== [6] 通知（failed/partialのみ） =====
  if (status === "failed" || status === "partial") {
    const failLines = objectResults
      .filter((r) => !r.ok)
      .map((r) => `- ${r.scope === "full" ? "全体" : r.groupId}: ${r.error ?? "不明なエラー"}`);
    await notifyTeams(
      TEAMS_WEBHOOK_URL,
      [
        `🔴 日次バックアップが${status === "failed" ? "失敗" : "一部失敗"}しました（run_id=${runId}）`,
        `成功 ${successCount}/${objectResults.length}`,
        ...failLines,
      ].join("\n"),
    );
  }

  // ===== [7] 週次サマリ（JSTで月曜のみ。既存フローの後に追記。失敗しても本レスポンスには影響させない） =====
  try {
    await sendWeeklyBackupSummaryIfMonday(supabase, TEAMS_WEBHOOK_URL, runTimestamp);
  } catch (e) {
    console.error(`weekly summary failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return json(
    {
      run_id: runId,
      status,
      trigger,
      results: objectResults,
      deleted_count: deletedPaths.length,
    },
    200,
    corsHeaders,
  );
});

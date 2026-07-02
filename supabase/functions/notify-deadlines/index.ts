// supabase/functions/notify-deadlines/index.ts
//
// 【設計意図】
// 毎週月曜の朝、PJごとの「期限超過（本日含む）」「今週中に完了予定」タスクを
// まとめて Teams の共有チャンネルに1通投稿する（週次・全員向けレポート版）。
// pg_cron から net.http_post で起動される想定（ブラウザを開いていなくても届く）。
// - 対象：notify_pref に関係なく全メンバーの、未完了タスク全件（個人opt-in方式から
//   「チーム全体の状況レポート」に変更。個々人への私信ではなく全員が見てよい内容）
// - PJごとにセクションを分け、各PJ内で「🔴期限超過」「🟡今週中」の2カテゴリに分けて
//   「タスク名（担当者）」の形式で列挙する
// - 認証：x-cron-secret ヘッダが NOTIFY_CRON_SECRET と一致しないと 401（無差別起動の防止）
//
// 【2026-07-02b 変更】担当者を Teams の実際の @メンションにするため、出力形式を
// MessageCard の直送りから「本文テンプレート＋メンション解決用マッピング」の
// 構造化JSONに変更した。@メンショントークンは Power Automate フロー側でしか
// 生成できない（Edge Function からは作れない）ため、担当者名の代わりに
// `%%mention_N%%` というプレースホルダーを本文中に埋め込み、`mentions` 配列で
// 「プレースホルダー→メールアドレス」の対応表を渡す。フロー側は
//   1. 各 mentions[].email について「ユーザーの@メンショントークンを取得する」を実行
//   2. messageText 中の該当プレースホルダーを取得したトークンで置換（replace は全件置換）
//   3. 置換後のテキストを Post message in a chat or channel で投稿
// という手順を組む（詳細は docs/dev/deadline-notifications.md 参照）。
// メールアドレスが未設定のメンバーはメンション不可のため、表示名の平文のままにする。
//
// 必要な Edge Function secrets（supabase secrets set ...）：
//   SUPABASE_URL（自動設定）/ SUPABASE_SERVICE_ROLE_KEY / TEAMS_WEBHOOK_URL / NOTIFY_CRON_SECRET
//
// 【現状の制約】マルチテナント（groups テーブル）には未対応。現状は全メンバーが単一グループ
// （grp-egg）のため group_id での絞り込みをしていない。将来複数グループが実運用に乗ったら、
// グループごとに Webhook 先を分けるか group_id でのフィルタが必要になる。
//
// 注意：Microsoft は受信Webhook（O365コネクタ）を2026年5月に完全廃止済み。本番は
// Power Automate の「Workflows」（Webhook要求受信→チャンネル投稿）で構築している。
// このJSON構造は Power Automate フロー側で解釈する前提（MessageCardではない）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 集計の基準は JST（Asia/Tokyo）。サーバはUTCで動くため +9h して当日を求める。
function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function jstTodayStr(): string {
  return jstNow().toISOString().slice(0, 10);
}
// 今週の終わり（日曜）を JST で求める。0=日,1=月,...6=土
function jstWeekEndStr(): string {
  const d = jstNow();
  const dow = d.getUTCDay();
  const daysToSunday = (7 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

type TaskRow = {
  id: string;
  name: string;
  due_date: string;
  project_id: string | null;
  assignee_member_id: string | null;
  assignee_member_ids: string[] | null;
};

type MemberRow = { id: string; display_name: string; email: string | null };

const NO_PJ_KEY = "__no_pj__";

Deno.serve(async (req: Request) => {
  // ===== 認証（共有シークレット） =====
  const secret = Deno.env.get("NOTIFY_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const webhookUrl = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (!webhookUrl) return json({ error: "TEAMS_WEBHOOK_URL not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const today = jstTodayStr();
  const weekEnd = jstWeekEndStr();

  // ===== 未完了・今週末（日曜）までに期限があるタスク全件 =====
  // ここには「期限超過（本日含む）」と「今週中に完了予定」の両方が含まれる。以降で振り分ける。
  const { data: tasks, error: tErr } = await supabase
    .from("tasks")
    .select("id, name, due_date, status, project_id, assignee_member_id, assignee_member_ids")
    .eq("is_deleted", false)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", weekEnd);
  if (tErr) return json({ error: "tasks query failed", detail: tErr.message }, 500);

  const { data: projects, error: pErr } = await supabase
    .from("projects").select("id, name").eq("is_deleted", false);
  if (pErr) return json({ error: "projects query failed", detail: pErr.message }, 500);

  const { data: members, error: mErr } = await supabase
    .from("members").select("id, display_name, email").eq("is_deleted", false);
  if (mErr) return json({ error: "members query failed", detail: mErr.message }, 500);

  const pjNameById = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const memberById = new Map((members ?? []).map((m) => [m.id as string, m as MemberRow]));

  // ===== メンション用プレースホルダーの発行（メンバーごとに1つ・使い回す） =====
  // email が無いメンバーは None のまま＝本文では表示名の平文になる。
  const placeholderByMemberId = new Map<string, string>();
  const mentions: { placeholder: string; email: string }[] = [];
  const resolveAssigneeText = (t: TaskRow): string => {
    const ids = new Set<string>();
    if (t.assignee_member_id) ids.add(t.assignee_member_id);
    if (Array.isArray(t.assignee_member_ids)) for (const id of t.assignee_member_ids) ids.add(id);
    if (ids.size === 0) return "未定";

    const tokens = [...ids].map((id) => {
      const m = memberById.get(id);
      if (!m) return "不明";
      if (!m.email) return m.display_name; // メール未登録＝メンション不可、平文表示
      let ph = placeholderByMemberId.get(id);
      if (!ph) {
        ph = `%%mention_${placeholderByMemberId.size + 1}%%`;
        placeholderByMemberId.set(id, ph);
        mentions.push({ placeholder: ph, email: m.email });
      }
      return ph;
    });
    return tokens.join("/");
  };

  // ===== PJごとに「期限超過（本日含む）」「今週中」に振り分け =====
  const byProject = new Map<string, { overdue: TaskRow[]; thisWeek: TaskRow[] }>();
  for (const t of (tasks ?? []) as TaskRow[]) {
    const key = t.project_id ?? NO_PJ_KEY;
    const bucket = byProject.get(key) ?? { overdue: [], thisWeek: [] };
    if (t.due_date <= today) bucket.overdue.push(t);
    else bucket.thisWeek.push(t);
    byProject.set(key, bucket);
  }

  const formatLines = (rows: TaskRow[]): string =>
    [...rows]
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((t) => `- ${t.name}（${resolveAssigneeText(t)}）`)
      .join("\n");

  const orderedKeys = [...byProject.keys()].sort((a, b) => {
    if (a === NO_PJ_KEY) return 1;
    if (b === NO_PJ_KEY) return -1;
    return (pjNameById.get(a) ?? "").localeCompare(pjNameById.get(b) ?? "", "ja");
  });

  const pjBlocks: string[] = [];
  let totalOverdue = 0;
  let totalThisWeek = 0;

  for (const key of orderedKeys) {
    const bucket = byProject.get(key)!;
    if (bucket.overdue.length === 0 && bucket.thisWeek.length === 0) continue;
    const pjName = key === NO_PJ_KEY ? "（PJ未設定）" : (pjNameById.get(key) ?? "（不明なPJ）");
    totalOverdue += bucket.overdue.length;
    totalThisWeek += bucket.thisWeek.length;

    const parts: string[] = [`📁 ${pjName}`];
    if (bucket.overdue.length > 0) parts.push(`🔴 期限超過（本日含む）\n${formatLines(bucket.overdue)}`);
    if (bucket.thisWeek.length > 0) parts.push(`🟡 今週中に完了予定\n${formatLines(bucket.thisWeek)}`);
    pjBlocks.push(parts.join("\n"));
  }

  if (pjBlocks.length === 0) return json({ posted: false, reason: "no target tasks" }, 200);

  const messageText = [
    `📋 今週のタスクアラート（${today} の週）`,
    `期限超過（本日含む）：${totalOverdue}件／今週中に完了予定：${totalThisWeek}件`,
    "",
    pjBlocks.join("\n\n"),
  ].join("\n");

  // ===== Power Automate フローへ POST（フロー側でメンショントークンに置換して投稿する） =====
  const payload = { messageText, mentions, totalOverdue, totalThisWeek, projectCount: pjBlocks.length };

  // ?dryRun=1 のときは Webhook へ送らず payload をそのまま返す（フロー未整備の段階での安全な確認用）
  if (new URL(req.url).searchParams.get("dryRun") === "1") {
    return json({ dryRun: true, payload }, 200);
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    return json({ posted: false, error: `Webhook POST failed: ${res.status}`, detail }, 502);
  }

  return json({ posted: true, totalOverdue, totalThisWeek, projects: pjBlocks.length, mentionCount: mentions.length }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

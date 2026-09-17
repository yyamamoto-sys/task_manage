// supabase/functions/backup-export-urls/index.ts
//
// 【設計意図】
// 日次バックアップ（docs/dev/backup-design.md）フェーズ4。
// 役割は「super-admin（またはフェーズ5の二次保管スクリプト）を検証し、指定されたパスの
// 署名URL（5分）を返すだけ」。Storage へのクライアント直接アクセスは全面拒否のまま
// （§10）で、この Function が唯一のダウンロード経路になる。
//
// 【backup-daily/index.ts をそのまま踏襲した点（新しい流儀を発明しない）】
// - 認証：x-cron-secret ヘッダが BACKUP_EXPORT_SECRET と一致（フェーズ5の二次保管
//   スクリプト用。今は使わないが受け口だけ作る）／または Authorization: Bearer <JWT> が
//   有効かつそのJWTのメールに一致する members行が is_super_admin=true（管理画面からの
//   手動実行）。どちらでもなければ401。
// - json() ヘルパー・toStorageKey() の変換規則（"backups/xxx" → "xxx"）
// - エラーメッセージにステータスコードを含める（CLAUDE.md Section 15）
//
// 【backup-daily と異なる点】
// - backup-daily は verify_jwt=false でデプロイされているため CORS を持たない
//   （pg_cron からの呼び出しにはブラウザのCORSプリフライトが発生しないため）。
//   この Function は管理画面（ブラウザ）から直接呼ぶことが主用途のため、
//   ai-consult/index.ts と同じ ALLOWED_ORIGINS 方式の CORS を実装する
//   （OPTIONSプリフライトに応答しないと、異なるオリジンからの呼び出しがブラウザ側で
//   ブロックされるため）。
//
// 【必要な Edge Function secrets】
//   SUPABASE_URL（自動設定）/ SUPABASE_SERVICE_ROLE_KEY / BACKUP_EXPORT_SECRET（任意・
//   フェーズ5まで未使用）
//
// 【デプロイはしない。ファイルを作るだけ（山本さんが supabase functions deploy する）】

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "backups";
const SIGNED_URL_EXPIRES_IN_SECONDS = 300; // 5分（§7・§10）
const MAX_PATHS_PER_REQUEST = 100; // 悪用・誤操作での大量発行を防ぐ緩い上限

// ===== CORS（ai-consult/index.ts と同じ方式） =====
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// "backups/full/2026-09-16.json" → "full/2026-09-16.json"（backup-daily/index.tsと同じ変換）
function toStorageKey(path: string): string {
  return path.startsWith(`${BUCKET}/`) ? path.slice(BUCKET.length + 1) : path;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const EXPORT_SECRET = Deno.env.get("BACKUP_EXPORT_SECRET");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(
      { error: "server misconfigured", status: 500, detail: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" },
      500,
      corsHeaders,
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ===== 認証：x-cron-secret 一致（フェーズ5用・今は未使用） または super-admin の JWT =====
  const providedSecret = req.headers.get("x-cron-secret");
  if (!(EXPORT_SECRET && providedSecret === EXPORT_SECRET)) {
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
  }

  // ===== 入力検証 =====
  let body: { paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid request body", status: 400 }, 400, corsHeaders);
  }
  const paths = Array.isArray(body?.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0) {
    return json({ error: "paths is required (non-empty string array)", status: 400 }, 400, corsHeaders);
  }
  if (paths.length > MAX_PATHS_PER_REQUEST) {
    return json({ error: `paths must be ${MAX_PATHS_PER_REQUEST} or fewer`, status: 400 }, 400, corsHeaders);
  }

  // ===== backup_objects からファイル本体のハッシュ・サイズを引く（あれば結果に含める。
  // 二次保管スクリプト（フェーズ5）が転送後の照合に使う値。取得できなくても
  // 署名URLの発行自体は続行する（管理画面のダウンロードでは必須ではないため）。=====
  const { data: objectRows } = await supabase
    .from("backup_objects")
    .select("path, sha256, bytes")
    .in("path", paths)
    .limit(paths.length);
  const objectInfoByPath = new Map(
    (objectRows ?? []).map((r: { path: string; sha256: string; bytes: number }) => [r.path, r]),
  );

  // ===== 署名URLの発行（1件ずつ。1件の失敗が他に波及しないようtry/catch） =====
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        const key = toStorageKey(path);
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(key, SIGNED_URL_EXPIRES_IN_SECONDS);
        if (error || !data?.signedUrl) {
          return { path, error: error?.message ?? "signed url not returned" };
        }
        const info = objectInfoByPath.get(path);
        return {
          path,
          signedUrl: data.signedUrl,
          sha256: info?.sha256,
          bytes: info?.bytes,
        };
      } catch (e) {
        return { path, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  return json({ results }, 200, corsHeaders);
});

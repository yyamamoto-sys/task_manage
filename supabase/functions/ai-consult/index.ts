// supabase/functions/ai-consult/index.ts
//
// 【設計意図】
// Anthropic APIのAPIキーをサーバーサイドにのみ保持するためのEdge Function。
// クライアントから直接Anthropic APIを呼ばせない（CLAUDE.md Section 6-1参照）。
// - Supabase Auth JWTによる認証チェック（未認証は401）
// - ユーザーごとのレート制限（1分あたりRATELIMIT_PER_MIN回まで、デフォルト20）
// - CORS: ALLOWED_ORIGINS 環境変数で許可ドメインを管理（カンマ区切り）
// - リクエストボディのpayloadをAnthropic APIに転送

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// 既定モデル（後方互換：model 指定が無い古いクライアントはこれを使う）
const DEFAULT_MODEL = "claude-sonnet-4-6";
// クライアントから選べるモデル（QuickResponse=haiku / Thinking=sonnet）。
// 未知の値は無視して既定にフォールバック（任意モデル指定の悪用を防ぐ）
const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5"];

// ===== CORS =====
// ALLOWED_ORIGINS 環境変数にカンマ区切りで本番ドメインを設定する。
// 例: "https://your-app.vercel.app,https://your-custom-domain.com"
// 未設定の場合はローカル開発用 localhost のみ（本番では必ず設定すること）。
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://localhost:4173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ===== レート制限（インメモリ・インスタンス単位） =====
// Edge Function のインスタンスが複数立つと完全ではないが、
// ループ呼び出し等の事故防止・コスト暴走防止として有効。
const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "20");
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();

  // メモリリーク防止：エントリ数が膨らんだら期限切れを掃除
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) {
      if (now >= val.resetAt) rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // CORS プリフライト
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Supabase Auth 認証チェック
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // レート制限チェック（認証後にユーザーIDで判定）
  const rateCheck = checkRateLimit(user.id);
  if (!rateCheck.allowed) {
    console.warn(`[ai-consult] rate limit exceeded: ${user.id}`);
    return new Response(
      JSON.stringify({
        error: "RATE_LIMIT_EXCEEDED",
        message: "1分あたりの利用上限に達しました。しばらくお待ちください。",
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // リクエストボディのパース
  let body: {
    system: string;
    messages: { role: string; content: string }[];
    max_tokens?: number;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 使用モデルを決定（ホワイトリスト外・未指定は既定にフォールバック）
  const model = (typeof body.model === "string" && ALLOWED_MODELS.includes(body.model))
    ? body.model
    : DEFAULT_MODEL;

  // Anthropic API へ転送
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: body.max_tokens ?? 4096,
        system: body.system,
        messages: body.messages,
      }),
    });
  } catch (fetchErr) {
    console.error("[ai-consult] Anthropic fetch failed:", fetchErr);
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_FETCH_FAILED", detail: String(fetchErr) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const responseText = await anthropicRes.text();
  console.log(
    `[ai-consult] status=${anthropicRes.status} user=${user.id} remaining=${rateCheck.remaining}`,
  );

  // Anthropic がエラーを返した場合、詳細をそのまま502で返す
  if (!anthropicRes.ok) {
    console.error(`[ai-consult] Anthropic error (${anthropicRes.status}):`, responseText);
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_ERROR", status: anthropicRes.status, detail: responseText }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(responseText, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-RateLimit-Remaining": String(rateCheck.remaining),
    },
  });
});

// supabase/functions/ai-consult/index.ts
//
// 【設計意図】
// Anthropic APIのAPIキーをサーバーサイドにのみ保持するためのEdge Function。
// クライアントから直接Anthropic APIを呼ばせない（CLAUDE.md Section 6-1参照）。
// - Supabase Auth JWTによる認証チェック（未認証は401）
// - ユーザーごとのレート制限（1分あたりRATELIMIT_PER_MIN回まで、デフォルト20）
// - CORS: ALLOWED_ORIGINS 環境変数で許可ドメインを管理（カンマ区切り）
// - リクエストボディのpayloadをAnthropic APIに転送
//
// 【ゲスト（サンプル閲覧）のAI利用回数制限・Phase 3・2026-08-07／v3.30で判定をSQL側に統一】
// ゲストはJWTの is_anonymous クレームで判定する（クライアント送信のフラグは偽装できるため
// 信用しない。CLAUDE.md Section 23）。回数の判定・条件付き加算はDBで原子的に行う
// （consume_guest_ai_quota()。supabase/migrations/20260807_add_guest_ai_quota.sql）。
// 「上限未満のときだけ加算し、拒否ならどちらのカウンタも進めない」という判定そのものが
// SQL関数の中で完結しており、このEdge Functionは戻り値（allowed/reason）をそのまま使うだけ
// （v3.29時点では無条件加算→ここで事後判定していたが、拒否された試行も全体枠を消費してしまう
// 可用性バグがあったため修正した）。
// しきい値は下記 GUEST_AI_PER_BROWSER_DAILY_LIMIT / GUEST_AI_GLOBAL_DAILY_LIMIT の
// 1箇所だけで管理し、RPC呼び出し時にSQL側へ引数で渡す（環境変数で上書き可・再デプロイ
// なしで変更したい場合はSupabaseダッシュボードのEdge Function Secretsを更新するだけでよい）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// 既定モデル（後方互換：model 指定が無い古いクライアントはこれを使う）
const DEFAULT_MODEL = "claude-sonnet-4-6";
// クライアントから選べるモデル（QuickResponse=haiku / Thinking=sonnet）。
// 未知の値は無視して既定にフォールバック（任意モデル指定の悪用を防ぐ）
const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5"];
// クライアント指定 max_tokens の上限（コスト暴走防止。レート制限と併用）
// 2026-07-24: メイン相談（apiClient.ts）が複数タスクの構造化提案等で出力が
// 4096を超えて途中で切れる不具合があったため、16384に引き上げ（v2.93の
// okrImportExtractor.ts同様8192に上げていたが、それでも上限に達していたため再拡大）
const MAX_TOKENS_CAP = 16384;

// ===== ゲスト（サンプル閲覧）のAI利用回数制限（1箇所の定数。CLAUDE.md Section 23） =====
// 「1ブラウザ=1匿名Authユーザー」とみなし、匿名ユーザーのuuid（=JWTのsub）をブラウザの
// 識別子として使う。しきい値はここだけで管理し、consume_guest_ai_quota()へ引数で渡す
// （SQL側は数字を一切持たない）。
const GUEST_AI_PER_BROWSER_DAILY_LIMIT = Number(Deno.env.get("GUEST_AI_PER_BROWSER_DAILY_LIMIT") ?? "3");
const GUEST_AI_GLOBAL_DAILY_LIMIT = Number(Deno.env.get("GUEST_AI_GLOBAL_DAILY_LIMIT") ?? "10");
// ゲストのAI利用ログを記録するmember_id。src/lib/guestMode.ts の GUEST_MEMBER_ID と
// 同一の値にすること（クライアント側の合成メンバーIDと突き合わせられるように）。
const GUEST_LOG_MEMBER_ID = "__guest__";

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

  // ===== ゲスト（サンプル閲覧）のAI利用回数制限 =====
  // is_anonymous はJWTのクレームであり auth.getUser() の戻り値に含まれる（クライアント側の
  // signInAnonymously()で作られたセッションのみtrueになる）。クライアントから送られてくる
  // フラグは一切見ない（偽装できるため）。
  let guestAdminClient: ReturnType<typeof createClient> | null = null;
  if (user.is_anonymous) {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      console.error("[ai-consult] SUPABASE_SERVICE_ROLE_KEY not configured; cannot enforce guest quota");
      return new Response(
        JSON.stringify({
          error: "GUEST_QUOTA_UNAVAILABLE",
          message: "サンプルのAI利用を確認できませんでした。しばらくしてから再度お試しください。",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    guestAdminClient = createClient(supabaseUrl, serviceRoleKey);

    // 判定（上限未満かどうか）と加算はconsume_guest_ai_quota()の中で完結している
    // （拒否ならどちらのカウンタも進めない。TOCTOUレース防止のため判定と加算を別クエリに
    // 分けない設計。supabase/migrations/20260807_add_guest_ai_quota.sql参照）。
    const { data: quotaRows, error: quotaErr } = await guestAdminClient
      .rpc("consume_guest_ai_quota", {
        p_anon_user_id: user.id,
        p_browser_limit: GUEST_AI_PER_BROWSER_DAILY_LIMIT,
        p_global_limit: GUEST_AI_GLOBAL_DAILY_LIMIT,
      });
    const quotaRow = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
    if (quotaErr || !quotaRow) {
      console.error("[ai-consult] guest quota RPC failed:", quotaErr);
      return new Response(
        JSON.stringify({
          error: "GUEST_QUOTA_UNAVAILABLE",
          message: "サンプルのAI利用を確認できませんでした。しばらくしてから再度お試しください。",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!quotaRow.allowed) {
      console.warn(`[ai-consult] guest quota exceeded: reason=${quotaRow.reason} user=${user.id}`);
      const isGlobal = quotaRow.reason === "global";
      return new Response(
        JSON.stringify({
          error: isGlobal ? "GUEST_GLOBAL_LIMIT_EXCEEDED" : "GUEST_DAILY_LIMIT_EXCEEDED",
          message: isGlobal
            ? "本日のサンプルAI利用枠が上限に達しました。"
            : `サンプルでのAI利用は1日${GUEST_AI_PER_BROWSER_DAILY_LIMIT}回までです。`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // リクエストボディのパース
  let body: {
    system: string;
    messages: { role: string; content: string }[];
    max_tokens?: number;
    model?: string;
    // 呼び出し元のAIIntent/ConsultationType（invokeAI.ts/apiClient.ts）。認証済みユーザーの
    // 使用量記録には使わない（既存どおりクライアント側でai_usage_logsにINSERTする）が、
    // ゲスト分の記録（このEdge FunctionがサービスロールでINSERTする唯一の経路）には必要。
    intent?: string;
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
        max_tokens: Math.min(body.max_tokens ?? 4096, MAX_TOKENS_CAP),
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

  // ゲスト分の使用量を記録する（クライアントからのINSERTはassertGuestBlocked()で常に
  // 遮断されるため、この経路がゲスト分を管理画面「AI使用量」タブに反映する唯一の手段）。
  // 失敗してもレスポンス自体は返す（記録の失敗でAI機能そのものを止めない）。
  if (user.is_anonymous && guestAdminClient) {
    try {
      const parsedForLog = JSON.parse(responseText) as {
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const { error: logErr } = await guestAdminClient.from("ai_usage_logs").insert({
        member_id: GUEST_LOG_MEMBER_ID,
        consultation_type: typeof body.intent === "string" && body.intent.trim()
          ? body.intent.trim().slice(0, 100)
          : "guest-ai",
        input_tokens: parsedForLog.usage?.input_tokens ?? 0,
        output_tokens: parsedForLog.usage?.output_tokens ?? 0,
        is_guest: true,
      });
      if (logErr) console.warn("[ai-consult] guest usage log insert failed:", logErr);
    } catch (logErr) {
      console.warn("[ai-consult] guest usage log insert failed:", logErr);
    }
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

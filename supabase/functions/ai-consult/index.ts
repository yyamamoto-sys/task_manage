// supabase/functions/ai-consult/index.ts
//
// 【設計意図】
// Anthropic APIのAPIキーをサーバーサイドにのみ保持するためのEdge Function。
// クライアントから直接Anthropic APIを呼ばせない（CLAUDE.md Section 6-1参照）。
// - Supabase Auth JWTによる認証チェック（未認証は401）
// - リクエストボディのpayloadをAnthropic APIに転送
// - CORSヘッダー対応

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
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

  // リクエストボディのパース
  let body: {
    system: string;
    messages: { role: string; content: string }[];
    max_tokens?: number;
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
        model: MODEL,
        max_tokens: body.max_tokens ?? 4096,
        system: body.system,
        messages: body.messages,
      }),
    });
  } catch (fetchErr) {
    console.error("[ai-consult] Anthropic fetch failed:", fetchErr);
    return new Response(JSON.stringify({ error: "ANTHROPIC_FETCH_FAILED", detail: String(fetchErr) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const responseText = await anthropicRes.text();
  console.log(`[ai-consult] Anthropic status: ${anthropicRes.status}`);

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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

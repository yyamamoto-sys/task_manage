// src/lib/ai/invokeAI.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") の共通ラッパー。
// non-2xx時に data に格納されたEdge Function側の詳細エラーを取り出してスローする。

import { supabase } from "../supabase/client";

export interface AIRawResponse {
  content: { type: "text"; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

type EdgeErrorBody = {
  error?: string;
  status?: number;
  detail?: string;
};

function extractEdgeError(data: unknown, fallback: string): string {
  const d = data as EdgeErrorBody | null;
  if (!d) return fallback;
  if (d.error === "ANTHROPIC_ERROR") {
    let msg = d.detail ?? "";
    try { msg = JSON.parse(d.detail ?? "")?.error?.message ?? d.detail ?? ""; } catch { /* ignore */ }
    const statusStr = d.status ? ` (${d.status})` : "";
    return `Anthropic APIエラー${statusStr}: ${msg}`;
  }
  if (d.error === "API key not configured") return "Edge FunctionにAPIキーが設定されていません。Supabaseの環境変数を確認してください。";
  if (d.error === "Unauthorized") return "認証エラー：ログインし直してください。";
  if (d.error) return d.error;
  return fallback;
}

export async function invokeAI(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number,
): Promise<AIRawResponse> {
  const { data, error } = await supabase.functions.invoke("ai-consult", {
    body: { system, messages, max_tokens: maxTokens },
  });

  if (error) {
    throw new Error(extractEdgeError(data, error.message));
  }

  const text: string = (data as AIRawResponse)?.content?.[0]?.text ?? "";
  if (!text) throw new Error("AIからの応答が空でした。");

  return data as AIRawResponse;
}

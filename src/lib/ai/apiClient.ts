// src/lib/ai/apiClient.ts
//
// 【設計意図】
// Supabase Edge Function（ai-consult）を呼び出すクライアント。
// APIキーはEdge Function側にのみ存在し、クライアントには露出しない（CLAUDE.md Section 6-1参照）。
// このモジュールはuseAIConsultationからのみ呼び出すこと（CLAUDE.md Section 6-12参照）。

import { supabase } from "../supabase/client";
import type { ConsultationType } from "../localData/types";
import type { AIConsultationPayload } from "./payloadBuilder";
import { SYSTEM_PROMPTS } from "./systemPrompt";
import type { ChatTurn } from "./sessionManager";

// ===== エラー型定義 =====

export type AIErrorCode =
  | "AUTH_REQUIRED"
  | "NETWORK_ERROR"
  | "RATE_LIMIT"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export class AIError extends Error {
  constructor(
    public code: AIErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AIError";
  }
}

// ===== Anthropic APIレスポンス型 =====

interface AnthropicContent {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContent[];
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ===== Edge Function呼び出し =====

/**
 * Supabase Edge Function（ai-consult）を呼び出してAIの回答を取得する。
 *
 * @param payload - AIに送るデータ（payloadBuilder.tsで構築したもの）
 * @param consultationType - 相談の種類（システムプロンプト選択に使用）
 * @param history - 会話履歴（マルチターン対応）
 * @returns AIの生レスポンステキスト（JSON文字列）
 * @throws AIError
 */
export interface AICallResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callAIConsultation(
  payload: AIConsultationPayload,
  consultationType: ConsultationType,
  history: ChatTurn[],
): Promise<AICallResult> {
  const systemPrompt = SYSTEM_PROMPTS[consultationType];

  // 会話履歴をAnthropic形式に変換
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  for (const turn of history) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  // 今回のユーザーメッセージをペイロードのJSONとして追加
  messages.push({
    role: "user",
    content: JSON.stringify(payload),
  });

  let data: AnthropicResponse | null = null;
  let error: Error | null = null;

  try {
    const result = await supabase.functions.invoke("ai-consult", {
      body: {
        system: systemPrompt,
        messages,
        max_tokens: 4096,
      },
    });
    data = result.data as AnthropicResponse | null;
    error = result.error as Error | null;
  } catch (e) {
    throw new AIError(
      "NETWORK_ERROR",
      "ネットワークエラーが発生しました。接続を確認してください。",
    );
  }

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      throw new AIError("AUTH_REQUIRED", "ログインが必要です。");
    }
    if (msg.includes("429") || msg.includes("rate")) {
      throw new AIError(
        "RATE_LIMIT",
        "リクエストが多すぎます。しばらく待ってから再試行してください。",
      );
    }
    throw new AIError("NETWORK_ERROR", `通信エラー: ${msg}`);
  }

  if (!data || !data.content || !data.content[0]?.text) {
    throw new AIError("INVALID_RESPONSE", "AIからの応答が不正な形式です。");
  }

  return {
    text: data.content[0].text,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

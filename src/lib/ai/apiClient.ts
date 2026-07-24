// src/lib/ai/apiClient.ts
//
// 【設計意図】
// Supabase Edge Function（ai-consult）を呼び出すクライアント。
// APIキーはEdge Function側にのみ存在し、クライアントには露出しない（CLAUDE.md Section 6-1参照）。
// このモジュールはuseAIConsultationからのみ呼び出すこと（CLAUDE.md Section 6-12参照）。
//
// ⚠ レガシー経路：このファイルは invokeAI を経由せず supabase.functions.invoke を
//   直接呼ぶため、AI 使用量ログ（ai_usage_logs）の自動記録が効かない。
//   呼び出し元の useAIConsultation 側で insertAiUsageLog を別途呼んで補っている。
//   新しい AI 機能を実装するときは invokeAI を経由すること（CLAUDE.md Section 16）。

import { supabase } from "../supabase/client";
import type { ConsultationType, ResponseVolume } from "./types";
import type { AIConsultationPayload } from "./payloadBuilder";
import { buildSystemPrompt } from "./systemPrompt";
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
  /** Anthropicの終了理由（"end_turn"|"max_tokens"等）。出力切れの検知に使う */
  stopReason: string;
}

/** 自己修正リトライ用：直前の不正出力を添えて厳密なJSONで出し直させる */
export interface AIRetryContext {
  previousResponseText: string;
  /** パース失敗の理由（AIへの説明文に埋め込む） */
  reason: string;
}

// 相談1回あたりのmax_tokens。会話を重ねる・複数タスクの構造化提案など出力が
// 大きくなる相談で応答が途中で切れてJSONパースに失敗する事故があったため、
// v2.93（okrImportExtractor）と同様に十分大きな値を確保する（Edge Function側の
// MAX_TOKENS_CAPと合わせて上げること。cap未変更だと静かにここより小さい値に丸められる）。
const MAX_TOKENS = 16384;

export async function callAIConsultation(
  payload: AIConsultationPayload,
  consultationType: ConsultationType,
  history: ChatTurn[],
  /** 使用モデル（QuickResponse=haiku / Thinking=sonnet）。省略時は Edge Function の既定 */
  model?: string,
  /** 回答ボリューム設定。省略時は "normal" */
  responseVolume?: ResponseVolume,
  /** 直前の応答がJSONパースに失敗した場合の自己修正リトライ用コンテキスト */
  retryContext?: AIRetryContext,
): Promise<AICallResult> {
  const systemPrompt = buildSystemPrompt(consultationType, responseVolume ?? "normal");

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

  // 自己修正リトライ：直前の不正な出力→修正依頼を会話として追加する
  // （okrImportExtractor.tsと同じ作法。引用符エスケープ漏れ等max_tokens以外の破損を救済する）
  if (retryContext) {
    messages.push({ role: "assistant", content: retryContext.previousResponseText });
    messages.push({
      role: "user",
      content:
        `あなたの直前の出力はJSONとして解析できませんでした（エラー: ${retryContext.reason}）。` +
        `同じ内容を、厳密に正しいJSONオブジェクトだけで出力し直してください。` +
        `二重引用符は \\" とエスケープし、日本語の引用は「」を使い、生の改行は入れず、` +
        `コードブロックや説明文は一切付けないこと。`,
    });
  }

  let data: AnthropicResponse | null = null;
  let error: Error | null = null;

  try {
    const result = await supabase.functions.invoke("ai-consult", {
      body: {
        system: systemPrompt,
        messages,
        max_tokens: MAX_TOKENS,
        ...(model ? { model } : {}),
      },
    });
    data = result.data as AnthropicResponse | null;
    error = result.error as Error | null;
  } catch {
    throw new AIError(
      "NETWORK_ERROR",
      "ネットワークエラーが発生しました。接続を確認してください。",
    );
  }

  if (error) {
    const msg = error.message ?? "";

    // Edge Function が返したエラー本文を取り出す
    const errData = (data as Record<string, unknown> | null);

    // Edge Function 自身のレート制限（1分あたり上限超過）
    if (errData && errData.error === "RATE_LIMIT_EXCEEDED") {
      const detail = typeof errData.message === "string" ? errData.message : "しばらく待ってから再試行してください。";
      throw new AIError("RATE_LIMIT", detail);
    }

    if (errData && errData.error === "ANTHROPIC_ERROR") {
      const status = errData.status as number | undefined;
      let detail = "";
      try { detail = JSON.parse(errData.detail as string)?.error?.message ?? String(errData.detail); }
      catch { detail = String(errData.detail ?? ""); }
      if (status === 401) throw new AIError("AUTH_REQUIRED", `Anthropic認証エラー: APIキーを確認してください。`);
      if (status === 429) throw new AIError("RATE_LIMIT", "Anthropic レート制限: しばらく待ってから再試行してください。");
      throw new AIError("NETWORK_ERROR", `Anthropic APIエラー (${status}): ${detail}`);
    }

    if (msg.includes("401") || msg.includes("Unauthorized")) {
      throw new AIError("AUTH_REQUIRED", "ログインが必要です。");
    }
    if (msg.includes("429") || msg.includes("rate")) {
      throw new AIError("RATE_LIMIT", "リクエストが多すぎます。しばらく待ってから再試行してください。");
    }
    throw new AIError("NETWORK_ERROR", `通信エラー: ${msg}`);
  }

  if (!data || !data.content || !data.content[0]?.text) {
    throw new AIError("INVALID_RESPONSE", "AIからの応答が不正な形式です。");
  }

  return {
    text: data.content[0].text,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
    stopReason: data.stop_reason ?? "",
  };
}

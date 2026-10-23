// src/lib/ai/consultationRunner.ts
//
// 【設計意図】
// callAIConsultation（API呼び出し）とparseAIResponse（JSONパース）を束ね、
// パース失敗時に1回だけ自己修正リトライを行うオーケストレーション層。
// useAIConsultation.ts から呼ぶ（同フックの唯一の入口ルールはCLAUDE.md Section 6-12参照）。
//
// 【自己修正リトライの方針】v2.93（okrImportExtractor.ts）を踏襲。
// - stop_reason==="max_tokens"（出力上限で途中切れ）はリトライしても同じ長さの壁に
//   ぶつかるだけなので、リトライせずTRUNCATED_RESPONSE_MESSAGEをそのまま伝播する。
// - それ以外のJSONパース失敗（引用符エスケープ漏れ等）は1回だけ、直前の不正出力を
//   添えて厳密なJSONに直させるリトライを行う。

import { callAIConsultation, AIError } from "./apiClient";
import type { AIConsultationPayload } from "./payloadBuilder";
import type { ConsultationType, ResponseVolume } from "./types";
import type { ChatTurn } from "./sessionManager";
import type { FileAttachment } from "./invokeAI";
import { parseAIResponse, type Proposal } from "./responseParser";

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface RunAIConsultationResult {
  proposals: Proposal[];
  follow_up_suggestions: string[];
  /** セッション履歴に保存する最終的な生レスポンス（リトライ成功時はリトライ後のテキスト） */
  rawResponse: string;
  /** 初回コールの使用量（AI使用量ログ記録用） */
  usage: AIUsage;
  /** リトライが発生した場合のみ、そのコールの使用量 */
  retryUsage?: AIUsage;
}

/** 1回呼んで使用量を渡す。返答が空で例外になっても、課金済みの分は AIError.usage から渡す（v3.185） */
async function callWithUsage(
  call: () => ReturnType<typeof callAIConsultation>,
  onUsage: ((usage: AIUsage, isRetry: boolean) => void) | undefined,
  isRetry: boolean,
): Promise<Awaited<ReturnType<typeof callAIConsultation>>> {
  try {
    const result = await call();
    onUsage?.(result.usage, isRetry);
    return result;
  } catch (e) {
    if (e instanceof AIError && e.usage) onUsage?.(e.usage, isRetry);
    throw e;
  }
}

export async function runAIConsultation(
  payload: AIConsultationPayload,
  consultationType: ConsultationType,
  history: ChatTurn[],
  model?: string,
  responseVolume?: ResponseVolume,
  attachments: FileAttachment[] = [],
  /** APIを1回呼び終えるたびに、そのコールの使用量を渡す。解析に失敗して例外になる場合でも消費済みのため、戻り値ではなくここで記録する */
  onUsage?: (usage: AIUsage, isRetry: boolean) => void,
): Promise<RunAIConsultationResult> {
  const first = await callWithUsage(
    () => callAIConsultation(payload, consultationType, history, model, responseVolume, undefined, attachments),
    onUsage, false,
  );

  try {
    const parsed = parseAIResponse(first.text, first.stopReason);
    return {
      proposals: parsed.proposals,
      follow_up_suggestions: parsed.follow_up_suggestions,
      rawResponse: first.text,
      usage: first.usage,
    };
  } catch (err) {
    // 出力切れ（max_tokens）はリトライしても解決しないため、そのまま伝播する
    if (!(err instanceof AIError) || first.stopReason === "max_tokens") {
      throw err;
    }

    const retry = await callWithUsage(
      () => callAIConsultation(payload, consultationType, history, model, responseVolume, {
        previousResponseText: first.text,
        reason: err.message,
      }, attachments),
      onUsage, true,
    );

    // リトライ結果のパース失敗はそのまま呼び出し元に伝播する（これ以上は救済しない）
    const parsedRetry = parseAIResponse(retry.text, retry.stopReason);
    return {
      proposals: parsedRetry.proposals,
      follow_up_suggestions: parsedRetry.follow_up_suggestions,
      rawResponse: retry.text,
      usage: first.usage,
      retryUsage: retry.usage,
    };
  }
}

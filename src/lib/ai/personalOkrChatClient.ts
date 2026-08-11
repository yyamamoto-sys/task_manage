// src/lib/ai/personalOkrChatClient.ts
//
// 【設計意図】
// 個人OKR用AIパネルの1ターン分のAI呼び出しを、React状態から分離した素の関数として持つ
// （usePersonalOkrAiConsultation.tsのテスト容易性のため。invokeAI/apiClient.tsと同じ
// 「呼び出しロジックはHookの外に置く」流儀）。
//
// 🔴 546対策：添付ファイルを伴わないコーチ役の短い回答を想定し、max_tokensはタスク管理の
// 主相談（16384）より小さい2048に絞る（CLAUDE.md Section 6-1c）。stop_reason==="max_tokens"
// は明示的なエラーにする（personalOkrOutlookExtractor.tsと同じ方針）。

import { invokeAI, type AIMessageInput } from "./invokeAI";

/** 添付ファイルを伴わない・コーチ役の短い回答を想定するための上限（Section 6-1c） */
export const MAX_TOKENS_OKR_CHAT = 2048;

export const OKR_CHAT_MODEL = "claude-sonnet-4-6";

/** 1ターン分の質問を送り、回答テキストを返す。turns は今回の質問を含む最新の会話履歴全体。 */
export async function sendPersonalOkrChatMessage(
  systemPrompt: string,
  turns: AIMessageInput[],
): Promise<string> {
  const res = await invokeAI(systemPrompt, turns, MAX_TOKENS_OKR_CHAT, "okr-personal-chat", OKR_CHAT_MODEL);
  if (res.stop_reason === "max_tokens") {
    throw new Error("回答が長くなりすぎたため途中で切れました。質問を分けて聞いてください。");
  }
  return res.content[0]?.text ?? "";
}

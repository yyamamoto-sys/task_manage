// src/lib/ai/usageLog.ts
//
// 【設計意図】
// AI 使用量を ai_usage_logs テーブルに記録するヘルパー。
// 全ての AI 呼び出しから一貫して呼び出せるよう、現在ユーザーは localStorage から取得する。
//
// 失敗してもメイン処理を止めないために void で fire-and-forget する。
// 失敗は console.warn で記録するだけ（ユーザーには見せない）。
//
// 【利用箇所】
//   - invokeAI（中央ゲート・全 AI 機能カバー）
//   - useAIConsultation も内部で呼んでいる（旧来の経路。callAIConsultation は invokeAI を経由しないため）

import { supabase } from "../supabase/client";
import { getCurrentUser } from "../localData/localStore";

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * AI 使用量を記録する。usage が無い・ユーザー未ログイン・DB エラーの
 * いずれの場合も例外を投げず警告ログのみで終わる。
 *
 * @param consultationType ai_usage_logs.consultation_type に保存する分類タグ。
 *   AIIntent（"task-management" / "kr-report" など）や ConsultationType
 *   （"change" / "simulate" など）を入れる。
 */
export function logAIUsage(
  consultationType: string,
  usage: AIUsage | undefined,
): void {
  if (!usage) return;
  const user = getCurrentUser();
  const memberId = user?.id;
  if (!memberId) return;

  void supabase
    .from("ai_usage_logs")
    .insert({
      member_id: memberId,
      consultation_type: consultationType,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    })
    .then(({ error }) => {
      if (error) {
        // 失敗してもメイン処理は止めない（CLAUDE.md Section 6 の例外的握りつぶし）
        // console には残してデバッグ可能に
        console.warn("AI使用量ログの記録に失敗:", error);
      }
    });
}

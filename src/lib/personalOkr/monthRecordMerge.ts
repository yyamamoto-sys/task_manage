// src/lib/personalOkr/monthRecordMerge.ts
//
// 【設計意図】
// personal_kr_months の各保存ハンドラ（今月の計画・バンド決定・振り返り）が、それぞれ
// 「自分が担当するフィールドだけ」を書き換えて保存できるようにする純粋関数。
//
// 🔴 背景（Step 0で確認した実際の不具合の芽）：personalOkrUiStore.saveMonth は
// upsertById（渡されたオブジェクトで既存行を丸ごと置換）でローカルstateを更新する。
// saveWithLock（DB側）は undefined のキーを送らないため列は保持されるが、
// ローカルstate側は「渡したオブジェクトそのもの」に置き換わるため、呼び出し側が
// monthRecord を spread せず新規オブジェクトを組み立てると、画面上でだけ他フィールド
// （review_text・self_eval_pct・band_override 等）が消えて見える。
// この関数を経由することで、既存レコードのフィールドを必ず引き継ぐ。
import type { PersonalKrMonth } from "../localData/types";

/**
 * 既存の月レコード（無ければ fallback）に patch をマージした新しい PersonalKrMonth を返す。
 * fallback は呼び出し側が uuid・created_at 等を用意した「新規行の初期値」。
 */
export function mergeMonthRecord(
  monthRecord: PersonalKrMonth | null,
  fallback: PersonalKrMonth,
  patch: Partial<PersonalKrMonth>,
): PersonalKrMonth {
  return { ...(monthRecord ?? fallback), ...patch };
}

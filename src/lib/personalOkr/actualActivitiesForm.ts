// src/lib/personalOkr/actualActivitiesForm.ts
//
// 【設計意図】
// 「実施記録」欄（ActualActivitiesBlock.tsx）のdirty判定を純粋関数として切り出す
// （monthReviewForm.ts/monthPlanForm.tsと同じ方針。Reactレンダリングテスト基盤が無いため
// ロジックはここでテストする）。単一のtextareaだけなので数値バリデーションは不要。

/** dirty判定（値比較）。空欄はnull/undefinedを""として正規化してから比較する。 */
export function computeActualActivitiesDirty(current: string, saved: string | null | undefined): boolean {
  return current !== (saved ?? "");
}

/**
 * 保存時に送る値へ変換する。🔴 空欄は undefined ではなく null を送ること（postgrest-jsの
 * 仕様。CLAUDE.md「Supabaseで列をnullにする時はundefinedでなくnullを送る」参照）。
 * 既存の他欄（positioning等）と同じ「空文字はnull」の作法に揃える（trimはしない）。
 */
export function toActualActivitiesSaveValue(draft: string): string | null {
  return draft || null;
}

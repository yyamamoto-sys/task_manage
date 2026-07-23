// src/lib/okr/okrImportMatch.ts
//
// 【設計意図】
// OKR PDF取込（okrImportExtractor）が抽出した氏名ヒント（leader_name_hint）を、
// 既存メンバー（display_name/short_name）に自動突合する純粋関数。
// 曖昧・不一致は呼び出し元UIで手動選択させる（未登録者を勝手に新規メンバー登録しない）。

export interface MatchableMember {
  id: string;
  display_name: string;
  short_name: string;
}

/**
 * 氏名ヒントから既存メンバーを1件だけ推定する。
 * 完全一致（display_name/short_name）→ 部分一致（どちらかがもう一方を含む）の順で判定し、
 * 部分一致が複数件ヒットする場合は曖昧とみなし null を返す（誤爆より「未選択」を優先）。
 */
export function matchMemberByName<T extends MatchableMember>(
  nameHint: string | null | undefined,
  members: T[],
): T | null {
  const hint = (nameHint ?? "").trim();
  if (!hint) return null;

  const exact = members.find(m => m.display_name === hint || m.short_name === hint);
  if (exact) return exact;

  const partial = members.filter(m =>
    m.display_name.includes(hint) || hint.includes(m.display_name) ||
    m.short_name.includes(hint) || hint.includes(m.short_name)
  );
  if (partial.length === 1) return partial[0];

  return null;
}

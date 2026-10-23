// src/lib/personalOkr/draftCloseGuard.ts
//
// 【設計意図・M62】
// AI下書き（課金済み）を閉じるときの確認判定。以前は「生成直後の本文から変わったか」だけを見て
// いたため、生成しただけで触っていない下書きは確認なしで捨てていた。
// 「下書きがあり、その内容がまだ反映先（本文欄・計画欄）に入っていない」なら確認対象にする。

/** 下書きの本文が、反映先にある本文（appliedText。未反映ならnull）と違えばtrue。空の下書きは対象外 */
export function hasUnappliedDraftText(hasDraft: boolean, text: string, appliedText: string | null): boolean {
  if (!hasDraft) return false;
  if (text.trim() === "") return false;
  return text !== (appliedText ?? "");
}

/** 複数欄の下書き版。いずれかの欄に内容があり、反映済みの欄と違えばtrue（appliedがnull＝未反映） */
export function hasUnappliedDraftFields<K extends string>(
  hasDraft: boolean,
  fields: Record<K, string>,
  applied: Record<K, string> | null,
  keys: readonly K[],
): boolean {
  if (!hasDraft) return false;
  return keys.some(k => fields[k].trim() !== "" && fields[k] !== (applied ? applied[k] : ""));
}

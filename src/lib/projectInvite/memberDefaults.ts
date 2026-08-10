// src/lib/projectInvite/memberDefaults.ts
//
// 【設計意図】
// 招待の受諾フォーム（表示名・略称のみ入力させる）で、イニシャル・色の既定値を
// 自動で作る小さな純粋関数。設計書の入力要件（3-2）「イニシャルと色は任意。既定値を
// 用意する」に対応する——このアプリでは「任意」を「入力欄自体を出さず常に自動生成する」
// という形で満たす（フォームを簡潔に保つための判断。取り込み後も管理画面から編集できる
// ため実害はない）。
//
// src/components/auth/SetupWizard.tsx に同種のロジック（getInitials）があるが、
// どちらも数行の純粋関数であり、依存を増やすより重複を許容する（意図的な判断）。
//
// 【全角スペースの扱い】表示名の区切りには半角スペースに加え全角スペース（U+3000）も
// 対象にする。ソースコードに全角スペースをそのまま埋め込むとno-irregular-whitespaceに
// 引っかかるため、\u3000 のUnicodeエスケープ表記で書く。

const NAME_SEPARATOR = /[\s\u3000]+/;

export function initialsFromDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(NAME_SEPARATOR);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2);
}

export function shortNameFromDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.split(NAME_SEPARATOR).map(p => p[0]).join("").slice(0, 4);
}

/** 招待の受諾で作成する members 行の既定アバター色（固定の1色。他メンバーとの重複は許容する）。 */
export const DEFAULT_INVITE_AVATAR_COLOR = {
  bg: "var(--avatar-3-bg)",
  text: "var(--avatar-3-text)",
};

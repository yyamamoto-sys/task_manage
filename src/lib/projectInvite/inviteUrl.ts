// src/lib/projectInvite/inviteUrl.ts
//
// 【設計意図】
// 招待リンクの形式は「アプリのURLに `?invite=<code>` を付けたもの」（設計書§7・
// Phase 2の決定。CLAUDE.md Section 25参照）。発行側（buildInviteLink）と
// 受け入れ側（extractInviteCodeFromSearch）の両方をこの1ファイルに集約する。

/** 発行側：アプリのURLに招待コードを付けたリンクを作る。 */
export function buildInviteLink(baseUrl: string, code: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("invite", code);
  return url.toString();
}

/**
 * 受け入れ側：URLのクエリ文字列（`location.search` 等）から招待コードを取り出す。
 * - `invite` パラメータが無い／値が空白のみ → null
 * - 同名パラメータが複数ある場合は先頭を採用する（URLSearchParams.get() の標準挙動）
 */
export function extractInviteCodeFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("invite");
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

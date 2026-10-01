// src/lib/reminder/deepLink.ts
//
// 通知のクリック先 `/?open=my-tasks` を読む（設計書 §3.2。招待コードの extractInviteCodeFromSearch と同じ形）。
// 読んだら history.replaceState でクエリを消し、リロードで再発火させない。

export type OpenTarget = "my-tasks";

export function extractOpenTarget(search: string): OpenTarget | null {
  const v = new URLSearchParams(search).get("open");
  return v === "my-tasks" ? v : null;
}

/** open パラメータだけを取り除いた URL（他のクエリ・ハッシュは残す） */
export function stripOpenParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("open");
  return `${url.pathname}${url.search}${url.hash}`;
}

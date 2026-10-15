// src/lib/reminder/deepLink.ts
//
// 通知のクリック先 `/?open=my-tasks`（期限）・`/?open=admin-errors`（v3.129・利用者の画面のエラー）・
// `/?open=admin-backup`（v3.136・日次バックアップの通知）・`/?open=admin-message&mid=…`（v3.131・管理者からのお知らせの詳細）・`/?open=admin-sent&mid=…`（v3.131・送信者への
// まとめ通知＝送信履歴）・`/?open=admin-feedback`（v3.157・利用者のご意見の受信）・`/?open=tour&id=<ツアーid>`（v3.159・お知らせツアーの再生）を読む（設計書 §3.2。招待コードの extractInviteCodeFromSearch と同じ形）。
// 読んだら history.replaceState でクエリを消し、リロードで再発火させない。

export type OpenTarget = "my-tasks" | "admin-errors" | "admin-backup" | "admin-message" | "admin-sent" | "admin-feedback" | "tour";

const OPEN_TARGETS: readonly OpenTarget[] = ["my-tasks", "admin-errors", "admin-backup", "admin-message", "admin-sent", "admin-feedback", "tour"];

export function extractOpenTarget(search: string): OpenTarget | null {
  const v = new URLSearchParams(search).get("open");
  return OPEN_TARGETS.find((t) => t === v) ?? null;
}

/** open・mid パラメータだけを取り除いた URL（他のクエリ・ハッシュは残す） */
export function stripOpenParam(href: string): string {
  const url = new URL(href);
  // `id` は他の用途のクエリと紛れないよう、お知らせツアー（open=tour）のときだけ取り除く
  if (url.searchParams.get("open") === "tour") url.searchParams.delete("id");
  url.searchParams.delete("open");
  url.searchParams.delete("mid");
  return `${url.pathname}${url.search}${url.hash}`;
}

const TOUR_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** `/?open=tour&id=<ツアーid>` のツアーid（形が合わなければ null）。v3.159：お知らせツアーの再生用 */
export function extractTourId(search: string): string | null {
  const p = new URLSearchParams(search);
  if (p.get("open") !== "tour") return null;
  const id = p.get("id");
  return id && TOUR_ID_RE.test(id) ? id : null;
}

// src/components/tour/tours/tourLinks.ts
//
// お知らせ（admin_messages）の本文に埋め込む「ツアーで見る」の専用記法 `amp://tour/<ツアーid>`（DB は変更しない）。
// 詳細ダイアログが本文からこの記法を取り除き、ボタンとして描く。旧画面（v3.158 以前）では普通の文字として見えるだけで壊れない。
// 記法の書き方は送信画面の「ツアーを添付」が本文末尾に足す（attachTourLink）。

/** ツアーid の形（英小文字・数字・ハイフン。48字まで）。定義側の id もこの形にする */
const ID_PATTERN = "[a-z0-9][a-z0-9-]{0,47}";
const TOKEN_RE = new RegExp(`amp://tour/(${ID_PATTERN})`, "g");
// ベルの行は本文の先頭200字で切られるため、途中で切れた記法も取り除く（idの長さを問わない）
const STRIP_RE = /amp:\/\/tour\/[a-z0-9-]*/g;
const ID_RE = new RegExp(`^${ID_PATTERN}$`);

export function isValidTourId(id: string): boolean {
  return ID_RE.test(id);
}

/** 本文から記法の id を重複なしで取り出す（出現順） */
export function extractTourIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** 記法を取り除いた本文（記法だけの行が残した空行は詰め、末尾の空白は落とす） */
export function stripTourLinks(body: string): string {
  if (!body.includes("amp://tour/")) return body;
  return body
    .replace(STRIP_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** 本文の末尾に記法を足す（送信画面の「ツアーを添付」）。すでに同じ記法があれば足さない */
export function attachTourLink(body: string, tourId: string | null): string {
  if (!tourId || !isValidTourId(tourId)) return body;
  if (extractTourIds(body).includes(tourId)) return body;
  const base = body.trimEnd();
  return base === "" ? `amp://tour/${tourId}` : `${base}\n\namp://tour/${tourId}`;
}

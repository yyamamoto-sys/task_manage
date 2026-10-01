// src/lib/adminMessages/linkify.ts
//
// お知らせ本文（プレーンテキスト）を「文字」と「リンク」の区切りに分ける（v3.131）。
// 画面は区切りを React の要素として描く（HTML として解釈しない＝dangerouslySetInnerHTML を使わない）。
// リンクにするのは http:// と https:// だけ（javascript: 等は文字のまま）。

export type TextSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
// 文末の句読点・閉じ括弧はURLに含めない
const TRAILING_RE = /[.,;:!?、。，．）)」』】\]]+$/;

export function linkifyPlainText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let raw = m[0];
    const trail = TRAILING_RE.exec(raw);
    if (trail) raw = raw.slice(0, raw.length - trail[0].length);
    let href: string | null = null;
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
    } catch {
      href = null;
    }
    if (!href || raw.length === 0) continue;
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    out.push({ type: "link", text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

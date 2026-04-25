// src/lib/renderLinks.tsx
// テキスト中の URL を <a> タグに変換して返すユーティリティ。

import type { ReactNode } from "react";

/** テキスト内の http(s) URL を自動リンク化して ReactNode を返す */
export function renderLinks(text: string): ReactNode {
  const urlPat = /https?:\/\/[^\s]+/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = urlPat.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--color-text-info)", textDecoration: "underline", wordBreak: "break-all" }}
      >
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

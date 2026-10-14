// src/lib/ooxmlCommon.ts
//
// 【設計意図】
// Office Open XML（.docx/.xlsx/.pptx）の抽出で共通に使う純関数。XMLパーサは使わず、
// docxText.ts と同じ「正規表現による簡易抽出」に揃える（新しい外部ライブラリを入れない）。

import { unzipSync } from "fflate";

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** タグの属性文字列から name="value" を取り出す（属性名の前方一致を避けるため空白区切りで探す）。 */
export function getXmlAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXmlEntities(m[1] ?? m[2] ?? "") : undefined;
}

/** zip を展開する。filter に一致するエントリだけを展開する（大きなファイルで不要な部分を解凍しない）。 */
export function unzipEntries(
  buf: Uint8Array,
  filter: (name: string) => boolean,
  failMessage: string,
): Record<string, Uint8Array> {
  try {
    return unzipSync(buf, { filter: f => filter(f.name) });
  } catch {
    throw new Error(failMessage);
  }
}

export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** .rels の Id → Target。 */
export function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = getXmlAttr(m[1], "Id");
    const target = getXmlAttr(m[1], "Target");
    if (id !== undefined && target !== undefined) map.set(id, target);
  }
  return map;
}

/** rels の Target（相対・絶対）を zip 内のパスに解決する。baseDir は rels の対象ファイルがあるディレクトリ（例 "xl"）。 */
export function resolveRelTarget(baseDir: string, target: string): string {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** ファイル名の末尾の数字（slide12.xml → 12）。 */
export function trailingNumber(path: string): number {
  const m = /(\d+)\.xml$/.exec(path);
  return m ? Number(m[1]) : 0;
}

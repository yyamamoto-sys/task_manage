// src/lib/pptxText.ts
//
// 【設計意図】
// PowerPoint (.pptx) からスライドごとのテキストを抽出する（AI相談の添付用・v3.144）。docxText.ts と同じく
// fflate で zip を開き、文字列を走査して抜き出す純関数。図形・画像・レイアウトは捨て、文字だけを拾う。
// - スライド順は ppt/presentation.xml の sldIdLst（＋rels）に従う（スライドを並べ替えた資料ではファイル名の
//   番号と表示順がずれるため）。読めなければ slideN.xml の番号順
// - 段落（<a:p>）ごとに改行。<a:br> は改行。スライド番号フィールドは除く
// - スライドノート（ppt/notesSlides）はスライドの rels から辿り「（ノート）」として続ける
// v3.145：
// - 非表示のスライド（ルート <p:sld show="0">）は抽出しない（件数を返す）。見出しの番号は元の順番のまま
// - スライドは1枚ずつ展開し、取り出した文字が maxChars に達したら残りは読まない
// - 走査は線形・zip の展開サイズと件数に上限（ooxmlCommon.ts）

import {
  decodeXmlEntities, getXmlAttr, unzipEntries, listZipNames, createZipBudget, decodeUtf8, parseRels,
  resolveRelTarget, trailingNumber, forEachElement, collectText, findOpenTagAttrs, truncateSafely, EXTRACT_CHAR_CAP,
} from "./ooxmlCommon";

export { isPptxFile } from "./officeFileKind";

const NOT_PPTX_MESSAGE = "PowerPointファイル（.pptx）として読み取れませんでした。古い .ppt 形式は非対応です。";

export interface PptxExtractResult {
  text: string;
  /** 非表示のため読まなかったスライドの数 */
  skippedHiddenSlides: number;
  /** 文字数の上限で打ち切った */
  truncated: boolean;
}

function paragraphsOf(xml: string, maxChars: number): string[] {
  const lines: string[] = [];
  let length = 0;
  forEachElement(xml, "a:p", (_attrs, inner) => {
    const raw = collectText(inner, {
      textTag: "a:t",
      skipTag: "a:fld",
      skipWhen: attrs => getXmlAttr(attrs, "type") === "slidenum",
      breaks: { "a:br": "\n" },
      maxChars,
    });
    for (const sub of decodeXmlEntities(raw).split("\n")) {
      const line = sub.trim();
      if (line !== "") {
        lines.push(line);
        length += line.length + 1;
      }
    }
    return length <= maxChars;
  });
  return lines;
}

/** .pptx のバイト列からスライドごとのテキストを抽出する（非表示スライドの件数つき）。失敗時は例外を投げる。 */
export function extractPptxDetailed(buf: Uint8Array, maxChars: number = EXTRACT_CHAR_CAP): PptxExtractResult {
  const names = listZipNames(buf, NOT_PPTX_MESSAGE);
  const nameSet = new Set(names);
  const slideFiles = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (slideFiles.length === 0) throw new Error("PowerPointファイルのスライド（slides）が見つかりませんでした。");

  const budget = createZipBudget();
  const meta = unzipEntries(
    buf,
    n => n === "ppt/presentation.xml" || n === "ppt/_rels/presentation.xml.rels",
    NOT_PPTX_MESSAGE,
    budget,
  );

  let ordered: string[] = [];
  if (meta["ppt/presentation.xml"] && meta["ppt/_rels/presentation.xml.rels"]) {
    const rels = parseRels(decodeUtf8(meta["ppt/_rels/presentation.xml.rels"]));
    forEachElement(decodeUtf8(meta["ppt/presentation.xml"]), "p:sldId", attrs => {
      const rid = getXmlAttr(attrs, "r:id");
      const target = rid !== undefined ? rels.get(rid) : undefined;
      if (target === undefined) return;
      const path = resolveRelTarget("ppt", target);
      if (nameSet.has(path)) ordered.push(path);
    });
  }
  if (ordered.length === 0) {
    ordered = [...slideFiles].sort((a, b) => trailingNumber(a) - trailingNumber(b));
  }

  const blocks: string[] = [];
  let length = 0;
  let truncated = false;
  let skippedHiddenSlides = 0;
  for (let i = 0; i < ordered.length; i++) {
    const path = ordered[i];
    if (truncated) break;
    const relsPath = path.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const entries = unzipEntries(buf, n => n === path || n === relsPath, NOT_PPTX_MESSAGE, budget);
    const slideBytes = entries[path];
    if (!slideBytes) continue;
    const slideXml = decodeUtf8(slideBytes);

    if (getXmlAttr(findOpenTagAttrs(slideXml, "p:sld") ?? "", "show") === "0") {
      skippedHiddenSlides += 1;
      continue;
    }

    const remaining = Math.max(maxChars - length, 1);
    const lines = paragraphsOf(slideXml, remaining);

    let noteLines: string[] = [];
    if (entries[relsPath]) {
      let notePath: string | undefined;
      forEachElement(decodeUtf8(entries[relsPath]), "Relationship", attrs => {
        const target = getXmlAttr(attrs, "Target");
        if (target === undefined || !/notesSlide\d+\.xml$/.test(target)) return;
        notePath = resolveRelTarget("ppt/slides", target);
        return false;
      });
      if (notePath && nameSet.has(notePath)) {
        const target = notePath;
        const noteEntries = unzipEntries(buf, n => n === target, NOT_PPTX_MESSAGE, budget);
        const noteBytes = noteEntries[target];
        if (noteBytes) noteLines = paragraphsOf(decodeUtf8(noteBytes), remaining);
      }
    }

    const parts = [`【スライド ${i + 1}】`, ...lines];
    if (noteLines.length > 0) parts.push("（ノート）", ...noteLines);
    const block = parts.join("\n");
    blocks.push(block);
    length += block.length + 2;
    if (length >= maxChars) truncated = i < ordered.length - 1 || length > maxChars;
  }
  const joined = blocks.join("\n\n");
  return {
    text: truncateSafely(joined, maxChars),
    skippedHiddenSlides,
    truncated: truncated || joined.length > maxChars,
  };
}

/** .pptx のバイト列からスライドごとのテキストを抽出する。失敗時は例外を投げる。 */
export function extractPptxTextFromBytes(buf: Uint8Array, maxChars: number = EXTRACT_CHAR_CAP): string {
  return extractPptxDetailed(buf, maxChars).text;
}

/** .pptx の File からテキストを抽出する。 */
export async function extractPptxText(file: File, maxChars: number = EXTRACT_CHAR_CAP): Promise<PptxExtractResult> {
  return extractPptxDetailed(new Uint8Array(await file.arrayBuffer()), maxChars);
}

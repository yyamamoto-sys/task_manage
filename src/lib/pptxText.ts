// src/lib/pptxText.ts
//
// 【設計意図】
// PowerPoint (.pptx) からスライドごとのテキストを抽出する（AI相談の添付用・v3.144）。docxText.ts と同じく
// fflate で zip を開き、正規表現で簡易抽出する純関数。図形・画像・レイアウトは捨て、文字だけを拾う。
// - スライド順は ppt/presentation.xml の sldIdLst（＋rels）に従う（スライドを並べ替えた資料ではファイル名の
//   番号と表示順がずれるため）。読めなければ slideN.xml の番号順
// - 段落（<a:p>）ごとに改行。<a:br> は改行。スライド番号フィールドは除く
// - スライドノート（ppt/notesSlides）はスライドの rels から辿り「（ノート）」として続ける

import {
  decodeXmlEntities, getXmlAttr, unzipEntries, decodeUtf8, parseRels, resolveRelTarget, trailingNumber,
} from "./ooxmlCommon";

const NOT_PPTX_MESSAGE = "PowerPointファイル（.pptx）として読み取れませんでした。古い .ppt 形式は非対応です。";

function paragraphsOf(xml: string): string[] {
  const cleaned = xml
    .replace(/<a:fld\b[^>]*type="slidenum"[\s\S]*?<\/a:fld>/g, "")
    .replace(/<a:t\b[^>]*\/>/g, "");
  const lines: string[] = [];
  for (const p of cleaned.split(/<\/a:p>/)) {
    const marked = p.replace(/<a:br\b[^>]*\/?>/g, "\n");
    const runs = [...marked.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|(\n)/g)].map(m => (m[2] ? "\n" : m[1]));
    const text = decodeXmlEntities(runs.join(""));
    for (const sub of text.split("\n")) {
      if (sub.trim() !== "") lines.push(sub.trim());
    }
  }
  return lines;
}

/** .pptx のバイト列からスライドごとのテキストを抽出する。失敗時は例外を投げる。 */
export function extractPptxTextFromBytes(buf: Uint8Array): string {
  const entries = unzipEntries(
    buf,
    n => n === "ppt/presentation.xml" || n === "ppt/_rels/presentation.xml.rels"
      || /^ppt\/slides\/slide\d+\.xml$/.test(n)
      || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n)
      || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n),
    NOT_PPTX_MESSAGE,
  );
  const slideFiles = Object.keys(entries).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (slideFiles.length === 0) throw new Error("PowerPointファイルのスライド（slides）が見つかりませんでした。");

  let ordered: string[] = [];
  if (entries["ppt/presentation.xml"] && entries["ppt/_rels/presentation.xml.rels"]) {
    const rels = parseRels(decodeUtf8(entries["ppt/_rels/presentation.xml.rels"]));
    for (const m of decodeUtf8(entries["ppt/presentation.xml"]).matchAll(/<p:sldId\b([^>]*?)\/?>/g)) {
      const rid = getXmlAttr(m[1], "r:id");
      const target = rid !== undefined ? rels.get(rid) : undefined;
      if (target === undefined) continue;
      const path = resolveRelTarget("ppt", target);
      if (entries[path]) ordered.push(path);
    }
  }
  if (ordered.length === 0) {
    ordered = [...slideFiles].sort((a, b) => trailingNumber(a) - trailingNumber(b));
  }

  const blocks: string[] = [];
  ordered.forEach((path, i) => {
    const lines = paragraphsOf(decodeUtf8(entries[path]));

    const relsPath = path.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    let noteLines: string[] = [];
    if (entries[relsPath]) {
      for (const m of decodeUtf8(entries[relsPath]).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        const target = getXmlAttr(m[1], "Target");
        if (target === undefined || !/notesSlide\d+\.xml$/.test(target)) continue;
        const notePath = resolveRelTarget("ppt/slides", target);
        if (entries[notePath]) noteLines = paragraphsOf(decodeUtf8(entries[notePath]));
        break;
      }
    }

    const parts = [`【スライド ${i + 1}】`, ...lines];
    if (noteLines.length > 0) parts.push("（ノート）", ...noteLines);
    blocks.push(parts.join("\n"));
  });
  return blocks.join("\n\n");
}

/** .pptx の File からテキストを抽出する。 */
export async function extractPptxText(file: File): Promise<string> {
  return extractPptxTextFromBytes(new Uint8Array(await file.arrayBuffer()));
}

export function isPptxFile(file: { type: string; name: string }): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return true;
  return (file.name.split(".").pop()?.toLowerCase() ?? "") === "pptx";
}

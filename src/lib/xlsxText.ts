// src/lib/xlsxText.ts
//
// 【設計意図】
// Excel (.xlsx) からシートごとのテキストを抽出する（AI相談の添付用・v3.144）。docxText.ts と同じく
// fflate で zip を開き、正規表現で簡易抽出する純関数。書式・罫線・グラフ・画像は捨て、値だけを拾う。
// - シート名は xl/workbook.xml ＋ xl/_rels/workbook.xml.rels で解決し、「■ シート名」の見出しを付ける
// - 1行＝1行、セルはタブ区切り（列位置は r="C3" の列から決めるので、途中の空セルもタブで保たれる）
// - 数式は計算結果（<v>）を使う。日付はシリアル値（数値）のまま出す（変換しない）
// - 空行・空シートは詰める。セル内の改行・タブは空白に置き換える（行構造を壊さないため）
// - 共有文字列のふりがな（<rPh>）は本文に含めない

import {
  decodeXmlEntities, getXmlAttr, unzipEntries, decodeUtf8, parseRels, resolveRelTarget, trailingNumber,
} from "./ooxmlCommon";

const NOT_XLSX_MESSAGE = "Excelファイル（.xlsx）として読み取れませんでした。古い .xls 形式は非対応です。";

/** <t>…</t> を連結する（ふりがな<rPh>は除外。自己終了の <t/> は空）。 */
function joinTextRuns(xml: string): string {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<t\b[^>]*\/>/g, "");
  return [...cleaned.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join("");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    out.push(decodeXmlEntities(joinTextRuns(m[1] ?? "")));
  }
  return out;
}

/** "AB12" → 列番号（A=0）。列が読めなければ -1。 */
function columnIndex(ref: string | undefined): number {
  const m = /^([A-Za-z]+)/.exec(ref ?? "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function flatten(s: string): string {
  return s.replace(/\r?\n|\r/g, " ").replace(/\t/g, " ");
}

function cellText(attrs: string, inner: string, shared: string[]): string {
  const type = getXmlAttr(attrs, "t");
  if (type === "inlineStr") return decodeXmlEntities(joinTextRuns(inner));
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  if (!v) return "";
  const raw = decodeXmlEntities(v[1]);
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

function sheetToText(xml: string, shared: string[]): string {
  const lines: string[] = [];
  for (const rowM of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowXml = rowM[1] ?? "";
    const cells: string[] = [];
    let next = 0;
    for (const c of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const col = columnIndex(getXmlAttr(attrs, "r"));
      const idx = col >= 0 ? col : next;
      next = idx + 1;
      const text = flatten(cellText(attrs, c[2] ?? "", shared));
      if (text === "") continue;
      while (cells.length < idx) cells.push("");
      cells[idx] = text;
    }
    const line = cells.join("\t");
    if (line.trim() !== "") lines.push(line);
  }
  return lines.join("\n");
}

/** .xlsx のバイト列からシートごとのテキストを抽出する。失敗時は例外を投げる。 */
export function extractXlsxTextFromBytes(buf: Uint8Array): string {
  const entries = unzipEntries(
    buf,
    n => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels"
      || /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
    NOT_XLSX_MESSAGE,
  );
  const sheetFiles = Object.keys(entries).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (sheetFiles.length === 0) throw new Error("Excelファイルのシート（worksheets）が見つかりませんでした。");

  const sharedXml = entries["xl/sharedStrings.xml"];
  const shared = parseSharedStrings(sharedXml ? decodeUtf8(sharedXml) : undefined);

  // 表示順のシート名。workbook.xml が読めなければファイル番号順・名前は「シートN」
  const ordered: { name: string; path: string }[] = [];
  if (entries["xl/workbook.xml"] && entries["xl/_rels/workbook.xml.rels"]) {
    const rels = parseRels(decodeUtf8(entries["xl/_rels/workbook.xml.rels"]));
    for (const m of decodeUtf8(entries["xl/workbook.xml"]).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const name = getXmlAttr(m[1], "name");
      const rid = getXmlAttr(m[1], "r:id");
      const target = rid !== undefined ? rels.get(rid) : undefined;
      if (name === undefined || target === undefined) continue;
      const path = resolveRelTarget("xl", target);
      if (entries[path]) ordered.push({ name, path });
    }
  }
  if (ordered.length === 0) {
    sheetFiles.sort((a, b) => trailingNumber(a) - trailingNumber(b));
    for (const path of sheetFiles) ordered.push({ name: `シート${trailingNumber(path)}`, path });
  }

  const blocks: string[] = [];
  for (const { name, path } of ordered) {
    const body = sheetToText(decodeUtf8(entries[path]), shared);
    if (body) blocks.push(`■ ${name}\n${body}`);
  }
  return blocks.join("\n\n");
}

/** .xlsx の File からテキストを抽出する。 */
export async function extractXlsxText(file: File): Promise<string> {
  return extractXlsxTextFromBytes(new Uint8Array(await file.arrayBuffer()));
}

export function isXlsxFile(file: { type: string; name: string }): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return true;
  return (file.name.split(".").pop()?.toLowerCase() ?? "") === "xlsx";
}

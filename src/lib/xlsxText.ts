// src/lib/xlsxText.ts
//
// 【設計意図】
// Excel (.xlsx) からシートごとのテキストを抽出する（AI相談の添付用・v3.144）。docxText.ts と同じく
// fflate で zip を開き、文字列を走査して抜き出す純関数。書式・罫線・グラフ・画像は捨て、値だけを拾う。
// - シート名は xl/workbook.xml ＋ xl/_rels/workbook.xml.rels で解決し、「■ シート名」の見出しを付ける
// - 1行＝1行、セルはタブ区切り（列位置は r="C3" の列から決めるので、途中の空セルもタブで保たれる）
// - 数式は計算結果（<v>）を使う。日付はシリアル値（数値）のまま出す（変換しない）
// - 空行・空シートは詰める。セル内の改行・タブは空白に置き換える（行構造を壊さないため）
// - 共有文字列のふりがな（<rPh>）は本文に含めない
// v3.145：
// - 非表示のシート（state="hidden"／"veryHidden"）は抽出しない（件数を返す）
// - 行内の連続する空セルのタブは最大 MAX_EMPTY_CELL_TABS 個に詰める（右端の遠い列に値が1つあるだけで
//   大量のタブが入るのを防ぐ。遠い列の位置関係は保たない）。行末の空セルは出さない
// - シートは1枚ずつ展開し、取り出した文字が maxChars に達したら残りのシートは読まない
// - 走査は線形・zip の展開サイズと件数に上限（ooxmlCommon.ts）

import {
  decodeXmlEntities, getXmlAttr, unzipEntries, listZipNames, createZipBudget, decodeUtf8, parseRels,
  resolveRelTarget, trailingNumber, forEachElement, collectText, truncateSafely, EXTRACT_CHAR_CAP,
} from "./ooxmlCommon";

export { isXlsxFile } from "./officeFileKind";

const NOT_XLSX_MESSAGE = "Excelファイル（.xlsx）として読み取れませんでした。古い .xls 形式は非対応です。";

/** 行内で連続する空セルとして出すタブの最大数。 */
export const MAX_EMPTY_CELL_TABS = 20;

export interface XlsxExtractResult {
  text: string;
  /** 非表示のため読まなかったシートの数 */
  skippedHiddenSheets: number;
  /** 文字数の上限で打ち切った（残りのシートまたは行を読んでいない） */
  truncated: boolean;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  forEachElement(xml, "si", (_attrs, inner) => {
    out.push(decodeXmlEntities(collectText(inner, { textTag: "t", skipTag: "rPh" })));
  });
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
  if (type === "inlineStr") {
    return decodeXmlEntities(collectText(inner, { textTag: "t", skipTag: "rPh" }));
  }
  let raw: string | undefined;
  forEachElement(inner, "v", (_a, text) => {
    raw = decodeXmlEntities(text);
    return false;
  });
  if (raw === undefined) return "";
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

/** 1枚のシートを行ごとのテキストにする。出力が maxChars を超えたら打ち切って truncated を返す。 */
function sheetToText(xml: string, shared: string[], maxChars: number): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let length = 0;
  let truncated = false;
  forEachElement(xml, "row", (_rowAttrs, rowInner) => {
    let line = "";
    let prevCol = 0;
    let hasValue = false;
    let nextCol = 0;
    forEachElement(rowInner, "c", (attrs, inner) => {
      const col = columnIndex(getXmlAttr(attrs, "r"));
      const idx = col >= 0 ? col : nextCol;
      nextCol = idx + 1;
      const text = flatten(cellText(attrs, inner, shared));
      if (text === "") return;
      line += "\t".repeat(Math.min(Math.max(idx - prevCol, 0), MAX_EMPTY_CELL_TABS + 1)) + text;
      prevCol = idx;
      hasValue = true;
    });
    if (hasValue && line.trim() !== "") {
      lines.push(line);
      length += line.length + 1;
      if (length > maxChars) {
        truncated = true;
        return false;
      }
    }
  });
  return { text: lines.join("\n"), truncated };
}

/** .xlsx のバイト列からシートごとのテキストを抽出する（非表示シートの件数つき）。失敗時は例外を投げる。 */
export function extractXlsxDetailed(buf: Uint8Array, maxChars: number = EXTRACT_CHAR_CAP): XlsxExtractResult {
  const names = listZipNames(buf, NOT_XLSX_MESSAGE);
  const sheetFiles = names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (sheetFiles.length === 0) throw new Error("Excelファイルのシート（worksheets）が見つかりませんでした。");

  const budget = createZipBudget();
  const meta = unzipEntries(
    buf,
    n => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels",
    NOT_XLSX_MESSAGE,
    budget,
  );
  const sharedXml = meta["xl/sharedStrings.xml"];
  const shared = parseSharedStrings(sharedXml ? decodeUtf8(sharedXml) : undefined);

  // 表示順のシート名。workbook.xml が読めなければファイル番号順・名前は「シートN」
  const ordered: { name: string; path: string; hidden: boolean }[] = [];
  if (meta["xl/workbook.xml"] && meta["xl/_rels/workbook.xml.rels"]) {
    const rels = parseRels(decodeUtf8(meta["xl/_rels/workbook.xml.rels"]));
    forEachElement(decodeUtf8(meta["xl/workbook.xml"]), "sheet", attrs => {
      const name = getXmlAttr(attrs, "name");
      const rid = getXmlAttr(attrs, "r:id");
      const target = rid !== undefined ? rels.get(rid) : undefined;
      if (name === undefined || target === undefined) return;
      const path = resolveRelTarget("xl", target);
      if (!sheetFiles.includes(path)) return;
      const state = getXmlAttr(attrs, "state");
      ordered.push({ name, path, hidden: state === "hidden" || state === "veryHidden" });
    });
  }
  if (ordered.length === 0) {
    const sorted = [...sheetFiles].sort((a, b) => trailingNumber(a) - trailingNumber(b));
    for (const path of sorted) ordered.push({ name: `シート${trailingNumber(path)}`, path, hidden: false });
  }

  const blocks: string[] = [];
  let length = 0;
  let truncated = false;
  let skippedHiddenSheets = 0;
  for (const sheet of ordered) {
    if (sheet.hidden) {
      skippedHiddenSheets += 1;
      continue;
    }
    if (truncated) continue;
    const entries = unzipEntries(buf, n => n === sheet.path, NOT_XLSX_MESSAGE, budget);
    const xml = entries[sheet.path];
    if (!xml) continue;
    const remaining = Math.max(maxChars - length, 1);
    const r = sheetToText(decodeUtf8(xml), shared, remaining);
    if (r.text) {
      const block = `■ ${sheet.name}\n${r.text}`;
      blocks.push(block);
      length += block.length + 2;
    }
    if (r.truncated || length >= maxChars) truncated = true;
  }
  const joined = blocks.join("\n\n");
  return {
    text: truncateSafely(joined, maxChars),
    skippedHiddenSheets,
    truncated: truncated || joined.length > maxChars,
  };
}

/** .xlsx のバイト列からシートごとのテキストを抽出する。失敗時は例外を投げる。 */
export function extractXlsxTextFromBytes(buf: Uint8Array, maxChars: number = EXTRACT_CHAR_CAP): string {
  return extractXlsxDetailed(buf, maxChars).text;
}

/** .xlsx の File からテキストを抽出する。 */
export async function extractXlsxText(file: File, maxChars: number = EXTRACT_CHAR_CAP): Promise<XlsxExtractResult> {
  return extractXlsxDetailed(new Uint8Array(await file.arrayBuffer()), maxChars);
}

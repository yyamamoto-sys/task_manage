// src/lib/xlsxGrid.ts
//
// 【設計意図・v3.189】
// Excel (.xlsx) のシートを「行×列の値の表」として読む（WBS取込用）。xlsxText.ts（AI相談の添付用）が
// 文字列に潰してしまう数値（日付のシリアル値）を、数値のまま返すために別に用意した。
// 解析の土台（fflate・ooxmlCommon・シート一覧の解決）は xlsxText.ts と同じものを使う（新しい依存は足さない）。
// 日付かどうかは書式（スタイル）を見ず、呼び出し側が「この列は日付」と決めて数値を日付に直す
// （wbsParse.ts）。ここは値をそのまま渡すだけ。
// 行は <row r="N"> の番号どおりの位置に置く（途中の空行が詰まらない＝「空行で表が終わる」判定が効く）。

import {
  decodeXmlEntities, getXmlAttr, unzipEntries, decodeUtf8, forEachElement, collectText,
} from "./ooxmlCommon";
import { resolveXlsxSheets, columnIndex } from "./xlsxText";

export type XlsxCellValue = string | number | null;

export interface XlsxGridSheet {
  name: string;
  rows: XlsxCellValue[][];
}

/** 読む行数・列数の上限（想定外に大きなシートで固まらないため）。右側の日付バー表示の列は値が無いので実質無関係。 */
export const MAX_GRID_ROWS = 5000;
export const MAX_GRID_COLS = 60;

const NOT_XLSX_MESSAGE = "Excelファイル（.xlsx）として読み取れませんでした。古い .xls 形式は非対応です。";

function cellValue(attrs: string, inner: string, shared: string[]): XlsxCellValue {
  const type = getXmlAttr(attrs, "t");
  if (type === "inlineStr") {
    return decodeXmlEntities(collectText(inner, { textTag: "t", skipTag: "rPh" }));
  }
  let raw: string | undefined;
  forEachElement(inner, "v", (_a, text) => {
    raw = decodeXmlEntities(text);
    return false;
  });
  if (raw === undefined || raw === "") return null;
  if (type === "s") return shared[Number(raw)] ?? null;
  if (type === "e") return null;
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (type === "str" || type === "d") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function sheetToGrid(xml: string, shared: string[]): XlsxCellValue[][] {
  const rows: XlsxCellValue[][] = [];
  let nextRow = 0;
  forEachElement(xml, "row", (rowAttrs, rowInner) => {
    const rAttr = Number(getXmlAttr(rowAttrs, "r"));
    const rowIdx = Number.isInteger(rAttr) && rAttr >= 1 ? rAttr - 1 : nextRow;
    nextRow = rowIdx + 1;
    if (rowIdx >= MAX_GRID_ROWS) return false;
    const cells: XlsxCellValue[] = [];
    let nextCol = 0;
    forEachElement(rowInner, "c", (attrs, inner) => {
      const col = columnIndex(getXmlAttr(attrs, "r"));
      const idx = col >= 0 ? col : nextCol;
      nextCol = idx + 1;
      if (idx >= MAX_GRID_COLS) return;
      const v = cellValue(attrs, inner, shared);
      if (v === null) return;
      while (cells.length < idx) cells.push(null);
      cells[idx] = v;
    });
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = cells;
  });
  return rows;
}

/** 表示されているシートを順に（優先名のシートを先頭に）値の表にして返す。失敗時は例外を投げる。 */
export function extractXlsxGrids(buf: Uint8Array, preferSheetName?: string): XlsxGridSheet[] {
  const { ordered, shared, budget } = resolveXlsxSheets(buf);
  const visible = ordered.filter(s => !s.hidden);
  const sorted = preferSheetName
    ? [...visible.filter(s => s.name === preferSheetName), ...visible.filter(s => s.name !== preferSheetName)]
    : visible;
  const out: XlsxGridSheet[] = [];
  for (const sheet of sorted) {
    const entries = unzipEntries(buf, n => n === sheet.path, NOT_XLSX_MESSAGE, budget);
    const xml = entries[sheet.path];
    if (!xml) continue;
    out.push({ name: sheet.name, rows: sheetToGrid(decodeUtf8(xml), shared) });
  }
  return out;
}

// WBS取込のテスト用：xlsx をテスト内で組み立てる（バイナリはコミットしない）。内容はすべて架空。
import { zipSync, strToU8 } from "fflate";

export type TestCell = string | number | null;
export interface TestSheet { name: string; rows: TestCell[][]; firstRow?: number; hidden?: boolean }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number) => String.fromCharCode(65 + i);

function sheetXml(sheet: TestSheet): string {
  const first = sheet.firstRow ?? 1;
  const rows = sheet.rows.map((cells, ri) => {
    const r = first + ri;
    const cs = cells.map((v, ci) => {
      if (v === null) return "";
      const ref = `${colName(ci)}${r}`;
      return typeof v === "number"
        ? `<c r="${ref}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join("");
    return cs === "" ? "" : `<row r="${r}">${cs}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function makeXlsx(sheets: TestSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheetTags = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("");
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`);
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return zipSync(files);
}

/** 2026-01-05 のExcelシリアル値（1900年系） */
export const SERIAL_20260105 = 46027;

export const HEADER = ["ID", "階層", "タスク名", "開始日", "終了日", "日数", "先行タスク", "備考"];

// src/lib/wbsImport/wbsColumns.ts
//
// 【設計意図・v3.198】
// 各種ツール（Asana・Jira・Redmine・Backlog など）の CSV／xlsx を、列の「役割」へ対応づけて WbsItem にする。
// ツール名は判定しない。見出しの文字だけで役割を推定する（大文字小文字・全半角・空白・記号を無視）。
// 推定が外れても画面で役割を選び直せる（階層の取り方も同様）。純粋関数。

import type { WbsCell } from "./wbsParse";
import { parseWbsDate } from "./wbsParse";
import type { WbsHierarchyMode, WbsItem } from "./wbsItems";
import { parseWbsStatus } from "./wbsItems";

export type ColumnRole = "id" | "name" | "parent" | "level" | "wbs" | "start" | "end" | "pred" | "assignee" | "status" | "memo";

export const COLUMN_ROLES: ColumnRole[] = ["id", "name", "parent", "level", "wbs", "start", "end", "pred", "assignee", "status", "memo"];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  id: "ID", name: "名前", parent: "親（ID）", level: "レベル", wbs: "WBS番号", start: "開始日", end: "終了日",
  pred: "先行タスク", assignee: "担当者", status: "状態・進捗", memo: "メモ",
};

/** 役割を決める順（同じ見出しが複数の役割に当てはまるとき、先の役割が取る） */
const ROLE_ORDER: ColumnRole[] = ["wbs", "parent", "level", "id", "name", "start", "end", "pred", "assignee", "status", "memo"];

const DICTIONARY: Record<ColumnRole, string[]> = {
  id: ["ID", "#", "Task ID", "Issue key", "Key", "キー", "課題キー", "No", "番号"],
  name: ["Name", "Task Name", "Summary", "Subject", "Title", "件名", "題名", "タスク名", "タイトル", "作業名", "タスク"],
  parent: ["Parent", "Parent Task", "Parent ID", "Parent issue", "Parent key", "親課題", "親チケット", "親タスク", "親ID", "親"],
  level: ["Outline Level", "Level", "階層", "レベル"],
  wbs: ["WBS", "Outline Number", "WBS番号"],
  start: ["Start", "Start Date", "開始日", "開始"],
  end: ["Due", "Due Date", "Finish", "End", "End Date", "期限日", "期日", "終了日", "締切日", "期限", "終了"],
  pred: ["Predecessors", "Predecessor", "Blocked By", "Depends on", "先行タスク", "先行"],
  assignee: ["Assignee", "Assigned To", "Owner", "Resource Names", "担当者", "担当"],
  status: ["Status", "% Complete", "Percent Complete", "状態", "ステータス", "進捗", "完了", "進捗率"],
  memo: ["Notes", "Description", "詳細", "説明", "備考", "メモ"],
};

export function normalizeHeaderKey(v: WbsCell): string {
  return String(v ?? "").normalize("NFKC").toLowerCase().replace(/[\s_\-.・]+/g, "");
}

const LOOKUP: Map<string, ColumnRole> = (() => {
  const m = new Map<string, ColumnRole>();
  for (const role of ROLE_ORDER) for (const w of DICTIONARY[role]) if (!m.has(normalizeHeaderKey(w))) m.set(normalizeHeaderKey(w), role);
  return m;
})();

/** 見出し1つの役割（辞書に無ければ null） */
export function guessRole(header: WbsCell): ColumnRole | null {
  return LOOKUP.get(normalizeHeaderKey(header)) ?? null;
}

export type TableHierarchy = "parent" | "level" | "wbs" | "indent" | "none";

export interface WbsColumnMapping {
  /** 役割ごとの列番号（0始まり）。無ければ -1 */
  columns: Record<ColumnRole, number>;
  hierarchy: TableHierarchy;
}

export interface WbsTable {
  header: string[];
  /** 見出しより下のデータ行 */
  rows: WbsCell[][];
  /** データ1行目の元の行番号（1始まり） */
  firstDataRow: number;
}

/** 行×列の値から、見出し行を探して表にする。見出しは先頭30行のうち「名前」の見出しを持つ最初の行、無ければ最初の空でない行 */
export function tableFromGrid(grid: WbsCell[][]): WbsTable | null {
  const filled = (r: WbsCell[]) => r.some(c => c !== null && c !== undefined && String(c).trim() !== "");
  let h = -1;
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    if ((grid[r] ?? []).some(c => guessRole(c) === "name")) { h = r; break; }
  }
  if (h < 0) h = grid.findIndex(filled);
  if (h < 0) return null;
  const rows = grid.slice(h + 1).filter(filled);
  if (rows.length === 0) return null;
  const width = Math.max((grid[h] ?? []).length, ...rows.map(r => r.length));
  const header = Array.from({ length: width }, (_, i) => String(grid[h][i] ?? "").trim());
  // 空行を除いたので、元の行番号は見出し直後の行を基準に数える（空行が挟まる表は警告の行番号が少しずれる）
  return { header, rows, firstDataRow: h + 2 };
}

const hasIndent = (v: WbsCell) => /^[ \t\u3000]/.test(String(v ?? ""));

export function autoMapping(table: WbsTable): WbsColumnMapping {
  const columns = Object.fromEntries(COLUMN_ROLES.map(r => [r, -1])) as Record<ColumnRole, number>;
  const taken = new Set<number>();
  for (const role of ROLE_ORDER) {
    const i = table.header.findIndex((h, k) => !taken.has(k) && guessRole(h) === role);
    if (i >= 0) { columns[role] = i; taken.add(i); }
  }
  // 名前の見出しが辞書に無いときは、使われていない最初の文字の列を名前にする
  if (columns.name < 0) {
    const i = table.header.findIndex((_h, k) => !taken.has(k));
    if (i >= 0) columns.name = i;
  }
  let hierarchy: TableHierarchy = "none";
  if (columns.parent >= 0) hierarchy = "parent";
  else if (columns.wbs >= 0) hierarchy = "wbs";
  else if (columns.level >= 0) hierarchy = "level";
  else if (columns.name >= 0 && table.rows.some(r => hasIndent(r[columns.name]))) hierarchy = "indent";
  return { columns, hierarchy };
}

export interface TableItemsResult {
  items: WbsItem[];
  mode: WbsHierarchyMode;
  warnings: string[];
}

const cellStr = (v: WbsCell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

export function itemsFromTable(table: WbsTable, mapping: WbsColumnMapping): TableItemsResult {
  const { columns: c, hierarchy } = mapping;
  const warnings: string[] = [];
  const get = (row: WbsCell[], role: ColumnRole): WbsCell => (c[role] >= 0 ? row[c[role]] : null);

  // レベル列：最小の値を最上位（0）にする（0始まりでも1始まりでも読める）
  let minLevel = Infinity;
  if (hierarchy === "level") {
    for (const r of table.rows) { const n = Number(cellStr(get(r, "level"))); if (Number.isFinite(n)) minLevel = Math.min(minLevel, n); }
  }
  const indentStack: number[] = [];
  let ambiguousDates = 0;

  const items: WbsItem[] = [];
  table.rows.forEach((row, i) => {
    const sourceRow = table.firstDataRow + i;
    const rawName = cellStr(get(row, "name"));
    if (rawName === "") {
      if (row.some(x => cellStr(x) !== "")) warnings.push(`${sourceRow}行目：名前が空のため読み飛ばしました。`);
      return;
    }
    const warns: string[] = [];
    let depth: number | undefined;
    if (hierarchy === "level") {
      const n = Number(cellStr(get(row, "level")));
      if (Number.isFinite(n)) depth = Math.max(0, n - minLevel);
      else { depth = 0; warns.push("レベルを数として読めないため、最上位として取り込みます"); }
    } else if (hierarchy === "wbs") {
      const w = cellStr(get(row, "wbs")).replace(/\.$/, "");
      if (/^\d+(\.\d+)*$/.test(w)) depth = w.split(".").length - 1;
      else { depth = 0; warns.push("WBS番号（1.2.3 の形）として読めないため、最上位として取り込みます"); }
    } else if (hierarchy === "indent") {
      const raw = String(get(row, "name") ?? "");
      const lead = /^[ \t\u3000]*/.exec(raw)?.[0] ?? "";
      let width = 0;
      for (const ch of lead) width += ch === "\t" ? 4 : ch === "\u3000" ? 2 : 1;
      while (indentStack.length > 0 && indentStack[indentStack.length - 1] > width) indentStack.pop();
      if (indentStack.length === 0 || indentStack[indentStack.length - 1] < width) indentStack.push(width);
      depth = indentStack.length - 1;
    } else if (hierarchy === "none") {
      depth = 0;
    }

    const startP = parseWbsDate(get(row, "start"));
    const endP = parseWbsDate(get(row, "end"));
    if (startP.invalid) warns.push("開始日を日付として読めません（日付なしで取り込みます）");
    if (endP.invalid) warns.push("終了日を日付として読めません（日付なしで取り込みます）");
    if (startP.ambiguous) ambiguousDates++;
    if (endP.ambiguous) ambiguousDates++;

    const idCell = c.id >= 0 ? cellStr(get(row, "id")) : hierarchy === "wbs" ? cellStr(get(row, "wbs")) : "";
    items.push({
      sourceRow,
      id: idCell !== "" ? idCell : `#${sourceRow}`,
      name: rawName,
      depth,
      parentId: hierarchy === "parent" ? cellStr(get(row, "parent")) : undefined,
      start: startP.value,
      end: endP.value,
      status: parseWbsStatus(get(row, "status")),
      milestone: false,
      predecessorText: cellStr(get(row, "pred")),
      assigneeText: cellStr(get(row, "assignee")),
      memo: cellStr(get(row, "memo")),
      warnings: warns,
    });
  });

  // 親の指定が ID に一致しないとき、一意な名前に一致すれば名前で解決する（Asana の「Parent Task」は親の名前が入る）
  if (hierarchy === "parent") {
    const ids = new Set(items.map(it => it.id));
    const byName = new Map<string, string[]>();
    for (const it of items) byName.set(it.name, [...(byName.get(it.name) ?? []), it.id]);
    for (const it of items) {
      const p = it.parentId ?? "";
      if (p === "" || ids.has(p)) continue;
      const hit = byName.get(p);
      if (hit && hit.length === 1) it.parentId = hit[0];
    }
  }

  if (ambiguousDates > 0) {
    warnings.push(`日付${ambiguousDates}件が「月/日/年」とも「日/月/年」とも読める形です。月/日/年として読みました。違う場合は元ファイルの日付を YYYY-MM-DD の形に直してから取り込んでください。`);
  }
  const mode: WbsHierarchyMode = hierarchy === "parent" ? "parent" : hierarchy === "none" ? "none" : "depth";
  return { items, mode, warnings };
}

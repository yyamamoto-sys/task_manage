// src/lib/wbsImport/wbsParse.ts
//
// 【設計意図・v3.189】
// 外部で作ったWBS（xlsx／Markdownの表）を読む純粋関数。AIは使わず、決まった規則だけで読む。
// 「取込形式」の列：ID／階層(G・P・C)／タスク名／開始日／終了日／先行タスク／備考（＋任意で担当者。「日数」は無視）。
// 列は見出しの名前で探す（順番違い・余分な列があっても動く）。見出し行は「ID」と「タスク名」を含む行を探す
// （行番号は固定しない）。データは最初のIDが出た行から、IDが空の行（凡例など）に当たるまで。
// 結合セルの見出し（縦に数行）は、見出し行の下にIDの無い行が続くだけなので「最初のIDまで読み飛ばす」で吸収する。
// ここは読むだけ。PJ・グループ・タスクへの当てはめは wbsPlan.ts。

import { resolvePredecessors, type PredSpec, type WbsPredecessor } from "./wbsPredecessors";

export type WbsCell = string | number | null | undefined;
/** 固定列テンプレートの階層（G=グループ／P=親タスク／C=その子タスク） */
export type WbsLevel = "G" | "P" | "C";
export type WbsStatus = "todo" | "in_progress" | "done";

export interface WbsRow {
  /** 取込結果の中での通し番号（0始まり・読んだ行の順） */
  index: number;
  /** 元の表での行番号（1始まり。画面の警告表示用） */
  sourceRow: number;
  id: string;
  /** グループ（PJ内 section）になる行か。タスクにはならない */
  isGroup: boolean;
  /** タスクの深さ（0=最上位。グループ行は 0）。v3.198 で G/P/C の3段から一般化 */
  depth: number;
  name: string;
  start: string | null;
  end: string | null;
  /** 先行タスク（解決できたものだけ。重複・自己参照・循環は除く）。種類（FS/SS/FF/SF）とずらし日数つき */
  predecessors: WbsPredecessor[];
  /** predecessors のIDだけ（確認画面・旧テスト用） */
  predecessorIds: string[];
  /** 構造で渡された先行の指定（MSPDI）。あれば predecessorText より優先して照合する */
  predSpecs?: PredSpec[];
  /** 先行タスクの元の文字列（確認画面に出す） */
  predecessorText: string;
  status: WbsStatus;
  milestone: boolean;
  /** 「ユーザー」「仮」などタグにする語 */
  tags: string[];
  /** 既知の語（完了・マイルストーン・ユーザー・仮）以外の備考。メモに残す */
  memo: string;
  assigneeText: string;
  /** 親タスクの index。グループと最上位のタスクは null */
  parentIndex: number | null;
  /** 属するグループ（G）の index。無ければ null */
  groupIndex: number | null;
  warnings: string[];
}

export interface WbsParseResult {
  title: string | null;
  rows: WbsRow[];
  /** 表全体の警告（見出しが見つからない等はエラーで返すのでここには出さない） */
  warnings: string[];
}

export type WbsParseOutcome = { ok: true; result: WbsParseResult } | { ok: false; error: string };

const KNOWN_REMARKS = ["完了", "マイルストーン", "ユーザー", "仮"] as const;
const TAG_REMARKS = ["ユーザー", "仮"];

function norm(v: WbsCell): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function normHeader(v: WbsCell): string {
  return norm(v).replace(/\s/g, "");
}

interface Columns {
  id: number;
  level: number;
  name: number;
  start: number;
  end: number;
  pred: number;
  remarks: number;
  assignee: number;
}

function findColumns(header: WbsCell[]): Columns | null {
  const h = header.map(normHeader);
  const find = (re: RegExp, skip: number[] = []) => h.findIndex((c, i) => c !== "" && !skip.includes(i) && re.test(c));
  const id = h.findIndex(c => /^id$/i.test(c));
  const name = find(/タスク名|^タスク$|^名称$|作業名/);
  if (id < 0 || name < 0) return null;
  return {
    id,
    level: find(/^階層$|^レベル$|^種別$/),
    name,
    start: find(/開始/),
    end: find(/終了|期日|完了日/),
    pred: find(/先行/),
    remarks: find(/備考|メモ/),
    assignee: find(/担当/),
  };
}

/** 年月日として実在するか確認して YYYY-MM-DD にする */
function toIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Excelのシリアル値（1900年系）→ YYYY-MM-DD。日付として妥当な範囲（1954〜2119年ごろ）のみ */
function serialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export interface ParsedDate {
  value: string | null;
  invalid: boolean;
  /** 「3/4/2026」のように M/D とも D/M とも読める（M/D として読んだ） */
  ambiguous?: boolean;
}

/** Excelの日付（シリアル値）・YYYY-MM-DD・YYYY/MM/DD・YYYY年M月D日・M/D/YYYY（英語ツール）・日時つきを読む。空は value=null・invalid=false */
export function parseWbsDate(cell: WbsCell): ParsedDate {
  if (cell === null || cell === undefined) return { value: null, invalid: false };
  if (typeof cell === "number") {
    const v = serialToIso(cell);
    return { value: v, invalid: v === null };
  }
  const s = norm(cell);
  if (s === "") return { value: null, invalid: false };
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) {
    const v = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    return { value: v, invalid: v === null };
  }
  const jp = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日?(?:[ T].*)?$/.exec(s);
  if (jp) {
    const v = toIso(Number(jp[1]), Number(jp[2]), Number(jp[3]));
    return { value: v, invalid: v === null };
  }
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(s);
  if (us) {
    const a = Number(us[1]);
    const b = Number(us[2]);
    const y = Number(us[3]);
    // 12を超える側が日。両方12以下は M/D と読み、曖昧として知らせる
    if (a > 12 && b <= 12) {
      const v = toIso(y, b, a);
      return { value: v, invalid: v === null };
    }
    const v = toIso(y, a, b);
    return { value: v, invalid: v === null, ambiguous: v !== null && a <= 12 && b <= 12 && a !== b };
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const v = serialToIso(Number(s));
    return { value: v, invalid: v === null };
  }
  return { value: null, invalid: true };
}

function parseLevel(raw: string, id: string): WbsLevel | null {
  const u = raw.trim().toUpperCase();
  if (u === "G" || u === "P" || u === "C") return u;
  if (u === "") {
    const depth = id.split(".").length;
    return depth === 1 ? "G" : depth === 2 ? "P" : depth === 3 ? "C" : null;
  }
  return null;
}

function parseRemarks(raw: string): { done: boolean; milestone: boolean; tags: string[]; memo: string } {
  const tokens = raw.split(/[・･,、，/／]+/).map(x => x.trim()).filter(x => x !== "");
  const known = new Set<string>(KNOWN_REMARKS);
  const unknown = tokens.filter(x => !known.has(x));
  return {
    done: tokens.includes("完了"),
    milestone: tokens.includes("マイルストーン"),
    tags: TAG_REMARKS.filter(t => tokens.includes(t)),
    memo: unknown.join("・"),
  };
}

const ID_LIKE = /^\d+(\.\d+)*$/;

/** 見出し行を探して読む。grid は行×列の値。title は見出しより上の最初の文字 */
export function parseWbsGrid(grid: WbsCell[][]): WbsParseOutcome {
  let headerRow = -1;
  let cols: Columns | null = null;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const c = findColumns(row);
    if (c) { headerRow = r; cols = c; break; }
  }
  if (headerRow < 0 || !cols) {
    return { ok: false, error: "見出し行（「ID」と「タスク名」を含む行）が見つかりませんでした。取り込める列の形式を確認してください。" };
  }

  let title: string | null = null;
  for (let r = 0; r < headerRow && title === null; r++) {
    for (const cell of grid[r] ?? []) {
      const t = norm(cell);
      if (t !== "") { title = t; break; }
    }
  }

  const warnings: string[] = [];
  const rows: WbsRow[] = [];
  const idToIndex = new Map<string, number>();
  const cell = (row: WbsCell[], i: number): WbsCell => (i >= 0 ? row[i] : null);

  let started = false;
  let r = headerRow + 1;
  for (; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const id = norm(cell(row, cols.id));
    if (id === "") {
      if (!started) continue;
      break;
    }
    started = true;
    const sourceRow = r + 1;
    const rowWarnings: string[] = [];
    const name = norm(cell(row, cols.name));
    const level = parseLevel(norm(cell(row, cols.level)), id);
    if (level === null) {
      warnings.push(`${sourceRow}行目（ID ${id}）：階層が G・P・C のどれでもないため読み飛ばしました。`);
      continue;
    }
    if (name === "") {
      warnings.push(`${sourceRow}行目（ID ${id}）：タスク名が空のため読み飛ばしました。`);
      continue;
    }
    const startP = parseWbsDate(cell(row, cols.start));
    const endP = parseWbsDate(cell(row, cols.end));
    let start = startP.value;
    let end = endP.value;
    if (startP.invalid) rowWarnings.push("開始日を日付として読めません（日付なしで取り込みます）");
    if (endP.invalid) rowWarnings.push("終了日を日付として読めません（日付なしで取り込みます）");
    if (start && end && start > end) {
      rowWarnings.push("開始日が終了日より後です（日付なしで取り込みます）");
      start = null;
      end = null;
    }
    const rem = parseRemarks(norm(cell(row, cols.remarks)));
    if (idToIndex.has(id)) rowWarnings.push(`IDが重複しています（先行タスクの指定には最初の行を使います）`);
    else idToIndex.set(id, rows.length);
    rows.push({
      index: rows.length,
      sourceRow,
      id,
      isGroup: level === "G",
      depth: level === "C" ? 1 : 0,
      name,
      start,
      end,
      predecessors: [],
      predecessorIds: [],
      predecessorText: norm(cell(row, cols.pred)),
      status: rem.done ? "done" : "todo",
      milestone: rem.milestone,
      tags: rem.tags,
      memo: rem.memo,
      assigneeText: norm(cell(row, cols.assignee)),
      parentIndex: null,
      groupIndex: null,
      warnings: rowWarnings,
    });
  }

  // 表の終わりより後ろに、まだIDらしい行がある＝別の表・途中の空行
  for (let k = r + 1; k < grid.length; k++) {
    const id = norm(cell(grid[k] ?? [], cols.id));
    if (ID_LIKE.test(id)) {
      warnings.push(`${r + 1}行目のIDが空の行で読み取りを終えました。${k + 1}行目以降にIDのある行がありますが、読んでいません（表の途中に空行がないか確認してください）。`);
      break;
    }
  }

  // 階層の組み立て（G直下にP、P直下にC。並びの順で親を決める）
  let curGroup: number | null = null;
  let curParent: number | null = null;
  for (const row of rows) {
    if (row.isGroup) {
      curGroup = row.index;
      curParent = null;
    } else if (row.depth === 0) {
      row.groupIndex = curGroup;
      curParent = row.index;
      if (curGroup === null) row.warnings.push("グループ（G）より前にあるため、グループに入れず取り込みます");
    } else {
      row.groupIndex = curGroup;
      if (curParent === null) {
        row.warnings.push("親（P）がありません。親なしのタスクとして取り込みます");
      } else {
        row.parentIndex = curParent;
        row.groupIndex = rows[curParent].groupIndex;
        const parentId = rows[curParent].id;
        if (ID_LIKE.test(row.id) && ID_LIKE.test(parentId) && !row.id.startsWith(`${parentId}.`)) {
          row.warnings.push(`IDが直前の親（${parentId}）の下の番号になっていません（並び順どおり親の下に入れます）`);
        }
      }
    }
  }

  resolvePredecessors(rows);

  if (rows.length === 0) {
    return { ok: false, error: "見出しの下に、取り込めるデータ行がありませんでした。" };
  }
  return { ok: true, result: { title, rows, warnings } };
}

// ===== Markdown =====

function splitMdRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map(c => c.replace(/\*\*|`/g, "").trim());
}

const MD_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Markdown の表（見出しに ID とタスク名を持つ最初の表）を読む。表より上の最初の見出し・文を title にする */
export function parseWbsMarkdown(text: string): WbsParseOutcome {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let title: string | null = null;
  let i = 0;
  const tableStarts: number[] = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().startsWith("|")) {
      if (i === 0 || !lines[i - 1].trim().startsWith("|")) tableStarts.push(i);
    } else if (title === null && tableStarts.length === 0 && l.trim() !== "") {
      title = l.replace(/^#+\s*/, "").trim();
    }
  }
  for (const start of tableStarts) {
    const grid: WbsCell[][] = [];
    for (let k = start; k < lines.length && lines[k].trim().startsWith("|"); k++) {
      if (MD_SEPARATOR.test(lines[k])) continue;
      grid.push(splitMdRow(lines[k]));
    }
    if (!grid.some(row => findColumns(row))) continue;
    const out = parseWbsGrid(grid);
    if (out.ok) return { ok: true, result: { ...out.result, title: title ?? out.result.title } };
    return out;
  }
  return { ok: false, error: "見出し行（「ID」と「タスク名」を含む表）が見つかりませんでした。取り込める列の形式を確認してください。" };
}

/** xlsx の各シート（優先順）を試し、見出しが見つかった最初のシートを読む */
export function parseWbsSheets(sheets: { name: string; rows: WbsCell[][] }[]): WbsParseOutcome {
  let firstError: string | null = null;
  for (const sheet of sheets) {
    const out = parseWbsGrid(sheet.rows);
    if (out.ok) return out;
    if (firstError === null) firstError = out.error;
  }
  return { ok: false, error: firstError ?? "読み取れるシートがありませんでした。" };
}

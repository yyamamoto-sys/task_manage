// src/lib/wbsImport/wbsItems.ts
//
// 【設計意図・v3.198】
// MS Project XML・各種ツールの CSV など「固定列テンプレート以外」の取り込みの共通の中間表現（WbsItem）と、
// それを確認画面・当てはめ（wbsPlan）が読む WbsRow へ組み立てる処理。
// - 階層は「深さ（depth）」か「親ID」のどちらかで来る。どちらも木にして、親が必ず子より前に並ぶ順（深さ優先）にする
//   （親ID は親が子より後ろにあっても解決する）。
// - groupTop（既定ON）：木の一番上の行のうち子を持つものを PJ内グループ（Section 78）にし、その子を深さ0のタスクにする。
//   子を持たない最上位の行はタスクのまま。OFF なら全行タスク。
// - タスクの深さは任意（Section 88）。MAX_TASK_DEPTH を超える枝は祖先の兄弟へ上げる。

import { MAX_TASK_DEPTH } from "../taskHierarchy";
import type { PredSpec } from "./wbsPredecessors";
import { resolvePredecessors } from "./wbsPredecessors";
import type { WbsCell, WbsParseResult, WbsRow, WbsStatus } from "./wbsParse";

export interface WbsItem {
  /** 元の表での行番号（1始まり。警告表示用） */
  sourceRow: number;
  /** 空なら「#行番号」を割り当てる */
  id: string;
  name: string;
  /** 深さで階層を持つとき（0始まり） */
  depth?: number;
  /** 親IDで階層を持つとき */
  parentId?: string;
  start: string | null;
  end: string | null;
  status: WbsStatus;
  milestone: boolean;
  predecessorText: string;
  predSpecs?: PredSpec[];
  assigneeText: string;
  memo: string;
  warnings: string[];
}

export type WbsHierarchyMode = "depth" | "parent" | "none";

export interface BuildRowsOptions {
  groupTop: boolean;
  mode: WbsHierarchyMode;
  title: string | null;
  /** 表全体の警告（読み取り側で出たもの） */
  warnings: string[];
}

/** 取り込める行数の上限（xlsx の MAX_GRID_ROWS に合わせる） */
export const MAX_IMPORT_ROWS = 5000;

const DONE_WORDS = new Set(["完了", "完了済み", "完了済", "済", "済み", "done", "closed", "resolved", "complete", "completed", "finished", "true", "yes", "○", "〇", "✓", "✔", "はい", "クローズ", "解決", "解決済み", "終了"]);
const DOING_WORDS = new Set(["進行中", "対応中", "処理中", "作業中", "着手中", "inprogress", "doing", "started", "wip"]);

/** 状態・進捗の欄を todo／in_progress／done にする。100%・完了系の語→done、1〜99%・進行中系の語→in_progress、他→todo */
export function parseWbsStatus(raw: WbsCell): WbsStatus {
  if (raw === null || raw === undefined) return "todo";
  // xlsx の数値セルは割合（0.5＝50%、1＝100%）。文字列の「1」は 1% として下で読む
  if (typeof raw === "number" && raw > 0 && raw <= 1) return raw >= 1 ? "done" : "in_progress";
  const s =String(raw).normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "") return "todo";
  if (DONE_WORDS.has(s)) return "done";
  if (DOING_WORDS.has(s)) return "in_progress";
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (pct) {
    const n = Number(pct[1]);
    return n >= 100 ? "done" : n > 0 ? "in_progress" : "todo";
  }
  // 単位なしの数値文字列は「パーセントの数」として読む
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 100) return "done";
    if (n > 0) return "in_progress";
  }
  return "todo";
}

interface Node {
  item: WbsItem;
  id: string;
  parent: number | null;
  children: number[];
}

function assignParents(items: WbsItem[], mode: WbsHierarchyMode, nodes: Node[], warn: (i: number, w: string) => void) {
  if (mode === "none") return;
  if (mode === "depth") {
    const stack: { depth: number; index: number }[] = [];
    items.forEach((it, i) => {
      const d = Math.max(0, it.depth ?? 0);
      while (stack.length > 0 && stack[stack.length - 1].depth >= d) stack.pop();
      const top = stack[stack.length - 1];
      nodes[i].parent = top ? top.index : null;
      if (d > 0 && !top) warn(i, "上の階層の行が無いため、最上位として取り込みます");
      else if (top && top.depth < d - 1) warn(i, "階層が飛んでいます（直前の上位の行の下に入れます）");
      stack.push({ depth: d, index: i });
    });
    return;
  }
  const idToIndex = new Map<string, number>();
  nodes.forEach((n, i) => { if (!idToIndex.has(n.id)) idToIndex.set(n.id, i); });
  items.forEach((it, i) => {
    const pid = (it.parentId ?? "").trim();
    if (pid === "") return;
    const pi = idToIndex.get(pid);
    if (pi === undefined) { warn(i, `親「${pid}」が見つかりません（最上位として取り込みます）`); return; }
    if (pi === i) { warn(i, "親が自分自身のため、最上位として取り込みます"); return; }
    nodes[i].parent = pi;
  });
  // 循環（A→B→A）は、辿って戻ってくる行の親を外して切る
  nodes.forEach((_n, i) => {
    const seen = new Set<number>([i]);
    let cur = nodes[i].parent;
    while (cur !== null) {
      if (seen.has(cur)) { nodes[i].parent = null; warn(i, "親をたどると循環するため、最上位として取り込みます"); return; }
      seen.add(cur);
      cur = nodes[cur].parent;
    }
  });
}

export function buildRowsFromItems(allItems: WbsItem[], opts: BuildRowsOptions): WbsParseResult {
  const warnings = [...opts.warnings];
  let items = allItems;
  if (items.length > MAX_IMPORT_ROWS) {
    warnings.push(`行数が多いため、先頭の${MAX_IMPORT_ROWS}行だけを取り込みます（全${items.length}行）。`);
    items = items.slice(0, MAX_IMPORT_ROWS);
  }
  const extra = new Map<number, string[]>();
  const warn = (i: number, w: string) => { const l = extra.get(i) ?? []; l.push(w); extra.set(i, l); };

  const nodes: Node[] = items.map(item => ({ item, id: item.id.trim() !== "" ? item.id.trim() : `#${item.sourceRow}`, parent: null, children: [] }));
  assignParents(items, opts.mode, nodes, warn);

  // MAX_TASK_DEPTH を超える枝は祖先の兄弟へ上げる
  const depthOf = (i: number): number => { let d = 0; let c = nodes[i].parent; while (c !== null) { d++; c = nodes[c].parent; } return d; };
  nodes.forEach((n, i) => {
    while (n.parent !== null && depthOf(i) > MAX_TASK_DEPTH - 1) {
      n.parent = nodes[n.parent].parent;
      warn(i, `階層が深すぎるため（上限${MAX_TASK_DEPTH}段）、上の階層へ引き上げます`);
    }
  });
  nodes.forEach((n, i) => { if (n.parent !== null) nodes[n.parent].children.push(i); });

  const roots = nodes.map((n, i) => (n.parent === null ? i : -1)).filter(i => i >= 0);
  const order: number[] = [];
  const dfs = (i: number) => { order.push(i); for (const c of nodes[i].children) dfs(c); };
  roots.forEach(dfs);

  const newIndex = new Map<number, number>();
  order.forEach((old, ni) => newIndex.set(old, ni));
  const isGroup = (i: number) => opts.groupTop && nodes[i].parent === null && nodes[i].children.length > 0;
  const rootOf = (i: number): number => { let c = i; while (nodes[c].parent !== null) c = nodes[c].parent as number; return c; };

  const idCount = new Map<string, number>();
  nodes.forEach(n => idCount.set(n.id, (idCount.get(n.id) ?? 0) + 1));

  const rows: WbsRow[] = order.map((old, ni) => {
    const n = nodes[old];
    const it = n.item;
    const group = isGroup(old);
    const root = rootOf(old);
    const inGroup = opts.groupTop && root !== old && isGroup(root);
    const treeDepth = depthOf(old);
    const rowWarnings = [...it.warnings, ...(extra.get(old) ?? [])];
    let start = it.start;
    let end = it.end;
    if (start && end && start > end) {
      rowWarnings.push("開始日が終了日より後です（日付なしで取り込みます）");
      start = null;
      end = null;
    }
    if ((idCount.get(n.id) ?? 0) > 1) rowWarnings.push("IDが重複しています（先行タスクの指定には最初の行を使います）");
    let parentIndex: number | null = null;
    if (n.parent !== null && !isGroup(n.parent)) parentIndex = newIndex.get(n.parent) ?? null;
    return {
      index: ni,
      sourceRow: it.sourceRow,
      id: n.id,
      isGroup: group,
      depth: group ? 0 : inGroup ? treeDepth - 1 : treeDepth,
      name: it.name,
      start,
      end,
      predecessors: [],
      predecessorIds: [],
      predSpecs: it.predSpecs,
      predecessorText: it.predecessorText,
      status: it.status,
      milestone: it.milestone,
      tags: [],
      memo: it.memo,
      assigneeText: it.assigneeText,
      parentIndex,
      groupIndex: inGroup ? newIndex.get(root) ?? null : null,
      warnings: rowWarnings,
    };
  });
  resolvePredecessors(rows);
  return { title: opts.title, rows, warnings };
}

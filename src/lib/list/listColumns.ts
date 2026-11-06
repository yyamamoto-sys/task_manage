// src/lib/list/listColumns.ts
//
// 【設計意図・v3.202】
// リスト（PC表）の列の表示／非表示。☐（select）とタスク名（name）は常に表示で、隠せるのは
// 期日・担当者・状態・優先度・工数の5列だけ。保存先は個人設定（localStorage の
// LIST_VIEW_SETTINGS 内の "columns"＝表示する列キーの配列）。
// 🔴 壊れた値・未知の列名が1つでも混じっていたら、一部だけ救わず既定（全列表示）に戻す。
// 「半端に隠れた列」が原因不明のまま残るより、全部見える状態に戻る方が利用者に分かりやすい。

export const TOGGLEABLE_COLUMNS = ["due_date", "assignee", "status", "priority", "estimated_hours"] as const;
export type ToggleableColumn = (typeof TOGGLEABLE_COLUMNS)[number];

export const COLUMN_LABELS: Record<ToggleableColumn, string> = {
  due_date: "期日",
  assignee: "担当者",
  status: "状態",
  priority: "優先度",
  estimated_hours: "工数",
};

export const DEFAULT_VISIBLE_COLUMNS: readonly ToggleableColumn[] = TOGGLEABLE_COLUMNS;

const KNOWN = new Set<string>(TOGGLEABLE_COLUMNS);

function canonical(set: ReadonlySet<string>): ToggleableColumn[] {
  return TOGGLEABLE_COLUMNS.filter(k => set.has(k));
}

/** 保存値 → 表示する列（表の列順に正規化）。配列でない・未知の列名を含む場合は全列表示。 */
export function parseVisibleColumns(raw: unknown): ToggleableColumn[] {
  if (!Array.isArray(raw)) return [...DEFAULT_VISIBLE_COLUMNS];
  for (const v of raw) {
    if (typeof v !== "string" || !KNOWN.has(v)) return [...DEFAULT_VISIBLE_COLUMNS];
  }
  return canonical(new Set(raw as string[]));
}

export function toggleColumn(visible: readonly ToggleableColumn[], key: ToggleableColumn): ToggleableColumn[] {
  const set = new Set<string>(visible);
  if (set.has(key)) set.delete(key); else set.add(key);
  return canonical(set);
}

export function sameColumns(a: readonly ToggleableColumn[], b: readonly ToggleableColumn[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

/** 列定義から、常に表示（☐・タスク名）＋ visible に含まれる列だけを残す（元の順序のまま）。 */
export function filterVisibleColumns<T extends { key: string }>(cols: readonly T[], visible: readonly ToggleableColumn[]): T[] {
  const set = new Set<string>(visible);
  return cols.filter(c => !KNOWN.has(c.key) || set.has(c.key));
}

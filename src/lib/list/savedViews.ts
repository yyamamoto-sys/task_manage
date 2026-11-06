// src/lib/list/savedViews.ts
//
// 【設計意図・v3.203】
// リストの「保存ビュー」＝まとめ方・フィルター・並べ替え・列の表示を名前を付けて残し、ワンクリックで戻す。
// 保存先は localStorage（個人設定・部署ごとにキーを分ける。キー生成は savedViewsKey）。
// 保存しないもの：検索文字列・選択中のタスク・折りたたみ状態・「自分担当のみ」（担当者フィルターと排他の一時的な切替）。
//
// 🔴 読み込みは「ビュー全体を捨てない」。壊れた項目・未知の値はその項目だけ既定値に落とす。
//    ただし version が未知（将来の形式）のときは中身を解釈できないので空として扱う。
// 🔴 存在しないメンバー id の検証（memberIds を渡したとき）は「適用するとき」に行い、保存データ側は書き換えない。
//    メンバー一覧の読み込み前に parse して書き戻すと、有効な担当者フィルターまで消えるため。

import { DEFAULT_VISIBLE_COLUMNS, parseVisibleColumns, sameColumns, type ToggleableColumn } from "./listColumns";

export const SAVED_VIEWS_VERSION = 1;
export const MAX_SAVED_VIEWS = 20;
export const MAX_VIEW_NAME_LENGTH = 30;

export const GROUP_BY_VALUES = ["project", "assignee", "status", "tag"] as const;
export const STATUS_FILTER_VALUES = ["all", "todo", "in_progress", "on_hold", "done", "cancelled"] as const;
export const PRIORITY_FILTER_VALUES = ["all", "high", "mid", "low"] as const;
export const SORT_KEY_VALUES = ["name", "due_date", "priority", "estimated_hours", "status", "assignee", "manual"] as const;
export const SORT_DIR_VALUES = ["asc", "desc"] as const;

export interface ListViewSettings {
  groupBy: (typeof GROUP_BY_VALUES)[number];
  filterStatus: (typeof STATUS_FILTER_VALUES)[number];
  filterPriority: (typeof PRIORITY_FILTER_VALUES)[number];
  sortKey: (typeof SORT_KEY_VALUES)[number];
  sortDir: (typeof SORT_DIR_VALUES)[number];
  filterHideDone: boolean;
  filterThisWeek: boolean;
  /** "all" または member id */
  filterMember: string;
  columns: ToggleableColumn[];
}

export interface SavedView {
  id: string;
  name: string;
  settings: ListViewSettings;
}

export const DEFAULT_LIST_SETTINGS: ListViewSettings = {
  groupBy: "project",
  filterStatus: "all",
  filterPriority: "all",
  sortKey: "due_date",
  sortDir: "asc",
  filterHideDone: false,
  filterThisWeek: false,
  filterMember: "all",
  columns: [...DEFAULT_VISIBLE_COLUMNS],
};

/** 部署ごとの保存キー。groupId が未確定（null）の間は "none" 枠に入る。 */
export function savedViewsKey(baseKey: string, groupId: string | null | undefined): string {
  return `${baseKey}:${groupId ?? "none"}`;
}

function pick<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** 1つのビューの設定を検証する。項目単位で既定値に落とす。memberIds が null のときはメンバー検証をしない。 */
export function sanitizeListSettings(raw: unknown, memberIds: ReadonlySet<string> | null): ListViewSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LIST_SETTINGS;
  const sortKey = pick(SORT_KEY_VALUES, o.sortKey, d.sortKey);
  // 手動並べ替えは「PJ別」でしか成り立たない（ツールバーの手動切替が groupBy を project に固定するのと同じ）
  const groupBy = sortKey === "manual" ? "project" : pick(GROUP_BY_VALUES, o.groupBy, d.groupBy);
  let filterMember = typeof o.filterMember === "string" && o.filterMember !== "" ? o.filterMember : "all";
  if (filterMember !== "all" && memberIds && !memberIds.has(filterMember)) filterMember = "all";
  return {
    groupBy,
    filterStatus: pick(STATUS_FILTER_VALUES, o.filterStatus, d.filterStatus),
    filterPriority: pick(PRIORITY_FILTER_VALUES, o.filterPriority, d.filterPriority),
    sortKey,
    sortDir: pick(SORT_DIR_VALUES, o.sortDir, d.sortDir),
    filterHideDone: o.filterHideDone === true,
    filterThisWeek: o.filterThisWeek === true,
    filterMember,
    columns: parseVisibleColumns(o.columns),
  };
}

/** 保存文字列 → ビュー一覧。壊れた JSON・未知の version は空。壊れたビュー1件は捨てるが他は残す。 */
export function parseSavedViews(text: string | null, memberIds: ReadonlySet<string> | null): SavedView[] {
  if (!text) return [];
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  if (!data || typeof data !== "object") return [];
  const obj = data as { version?: unknown; views?: unknown };
  if (obj.version !== SAVED_VIEWS_VERSION || !Array.isArray(obj.views)) return [];
  const out: SavedView[] = [];
  const seen = new Set<string>();
  for (const v of obj.views) {
    if (out.length >= MAX_SAVED_VIEWS) break;
    if (!v || typeof v !== "object") continue;
    const r = v as { id?: unknown; name?: unknown; settings?: unknown };
    if (typeof r.id !== "string" || r.id === "" || seen.has(r.id)) continue;
    const name = normalizeViewName(r.name);
    if (name === null) continue;
    seen.add(r.id);
    out.push({ id: r.id, name, settings: sanitizeListSettings(r.settings, memberIds) });
  }
  return out;
}

export function serializeSavedViews(views: readonly SavedView[]): string {
  return JSON.stringify({ version: SAVED_VIEWS_VERSION, views: views.slice(0, MAX_SAVED_VIEWS) });
}

/** 名前を整える（前後の空白除去・30字まで）。空・文字列でないときは null。 */
export function normalizeViewName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const t = name.trim();
  if (t === "") return null;
  return t.length > MAX_VIEW_NAME_LENGTH ? t.slice(0, MAX_VIEW_NAME_LENGTH) : t;
}

export function isSameSettings(a: ListViewSettings, b: ListViewSettings): boolean {
  return a.groupBy === b.groupBy
    && a.filterStatus === b.filterStatus
    && a.filterPriority === b.filterPriority
    && a.sortKey === b.sortKey
    && a.sortDir === b.sortDir
    && a.filterHideDone === b.filterHideDone
    && a.filterThisWeek === b.filterThisWeek
    && a.filterMember === b.filterMember
    && sameColumns(a.columns, b.columns);
}

export function canAddView(views: readonly SavedView[]): boolean {
  return views.length < MAX_SAVED_VIEWS;
}

export function addView(views: readonly SavedView[], view: SavedView): SavedView[] {
  return canAddView(views) ? [...views, view] : [...views];
}

export function renameView(views: readonly SavedView[], id: string, name: string): SavedView[] {
  const n = normalizeViewName(name);
  if (n === null) return [...views];
  return views.map(v => (v.id === id ? { ...v, name: n } : v));
}

export function overwriteView(views: readonly SavedView[], id: string, settings: ListViewSettings): SavedView[] {
  return views.map(v => (v.id === id ? { ...v, settings } : v));
}

export function removeView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter(v => v.id !== id);
}

export function newViewId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

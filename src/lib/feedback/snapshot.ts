// src/lib/feedback/snapshot.ts
//
// ご意見に自動で添える「画面の状況」のスナップショット（v3.157・CLAUDE.md Section 82）。
// 画像ではなく構造化データ（列挙値・数値・ID・要素の種類）で再現できる情報だけを送る。
//
// 🔴 許可リスト方式の純関数：任意の DOM・state を丸ごと直列化しない。入力（getter の返り値・クリック履歴・環境）から、
//    ここで名指しした項目だけを、型・形式を検査して取り出す。画面に表示された文字列（タスク名・PJ名・コメント・検索語）は
//    取り出す項目に存在しない（検索欄は「入力があるか」の真偽だけ）。形式に合わない値は捨てる（黙って落とす）。
// 🔴 メール・表示名は含めない（送信者は RPC が member_id で決める）。選択中のPJ・タスクは ID のみ（名前は送らない）。
// 上限16KB：超えたら finalizeSnapshot が null と too_large を返し、本文だけを送る（本文を落とさない）。
// DB 側（submit_feedback の sanitize_feedback_json）にも同じ思想の検証があり、二重になっている。

import { parseUserAgent, type BrowserName, type OsName } from "./browserInfo";
import type { ClickRecord } from "./clickHistory";
import {
  FEEDBACK_CLICK_HISTORY_MAX, FEEDBACK_SNAPSHOT_MAX_BYTES, FEEDBACK_SNAPSHOT_VERSION,
} from "./constants";
import { extractOpenTarget } from "../reminder/deepLink";

// ===== 形式の検査（許可リストの部品） =====

const TOKEN_RE = /^[A-Za-z0-9_:.-]{1,48}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function tokenOf(v: unknown): string | undefined {
  return typeof v === "string" && TOKEN_RE.test(v) ? v : undefined;
}
function idOf(v: unknown): string | undefined {
  return typeof v === "string" && ID_RE.test(v) ? v : undefined;
}
function boolOf(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function intOf(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined;
}
function objOf(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
/** undefined のキーを落とす（JSON を小さく保ち、「無い」と「null」を区別しない） */
function compact<T extends Record<string, unknown>>(o: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? (out as T) : undefined;
}

// ===== スナップショットの型 =====

export interface FeedbackClickEntry {
  tag: string;
  role?: string;
  tour?: string;
  /** 何ミリ秒前か（スナップショットを確定した時点から） */
  agoMs: number;
  x?: number;
  y?: number;
  /** ビューポート比（0〜1） */
  rx?: number;
  ry?: number;
}

export interface FeedbackSnapshot {
  v: typeof FEEDBACK_SNAPSHOT_VERSION;
  takenAt: string;
  screen?: string;
  mode?: string;
  view?: string;
  overlay?: string;
  settingsPage?: string;
  route?: string;
  app: { version: string };
  env: {
    browser: BrowserName;
    browserMajor?: number;
    os: OsName;
    isMobile?: boolean;
    viewport: { w: number; h: number };
    display?: { w: number; h: number };
    dpr?: number;
    /** devicePixelRatio×100。ブラウザの拡大とOSの表示倍率の合算（どちらかは区別できない） */
    zoomPct?: number;
    lang?: string;
    theme?: string;
  };
  department?: { displayGroupId?: string };
  selection?: { projectId?: string; taskId?: string; selectedCount?: number };
  listSettings?: {
    groupBy?: string; sortKey?: string; sortDir?: string; density?: string;
    filters?: { status?: string; priority?: string; myOnly?: boolean; thisWeek?: boolean; hideDone?: boolean; member?: string; hasSearch?: boolean };
  };
  ganttSettings?: {
    mode?: string; dayWidth?: number; hideCompleted?: boolean; sortOrder?: string;
    showDeps?: boolean; showBaseline?: boolean; showCriticalPath?: boolean; showOverload?: boolean;
  };
  kanbanSettings?: { hideDone?: boolean; showPaused?: boolean; hasSectionFilter?: boolean };
  clicks: FeedbackClickEntry[];
}

/**
 * スナップショットの最上位のキー（許可リスト）。DB の submit_feedback が残すキーと同じでなければならない
 * （feedbackMigration.test.ts が SQL の配列と照合する）。キーを足すときは両方に足す。
 */
export const SNAPSHOT_TOP_LEVEL_KEYS: readonly string[] = [
  "v", "takenAt", "mode", "view", "overlay", "settingsPage", "route", "screen", "app", "env",
  "department", "selection", "listSettings", "ganttSettings", "kanbanSettings", "clicks",
];

export interface SnapshotBuildInput {
  /** スナップショットを確定した時刻（ms） */
  now: number;
  /** 表示中の画面名（getClientErrorScreen） */
  screen: string | null;
  /** pathname と、既知の open だけの経路（buildFeedbackRoute の結果） */
  route: string | null;
  appVersion: string;
  userAgent: string | null;
  viewport: { w: number; h: number };
  display?: { w: number; h: number } | null;
  dpr?: number | null;
  /** collectSnapshotContext() の結果（画面側の getter が返した値） */
  context: Record<string, unknown>;
  clicks: readonly ClickRecord[];
}

/** 現在の経路。pathname と既知の open（extractOpenTarget）だけ。クエリ・ハッシュは捨てる（招待コード対策） */
export function buildFeedbackRoute(pathname: string, search: string): string {
  const path = /^\/[A-Za-z0-9_./-]{0,60}$/.test(pathname) ? pathname : "/";
  const open = extractOpenTarget(search);
  return open ? `${path}?open=${open}` : path;
}

function buildClicks(clicks: readonly ClickRecord[], now: number): FeedbackClickEntry[] {
  return clicks.slice(-FEEDBACK_CLICK_HISTORY_MAX).map((c) => {
    const hasPoint = c.x !== null && c.y !== null && c.vw > 0 && c.vh > 0;
    const entry: FeedbackClickEntry = {
      tag: tokenOf(c.tag) ?? "unknown",
      agoMs: Math.max(0, Math.round(now - c.at)),
    };
    const role = tokenOf(c.role); if (role) entry.role = role;
    const tour = tokenOf(c.tour); if (tour) entry.tour = tour;
    if (hasPoint) {
      entry.x = c.x as number;
      entry.y = c.y as number;
      entry.rx = Math.round(((c.x as number) / c.vw) * 1000) / 1000;
      entry.ry = Math.round(((c.y as number) / c.vh) * 1000) / 1000;
    }
    return entry;
  });
}

function buildListSettings(raw: unknown): FeedbackSnapshot["listSettings"] {
  const o = objOf(raw);
  if (!o) return undefined;
  const f = objOf(o.filters);
  return compact({
    groupBy: tokenOf(o.groupBy), sortKey: tokenOf(o.sortKey), sortDir: tokenOf(o.sortDir), density: tokenOf(o.density),
    filters: f ? compact({
      status: tokenOf(f.status), priority: tokenOf(f.priority),
      myOnly: boolOf(f.myOnly), thisWeek: boolOf(f.thisWeek), hideDone: boolOf(f.hideDone),
      member: f.member === "all" || f.member === "set" ? f.member : undefined,
      hasSearch: boolOf(f.hasSearch),
    }) : undefined,
  });
}

function buildGanttSettings(raw: unknown): FeedbackSnapshot["ganttSettings"] {
  const o = objOf(raw);
  if (!o) return undefined;
  return compact({
    mode: tokenOf(o.mode), dayWidth: intOf(o.dayWidth, 1, 400), hideCompleted: boolOf(o.hideCompleted), sortOrder: tokenOf(o.sortOrder),
    showDeps: boolOf(o.showDeps), showBaseline: boolOf(o.showBaseline), showCriticalPath: boolOf(o.showCriticalPath), showOverload: boolOf(o.showOverload),
  });
}

function buildKanbanSettings(raw: unknown): FeedbackSnapshot["kanbanSettings"] {
  const o = objOf(raw);
  if (!o) return undefined;
  return compact({ hideDone: boolOf(o.hideDone), showPaused: boolOf(o.showPaused), hasSectionFilter: boolOf(o.hasSectionFilter) });
}

/** 許可リストで組み立てる。入力に余計なキー・文字列があっても、ここで名指しした項目以外は出力に現れない */
export function buildFeedbackSnapshot(input: SnapshotBuildInput): FeedbackSnapshot {
  const ctx = input.context;
  const ua = parseUserAgent(input.userAgent);
  const dpr = typeof input.dpr === "number" && Number.isFinite(input.dpr) && input.dpr > 0 && input.dpr < 20
    ? Math.round(input.dpr * 100) / 100 : undefined;
  const disp = input.display;
  const dep = objOf(ctx.department);
  const sel = objOf(ctx.selection);

  const snapshot: FeedbackSnapshot = {
    v: FEEDBACK_SNAPSHOT_VERSION,
    takenAt: new Date(input.now).toISOString(),
    screen: tokenOf(input.screen),
    mode: tokenOf(ctx.mode),
    view: tokenOf(ctx.view),
    overlay: tokenOf(ctx.overlay),
    settingsPage: tokenOf(ctx.settingsPage),
    route: typeof input.route === "string" && input.route.length <= 80 && /^\/[A-Za-z0-9_./-]*(\?open=[a-z-]+)?$/.test(input.route) ? input.route : undefined,
    app: { version: tokenOf(input.appVersion) ?? "unknown" },
    env: {
      browser: ua.browser,
      browserMajor: ua.major ?? undefined,
      os: ua.os,
      isMobile: boolOf(ctx.isMobile),
      viewport: { w: intOf(input.viewport.w, 0, 20000) ?? 0, h: intOf(input.viewport.h, 0, 20000) ?? 0 },
      display: disp ? { w: intOf(disp.w, 0, 20000) ?? 0, h: intOf(disp.h, 0, 20000) ?? 0 } : undefined,
      dpr,
      zoomPct: dpr !== undefined ? Math.round(dpr * 100) : undefined,
      lang: tokenOf(ctx.lang),
      theme: tokenOf(ctx.theme),
    },
    department: dep ? compact({ displayGroupId: idOf(dep.displayGroupId) }) : undefined,
    selection: sel ? compact({ projectId: idOf(sel.projectId), taskId: idOf(sel.taskId), selectedCount: intOf(sel.selectedCount, 0, 100000) }) : undefined,
    listSettings: buildListSettings(ctx.listSettings),
    ganttSettings: buildGanttSettings(ctx.ganttSettings),
    kanbanSettings: buildKanbanSettings(ctx.kanbanSettings),
    clicks: buildClicks(input.clicks, input.now),
  };
  // undefined のキーを落とす（JSON.stringify も落とすが、等値比較・テストで「無い」を揃えるため）
  const clean = JSON.parse(JSON.stringify(snapshot)) as FeedbackSnapshot;
  return clean;
}

export function serializeSnapshot(snapshot: FeedbackSnapshot): { json: string; bytes: number } {
  const json = JSON.stringify(snapshot);
  return { json, bytes: new TextEncoder().encode(json).length };
}

export interface FinalizedSnapshot {
  snapshot: FeedbackSnapshot | null;
  /** DB の snapshot_state に渡す値（付けた／16KB超で外した） */
  state: "attached" | "too_large";
  bytes: number;
}

/** 16KB を超えたら外す（本文だけを送る。本文を落とさない） */
export function finalizeSnapshot(snapshot: FeedbackSnapshot, maxBytes: number = FEEDBACK_SNAPSHOT_MAX_BYTES): FinalizedSnapshot {
  const { bytes } = serializeSnapshot(snapshot);
  if (bytes > maxBytes) return { snapshot: null, state: "too_large", bytes };
  return { snapshot, state: "attached", bytes };
}

// ===== プレビュー（人が読む1行ずつの要約） =====

export type SnapshotSummaryId = "screen" | "app" | "browser" | "window" | "department" | "selection" | "display" | "clicks";
export interface SnapshotSummaryLine { id: SnapshotSummaryId; value: string }

/** 要約の項目名（日本語。Claude 用コピーで使う。画面のプレビューは i18n の layout.feedback.sum.<id>） */
export const SNAPSHOT_SUMMARY_LABEL_JA: Record<SnapshotSummaryId, string> = {
  screen: "画面", app: "アプリの版", browser: "ブラウザ", window: "ウィンドウ", department: "表示部署",
  selection: "選択中", display: "表示設定", clicks: "直前の操作",
};

const VIEW_LABEL: Record<string, string> = {
  list: "リスト", gantt: "ガント", kanban: "カンバン", dashboard: "ダッシュボード", workload: "稼働状況",
  settings: "設定", guide: "ガイド", okr: "OKR",
};
const MODE_LABEL: Record<string, string> = { plan: "計画モード", okr: "OKRモード" };
const OVERLAY_LABEL: Record<string, string> = { settings: "設定", guide: "ガイド" };
const TAG_LABEL: Record<string, string> = {
  button: "ボタン", a: "リンク", input: "入力欄", select: "選択欄", textarea: "テキスト欄", label: "ラベル", summary: "見出し",
  tr: "行", td: "セル", th: "見出しセル", li: "項目", div: "領域", span: "領域", svg: "図", path: "図", rect: "図", p: "文章", h1: "見出し", h2: "見出し", h3: "見出し",
};
const GROUP_LABEL: Record<string, string> = { project: "PJ別", assignee: "担当者別", status: "状態別", tag: "タグ別", todo: "ToDo別", none: "まとめなし" };
const SORT_LABEL: Record<string, string> = {
  manual: "手動", due_date: "期日", start_date: "開始日", priority: "優先度", status: "状態", name: "名前", created_at: "作成日", updated_at: "更新日",
};

export function summarizeSnapshot(s: FeedbackSnapshot): SnapshotSummaryLine[] {
  const lines: SnapshotSummaryLine[] = [];

  const view = s.view ?? s.screen;
  const screenParts = [
    view ? (VIEW_LABEL[view] ?? view) : null,
    s.overlay ? `${OVERLAY_LABEL[s.overlay] ?? s.overlay}を開いている` : null,
    s.settingsPage ? `設定：${s.settingsPage}` : null,
    s.mode ? (MODE_LABEL[s.mode] ?? s.mode) : null,
  ].filter((x): x is string => !!x);
  if (screenParts.length > 0) lines.push({ id: "screen", value: screenParts.join("・") });

  lines.push({ id: "app", value: `v${s.app.version}` });
  lines.push({ id: "browser", value: `${s.env.browser}${s.env.browserMajor !== undefined ? ` ${s.env.browserMajor}` : ""}・${s.env.os}` });

  const win = [
    `${s.env.viewport.w}×${s.env.viewport.h}`,
    s.env.zoomPct !== undefined ? `拡大 ${s.env.zoomPct}%` : null,
    s.env.isMobile === undefined ? null : s.env.isMobile ? "モバイル表示" : "PC表示",
  ].filter((x): x is string => !!x);
  lines.push({ id: "window", value: win.join("・") });

  if (s.department?.displayGroupId) lines.push({ id: "department", value: `表示部署ID ${s.department.displayGroupId}（部署名は送りません）` });

  const sel: string[] = [];
  if (s.selection?.projectId) sel.push(`PJ ID ${s.selection.projectId}`);
  if (s.selection?.taskId) sel.push(`タスク ID ${s.selection.taskId}`);
  if (s.selection?.selectedCount) sel.push(`選択中のタスク ${s.selection.selectedCount}件`);
  if (sel.length > 0) lines.push({ id: "selection", value: `${sel.join("・")}（名前は送りません）` });

  const disp: string[] = [];
  const l = s.listSettings;
  if (l) {
    if (l.groupBy) disp.push(`まとめ方 ${GROUP_LABEL[l.groupBy] ?? l.groupBy}`);
    if (l.sortKey) disp.push(`並び順 ${SORT_LABEL[l.sortKey] ?? l.sortKey}${l.sortDir === "desc" ? "（降順）" : ""}`);
    const f = l.filters;
    const active = [
      f?.status && f.status !== "all" ? `状態:${f.status}` : null,
      f?.priority && f.priority !== "all" ? `優先度:${f.priority}` : null,
      f?.myOnly ? "自分のみ" : null, f?.thisWeek ? "今週" : null, f?.hideDone ? "完了を隠す" : null,
      f?.member === "set" ? "担当者指定" : null, f?.hasSearch ? "検索あり" : null,
    ].filter((x): x is string => !!x);
    if (active.length > 0) disp.push(`絞り込み ${active.join("・")}`);
  }
  const g = s.ganttSettings;
  if (g) {
    if (g.mode) disp.push(`ガント ${g.mode === "person" ? "人別" : "PJ別"}`);
    if (g.dayWidth !== undefined) disp.push(`1日あたり ${g.dayWidth}px`);
    if (g.hideCompleted) disp.push("完了を隠す");
  }
  const k = s.kanbanSettings;
  if (k) {
    if (k.hideDone) disp.push("完了を隠す");
    if (k.showPaused) disp.push("保留・中止も表示");
    if (k.hasSectionFilter) disp.push("グループで絞り込み");
  }
  if (disp.length > 0) lines.push({ id: "display", value: disp.join("／") });

  if (s.clicks.length > 0) {
    const chain = s.clicks.map((c) => TAG_LABEL[c.tag] ?? c.tag).join("→");
    const latest = s.clicks[s.clicks.length - 1];
    lines.push({ id: "clicks", value: `${chain}（直近${s.clicks.length}件・最後は${Math.round(latest.agoMs / 1000)}秒前。文字は送りません）` });
  }
  return lines;
}

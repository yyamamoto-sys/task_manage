import type { Band, Checkin, Draft, KrRecord, OkrItem, Pj, Seg, Task } from "./types";

export const TODAY = "2026-11-10";
const DAY_MS = 86400000;
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function toUtc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const dt = new Date(toUtc(s) + n * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** a - b（日数） */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}

export function weekdayOf(s: string): number {
  return new Date(toUtc(s)).getUTCDay();
}

export function formatMd(s: string): string {
  const [, m, d] = s.split("-").map(Number);
  return `${m}/${d}(${WEEKDAYS[weekdayOf(s)]})`;
}

export function formatFull(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}年${m}月${d}日(${WEEKDAYS[weekdayOf(s)]})`;
}

/** その日を含む週の月曜日 */
export function weekStartOf(s: string): string {
  return addDays(s, -((weekdayOf(s) + 6) % 7));
}

export const isOpen = (t: Task) => t.status !== "完了";

// ---------- 達成度バンド ----------

/** 仮の5段階。実際の区分に差し替える（ここ1か所だけ直せばよい。左ほど高い） */
export const BANDS: Band[] = ["S", "A", "B", "C", "D"];

/** 高いほど大きい数（S=5 … D=1） */
export function bandRank(b: Band): number {
  return BANDS.length - BANDS.indexOf(b);
}

// ---------- 対照表 ----------

/** 現状 − 目標。数値は単位のまま、バンドは段数（マイナス＝目標より下） */
export function krGap(r: KrRecord): number {
  return r.kind === "number" ? r.value - r.target : bandRank(r.value) - bandRank(r.target);
}

/** 前回からの動き（現状 − 前回値）。数値は単位のまま、バンドは段数 */
export function krMove(r: KrRecord): number {
  return r.kind === "number" ? r.value - r.prev : bandRank(r.value) - bandRank(r.prev);
}

/** 直近のチェックイン日より前の更新のままなら「未更新」（資料に出てこなかったKR） */
export function isNotUpdated(r: KrRecord, latestCheckinDate: string): boolean {
  return r.updatedAt < latestCheckinDate;
}

export function latestCheckinDate(checkins: Checkin[]): string {
  return checkins.reduce((m, c) => (c.date > m ? c.date : m), "");
}

/**
 * 確定：下書きに出てきたKRだけ更新し、出てこなかったKRは前回値のまま。
 * 同じ日のチェックインへの再確定では「前回」をずらさない。
 */
export function applyDrafts(
  records: Record<string, KrRecord>,
  drafts: Draft[],
  values: Record<string, number | Band>,
  checkinDate: string,
): Record<string, KrRecord> {
  const out = { ...records };
  for (const d of drafts) {
    const r = records[d.krId];
    if (!r) continue;
    const v = values[d.krId] ?? d.value;
    const shift = r.updatedAt !== checkinDate;
    const base = { updatedAt: checkinDate, prevAt: shift ? r.updatedAt : r.prevAt, source: d.source };
    if (r.kind === "number" && typeof v === "number") {
      out[d.krId] = { ...r, ...base, value: v, prev: shift ? r.value : r.prev };
    } else if (r.kind === "band" && typeof v === "string") {
      out[d.krId] = { ...r, ...base, value: v, prev: shift ? r.value : r.prev };
    }
  }
  return out;
}

// ---------- 仕事とKRのつながり ----------

export function uniqueTasks(list: Task[]): Task[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function krIdsOfPj(pj: Pj, items: OkrItem[]): string[] {
  return [...new Set(pj.tfIds.map((id) => items.find((i) => i.id === id)?.parentId).filter((x): x is string => !!x))];
}

export interface LinkCtx {
  pjs: Pj[];
  items: OkrItem[];
  /** 本人がつなぎ先を変えたタスク（タスクID → KR ID）。あれば既定のつながりを置き換える */
  overrides: Record<string, string>;
}

/** タスクがつながるKR。既定は属するPJのKR（共有PJで同じKRに2回付いても1つ）。上書きがあればそれ */
export function krIdsOfTask(task: Task, ctx: LinkCtx): string[] {
  const o = ctx.overrides[task.id];
  if (o) return [o];
  const pj = ctx.pjs.find((p) => p.id === task.pjId);
  return pj ? krIdsOfPj(pj, ctx.items) : [];
}

/** KRにつながる仕事。1つのタスクは同じKRに1回だけ数える */
export function tasksOfKr(tasks: Task[], krId: string, ctx: LinkCtx): Task[] {
  return uniqueTasks(tasks.filter((t) => krIdsOfTask(t, ctx).includes(krId)));
}

/** どのKRにもつながる先がある仕事（共有PJの仕事も1回） */
export function linkedTasks(tasks: Task[], ctx: LinkCtx): Task[] {
  return uniqueTasks(tasks.filter((t) => krIdsOfTask(t, ctx).length > 0));
}

export function unlinkedTasks(tasks: Task[], ctx: LinkCtx): Task[] {
  return tasks.filter((t) => krIdsOfTask(t, ctx).length === 0);
}

/** そのタスクがつながるTF（PJの紐づけのうち、つながるKRの下にあるもの） */
export function tfIdsOfTask(task: Task, ctx: LinkCtx): string[] {
  const pj = ctx.pjs.find((p) => p.id === task.pjId);
  if (!pj) return [];
  const krs = krIdsOfTask(task, ctx);
  return pj.tfIds.filter((id) => krs.includes(ctx.items.find((i) => i.id === id)?.parentId ?? ""));
}

/** 前回更新の翌日〜今回更新日に、その人が終えた、そのKRにつながる仕事 */
export function tasksDoneBetween(tasks: Task[], memberId: string, krId: string, from: string, to: string, ctx: LinkCtx): Task[] {
  return tasksOfKr(
    tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated > from && t.updated <= to),
    krId,
    ctx,
  );
}

export function weekStarts(start: string, today: string): string[] {
  const out: string[] = [];
  for (let w = weekStartOf(start); w <= today; w = addDays(w, 7)) out.push(w);
  return out;
}

export interface Buildup {
  weeks: string[];
  /** KRごとの、週ごとの累計完了件数 */
  cumulative: Record<string, number[]>;
  /** 同じタスクは1回だけ数えた全体の累計 */
  total: number[];
}

/** 期の始めから週ごとの、KRにつながる仕事の累計完了件数 */
export function buildup(tasks: Task[], memberId: string, krIds: string[], start: string, today: string, ctx: LinkCtx): Buildup {
  const weeks = weekStarts(start, today);
  const done = tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated >= start && t.updated <= today);
  const cumulative: Record<string, number[]> = {};
  for (const k of krIds) {
    cumulative[k] = weeks.map((w) => {
      const end = addDays(w, 6);
      return done.filter((t) => t.updated <= end && krIdsOfTask(t, ctx).includes(k)).length;
    });
  }
  const total = weeks.map((w) => {
    const end = addDays(w, 6);
    return done.filter((t) => t.updated <= end && krIdsOfTask(t, ctx).length > 0).length;
  });
  return { weeks, cumulative, total };
}

/** 期のまとめ（コピー用の文面）。どのKRへ何を積んだか */
export function buildSummaryText(args: {
  period: string;
  owner: string;
  krs: { id: string; label: string; text: string }[];
  tasks: Task[];
  memberId: string;
  start: string;
  today: string;
  ctx: LinkCtx;
  how: Record<string, string>;
}): string {
  const { period, owner, krs, tasks, memberId, start, today, ctx, how } = args;
  const lines = [`${period} 期のまとめ（${owner}）`, `集計期間：${start}〜${today}`, ""];
  for (const kr of krs) {
    const done = tasksOfKr(
      tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated >= start && t.updated <= today),
      kr.id,
      ctx,
    );
    lines.push(`${kr.label} ${kr.text}：${done.length}件`);
    for (const t of done) lines.push(`  ・${t.title}${how[t.id] ? `（${how[t.id]}）` : ""}`);
  }
  const all = linkedTasks(
    tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated >= start && t.updated <= today),
    ctx,
  );
  lines.push("", `合計：${all.length}件（複数のKRにつながる仕事は1件に数えています）`);
  return lines.join("\n");
}

/** 四半期に有効な項目だけ（Objective・KRは常に有効） */
export function itemsInQuarter(items: OkrItem[], q: "3Q" | "4Q"): OkrItem[] {
  return items.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes(q));
}

// ---------- 進みと遅れ（第4版） ----------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 期の経過割合（0〜1）。期の始め＝0、期の終わり＝1 */
export function periodElapsed(start: string, end: string, today: string): number {
  const total = diffDays(end, start);
  return total <= 0 ? 1 : clamp01(diffDays(today, start) / total);
}

/** KRの進み（0〜1）。数値は 現状÷目標。バンドは最下段（D）を0、目標のバンドを1として段で測る */
export function krProgress(r: KrRecord): number {
  if (r.kind === "number") return r.target <= 0 ? 0 : clamp01(r.value / r.target);
  const span = bandRank(r.target) - 1;
  return span <= 0 ? 1 : clamp01((bandRank(r.value) - 1) / span);
}

export type Pace = "reached" | "ahead" | "behind";

/** 目標に届いた／期の経過に対して進みが追いついている（ahead）／下回っている（behind） */
export function krPace(r: KrRecord, elapsed: number): Pace {
  const p = krProgress(r);
  if (p >= 1) return "reached";
  return p < elapsed ? "behind" : "ahead";
}

/** 期の経過割合 − 進み。正なら遅れ（その大きさ）、負なら先行 */
export function paceGap(r: KrRecord, elapsed: number): number {
  return elapsed - krProgress(r);
}

export function overallProgress(records: Record<string, KrRecord>, krIds: string[]): number {
  const list = krIds.map((k) => records[k]).filter((r): r is KrRecord => !!r);
  return list.length === 0 ? 0 : list.reduce((s, r) => s + krProgress(r), 0) / list.length;
}

/** 遅れているKR。遅れの大きい順に最大 max 個 */
export function focusKrs(records: Record<string, KrRecord>, krIds: string[], elapsed: number, max = 2): string[] {
  return krIds
    .filter((k) => records[k] && krPace(records[k], elapsed) === "behind")
    .sort((a, b) => paceGap(records[b], elapsed) - paceGap(records[a], elapsed))
    .slice(0, max);
}

/** そのKRにつながる、その人の未着手・進行中の仕事。期日の近い（超過を含む）順に最大 max 件 */
export function focusTasks(tasks: Task[], memberId: string, krId: string, ctx: LinkCtx, max = 3): Task[] {
  const open = tasksOfKr(
    tasks.filter((t) => t.assigneeId === memberId && isOpen(t)),
    krId,
    ctx,
  );
  return open
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : Number(b.status === "進行中") - Number(a.status === "進行中")))
    .slice(0, max);
}

export interface FocusItem {
  krId: string;
  /** 遅れの大きさ（割合の差。0.12＝12ポイント） */
  gap: number;
  /** そのKRにつながる未完了の仕事の件数（全員分・1件は1回） */
  openCount: number;
  /** 本人視点のときだけ入る、本人の仕事（上位3件） */
  mine: Task[];
}

export function weeklyFocus(args: {
  records: Record<string, KrRecord>;
  krIds: string[];
  elapsed: number;
  tasks: Task[];
  ctx: LinkCtx;
  memberId: string;
  isOwnerView: boolean;
}): FocusItem[] {
  const { records, krIds, elapsed, tasks, ctx, memberId, isOwnerView } = args;
  return focusKrs(records, krIds, elapsed).map((krId) => ({
    krId,
    gap: paceGap(records[krId], elapsed),
    openCount: tasksOfKr(tasks.filter(isOpen), krId, ctx).length,
    mine: isOwnerView ? focusTasks(tasks, memberId, krId, ctx) : [],
  }));
}

export type Milestone = "half" | "reached";

/** 確定の前後で越えた節目。半分（進み50%）を越えた／目標に届いた */
export function crossedMilestones(before: KrRecord, after: KrRecord): Milestone[] {
  const b = krProgress(before);
  const a = krProgress(after);
  const out: Milestone[] = [];
  if (b < 0.5 && a >= 0.5 && a < 1) out.push("half");
  if (b < 1 && a >= 1) out.push("reached");
  return out;
}

// ---------- 文字単位の差分（Kintone取込の突き合わせ） ----------

function mergeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.changed === s.changed) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** 最長共通部分列（LCS）で左右それぞれの「違う文字」を印づける */
export function diffChars(a: string, b: string): { left: Seg[]; right: Seg[] } {
  const x = Array.from(a);
  const y = Array.from(b);
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left: Seg[] = [];
  const right: Seg[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      left.push({ text: x[i], changed: false });
      right.push({ text: y[j], changed: false });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: x[i++], changed: true });
    } else {
      right.push({ text: y[j++], changed: true });
    }
  }
  while (i < x.length) left.push({ text: x[i++], changed: true });
  while (j < y.length) right.push({ text: y[j++], changed: true });
  return { left: mergeSegs(left), right: mergeSegs(right) };
}

export interface CompareRow {
  id: string;
  label: string;
  kind: OkrItem["kind"];
  app: string;
  kintone: string;
  same: boolean;
  left: Seg[];
  right: Seg[];
}

export function compareOkr(appItems: OkrItem[], kintone: Record<string, string>): CompareRow[] {
  return appItems.map((it) => {
    const k = kintone[it.id] ?? "";
    const d = diffChars(it.text, k);
    return { id: it.id, label: it.label, kind: it.kind, app: it.text, kintone: k, same: it.text === k, left: d.left, right: d.right };
  });
}

export type Resolution = "app" | "kintone";

export function canLock(rows: CompareRow[], resolutions: Record<string, Resolution>): boolean {
  return rows.every((r) => r.same || resolutions[r.id] !== undefined);
}

export function resolvedTexts(rows: CompareRow[], resolutions: Record<string, Resolution>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = !r.same && resolutions[r.id] === "kintone" ? r.kintone : r.app;
  return out;
}

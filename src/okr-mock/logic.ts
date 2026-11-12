import type { Band, BandRecord, Checkin, Draft, KintoneRow, KrRecord, NumberRecord, OkrItem, Pj, Seg, Task } from "./types";

export const TODAY = "2026-11-10";
const DAY_MS = 86400000;
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
/** PJに属さない個人の仕事の置き場（図では1つのまとまりとして扱う） */
export const PERSONAL_PJ = "personal";

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

// ---------- 達成度（仮の区分） ----------

/** 仮の5段階。実際の区分に差し替える（ここ1か所だけ直せばよい。左ほど高い） */
export const BANDS: Band[] = ["S", "A", "B", "C", "D"];

/** 高いほど大きい数（S=5 … D=1） */
export function bandRank(b: Band): number {
  return BANDS.length - BANDS.indexOf(b);
}

/** 目標の達成度まであと何段か（届いていれば0） */
export function stepsToTarget(r: BandRecord): number {
  return Math.max(0, bandRank(r.target) - bandRank(r.value));
}

// ---------- 対照表 ----------

/** 現状 − 目標値。数値は単位のまま、達成度は段数（マイナス＝目標より下） */
export function krGap(r: KrRecord): number {
  return r.kind === "number" ? r.value - r.target : bandRank(r.value) - bandRank(r.target);
}

/** 前回からの動き（現状 − 前回値）。数値は単位のまま、達成度は段数 */
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

/** 確定の前後の増減の札（「＋4社」「＋2段」）。動かなければ null */
export function deltaText(before: KrRecord, after: KrRecord): string | null {
  let n = 0;
  if (after.kind === "number" && before.kind === "number") n = after.value - before.value;
  else if (after.kind === "band" && before.kind === "band") n = bandRank(after.value) - bandRank(before.value);
  if (n === 0) return null;
  const unit = after.kind === "number" ? after.unit : "段";
  return `${n > 0 ? "＋" : "−"}${Math.abs(n)}${unit}`;
}

// ---------- 仕事とKRのつながり ----------

export function uniqueTasks(list: Task[]): Task[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** 今期の仕事だけ。未完了は常に対象、完了は期の始め以降に終えたもの */
export function inPeriod(t: Task, periodStart: string): boolean {
  return t.status !== "完了" || t.updated >= periodStart;
}

export function periodTasks(list: Task[], periodStart: string): Task[] {
  return list.filter((t) => inPeriod(t, periodStart));
}

export function krIdsOfPj(pj: Pj, items: OkrItem[]): string[] {
  return [...new Set(pj.tfIds.map((id) => items.find((i) => i.id === id)?.parentId).filter((x): x is string => !!x))];
}

export interface LinkCtx {
  pjs: Pj[];
  items: OkrItem[];
  /** 担当者本人がつなぎ先を変えた仕事（仕事ID → KR ID）。全員分をまとめたもの。あれば既定のつながりを置き換える */
  overrides: Record<string, string>;
}

/**
 * 仕事がつながるKR。上書きがあればそれ。完了した仕事は「完了した時点のつながり」の記録を使う。
 * それ以外は属するPJのKR（共有PJで同じKRに2回付いても1つ）
 */
export function krIdsOfTask(task: Task, ctx: LinkCtx): string[] {
  const o = ctx.overrides[task.id];
  if (o) return [o];
  if (task.status === "完了" && task.doneKrIds) return task.doneKrIds;
  const pj = ctx.pjs.find((p) => p.id === task.pjId);
  return pj ? krIdsOfPj(pj, ctx.items) : [];
}

/** KRにつながる仕事。1つの仕事は同じKRに1回だけ数える */
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

/** 「どう効くか」の答えの持ち方：仕事×KR */
export const howKey = (taskId: string, krId: string) => `${taskId}|${krId}`;
/** 週の振り返りの答えの持ち方：週×KR */
export const answerKey = (weekStart: string, krId: string) => `${weekStart}|${krId}`;

/** 期のまとめ（コピー用の文面）。どのKRへ何を積んだか。「どう効くか」は該当のKRにだけ付ける */
export function buildSummaryText(args: {
  period: string;
  owner: string;
  krs: { id: string; label: string; text: string }[];
  tasks: Task[];
  memberId: string;
  start: string;
  today: string;
  ctx: LinkCtx;
  /** 仕事×KR（howKey）→ 選んだ一言 */
  how: Record<string, string>;
  /** 本人が「そのとおり」と確かめた、成果につながった仕事 */
  outcomes?: { title: string; krLabel: string; change: string; excerpt: string }[];
}): string {
  const { period, owner, krs, tasks, memberId, start, today, ctx, how, outcomes = [] } = args;
  const lines = [`${period} 期のまとめ（${owner}）`, `集計期間：${start}〜${today}`, ""];
  const mineDone = tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated >= start && t.updated <= today);
  for (const kr of krs) {
    const done = tasksOfKr(mineDone, kr.id, ctx);
    lines.push(`${kr.label} ${kr.text}：${done.length}件`);
    for (const t of done) {
      const h = how[howKey(t.id, kr.id)];
      lines.push(`  ・${t.title}${h ? `（${h}）` : ""}`);
    }
  }
  const all = linkedTasks(mineDone, ctx);
  lines.push("", `合計：${all.length}件（複数のKRにつながる仕事は1件に数えています）`);
  if (outcomes.length > 0) {
    lines.push("", `成果につながった仕事：${outcomes.length}件（資料の記述と照らして、本人が確かめたもの）`);
    for (const o of outcomes) lines.push(`  ★${o.title} → ${o.krLabel} ${o.change}「${o.excerpt}」`);
  }
  return lines.join("\n");
}

// ---------- 成果と仕事（別の物差し） ----------

/** 成果の進みと仕事の消化がこのポイント以上離れたとき、事実を1行で添える */
export const GAP_NOTE_POINTS = 30;

export interface WorkDigest {
  done: number;
  total: number;
  /** 仕事の消化（％の整数）。仕事が0件のときは null */
  pct: number | null;
}

export function workDigest(list: Task[]): WorkDigest {
  const total = list.length;
  const done = list.filter((t) => t.status === "完了").length;
  return { done, total, pct: total === 0 ? null : Math.round((done / total) * 100) };
}

/** 成果の進み（％）と仕事の消化（％）が30ポイント以上離れているときだけ、事実を1行で返す。評価や助言は書かない */
export function outcomeWorkLine(outcomePct: number, work: WorkDigest): string | null {
  if (work.pct === null) return null;
  if (work.pct - outcomePct >= GAP_NOTE_POINTS) return `仕事は ${work.pct}％ 終えていますが、成果は ${outcomePct}％ です`;
  if (outcomePct - work.pct >= GAP_NOTE_POINTS) return `成果は ${outcomePct}％ 進んでいますが、仕事の消化は ${work.pct}％ です`;
  return null;
}

/** 四半期に有効な項目だけ（Oとkrは常に有効） */
export function itemsInQuarter(items: OkrItem[], q: "3Q" | "4Q"): OkrItem[] {
  return items.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes(q));
}

// ---------- 進みと遅れ ----------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 期の経過割合（0〜1）。期の始め＝0、期の終わり＝1 */
export function periodElapsed(start: string, end: string, today: string): number {
  const total = diffDays(end, start);
  return total <= 0 ? 1 : clamp01(diffDays(today, start) / total);
}

/**
 * 数値KRの進み（0〜1）＝（現状−期首）÷（目標値−期首）。
 * 目標値＝期首のときは割れないので、目標に届いていれば1、届いていなければ0
 */
export function numberProgress(r: Pick<NumberRecord, "start" | "target" | "value" | "direction">): number {
  const span = r.target - r.start;
  if (span === 0) return (r.direction === "up" ? r.value >= r.target : r.value <= r.target) ? 1 : 0;
  return clamp01((r.value - r.start) / span);
}

/** KRの進み（0〜1）。達成度は最下段（D）を0、目標の区分を1として段で測る（期の経過とは比べない） */
export function krProgress(r: KrRecord): number {
  if (r.kind === "number") return numberProgress(r);
  const span = bandRank(r.target) - 1;
  return span <= 0 ? 1 : clamp01((bandRank(r.value) - 1) / span);
}

export type Pace = "reached" | "ahead" | "behind";

/** 期の経過 − 進み を整数のポイントにしたもの。画面に出す数と判定の両方がこれを使う（丸めを1か所にする） */
export function gapPoints(progress: number, elapsed: number): number {
  return Math.round((elapsed - progress) * 100);
}

/** 目標に届いた／期の経過に対して進みが追いついている（ahead）／下回っている（behind）。判定は表示と同じポイントで行う */
export function paceOfProgress(progress: number, elapsed: number): Pace {
  if (progress >= 1) return "reached";
  return gapPoints(progress, elapsed) > 0 ? "behind" : "ahead";
}

/** 数値KRだけが遅れ判定の対象。達成度のKRは期の経過と比べないので、届いたとき以外は null */
export function krPace(r: KrRecord, elapsed: number): Pace | null {
  if (r.kind === "band") return stepsToTarget(r) === 0 ? "reached" : null;
  return paceOfProgress(krProgress(r), elapsed);
}

/** 期の経過割合 − 進み。正なら遅れ（その大きさ）、負なら先行（並べ替え用の生の値） */
export function paceGap(r: KrRecord, elapsed: number): number {
  return elapsed - krProgress(r);
}

/** 全体の進み＝数値KRの平均。達成度のKRは含めない */
export function overallProgress(records: Record<string, KrRecord>, krIds: string[]): number {
  const list = krIds.map((k) => records[k]).filter((r): r is NumberRecord => !!r && r.kind === "number");
  return list.length === 0 ? 0 : list.reduce((s, r) => s + krProgress(r), 0) / list.length;
}

/** 達成度のKR（全体の進みとは別に、段で見せる） */
export function bandKrIds(records: Record<string, KrRecord>, krIds: string[]): string[] {
  return krIds.filter((k) => records[k]?.kind === "band");
}

/** 遅れている数値KR。遅れの大きい順に最大 max 個 */
export function focusKrs(records: Record<string, KrRecord>, krIds: string[], elapsed: number, max = 2): string[] {
  return krIds
    .filter((k) => records[k] && krPace(records[k], elapsed) === "behind")
    .sort((a, b) => paceGap(records[b], elapsed) - paceGap(records[a], elapsed))
    .slice(0, max);
}

/** 達成度のKRのうち、目標まで残り2段以上のもの（残りの多い順） */
export function stepKrs(records: Record<string, KrRecord>, krIds: string[]): string[] {
  const steps = (k: string) => {
    const r = records[k];
    return r && r.kind === "band" ? stepsToTarget(r) : 0;
  };
  return krIds.filter((k) => steps(k) >= 2).sort((a, b) => steps(b) - steps(a));
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
  /** behind＝遅れている数値KR、steps＝目標まで残り2段以上の達成度KR */
  kind: "behind" | "steps";
  /** 遅れのポイント（kind=behind のとき） */
  points: number;
  /** 目標まで何段か（kind=steps のとき） */
  steps: number;
  /** 直近のチェックインで更新されていない */
  stale: boolean;
  /** そのKRにつながる未完了の仕事の件数（全員分・1件は1回） */
  openCount: number;
  /** 見ている人本人の仕事（上位3件） */
  mine: Task[];
}

export function weeklyFocus(args: {
  records: Record<string, KrRecord>;
  krIds: string[];
  elapsed: number;
  tasks: Task[];
  ctx: LinkCtx;
  memberId: string;
  latest: string;
}): FocusItem[] {
  const { records, krIds, elapsed, tasks, ctx, memberId, latest } = args;
  const base = (krId: string) => ({
    krId,
    stale: isNotUpdated(records[krId], latest),
    openCount: tasksOfKr(tasks.filter(isOpen), krId, ctx).length,
    mine: focusTasks(tasks, memberId, krId, ctx),
  });
  const behind: FocusItem[] = focusKrs(records, krIds, elapsed).map((k) => ({
    ...base(k),
    kind: "behind" as const,
    points: gapPoints(krProgress(records[k]), elapsed),
    steps: 0,
  }));
  const steps: FocusItem[] = stepKrs(records, krIds).map((k) => {
    const r = records[k];
    return { ...base(k), kind: "steps" as const, points: 0, steps: r.kind === "band" ? stepsToTarget(r) : 0 };
  });
  return [...behind, ...steps];
}

export interface TaskCandidate {
  task: Task;
  reason: string;
}

/**
 * 「このKRにつなげられそうなあなたの仕事」。AIの候補（PJごとの固定データ）にそのKRが含まれる、
 * 本人の未完了の仕事のうち、まだそのKRにつながっていないもの
 */
export function candidateTasksForKr(
  tasks: Task[],
  memberId: string,
  krId: string,
  ctx: LinkCtx,
  aiCands: Record<string, { krId: string; reason: string }[]>,
  max = 3,
): TaskCandidate[] {
  const out: TaskCandidate[] = [];
  for (const t of tasks) {
    if (t.assigneeId !== memberId || !isOpen(t)) continue;
    if (krIdsOfTask(t, ctx).includes(krId)) continue;
    const c = (aiCands[t.pjId] ?? []).find((x) => x.krId === krId);
    if (c) out.push({ task: t, reason: c.reason });
  }
  return out.slice(0, max);
}

// ---------- 今週の振り返りと「今週やる」 ----------

/** その週（月曜〜日曜）に動いた（最終更新日が入る）、その人の仕事 */
export function tasksMovedInWeek(tasks: Task[], memberId: string, weekStart: string): Task[] {
  const end = addDays(weekStart, 6);
  return tasks.filter((t) => t.assigneeId === memberId && t.updated >= weekStart && t.updated <= end);
}

/** その週に動いた仕事がつながるKR（振り返りの対象） */
export function weekKrIds(tasks: Task[], memberId: string, weekStart: string, ctx: LinkCtx, krOrder: string[]): string[] {
  const set = new Set(tasksMovedInWeek(tasks, memberId, weekStart).flatMap((t) => krIdsOfTask(t, ctx)));
  return krOrder.filter((k) => set.has(k));
}

export type PickOutcome = "終えた" | "進行中" | "未着手";

/** 「今週やる」と選んだ仕事がどうなったか */
export function picksOutcome(tasks: Task[], picked: string[]): { total: number; counts: Record<PickOutcome, number>; rows: { task: Task; outcome: PickOutcome }[] } {
  const rows = picked
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t)
    .map((task) => ({ task, outcome: (task.status === "完了" ? "終えた" : task.status) as PickOutcome }));
  const counts: Record<PickOutcome, number> = { 終えた: 0, 進行中: 0, 未着手: 0 };
  for (const r of rows) counts[r.outcome]++;
  return { total: rows.length, counts, rows };
}

/** AIの見立て（固定の型に、その週の実データを当てはめる） */
export function weeklyView(moved: Task[]): string {
  const done = moved.filter((t) => t.status === "完了");
  const doing = moved.filter((t) => t.status !== "完了");
  const parts: string[] = [];
  if (done.length) parts.push(`終えた仕事は${done.length}件（${done.slice(0, 2).map((t) => t.title).join("、")}）`);
  if (doing.length) parts.push(`進めている仕事は${doing.length}件`);
  return `今週のあなたは、${parts.join("、")}です。`;
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

export type RowStatus = "same" | "changed" | "kintoneOnly" | "appOnly";

export interface CompareRow {
  id: string;
  label: string;
  status: RowStatus;
  app: string;
  kintone: string;
  left: Seg[];
  right: Seg[];
}

/** Kintone（正）とアプリのTFを突き合わせる。文言の違いと、行の過不足（Kintoneにだけある／アプリにだけある） */
export function compareOkr(appTfs: OkrItem[], kintone: KintoneRow[]): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const k of kintone) {
    const a = appTfs.find((i) => i.id === k.id);
    if (!a) {
      rows.push({ id: k.id, label: k.label, status: "kintoneOnly", app: "", kintone: k.text, left: [], right: [{ text: k.text, changed: true }] });
      continue;
    }
    const d = diffChars(a.text, k.text);
    rows.push({ id: k.id, label: k.label, status: a.text === k.text ? "same" : "changed", app: a.text, kintone: k.text, left: d.left, right: d.right });
  }
  for (const a of appTfs) {
    if (!kintone.some((k) => k.id === a.id)) {
      rows.push({ id: a.id, label: a.label, status: "appOnly", app: a.text, kintone: "", left: [{ text: a.text, changed: true }], right: [] });
    }
  }
  return rows;
}

/** 取り込み：TFをKintoneの内容そのものにする（文言の差し替え・Kintoneだけにある行の追加・アプリだけにある行の取り外し） */
export function importKintone(items: OkrItem[], kintone: KintoneRow[], quarter: "3Q" | "4Q"): OkrItem[] {
  const keep = items.filter((i) => i.kind !== "tf");
  const tfs = kintone.map((k) => {
    const cur = items.find((i) => i.id === k.id);
    return cur ? { ...cur, text: k.text } : ({ id: k.id, kind: "tf", parentId: k.parentId, label: k.label, text: k.text, quarters: [quarter] } as OkrItem);
  });
  return [...keep, ...tfs];
}

export function diffCount(rows: CompareRow[]): number {
  return rows.filter((r) => r.status !== "same").length;
}

// ---------- フォーカスの輪（キーボード操作） ----------

/** Tab で端を越えるとき、どこへ回すか。回さなくてよい（自然な移動でよい）ときは null */
export function trapTarget(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (shift && current <= 0) return count - 1;
  if (!shift && current >= count - 1) return 0;
  return null;
}

// ---------- 色の対比（WCAG の相対輝度） ----------

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

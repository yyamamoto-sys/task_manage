import { hasPending, nextStep } from "./steps";
import type { Assessment, Checkin, Draft, Hint, KintoneRow, KrBands, KrRecord, OkrItem, Pj, Seg, Task } from "./types";

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

// ---------- 対照表 ----------

/** 直近のチェックイン日より前の更新のままなら「未更新」（資料に出てこなかったKR） */
export function isNotUpdated(r: KrRecord, latestCheckinDate: string): boolean {
  return r.updatedAt < latestCheckinDate;
}

export function latestCheckinDate(checkins: Checkin[]): string {
  return checkins.reduce((m, c) => (c.date > m ? c.date : m), "");
}

/**
 * 確定：資料に出てきたKR（手がかりの下書き・見立てのどちらか）だけ更新し、出てこなかったKRは前回のまま。
 * 同じ日のチェックインへの再確定では「前回」をずらさない。手がかりの数字は下書きがあるKRだけ動く
 */
export function applyConfirm(
  records: Record<string, KrRecord>,
  drafts: Draft[],
  values: Record<string, number>,
  assessed: { krId: string; source: { doc: string; page: string } }[],
  checkinDate: string,
): Record<string, KrRecord> {
  const out = { ...records };
  const krIds = [...new Set([...drafts.map((d) => d.krId), ...assessed.map((a) => a.krId)])];
  for (const krId of krIds) {
    const r = records[krId];
    if (!r) continue;
    const d = drafts.find((x) => x.krId === krId);
    const a = assessed.find((x) => x.krId === krId);
    const shift = r.updatedAt !== checkinDate;
    const next: KrRecord = { ...r, updatedAt: checkinDate, prevAt: shift ? r.updatedAt : r.prevAt, source: d?.source ?? a?.source ?? r.source };
    if (d && r.hint) {
      const v = values[krId] ?? d.value;
      next.hint = { ...r.hint, value: v, prev: shift ? r.hint.value : r.hint.prev };
    }
    out[krId] = next;
  }
  return out;
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
  /**
   * 担当者本人がつなぎ先を選んだ仕事（仕事ID → KR IDの集合）。全員分をまとめたもの。
   * あれば既定のつながりを置き換える。空の集合＝どのKRにもつながない
   */
  overrides: Record<string, string[]>;
}

/** 本人が選ぶ前の既定のつなぎ先。完了した仕事は「完了した時点のつながり」の記録、それ以外は属するPJのKR（共有PJで同じKRに2回付いても1つ） */
export function defaultKrIdsOfTask(task: Task, ctx: LinkCtx): string[] {
  if (task.status === "完了" && task.doneKrIds) return task.doneKrIds;
  const pj = ctx.pjs.find((p) => p.id === task.pjId);
  return pj ? krIdsOfPj(pj, ctx.items) : [];
}

/** 仕事がつながるKR。本人が選んだ集合があればそれ（0個もありうる）。なければ既定 */
export function krIdsOfTask(task: Task, ctx: LinkCtx): string[] {
  const o = ctx.overrides[task.id];
  return o ?? defaultKrIdsOfTask(task, ctx);
}

/** 結節点＝2つ以上のKRにつながっている仕事（PJの既定で複数につながるものも、本人が選んだものも含む）。共有PJの仕事も1回 */
export function junctionTasks(tasks: Task[], ctx: LinkCtx): Task[] {
  return uniqueTasks(tasks.filter((t) => krIdsOfTask(t, ctx).length >= 2));
}

export interface SharedWork {
  /** 相手のKR */
  krId: string;
  tasks: Task[];
}

/** このKRと仕事を共有している（同じ仕事が両方につながる）KRごとの、共有している仕事。共有が無いKRは出さない */
export function sharedWork(tasks: Task[], krId: string, ctx: LinkCtx, krOrder: string[]): SharedWork[] {
  const mine = tasksOfKr(tasks, krId, ctx);
  return krOrder
    .filter((k) => k !== krId)
    .map((k) => ({ krId: k, tasks: mine.filter((t) => krIdsOfTask(t, ctx).includes(k)) }))
    .filter((s) => s.tasks.length > 0);
}

/** KRの並び順にそろえる（重複は除く） */
export function sortKrIds(ids: string[], krOrder: string[]): string[] {
  return krOrder.filter((k) => ids.includes(k));
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

/** 「どう役立つか」の答えの持ち方：仕事×KR */
export const howKey = (taskId: string, krId: string) => `${taskId}|${krId}`;
/** 週の振り返りの答えの持ち方：週×KR */
export const answerKey = (weekStart: string, krId: string) => `${weekStart}|${krId}`;

/** 期のまとめ（コピー用の文面）。どのKRへ何を積んだか。「どう役立つか」は該当のKRにだけ付ける */
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
  /** 週の振り返りの答え（本人の分だけ。役立ったかは選んだ言葉のまま） */
  reflections?: { weekStart: string; krLabel: string; effect: string }[];
  /** KRごとのAIの見立ての推移（例：10/6 62 → 10/20 64）。資料に出た回だけ */
  trends?: { krLabel: string; text: string }[];
  /** 資料から拾った学び（KRごと） */
  learnings?: { krLabel: string; kind: string; text: string }[];
}): string {
  const { period, owner, krs, tasks, memberId, start, today, ctx, how, outcomes = [], reflections = [], trends = [], learnings = [] } = args;
  const lines = [`${period} 期のまとめ（${owner}）`, `集計期間：${start}〜${today}`, ""];
  const mineDone = tasks.filter((t) => t.assigneeId === memberId && t.status === "完了" && t.updated >= start && t.updated <= today);
  for (const kr of krs) {
    const done = tasksOfKr(mineDone, kr.id, ctx);
    lines.push(done.length === 0 ? `${kr.label} ${kr.text}：この期に終えた仕事は、まだつながっていません` : `${kr.label} ${kr.text}：${done.length}件`);
    for (const t of done) {
      const h = how[howKey(t.id, kr.id)];
      lines.push(`  ・${t.title}${h ? `（${h}）` : ""}`);
    }
  }
  const all = linkedTasks(mineDone, ctx);
  lines.push("", all.length === 0 ? "合計：この期に終えた仕事は、まだありません" : `合計：${all.length}件（複数のKRにつながる仕事は1件に数えています）`);
  if (outcomes.length > 0) {
    lines.push("", `成果につながった仕事：${outcomes.length}件（資料の記述と照らして、本人が確かめたもの）`);
    for (const o of outcomes) lines.push(`  ★${o.title} → ${o.krLabel} ${o.change}「${o.excerpt}」`);
  }
  if (trends.length > 0) {
    lines.push("", "AIの見立ての推移（資料の記述から。60が出発点）");
    for (const t of trends) lines.push(`  ・${t.krLabel}：${t.text}`);
  }
  if (learnings.length > 0) {
    lines.push("", "資料から拾った学び");
    for (const l of learnings) lines.push(`  ・${l.krLabel}（${l.kind}）${l.text}`);
  }
  if (reflections.length > 0) {
    lines.push("", "週の振り返り（仕事がKRに役立ったか。本人の選択）");
    for (const r of reflections) lines.push(`  ・${formatMd(r.weekStart)}の週 ${r.krLabel}：${r.effect}`);
  }
  return lines.join("\n");
}

// ---------- 成果と仕事（別の物差し） ----------

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

/** 四半期に有効な項目だけ（Oとkrは常に有効） */
export function itemsInQuarter(items: OkrItem[], q: "3Q" | "4Q"): OkrItem[] {
  return items.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes(q));
}

// ---------- 手がかりの数字と期の経過（KRの詳細の中だけで使う） ----------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 期の経過割合（0〜1）。期の始め＝0、期の終わり＝1 */
export function periodElapsed(start: string, end: string, today: string): number {
  const total = diffDays(end, start);
  return total <= 0 ? 1 : clamp01(diffDays(today, start) / total);
}

/**
 * 手がかりの数字の位置（0〜1）＝（現状−期首）÷（目標値−期首）。主役の％としては使わない。
 * 目標値＝期首のときは割れないので、目標に届いていれば1、届いていなければ0
 */
export function hintProgress(h: Pick<Hint, "start" | "target" | "value" | "direction">): number {
  const span = h.target - h.start;
  if (span === 0) return (h.direction === "up" ? h.value >= h.target : h.value <= h.target) ? 1 : 0;
  return clamp01((h.value - h.start) / span);
}

/** 期の経過 − 手がかりの位置 を整数のポイントにしたもの（丸めを1か所にする） */
export function gapPoints(progress: number, elapsed: number): number {
  return Math.round((elapsed - progress) * 100);
}

/** 手がかりの数字が期の経過より後ろにあるか（届いていれば false）。数値のないKRは false。KRの詳細の中だけで使う */
export function hintTrailsPeriod(h: Hint | undefined, elapsed: number): boolean {
  if (!h) return false;
  const p = hintProgress(h);
  return p < 1 && gapPoints(p, elapsed) > 0;
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
  /** next＝次の段の要件にまだ／一部があり、見ている人の仕事がつながるKR。most＝自分の仕事が最も多くつながるKR */
  kind: "next" | "most";
  /** 次の段（next のとき） */
  step: number | null;
  /** 次の段の要件のうち、まだ／一部の数（next のとき） */
  pendingCount: number;
  /** 直近のチェックインで更新されていない */
  stale: boolean;
  /** そのKRにつながる未完了の仕事の件数（全員分・1件は1回） */
  openCount: number;
  /** 見ている人本人の仕事（上位3件） */
  mine: Task[];
}

/** 今週どこに力を入れるか：次の段の要件に「まだ／一部」があり、見ている人の仕事がつながるKR。無ければ自分の仕事が最も多くつながるKR */
export function weeklyFocus(args: {
  records: Record<string, KrRecord>;
  krIds: string[];
  assessOf: Record<string, Assessment | undefined>;
  bandsOf: Record<string, KrBands>;
  tasks: Task[];
  ctx: LinkCtx;
  memberId: string;
  latest: string;
  max?: number;
}): FocusItem[] {
  const { records, krIds, assessOf, bandsOf, tasks, ctx, memberId, latest, max = 2 } = args;
  const open = tasks.filter(isOpen);
  const base = (krId: string) => ({
    krId,
    stale: records[krId] ? isNotUpdated(records[krId], latest) : false,
    openCount: tasksOfKr(open, krId, ctx).length,
    mine: focusTasks(tasks, memberId, krId, ctx),
  });
  const next: FocusItem[] = krIds
    .filter((k) => {
      const a = assessOf[k];
      return !!a && hasPending(a, bandsOf[k]) && focusTasks(tasks, memberId, k, ctx).length > 0;
    })
    .map((k) => {
      const a = assessOf[k]!;
      const pend = a.basis.filter((b) => b.status !== "確認できた");
      const step = nextStep(a.value, bandsOf[k]);
      return { ...base(k), kind: "next" as const, step, pendingCount: pend.length };
    })
    .sort((a, b) => b.pendingCount - a.pendingCount || b.mine.length - a.mine.length);
  if (next.length > 0) return next.slice(0, max);
  const most = krIds
    .map((k) => ({ k, n: tasksOfKr(tasks.filter((t) => t.assigneeId === memberId && isOpen(t)), k, ctx).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return most.length > 0 ? [{ ...base(most[0].k), kind: "most" as const, step: null, pendingCount: 0 }] : [];
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

export type PickOutcome = "完了" | "進行中" | "未着手";

/** 「今週やる」と選んだ仕事がどうなったか */
export function picksOutcome(tasks: Task[], picked: string[]): { total: number; counts: Record<PickOutcome, number>; rows: { task: Task; outcome: PickOutcome }[] } {
  const rows = picked
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t)
    .map((task) => ({ task, outcome: (task.status === "完了" ? "完了" : task.status) as PickOutcome }));
  const counts: Record<PickOutcome, number> = { 完了: 0, 進行中: 0, 未着手: 0 };
  for (const r of rows) counts[r.outcome]++;
  return { total: rows.length, counts, rows };
}

/** AIのまとめ（固定の型に、その週の実データを当てはめる） */
export function weeklyView(moved: Task[]): string {
  const done = moved.filter((t) => t.status === "完了");
  const doing = moved.filter((t) => t.status !== "完了");
  const parts: string[] = [];
  if (done.length) parts.push(`終えた仕事は${done.length}件（${done.slice(0, 2).map((t) => t.title).join("、")}）`);
  if (doing.length) parts.push(`進めている仕事は${doing.length}件`);
  return `今週のあなたは、${parts.join("、")}です。`;
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

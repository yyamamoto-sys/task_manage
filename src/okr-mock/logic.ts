import type { Checkpoint, Member, OkrItem, Pj, Quarter, Seg, Synergy, Task, Team } from "./types";

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

/** 今日を含めて、次にその曜日が来る日（今日が該当曜日なら今日） */
export function nextCheckinDate(today: string, weekday: number): string {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff);
}

export const isOpen = (t: Task) => t.status !== "完了";

export function overdueTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => isOpen(t) && t.due < today);
}

/** 今日からチェックイン日までに期日が来る未完了タスク（期日超過は含めない） */
export function dueBeforeCheckin(tasks: Task[], today: string, checkin: string): Task[] {
  return tasks.filter((t) => isOpen(t) && t.due >= today && t.due <= checkin);
}

export const STALE_DAYS = 7;

export function isStaleTask(t: Task, today: string, days = STALE_DAYS): boolean {
  return isOpen(t) && diffDays(today, t.updated) >= days;
}

/** KR・TF などの範囲：タスクはあるが、どれも直近 days 日以内に動いていない。タスクが1件も無いものは「未登録」で別扱い */
export function isStaleScope(tasks: Task[], today: string, days = STALE_DAYS): boolean {
  if (tasks.length === 0) return false;
  return tasks.every((t) => diffDays(today, t.updated) >= days);
}

export function isUnregistered(tasks: Task[]): boolean {
  return tasks.length === 0;
}

export function daysSinceLastMove(tasks: Task[], today: string): number | null {
  if (tasks.length === 0) return null;
  return Math.min(...tasks.map((t) => diffDays(today, t.updated)));
}

export interface Movement {
  updated: number;
  completed: number;
  overdue: number;
}

/** 動きを数える期間（両端を含む） */
export interface Window {
  from: string;
  to: string;
}

export function inWindow(date: string, win: Window): boolean {
  return date >= win.from && date <= win.to;
}

/** 前回チェックインの翌日〜今回のチェックイン日（今日が曜日に当たれば今日が今回） */
export function weekWindow(today: string, weekday: number): Window {
  const to = nextCheckinDate(today, weekday);
  return { from: addDays(to, -6), to };
}

/** 画面に出す期間の文字 */
export function formatWindow(win: Window): string {
  return `${formatMd(win.from)}〜${formatMd(win.to)}`;
}

/** 期間内の動き。期間を渡さなければ直近7日（今日を含む） */
export function movement(tasks: Task[], today: string, win: Window = { from: addDays(today, -6), to: today }): Movement {
  let updated = 0;
  let completed = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (inWindow(t.updated, win)) {
      updated++;
      if (t.status === "完了") completed++;
    }
    if (isOpen(t) && t.due < today) overdue++;
  }
  return { updated, completed, overdue };
}

/** 直近 weeks 週の完了件数（古い週 → 新しい週の順） */
export function weeklyCompleted(tasks: Task[], today: string, weeks = 4): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const t of tasks) {
    if (t.status !== "完了") continue;
    const ago = diffDays(today, t.updated);
    if (ago < 0) continue;
    const bucket = Math.floor(ago / 7);
    if (bucket < weeks) out[weeks - 1 - bucket]++;
  }
  return out;
}

/** 四半期に有効な項目だけ（Objective・KRは常に有効） */
export function itemsInQuarter(items: OkrItem[], q: Quarter): OkrItem[] {
  return items.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes(q));
}

export function uniqueTasks(list: Task[]): Task[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** 全体の集計：TFにつながるPJのタスクを、共有PJでも1回だけ数える */
export function tasksForAll(tasks: Task[], pjs: Pj[]): Task[] {
  const ids = new Set(pjs.filter((p) => p.tfIds.length > 0).map((p) => p.id));
  return tasks.filter((t) => ids.has(t.pjId));
}

/** 共有PJ：2つ以上のTFに紐づくPJ。exceptTfId を渡すとその TF 以外の共有先を返す */
export function sharedTfs(pj: Pj, items: OkrItem[], exceptTfId?: string): OkrItem[] {
  if (pj.tfIds.length < 2) return [];
  return pj.tfIds
    .filter((id) => id !== exceptTfId)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is OkrItem => !!i);
}

export function isSharedAcrossKrs(pj: Pj, items: OkrItem[]): boolean {
  return new Set(pj.tfIds.map((id) => items.find((i) => i.id === id)?.parentId)).size > 1;
}

export function krIdsOfPj(pj: Pj, items: OkrItem[]): string[] {
  return [...new Set(pj.tfIds.map((id) => items.find((i) => i.id === id)?.parentId).filter((x): x is string => !!x))];
}

export function checkpointOf(cps: Checkpoint[], tfId: string, month: string): Checkpoint | undefined {
  return cps.find((c) => c.tfId === tfId && c.month === month);
}

export function tasksForTf(tasks: Task[], pjs: Pj[], tfId: string): Task[] {
  const ids = new Set(pjs.filter((p) => p.tfIds.includes(tfId)).map((p) => p.id));
  return tasks.filter((t) => ids.has(t.pjId));
}

export function tfIdsOfKr(items: OkrItem[], krId: string): string[] {
  return items.filter((i) => i.kind === "tf" && i.parentId === krId).map((i) => i.id);
}

/** 1つのPJが同じKR内の2つのTFに紐づいていても、タスクは重複させない */
export function tasksForKr(tasks: Task[], pjs: Pj[], items: OkrItem[], krId: string): Task[] {
  const tfs = new Set(tfIdsOfKr(items, krId));
  const ids = new Set(pjs.filter((p) => p.tfIds.some((x) => tfs.has(x))).map((p) => p.id));
  return tasks.filter((t) => ids.has(t.pjId));
}

export function pjsForKr(pjs: Pj[], items: OkrItem[], krId: string): Pj[] {
  const tfs = new Set(tfIdsOfKr(items, krId));
  return pjs.filter((p) => p.tfIds.some((x) => tfs.has(x)));
}

export function unconnectedPjs(pjs: Pj[]): Pj[] {
  return pjs.filter((p) => p.tfIds.length === 0);
}

export interface MatrixCell {
  updated: number;
  open: number;
}

export interface MatrixRow {
  member: Member;
  cells: Record<string, MatrixCell>;
  /** 重複を除いた合計（共有PJのタスクを複数KRで数えない） */
  total: MatrixCell;
}

export interface MatrixFooter {
  cells: Record<string, MatrixCell>;
  total: MatrixCell;
}

function cellOf(list: Task[], win: Window): MatrixCell {
  return { updated: list.filter((t) => inWindow(t.updated, win)).length, open: list.filter(isOpen).length };
}

/**
 * メンバー × KR。セル＝その人が担当するタスクのうち期間内の更新件数と未完了件数。
 * KRごとには数えるが、合計は共有PJの重複を除く
 */
export function buildMatrix(
  members: Member[],
  krIds: string[],
  krTasks: Record<string, Task[]>,
  win: Window,
): { rows: MatrixRow[]; footer: MatrixFooter } {
  const rows = members.map((member) => {
    const cells: Record<string, MatrixCell> = {};
    const all: Task[] = [];
    for (const krId of krIds) {
      const mine = (krTasks[krId] ?? []).filter((t) => t.assigneeId === member.id);
      cells[krId] = cellOf(mine, win);
      all.push(...mine);
    }
    return { member, cells, total: cellOf(uniqueTasks(all), win) };
  });
  const ids = new Set(members.map((m) => m.id));
  const footerCells: Record<string, MatrixCell> = {};
  const footerAll: Task[] = [];
  for (const krId of krIds) {
    const mine = (krTasks[krId] ?? []).filter((t) => ids.has(t.assigneeId));
    footerCells[krId] = cellOf(mine, win);
    footerAll.push(...mine);
  }
  return { rows, footer: { cells: footerCells, total: cellOf(uniqueTasks(footerAll), win) } };
}

// ---------- 文字単位の差分 ----------

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
    return {
      id: it.id,
      label: it.label,
      kind: it.kind,
      app: it.text,
      kintone: k,
      same: it.text === k,
      left: d.left,
      right: d.right,
    };
  });
}

export type Resolution = "app" | "kintone";

/** 差分のある行がすべて「どちらに合わせるか」選ばれているか */
export function canLock(rows: CompareRow[], resolutions: Record<string, Resolution>): boolean {
  return rows.every((r) => r.same || resolutions[r.id] !== undefined);
}

/** 選択を反映した確定文言 */
export function resolvedTexts(rows: CompareRow[], resolutions: Record<string, Resolution>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = !r.same && resolutions[r.id] === "kintone" ? r.kintone : r.app;
  return out;
}

// ---------- チェックイン事前レポート ----------

export interface MemberTasks {
  member: Member;
  tasks: Task[];
}

export interface PreReport {
  team: Team;
  checkin: string;
  dueSoon: MemberTasks[];
  overdue: MemberTasks[];
  staleTasks: Task[];
  staleKrIds: string[];
  staleTfIds: string[];
  unregisteredKrIds: string[];
  unregisteredTfIds: string[];
  window: Window;
}

function groupByMember(members: Member[], tasks: Task[]): MemberTasks[] {
  return members
    .map((member) => ({ member, tasks: tasks.filter((t) => t.assigneeId === member.id) }))
    .filter((g) => g.tasks.length > 0);
}

export function buildPreReport(args: {
  team: Team;
  members: Member[];
  items: OkrItem[];
  pjs: Pj[];
  tasks: Task[];
  today: string;
}): PreReport {
  const { team, members, items, pjs, tasks, today } = args;
  const teamMembers = members.filter((m) => m.teamId === team.id);
  const ids = new Set(teamMembers.map((m) => m.id));
  const teamTasks = tasks.filter((t) => ids.has(t.assigneeId));
  const checkin = nextCheckinDate(today, team.checkinWeekday);
  const connected = new Set(pjs.filter((p) => p.tfIds.length > 0).map((p) => p.id));
  const scopeIds = (kind: "kr" | "tf", test: (ts: Task[]) => boolean) =>
    items
      .filter((i) => i.kind === kind)
      .filter((i) => test(kind === "kr" ? tasksForKr(tasks, pjs, items, i.id) : tasksForTf(tasks, pjs, i.id)))
      .map((i) => i.id);
  const isStale = (ts: Task[]) => isStaleScope(ts, today);
  return {
    team,
    checkin,
    dueSoon: groupByMember(teamMembers, dueBeforeCheckin(teamTasks, today, checkin)),
    overdue: groupByMember(teamMembers, overdueTasks(teamTasks, today)),
    staleTasks: teamTasks.filter((t) => isStaleTask(t, today) && connected.has(t.pjId)),
    staleKrIds: scopeIds("kr", isStale),
    staleTfIds: scopeIds("tf", isStale),
    unregisteredKrIds: scopeIds("kr", isUnregistered),
    unregisteredTfIds: scopeIds("tf", isUnregistered),
    window: weekWindow(today, team.checkinWeekday),
  };
}

// ---------- 文面の生成 ----------

export function buildReminderText(args: {
  toName: string;
  fromName: string;
  checkin: string;
  tasks: { title: string; due: string }[];
  today: string;
}): string {
  const { toName, fromName, checkin, tasks, today } = args;
  const lines = tasks.map((t) => {
    const late = t.due < today ? `（${diffDays(today, t.due)}日超過）` : "";
    return `・${t.title} 期日 ${formatMd(t.due)}${late}`;
  });
  return [
    `${toName}さん`,
    "",
    `お疲れさまです。${formatMd(checkin)}のチェックインの前に、次のタスクの状況を教えてください。`,
    ...lines,
    "",
    "進めにくい点があれば、チェックインで一緒に相談しましょう。",
    `${fromName}`,
  ].join("\n");
}

export function buildReportMarkdown(args: {
  report: PreReport;
  krLabel: (id: string) => string;
  tfLabel: (id: string) => string;
  pjName: (pjId: string) => string;
  today: string;
  /** TFリーダーの申告とチェックポイントを1行ずつ */
  selfLines?: string[];
  /** 取り上げた「つながり」を1行ずつ */
  linkLines?: string[];
}): string {
  const { report, krLabel, tfLabel, pjName, today } = args;
  const out: string[] = [];
  out.push(`# ${report.team.name} 事前レポート（チェックイン ${formatMd(report.checkin)}）`);
  out.push("");
  out.push(`作成日：${formatMd(today)} 今週の動きの期間：${formatWindow(report.window)}`);
  const section = (title: string, groups: MemberTasks[]) => {
    out.push("", `## ${title}`);
    if (groups.length === 0) out.push("なし");
    for (const g of groups) {
      out.push(`- ${g.member.name}`);
      for (const t of g.tasks) out.push(`  - ${t.title}（${pjName(t.pjId)}）期日 ${formatMd(t.due)}／${t.status}`);
    }
  };
  section("チェックイン日までに期日が来る未完了タスク", report.dueSoon);
  section("期日を過ぎているタスク", report.overdue);
  out.push("", "## 7日以上動きのないもの");
  const stale = [
    ...report.staleKrIds.map((id) => `- ${krLabel(id)}（目標全体）`),
    ...report.staleTfIds.map((id) => `- ${tfLabel(id)}（取り組み全体）`),
    ...report.staleTasks.map((t) => `- ${t.title}（${pjName(t.pjId)}）最終更新 ${formatMd(t.updated)}`),
  ];
  out.push(...(stale.length ? stale : ["なし"]));
  const unreg = [
    ...report.unregisteredKrIds.map((id) => `- ${krLabel(id)}`),
    ...report.unregisteredTfIds.map((id) => `- ${tfLabel(id)}`),
  ];
  out.push("", "## タスク未登録", ...(unreg.length ? unreg : ["なし"]));
  out.push("", `## TFリーダーの申告（${formatWindow(report.window)}）`, ...(args.selfLines?.length ? args.selfLines : ["なし"]));
  out.push("", "## つながり（チェックインで取り上げるもの）", ...(args.linkLines?.length ? args.linkLines : ["なし"]));
  return out.join("\n");
}

// ---------- つながり（KRをまたぐシナジーの候補） ----------

export const SYNERGY_LABEL: Record<Synergy["type"], string> = {
  "same-subject": "同じ相手・対象",
  handoff: "受け渡し",
  duplicate: "重複",
  crunch: "集中",
};

function krsOfTask(t: Task, pjs: Pj[], items: OkrItem[]): string[] {
  const pj = pjs.find((p) => p.id === t.pjId);
  return pj ? krIdsOfPj(pj, items) : [];
}

/** 別のPJの2つのタスクが、異なるKRにまたがるか（同じPJの中は「つながり」と呼ばない） */
function crossKr(a: Task, b: Task, pjs: Pj[], items: OkrItem[]): boolean {
  if (a.pjId === b.pjId) return false;
  const ka = krsOfTask(a, pjs, items);
  const kb = krsOfTask(b, pjs, items);
  return ka.some((x) => kb.some((y) => x !== y));
}

function unionKrs(list: Task[], pjs: Pj[], items: OkrItem[]): string[] {
  return [...new Set(list.flatMap((t) => krsOfTask(t, pjs, items)))].sort();
}

/** その日を含む週の月曜日 */
export function weekStartOf(s: string): string {
  const wd = weekdayOf(s);
  return addDays(s, -((wd + 6) % 7));
}

export const CRUNCH_MIN_TASKS = 4;

/** (a)(b)(d) を機械的に求める。(c) は呼び出し側が固定の候補を足す */
export function buildSynergies(args: { tasks: Task[]; pjs: Pj[]; items: OkrItem[]; today: string; members: Member[] }): Synergy[] {
  const { tasks, pjs, items, today, members } = args;
  const out: Synergy[] = [];
  const krName = (ids: string[]) => ids.map((id) => items.find((i) => i.id === id)?.label ?? id).join("・");

  const bySubject = new Map<string, Task[]>();
  for (const t of tasks) if (t.subject) bySubject.set(t.subject, [...(bySubject.get(t.subject) ?? []), t]);
  for (const [subject, list] of bySubject) {
    const hit = list.some((a, i) => list.slice(i + 1).some((b) => crossKr(a, b, pjs, items)));
    if (!hit) continue;
    const krs = unionKrs(list, pjs, items);
    out.push({
      id: `same:${subject}`,
      type: "same-subject",
      krIds: krs,
      taskIds: list.map((t) => t.id),
      summary: `「${subject}」を、${krName(krs)}のタスクがそれぞれ扱っています。窓口や情報を揃えると、先方への動きが重ならずに済みます。`,
    });
  }

  for (const t of tasks) {
    for (const depId of t.dependsOn ?? []) {
      const dep = tasks.find((x) => x.id === depId);
      if (!dep || !crossKr(dep, t, pjs, items)) continue;
      const krs = unionKrs([dep, t], pjs, items);
      const note = dep.due > t.due ? "前提の期日のほうが後ろにあります。" : dep.status === "完了" ? "前提はすでに完了しています。" : "前提の完了を待っている状態です。";
      out.push({
        id: `handoff:${dep.id}>${t.id}`,
        type: "handoff",
        krIds: krs,
        taskIds: [dep.id, t.id],
        summary: `「${dep.title}」が、別のKRの「${t.title}」の前提になっています。${note}`,
      });
    }
  }

  for (const m of members) {
    const byWeek = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.assigneeId !== m.id || !isOpen(t) || t.due < today) continue;
      if (krsOfTask(t, pjs, items).length === 0) continue;
      const w = weekStartOf(t.due);
      byWeek.set(w, [...(byWeek.get(w) ?? []), t]);
    }
    for (const [w, list] of byWeek) {
      const krs = unionKrs(list, pjs, items);
      if (list.length < CRUNCH_MIN_TASKS || krs.length < 2) continue;
      out.push({
        id: `crunch:${m.id}:${w}`,
        type: "crunch",
        krIds: krs,
        taskIds: list.map((t) => t.id),
        summary: `${m.name}さんに、${formatMd(w)}の週に${krName(krs)}の期日が${list.length}件重なっています。`,
      });
    }
  }
  return out;
}

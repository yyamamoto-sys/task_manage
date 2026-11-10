import type { Member, OkrItem, Pj, Seg, Task, Team } from "./types";

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

/** KR・TF などの範囲：中のタスクが1件も直近 days 日以内に動いていない（タスクなしも停滞扱い） */
export function isStaleScope(tasks: Task[], today: string, days = STALE_DAYS): boolean {
  if (tasks.length === 0) return true;
  return tasks.every((t) => diffDays(today, t.updated) >= days);
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

/** 直近7日（今日を含む）の動き */
export function movement(tasks: Task[], today: string): Movement {
  let updated = 0;
  let completed = 0;
  let overdue = 0;
  for (const t of tasks) {
    const ago = diffDays(today, t.updated);
    if (ago >= 0 && ago <= 6) {
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
}

/** メンバー × KR。セル＝その人が担当するタスクのうち直近7日の更新件数と未完了件数 */
export function buildMatrix(
  members: Member[],
  krIds: string[],
  krTasks: Record<string, Task[]>,
  today: string,
): MatrixRow[] {
  return members.map((member) => {
    const cells: Record<string, MatrixCell> = {};
    for (const krId of krIds) {
      const mine = (krTasks[krId] ?? []).filter((t) => t.assigneeId === member.id);
      cells[krId] = {
        updated: mine.filter((t) => {
          const ago = diffDays(today, t.updated);
          return ago >= 0 && ago <= 6;
        }).length,
        open: mine.filter(isOpen).length,
      };
    }
    return { member, cells };
  });
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
  const staleScopeIds = (kind: "kr" | "tf") =>
    items
      .filter((i) => i.kind === kind)
      .filter((i) => {
        const ts = kind === "kr" ? tasksForKr(tasks, pjs, items, i.id) : tasksForTf(tasks, pjs, i.id);
        return isStaleScope(ts, today);
      })
      .map((i) => i.id);
  return {
    team,
    checkin,
    dueSoon: groupByMember(teamMembers, dueBeforeCheckin(teamTasks, today, checkin)),
    overdue: groupByMember(teamMembers, overdueTasks(teamTasks, today)),
    staleTasks: teamTasks.filter((t) => isStaleTask(t, today) && connected.has(t.pjId)),
    staleKrIds: staleScopeIds("kr"),
    staleTfIds: staleScopeIds("tf"),
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
}): string {
  const { report, krLabel, tfLabel, pjName, today } = args;
  const out: string[] = [];
  out.push(`# ${report.team.name} 事前レポート（チェックイン ${formatMd(report.checkin)}）`);
  out.push("");
  out.push(`作成日：${formatMd(today)}`);
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
  return out.join("\n");
}

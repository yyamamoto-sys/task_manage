// supabase/functions/_shared/reminderLogic.ts
//
// 期限リマインド（push-reminders）の判定ロジック。Deno・npm に依存しない純粋関数だけを置き、
// src/lib/reminder/__tests__/reminderLogic.test.ts から相対 import して vitest で検証する
// （ai-consult/guestQuota.ts と同じ置き方）。正本：docs/dev/web-push-reminder-design.md §6.1・§7.2。
//
// 既定値・時刻の選択肢はフロントの src/lib/reminder/notificationPrefs.ts と同じ値を持つ
// （Edge Function から src は import できないため二重に持つ。一致はテストで検査する）。

export const DEFAULT_REMINDER_TIME = "08:30";
export const REMINDER_TIME_MIN = "07:00";
export const REMINDER_TIME_MAX = "19:00";
export const DIGEST_TITLE = "タスクの期限";
export const DIGEST_URL = "/?open=my-tasks";
export const TASK_NAME_MAX_CHARS = 40;
export const PUSH_TTL_SECONDS = 12 * 60 * 60;

export interface PrefsRow {
  member_id: string;
  inapp_enabled: boolean;
  push_enabled: boolean;
  notify_overdue: boolean;
  notify_due_today: boolean;
  reminder_time: string; // "08:30:00"（DB の time）または "08:30"
}

export type EffectivePrefs = Omit<PrefsRow, "member_id" | "reminder_time"> & { reminder_time: string };

export const DEFAULT_PREFS: EffectivePrefs = {
  inapp_enabled: true,
  push_enabled: false,
  notify_overdue: true,
  notify_due_today: true,
  reminder_time: DEFAULT_REMINDER_TIME,
};

export interface ReminderTaskRow {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  created_at: string | null;
  is_deleted?: boolean | null;
  assignee_member_id: string | null;
  assignee_member_ids: string[] | null;
}

export interface ReminderMemberRow {
  id: string;
  is_deleted?: boolean | null;
}

export interface ReminderDigest {
  memberId: string;
  overdueCount: number;
  dueTodayCount: number;
  firstTaskId: string;
  title: string;
  body: string;
  url: string;
  wantsInapp: boolean;
  wantsPush: boolean;
}

/** "08:30:00" / "8:30" → "08:30"。解釈できなければ null */
export function normalizeTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function effectivePrefs(row: PrefsRow | undefined): EffectivePrefs {
  if (!row) return DEFAULT_PREFS;
  return {
    inapp_enabled: row.inapp_enabled,
    push_enabled: row.push_enabled,
    notify_overdue: row.notify_overdue,
    notify_due_today: row.notify_due_today,
    reminder_time: normalizeTime(row.reminder_time) ?? DEFAULT_REMINDER_TIME,
  };
}

export interface JstSlot {
  /** JST の日付 YYYY-MM-DD */
  date: string;
  /** JST の時刻を30分単位に切り捨てた "HH:MM"（cron の起動遅延を吸収する） */
  slotTime: string;
  /** 0=日 … 6=土（JST） */
  dow: number;
}

export function resolveJstSlot(now: Date): JstSlot {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const h = jst.getUTCHours();
  const m = jst.getUTCMinutes() < 30 ? 0 : 30;
  return {
    date: jst.toISOString().slice(0, 10),
    slotTime: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    dow: jst.getUTCDay(),
  };
}

export type DaySkip = { skip: false } | { skip: true; reason: string };

/**
 * 送ってよい日か。週末と祝日は送らない（設計書 §11-3）。
 * isHoliday は src/lib/date/holidays.ts と同じく japanese-holidays の isHoliday(d, true) を
 * 包んだもの（祝日名 or null）を渡す。
 */
export function resolveDaySkip(slot: JstSlot, isHoliday: (dateStr: string) => string | null): DaySkip {
  if (slot.dow === 0 || slot.dow === 6) return { skip: true, reason: "休日（土日）のためスキップ" };
  const holiday = isHoliday(slot.date);
  if (holiday) return { skip: true, reason: `祝日（${holiday}）のためスキップ` };
  return { skip: false };
}

/**
 * dateStr（JST基準の "YYYY-MM-DD"）の年月日を直接ローカル構築した Date を返す。
 * japanese-holidays の isHoliday は内部で getFullYear()/getMonth()/getDate()（ローカル
 * ゲッター）を読むため、`new Date(dateStr + "T00:00:00Z")` のように UTC としてパースして
 * からローカルゲッターで読むと、実行環境のタイムゾーンが UTC でない場合に日付がずれる。
 * 年月日を直接ローカル構築すれば、セットとゲットが常に同じ「ローカル」基準になるため、
 * 実行環境のタイムゾーンに依存しない。
 */
export function buildJstHolidayDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export type HolidayCheckFn = (date: Date, includeFurikae?: boolean) => string | null | undefined;

/**
 * japanese-holidays モジュールから isHoliday 関数を取り出す。読み込めなければ throw する
 * （黙って「祝日ではない」側へフェイルオープンしない。esm.sh配信障害・ライブラリの
 * 破壊的変更を検知できないまま運用されるのを防ぐ）。
 */
export function resolveHolidayCheckFn(mod: Record<string, unknown>): HolidayCheckFn {
  const direct = mod.isHoliday;
  const nested = (mod.default as Record<string, unknown> | undefined)?.isHoliday;
  const fn = direct ?? nested;
  if (typeof fn !== "function") {
    throw new Error("japanese-holidays の isHoliday を読み込めませんでした（祝日判定ができないため送信を中止します）");
  }
  return fn as HolidayCheckFn;
}

/** src/lib/taskMeta.ts の getAssigneeIds と同じ規則 */
export function assigneeIdsOf(t: Pick<ReminderTaskRow, "assignee_member_id" | "assignee_member_ids">): string[] {
  if (t.assignee_member_ids && t.assignee_member_ids.length > 0) return t.assignee_member_ids;
  if (t.assignee_member_id) return [t.assignee_member_id];
  return [];
}

function truncateChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : s;
}

/** 「期限超過2件・今日期限1件：◯◯ ほか」。0件の種類は書かない。合計1件なら「ほか」を付けない */
export function buildDigestBody(overdueCount: number, dueTodayCount: number, firstTaskName: string): string {
  const parts: string[] = [];
  if (overdueCount > 0) parts.push(`期限超過${overdueCount}件`);
  if (dueTodayCount > 0) parts.push(`今日期限${dueTodayCount}件`);
  const total = overdueCount + dueTodayCount;
  const name = truncateChars(firstTaskName.trim() || "（名前なし）", TASK_NAME_MAX_CHARS);
  return `${parts.join("・")}：${name}${total > 1 ? " ほか" : ""}`;
}

function compareTasks(a: ReminderTaskRow, b: ReminderTaskRow): number {
  const da = a.due_date ?? "";
  const db = b.due_date ?? "";
  if (da !== db) return da < db ? -1 : 1;
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface BuildDigestsInput {
  members: ReminderMemberRow[];
  prefs: PrefsRow[];
  tasks: ReminderTaskRow[];
  today: string;
  /** 指定するとその時刻を選んでいる人だけを対象にする。null なら時刻で絞らない（dryRun の全体確認用） */
  slotTime: string | null;
}

/**
 * 今回の起動で知らせる人と文面を組み立てる（設計書 §7.2）。
 * 部署では絞らない（本人が担当するタスクは全部署分）。status は todo / in_progress のみ。
 */
export function buildDigests(input: BuildDigestsInput): ReminderDigest[] {
  const prefsById = new Map(input.prefs.map((p) => [p.member_id, p]));
  const activeMembers = input.members.filter((m) => !m.is_deleted);
  const activeIds = new Set(activeMembers.map((m) => m.id));

  const tasksByMember = new Map<string, ReminderTaskRow[]>();
  for (const t of input.tasks) {
    if (t.is_deleted) continue;
    if (t.status !== "todo" && t.status !== "in_progress") continue;
    if (!t.due_date || t.due_date > input.today) continue;
    for (const mid of new Set(assigneeIdsOf(t))) {
      if (!activeIds.has(mid)) continue;
      const list = tasksByMember.get(mid);
      if (list) list.push(t);
      else tasksByMember.set(mid, [t]);
    }
  }

  const digests: ReminderDigest[] = [];
  for (const m of activeMembers) {
    const p = effectivePrefs(prefsById.get(m.id));
    if (input.slotTime !== null && p.reminder_time !== input.slotTime) continue;
    if (!p.inapp_enabled && !p.push_enabled) continue;
    const mine = tasksByMember.get(m.id) ?? [];
    const included = mine.filter((t) =>
      (t.due_date as string) < input.today ? p.notify_overdue : p.notify_due_today,
    );
    if (included.length === 0) continue;
    const overdueCount = included.filter((t) => (t.due_date as string) < input.today).length;
    const dueTodayCount = included.length - overdueCount;
    const first = [...included].sort(compareTasks)[0];
    digests.push({
      memberId: m.id,
      overdueCount,
      dueTodayCount,
      firstTaskId: first.id,
      title: DIGEST_TITLE,
      body: buildDigestBody(overdueCount, dueTodayCount, first.name),
      url: DIGEST_URL,
      wantsInapp: p.inapp_enabled,
      wantsPush: p.push_enabled,
    });
  }
  return digests;
}

/**
 * claim_reminder_sends の戻り値（SETOF text）から「今日まだ送っていなかった人」の文面だけを残す。
 * PostgREST の返し方（文字列の配列／{claim_reminder_sends: id} の配列）の両方を受ける。
 */
export function pickClaimedTargets(digests: ReminderDigest[], claimRows: unknown): ReminderDigest[] {
  const rows = Array.isArray(claimRows) ? claimRows : [];
  const claimed = new Set(rows.map((r) =>
    typeof r === "string" ? r : String((r as Record<string, unknown> | null)?.claim_reminder_sends ?? "")));
  return digests.filter((d) => claimed.has(d.memberId));
}

/**
 * テスト専用の参照実装：claim_reminder_sends（SQL）と同じ規則
 * 「(member_id, send_date) が未登録の人だけを登録して返す」を Map で再現する。本番の判定経路ではない
 * （判定と記録は SQL の INSERT … ON CONFLICT DO NOTHING RETURNING 1文で行う）。SQL を変えたらここも見直す。
 */
export function simulateClaimReminderSends(log: Set<string>, memberIds: string[], sendDate: string): string[] {
  const inserted: string[] = [];
  for (const id of new Set(memberIds)) {
    const key = `${id}\u0000${sendDate}`;
    if (log.has(key)) continue;
    log.add(key);
    inserted.push(id);
  }
  return inserted;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function buildDigestPayload(digest: Pick<ReminderDigest, "title" | "body" | "url">, date: string): PushPayload {
  return { title: digest.title, body: digest.body, url: digest.url, tag: `deadline-${date}` };
}

export const TEST_PAYLOAD: PushPayload = {
  title: "テスト通知",
  body: "この通知が見えていれば、Windows通知は届きます。",
  url: "/",
  tag: "push-test",
};

export type RunStatus = "success" | "partial" | "failed";

/** 1件でも失敗があれば partial。送信を試みて1件も成功せず、アプリ内通知も書けなかったら failed */
export function resolveRunStatus(c: {
  pushAttempted: number;
  pushSucceeded: number;
  pushFailed: number;
  inappFailed: number;
  inappWritten: number;
}): RunStatus {
  if (c.pushFailed === 0 && c.inappFailed === 0) return "success";
  const nothingWorked = c.pushSucceeded === 0 && c.inappWritten === 0;
  return nothingWorked ? "failed" : "partial";
}

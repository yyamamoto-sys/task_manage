// src/lib/reminder/__tests__/reminderLogic.test.ts
//
// push-reminders（Edge Function）の判定ロジック。実体は supabase/functions/_shared/ の純粋関数で、
// ここから相対 import して検証する（ai-consult/guestQuota.ts と同じ置き方）。
// 祝日は本番と同じ japanese-holidays を src/lib/date/holidays.ts 経由で渡す。

import { describe, it, expect } from "vitest";
import {
  buildDigestBody, buildDigests, DEFAULT_PREFS, DEFAULT_REMINDER_TIME, effectivePrefs, normalizeTime,
  pickClaimedTargets, resolveDaySkip, resolveJstSlot, resolveRunStatus, simulateClaimReminderSends,
  REMINDER_TIME_MIN, REMINDER_TIME_MAX,
  type PrefsRow, type ReminderTaskRow, type ReminderMemberRow,
} from "../../../../supabase/functions/_shared/reminderLogic";
import { classifyPushStatus, summarizeFailures } from "../../../../supabase/functions/_shared/webPushCore";
import { fetchAllRows } from "../../../../supabase/functions/_shared/fetchAllRows";
import { isHoliday } from "../../date/holidays";
import { DEFAULT_NOTIFICATION_PREFS, REMINDER_TIME_OPTIONS } from "../notificationPrefs";

const TODAY = "2026-10-05"; // 月曜

function task(p: Partial<ReminderTaskRow> & { id: string }): ReminderTaskRow {
  return {
    name: `タスク${p.id}`, status: "todo", due_date: TODAY, created_at: "2026-09-01T00:00:00Z",
    is_deleted: false, assignee_member_id: "m1", assignee_member_ids: null, ...p,
  };
}
function prefs(memberId: string, p: Partial<PrefsRow> = {}): PrefsRow {
  return {
    member_id: memberId, inapp_enabled: true, push_enabled: false,
    notify_overdue: true, notify_due_today: true, reminder_time: "08:30:00", ...p,
  };
}
const members: ReminderMemberRow[] = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

describe("JSTの時刻スロット", () => {
  it("UTC日曜23:30＝JST月曜8:30。起動が遅れても30分単位に切り捨てる", () => {
    expect(resolveJstSlot(new Date("2026-10-04T23:30:00Z"))).toEqual({ date: "2026-10-05", slotTime: "08:30", dow: 1 });
    expect(resolveJstSlot(new Date("2026-10-04T23:59:59Z")).slotTime).toBe("08:30");
    expect(resolveJstSlot(new Date("2026-10-05T00:00:30Z")).slotTime).toBe("09:00");
    expect(resolveJstSlot(new Date("2026-10-05T10:30:00Z"))).toEqual({ date: "2026-10-05", slotTime: "19:30", dow: 1 });
  });
});

describe("送ってよい日（平日・祝日）", () => {
  const holidayFn = (d: string) => isHoliday(d);
  it("平日は送る", () => {
    expect(resolveDaySkip(resolveJstSlot(new Date("2026-10-04T23:30:00Z")), holidayFn)).toEqual({ skip: false });
  });
  it("土日は送らない", () => {
    expect(resolveDaySkip({ date: "2026-10-03", slotTime: "08:30", dow: 6 }, holidayFn).skip).toBe(true);
    expect(resolveDaySkip({ date: "2026-10-04", slotTime: "08:30", dow: 0 }, holidayFn).skip).toBe(true);
  });
  it("祝日（文化の日）と振替休日は送らない", () => {
    const culture = resolveDaySkip({ date: "2026-11-03", slotTime: "08:30", dow: 2 }, holidayFn);
    expect(culture).toEqual({ skip: true, reason: expect.stringContaining("祝日") });
    expect(resolveDaySkip({ date: "2026-05-06", slotTime: "08:30", dow: 3 }, holidayFn).skip).toBe(true);
  });
});

describe("対象の抽出（buildDigests）", () => {
  it("todo / in_progress だけを数え、完了・保留・中止・削除済み・未来の期限は除く", () => {
    const digests = buildDigests({
      members, prefs: [], today: TODAY, slotTime: "08:30",
      tasks: [
        task({ id: "a" }),
        task({ id: "b", status: "in_progress", due_date: "2026-10-01" }),
        task({ id: "c", status: "done" }),
        task({ id: "d", status: "on_hold" }),
        task({ id: "e", status: "cancelled" }),
        task({ id: "f", is_deleted: true }),
        task({ id: "g", due_date: "2026-10-06" }),
        task({ id: "h", due_date: null }),
      ],
    });
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ memberId: "m1", overdueCount: 1, dueTodayCount: 1 });
  });

  it("行が無い人は既定値（アプリ内オン・Windowsオフ・8:30）で扱う", () => {
    const d = buildDigests({ members, prefs: [], tasks: [task({ id: "a" })], today: TODAY, slotTime: "08:30" });
    expect(d[0]).toMatchObject({ wantsInapp: true, wantsPush: false });
    expect(buildDigests({ members, prefs: [], tasks: [task({ id: "a" })], today: TODAY, slotTime: "09:00" })).toEqual([]);
  });

  it("その時刻を選んでいる人だけが対象になる（案C）", () => {
    const tasks = [task({ id: "a", assignee_member_id: "m1" }), task({ id: "b", assignee_member_id: "m2" })];
    const p = [prefs("m2", { reminder_time: "12:00:00" })];
    expect(buildDigests({ members, prefs: p, tasks, today: TODAY, slotTime: "08:30" }).map(d => d.memberId)).toEqual(["m1"]);
    expect(buildDigests({ members, prefs: p, tasks, today: TODAY, slotTime: "12:00" }).map(d => d.memberId)).toEqual(["m2"]);
    expect(buildDigests({ members, prefs: p, tasks, today: TODAY, slotTime: null }).map(d => d.memberId)).toEqual(["m1", "m2"]);
  });

  it("種類の絞り込み：期限超過を外すと今日期限だけ、両方外すと届かない", () => {
    const tasks = [task({ id: "a", due_date: "2026-10-01" }), task({ id: "b" })];
    const onlyToday = buildDigests({ members, prefs: [prefs("m1", { notify_overdue: false })], tasks, today: TODAY, slotTime: "08:30" });
    expect(onlyToday[0]).toMatchObject({ overdueCount: 0, dueTodayCount: 1, firstTaskId: "b" });
    expect(buildDigests({ members, prefs: [prefs("m1", { notify_overdue: false, notify_due_today: false })], tasks, today: TODAY, slotTime: "08:30" })).toEqual([]);
    expect(buildDigests({ members, prefs: [prefs("m1", { notify_due_today: false })], tasks: [task({ id: "b" })], today: TODAY, slotTime: "08:30" })).toEqual([]);
  });

  it("両チャネルともオフの人・対象0件の人には送らない", () => {
    expect(buildDigests({ members, prefs: [prefs("m1", { inapp_enabled: false })], tasks: [task({ id: "a" })], today: TODAY, slotTime: "08:30" })).toEqual([]);
    expect(buildDigests({ members, prefs: [], tasks: [], today: TODAY, slotTime: "08:30" })).toEqual([]);
  });

  it("担当者は assignee_member_ids を優先し、複数担当なら全員に数える。削除済みメンバーには送らない", () => {
    const tasks = [task({ id: "a", assignee_member_id: "m1", assignee_member_ids: ["m2", "m3", "m2"] })];
    const d = buildDigests({ members: [{ id: "m1" }, { id: "m2" }, { id: "m3", is_deleted: true }], prefs: [], tasks, today: TODAY, slotTime: "08:30" });
    expect(d.map(x => x.memberId)).toEqual(["m2"]);
    expect(d[0].dueTodayCount).toBe(1);
  });

  it("最初の1件は期日→作成日時→id の順で常に同じ1件になる", () => {
    const tasks = [
      task({ id: "z", due_date: "2026-10-02", name: "後" }),
      task({ id: "y", due_date: "2026-10-01", created_at: "2026-09-02T00:00:00Z", name: "作成が遅い" }),
      task({ id: "x", due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z", name: "先頭" }),
      task({ id: "w", due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z", name: "同時刻でidが小さい" }),
    ];
    const d = buildDigests({ members, prefs: [], tasks, today: TODAY, slotTime: "08:30" });
    expect(d[0].firstTaskId).toBe("w");
    expect(d[0].body).toBe("期限超過4件：同時刻でidが小さい ほか");
  });
});

describe("通知文言（件数＋最初の1件）", () => {
  it("種類ごとの件数と最初の1件。合計2件以上なら「ほか」", () => {
    expect(buildDigestBody(2, 1, "資料作成")).toBe("期限超過2件・今日期限1件：資料作成 ほか");
  });
  it("1件だけなら「ほか」を付けない。0件の種類は書かない", () => {
    expect(buildDigestBody(0, 1, "資料作成")).toBe("今日期限1件：資料作成");
    expect(buildDigestBody(1, 0, "資料作成")).toBe("期限超過1件：資料作成");
  });
  it("タスク名は40字で切る", () => {
    const long = "あ".repeat(45);
    expect(buildDigestBody(1, 0, long)).toBe(`期限超過1件：${"あ".repeat(40)}…`);
    expect(buildDigestBody(1, 0, "あ".repeat(40))).toBe(`期限超過1件：${"あ".repeat(40)}`);
  });
});

describe("1人1日1回（claim_reminder_sends の規則）", () => {
  const tasks = [task({ id: "a", assignee_member_id: "m1" }), task({ id: "b", assignee_member_id: "m2" })];

  it("同じ回が2回起動しても、2回目は誰にも送らない", () => {
    const log = new Set<string>();
    const digests = buildDigests({ members, prefs: [], tasks, today: TODAY, slotTime: "08:30" });
    const first = pickClaimedTargets(digests, simulateClaimReminderSends(log, digests.map(d => d.memberId), TODAY));
    const second = pickClaimedTargets(digests, simulateClaimReminderSends(log, digests.map(d => d.memberId), TODAY));
    expect(first.map(d => d.memberId)).toEqual(["m1", "m2"]);
    expect(second).toEqual([]);
  });

  it("送った後に時刻を12:00へ変えても、その日はもう届かない。翌日は届く", () => {
    const log = new Set<string>();
    const at0830 = buildDigests({ members, prefs: [], tasks, today: TODAY, slotTime: "08:30" });
    pickClaimedTargets(at0830, simulateClaimReminderSends(log, at0830.map(d => d.memberId), TODAY));
    const changed = [prefs("m1", { reminder_time: "12:00:00" })];
    const at1200 = buildDigests({ members, prefs: changed, tasks, today: TODAY, slotTime: "12:00" });
    expect(at1200.map(d => d.memberId)).toEqual(["m1"]);
    expect(pickClaimedTargets(at1200, simulateClaimReminderSends(log, at1200.map(d => d.memberId), TODAY))).toEqual([]);
    const nextDay = "2026-10-06";
    const tomorrow = buildDigests({ members, prefs: changed, tasks, today: nextDay, slotTime: "12:00" });
    expect(pickClaimedTargets(tomorrow, simulateClaimReminderSends(log, tomorrow.map(d => d.memberId), nextDay)).map(d => d.memberId)).toEqual(["m1"]);
  });

  it("RPC の戻り値は文字列の配列でも {claim_reminder_sends} の配列でも読める", () => {
    const digests = buildDigests({ members, prefs: [], tasks, today: TODAY, slotTime: "08:30" });
    expect(pickClaimedTargets(digests, ["m2"]).map(d => d.memberId)).toEqual(["m2"]);
    expect(pickClaimedTargets(digests, [{ claim_reminder_sends: "m1" }]).map(d => d.memberId)).toEqual(["m1"]);
    expect(pickClaimedTargets(digests, null)).toEqual([]);
  });
});

describe("既定値（フロントと Edge Function で同じ）", () => {
  it("アプリ内オン・Windowsオフ・両種類オン・8:30", () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({ ...DEFAULT_PREFS });
    expect(DEFAULT_PREFS).toEqual({ inapp_enabled: true, push_enabled: false, notify_overdue: true, notify_due_today: true, reminder_time: "08:30" });
    expect(effectivePrefs(undefined)).toEqual(DEFAULT_PREFS);
  });
  it("時刻の選択肢は 7:00〜19:00 の30分刻み25件で、Edge Function の範囲と一致する", () => {
    expect(REMINDER_TIME_OPTIONS).toHaveLength(25);
    expect(REMINDER_TIME_OPTIONS[0]).toBe(REMINDER_TIME_MIN);
    expect(REMINDER_TIME_OPTIONS[24]).toBe(REMINDER_TIME_MAX);
    expect(REMINDER_TIME_OPTIONS).toContain(DEFAULT_REMINDER_TIME);
  });
  it("DB の time 表記を正規化する", () => {
    expect(normalizeTime("08:30:00")).toBe("08:30");
    expect(normalizeTime("7:00")).toBe("07:00");
    expect(normalizeTime("x")).toBeNull();
    expect(effectivePrefs(prefs("m1", { reminder_time: "壊れた値" })).reminder_time).toBe("08:30");
  });
});

describe("購読の失効と送信結果", () => {
  it("201/200/202 は成功、410/404 は失効（行を消す）、それ以外は失敗（行は残す）", () => {
    expect(classifyPushStatus(201).kind).toBe("ok");
    expect(classifyPushStatus(410).kind).toBe("gone");
    expect(classifyPushStatus(404).kind).toBe("gone");
    expect(classifyPushStatus(429).kind).toBe("failed");
    expect(classifyPushStatus(500).kind).toBe("failed");
    expect(classifyPushStatus(null, "TypeError")).toEqual({ kind: "failed", status: null, reason: "TypeError" });
  });
  it("失敗の要約はステータス別の件数だけ（endpoint・本文は載せない）", () => {
    expect(summarizeFailures([classifyPushStatus(201), classifyPushStatus(410)])).toBeNull();
    expect(summarizeFailures([classifyPushStatus(500), classifyPushStatus(500), classifyPushStatus(null), classifyPushStatus(429)]))
      .toBe("429:1件 / 500:2件 / 例外:1件");
  });
  it("実行結果：失敗なしは success、一部失敗は partial、何も届かなければ failed", () => {
    expect(resolveRunStatus({ pushAttempted: 2, pushSucceeded: 2, pushFailed: 0, inappFailed: 0, inappWritten: 2 })).toBe("success");
    expect(resolveRunStatus({ pushAttempted: 2, pushSucceeded: 1, pushFailed: 1, inappFailed: 0, inappWritten: 0 })).toBe("partial");
    expect(resolveRunStatus({ pushAttempted: 1, pushSucceeded: 0, pushFailed: 1, inappFailed: 0, inappWritten: 1 })).toBe("partial");
    expect(resolveRunStatus({ pushAttempted: 1, pushSucceeded: 0, pushFailed: 1, inappFailed: 1, inappWritten: 0 })).toBe("failed");
  });
});

describe("Edge Function 用 fetchAllRows（Section 61 と同じ終了条件）", () => {
  // サーバの max_rows（500）が要求ページサイズ（1000）より小さくても末尾を欠かさない
  function fakeBuilder(total: number, maxRows: number) {
    return () => {
      const q = {
        order: () => q,
        range: async (from: number, to: number) => {
          const end = Math.min(to, from + maxRows - 1, total - 1);
          const data = from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => ({ id: String(from + i) }));
          return { data, error: null, count: total };
        },
      };
      return q;
    };
  }
  it("総件数1200・max_rows500 で1200件すべて取る", async () => {
    const res = await fetchAllRows<{ id: string }>(fakeBuilder(1200, 500));
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1200);
  });
});

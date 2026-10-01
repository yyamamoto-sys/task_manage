// src/lib/reminder/__tests__/reminderHealth.test.ts
//
// 「期限リマインドが止まったら赤バナー」の判定（設計書 §6.3）。基準時刻は JST で書き、UTC に直して渡す。

import { describe, it, expect } from "vitest";
import { resolveReminderHealth, type ReminderRunLite } from "../reminderHealth";

/** JST "2026-10-05T09:05" → Date */
const jst = (s: string) => new Date(`${s}:00+09:00`);
const run = (startedJst: string, p: Partial<ReminderRunLite> = {}): ReminderRunLite => ({
  started_at: jst(startedJst).toISOString(), trigger: "cron", status: "success", push_attempted: 0, push_failed: 0, ...p,
});

describe("赤：30分以上前の予定スロットの実行が無い／失敗", () => {
  it("月曜9:05に8:30の記録が無ければ赤（missing・8:30）", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:00")], jst("2026-10-05T09:05")))
      .toEqual({ level: "red", missedSlot: "08:30", reason: "missing" });
  });
  it("8:30の記録が success なら赤にしない", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:30")], jst("2026-10-05T09:05")).level).toBe("none");
  });
  it("8:30の記録が failed、または running のまま（途中で落ちた）なら赤", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:30", { status: "failed" })], jst("2026-10-05T09:05")))
      .toMatchObject({ level: "red", reason: "failed" });
    expect(resolveReminderHealth([run("2026-10-05T08:30", { status: "running" })], jst("2026-10-05T09:05")).level).toBe("red");
  });
  it("手動実行・テスト送信の記録は cron の代わりにならない", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:31", { trigger: "manual" })], jst("2026-10-05T09:05")).level).toBe("red");
  });
  it("20:05 は 19:30 の回を確認する（範囲の最後）", () => {
    expect(resolveReminderHealth([], jst("2026-10-05T20:05"))).toMatchObject({ level: "red", missedSlot: "19:30" });
  });
});

describe("範囲外は判定しない", () => {
  it("土日・早朝・夜は記録が無くても出さない", () => {
    expect(resolveReminderHealth([], jst("2026-10-03T10:05")).level).toBe("none"); // 土曜
    expect(resolveReminderHealth([], jst("2026-10-04T10:05")).level).toBe("none"); // 日曜
    expect(resolveReminderHealth([], jst("2026-10-05T07:20")).level).toBe("none"); // 6:30 の回は存在しない
    expect(resolveReminderHealth([], jst("2026-10-05T20:35")).level).toBe("none"); // 20:00 の回は存在しない
  });
  it("月曜7:35 は 7:00 の回を確認する", () => {
    expect(resolveReminderHealth([], jst("2026-10-05T07:35"))).toMatchObject({ level: "red", missedSlot: "07:00" });
  });
});

describe("黄：直近の実行で失敗が多い", () => {
  it("直近が partial なら黄", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:30", { status: "partial" })], jst("2026-10-05T09:05")))
      .toMatchObject({ level: "yellow", reason: "partial" });
  });
  it("Windows通知の失敗率が50%以上なら黄、50%未満なら出さない", () => {
    expect(resolveReminderHealth([run("2026-10-05T08:30", { push_attempted: 4, push_failed: 2 })], jst("2026-10-05T09:05")).level).toBe("yellow");
    expect(resolveReminderHealth([run("2026-10-05T08:30", { push_attempted: 4, push_failed: 1 })], jst("2026-10-05T09:05")).level).toBe("none");
  });
});

import { describe, it, expect } from "vitest";
import { resolveBackupHealth } from "../backupHealth";

const NOW = new Date("2026-09-17T03:00:00.000Z");

function isoHoursAgo(hours: number, from: Date = NOW): string {
  return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function isoDaysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("resolveBackupHealth", () => {
  it("一次バックアップが24時間ちょうど前なら赤", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(24),
      hasAnyExportRecord: false,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("red");
    expect(r.hoursSinceLastRunSuccess).toBeCloseTo(24, 5);
  });

  it("一次バックアップが23時間59分前なら赤にならない（他条件も正常なら none）", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(23 + 59 / 60),
      hasAnyExportRecord: false,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("none");
  });

  it("一次バックアップが25時間前なら赤", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(25),
      hasAnyExportRecord: false,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("red");
    expect(r.hoursSinceLastRunSuccess).toBeCloseTo(25, 5);
  });

  it("一次バックアップが一度も成功していない（レコードが1件も無い）場合は赤", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: null,
      hasAnyExportRecord: false,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("red");
    expect(r.hoursSinceLastRunSuccess).toBeNull();
    expect(r.daysSinceLastExportSuccess).toBeNull();
  });

  it("backup_exports が空（1件も無い）なら、二次保管がどれだけ古くても何も出さない（一次は正常前提）", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(1),
      hasAnyExportRecord: false,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("none");
    expect(r.daysSinceLastExportSuccess).toBeNull();
  });

  it("backup_exports に記録はあるが一度も成功していないなら黄（一次は正常前提）", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(1),
      hasAnyExportRecord: true,
      lastExportSuccessAt: null,
      now: NOW,
    });
    expect(r.level).toBe("yellow");
    expect(r.daysSinceLastExportSuccess).toBeNull();
  });

  it("二次保管の最終成功が3日ちょうど前なら黄（一次は正常前提）", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(1),
      hasAnyExportRecord: true,
      lastExportSuccessAt: isoDaysAgo(3),
      now: NOW,
    });
    expect(r.level).toBe("yellow");
    expect(r.daysSinceLastExportSuccess).toBeCloseTo(3, 5);
  });

  it("二次保管の最終成功が2日23時間前なら黄にならない（一次は正常前提でnone）", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(1),
      hasAnyExportRecord: true,
      lastExportSuccessAt: isoHoursAgo(2 * 24 + 23),
      now: NOW,
    });
    expect(r.level).toBe("none");
  });

  it("一次・二次の両方が条件を満たす場合は赤を優先する", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(48),
      hasAnyExportRecord: true,
      lastExportSuccessAt: isoDaysAgo(10),
      now: NOW,
    });
    expect(r.level).toBe("red");
    expect(r.daysSinceLastExportSuccess).toBeCloseTo(10, 5);
  });

  it("一次・二次とも正常なら none", () => {
    const r = resolveBackupHealth({
      lastRunSuccessAt: isoHoursAgo(3),
      hasAnyExportRecord: true,
      lastExportSuccessAt: isoDaysAgo(1),
      now: NOW,
    });
    expect(r.level).toBe("none");
  });
});

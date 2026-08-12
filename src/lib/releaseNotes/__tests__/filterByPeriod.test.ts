// src/lib/releaseNotes/__tests__/filterByPeriod.test.ts
import { describe, it, expect } from "vitest";
import type { ReleaseNoteEntry } from "../../releaseNotes";
import { filterReleaseNotesByPeriod, buildReleaseNotesText } from "../filterByPeriod";

const ENTRIES: ReleaseNoteEntry[] = [
  { version: "v3.10", date: "2026-08-10", title: "3件目", highlights: ["最新の変更A", "最新の変更B"] },
  { version: "v3.05", date: "2026-08-01", title: "2件目", highlights: ["中間の変更"] },
  { version: "v3.00", date: "2026-07-15", title: "1件目", highlights: ["最初の変更"] },
];

describe("filterReleaseNotesByPeriod", () => {
  it("期間の両端を含む（start/endちょうどの日付のエントリも含まれる）", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "2026-08-01", end: "2026-08-10" });
    expect(result.map(e => e.version)).toEqual(["v3.10", "v3.05"]);
  });

  it("期間外のエントリは除かれる", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "2026-08-01", end: "2026-08-01" });
    expect(result.map(e => e.version)).toEqual(["v3.05"]);
  });

  it("startのみ指定（endなし）で、start以降が全て含まれる", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "2026-08-01", end: null });
    expect(result.map(e => e.version)).toEqual(["v3.10", "v3.05"]);
  });

  it("endのみ指定（startなし）で、end以前が全て含まれる", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: null, end: "2026-08-01" });
    expect(result.map(e => e.version)).toEqual(["v3.05", "v3.00"]);
  });

  it("start・endともnull（既定・絞り込みなし）のときは全件を返す", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: null, end: null });
    expect(result).toEqual(ENTRIES);
  });

  it("start・endとも空文字列のときは全件を返す（未入力のUI状態を想定）", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "", end: "" });
    expect(result).toEqual(ENTRIES);
  });

  it("該当0件のときは空配列を返す", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "2027-01-01", end: "2027-01-31" });
    expect(result).toEqual([]);
  });

  it("startがendより後（逆転した期間）のときは0件を返す", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "2026-08-10", end: "2026-08-01" });
    expect(result).toEqual([]);
  });

  it("不正な日付文字列の境界は無視し、もう一方の境界だけで判定する", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "not-a-date", end: "2026-08-01" });
    expect(result.map(e => e.version)).toEqual(["v3.05", "v3.00"]);
  });

  it("両方不正な日付文字列のときは全件を返す（境界なし扱い）", () => {
    const result = filterReleaseNotesByPeriod(ENTRIES, { start: "not-a-date", end: "also-invalid" });
    expect(result).toEqual(ENTRIES);
  });

  it("エントリ自身のdateが不正な場合はそのエントリを除外する", () => {
    const withBadEntry: ReleaseNoteEntry[] = [
      ...ENTRIES,
      { version: "v0.9", date: "broken-date", title: "壊れた日付", highlights: ["x"] },
    ];
    const result = filterReleaseNotesByPeriod(withBadEntry, { start: null, end: null });
    expect(result.map(e => e.version)).toEqual(["v3.10", "v3.05", "v3.00"]);
  });
});

describe("buildReleaseNotesText", () => {
  it("日付・バージョン・タイトルの行と、変更点の箇条書きを並べたプレーンテキストを組み立てる", () => {
    const text = buildReleaseNotesText([ENTRIES[0]]);
    expect(text).toBe(
      "2026-08-10  v3.10  3件目\n- 最新の変更A\n- 最新の変更B",
    );
  });

  it("複数エントリは空行で区切る", () => {
    const text = buildReleaseNotesText([ENTRIES[0], ENTRIES[1]]);
    expect(text).toBe(
      "2026-08-10  v3.10  3件目\n- 最新の変更A\n- 最新の変更B" +
        "\n\n" +
        "2026-08-01  v3.05  2件目\n- 中間の変更",
    );
  });

  it("該当0件のときは空文字列を返す", () => {
    expect(buildReleaseNotesText([])).toBe("");
  });

  it("装飾（絵文字・罫線）を含まない素直な箇条書き形式である", () => {
    const text = buildReleaseNotesText(ENTRIES);
    expect(text).not.toMatch(/[━─═]/);
    expect(text).not.toMatch(/[🎉✨🚀]/u);
  });
});

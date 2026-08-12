// src/lib/__tests__/releaseNotes.test.ts
//
// 【設計意図】
// APP_VERSION（src/lib/version.ts）を上げたのに releaseNotes.ts への追記を忘れると、
// この検査が落ちて気づける（version.test.ts の「ソースを読んで検査する」方式と同じ狙い）。
// CLAUDE.md Section 11「バージョンを上げるときの4点セット」参照。

import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../version";
import { RELEASE_NOTES } from "../releaseNotes";

describe("バージョン同期：RELEASE_NOTES先頭のバージョンがAPP_VERSIONと一致する", () => {
  it("RELEASE_NOTESが1件以上ある", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
  });

  it("RELEASE_NOTES[0].versionが `v${APP_VERSION}` と一致する", () => {
    expect(RELEASE_NOTES[0].version).toBe(`v${APP_VERSION}`);
  });

  it("RELEASE_NOTES[0]にタイトルと1件以上の変更点がある（空エントリの書き忘れ防止）", () => {
    const latest = RELEASE_NOTES[0];
    expect(latest.title.trim().length).toBeGreaterThan(0);
    expect(latest.highlights.length).toBeGreaterThan(0);
    for (const h of latest.highlights) {
      expect(h.trim().length).toBeGreaterThan(0);
    }
  });

  it("日付は新しい順（先頭が最も新しい）で並んでいる", () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      const prev = new Date(RELEASE_NOTES[i - 1].date).getTime();
      const cur = new Date(RELEASE_NOTES[i].date).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });
});

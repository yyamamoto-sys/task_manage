// src/lib/__tests__/changelogVersion.test.ts
//
// 【設計意図・2026-08-26】
// version.test.ts / releaseNotes.test.ts は「CLAUDE.md冒頭」「RELEASE_NOTES[0]」と
// APP_VERSION の一致だけを検査しており、docs/dev/CHANGELOG.md は一切機械検査されていな
// かった。そのため v3.93〜v3.95 の3版がCHANGELOG.mdへの追記だけ漏れても、既存テストは
// 何も気づかず全通過していた（v3.82でも同種の抜けが起きた再発）。
// この検査は「CHANGELOG.mdの末尾（最新）の版番号が APP_VERSION と一致するか」を
// ソース走査で固定する。バージョンを上げてCHANGELOG.mdへの追記を忘れると、この
// テストが落ちて気づける（version.test.ts / releaseNotes.test.ts と同じ「ソースを
// 読んで検査する」方式）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../version";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = path.resolve(__dirname, "../../../docs/dev/CHANGELOG.md");

/** 行頭が `# v数字.数字` の見出し行だけを拾う（`#   本文...` のようなぶら下げコメントは除外） */
const VERSION_HEADER = /^# v(\d+\.\d+)/;

describe("バージョン同期：CHANGELOG.md末尾の版番号がAPP_VERSIONと一致する", () => {
  it("docs/dev/CHANGELOG.mdに1件以上のバージョン見出しがある", () => {
    const content = fs.readFileSync(CHANGELOG_PATH, "utf-8");
    const headers = content.split("\n").filter(line => VERSION_HEADER.test(line));
    expect(headers.length).toBeGreaterThan(0);
  });

  it("CHANGELOG.md内で最後に登場する `# vX.Y` 見出しが `v${APP_VERSION}` と一致する", () => {
    const content = fs.readFileSync(CHANGELOG_PATH, "utf-8");
    const lines = content.split("\n");
    const headerLines = lines.filter(line => VERSION_HEADER.test(line));
    const lastHeader = headerLines[headerLines.length - 1];
    expect(
      lastHeader,
      "docs/dev/CHANGELOG.mdに `# vX.Y（YYYY-MM-DD）：…` 形式の見出しが見つかりませんでした",
    ).toBeDefined();
    const match = lastHeader.match(VERSION_HEADER);
    expect(
      match![1],
      `CHANGELOG.mdの最新見出しは "v${match![1]}" ですが、APP_VERSIONは "${APP_VERSION}" です。\n` +
      `バージョンを上げたら docs/dev/CHANGELOG.md の末尾に "# v${APP_VERSION}（YYYY-MM-DD）：…" を\n` +
      `必ず追記すること（CLAUDE.md Section 11「バージョンを上げるときの4点セット」参照）。`,
    ).toBe(APP_VERSION);
  });
});

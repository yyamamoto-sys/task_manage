// src/lib/__tests__/version.test.ts
//
// 【設計意図】
// APP_VERSION（src/lib/version.ts）が CLAUDE.md 冒頭のバージョン表記
// （`# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v3.25` の `v3.25`）と一致する
// ことを機械的に検査する。modalStyles.test.ts と同じ「ファイルを読んで検査する」方式。
// これにより「CLAUDE.mdだけバージョンを上げてコード側の表示が古いまま」という
// ドリフトが、CIやローカルのvitest実行で必ず検知できる。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION, formatBuildTime } from "../version";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_MD_PATH = path.resolve(__dirname, "../../../CLAUDE.md");

describe("バージョン同期：APP_VERSION と CLAUDE.md冒頭の表記が一致する", () => {
  it("CLAUDE.md冒頭の「v数字.数字」表記とAPP_VERSIONが一致する", () => {
    const content = fs.readFileSync(CLAUDE_MD_PATH, "utf-8");
    const firstLine = content.split("\n")[0];
    const match = firstLine.match(/v(\d+\.\d+)/);
    expect(
      match,
      `CLAUDE.md冒頭からバージョン表記(v数字.数字)が見つかりませんでした: "${firstLine}"`,
    ).not.toBeNull();
    expect(APP_VERSION).toBe(match![1]);
  });
});

describe("formatBuildTime：UTC ISO文字列をAsia/Tokyoの表記に変換する", () => {
  it("UTCの日時をJST（+9h）の \"YYYY-MM-DD HH:mm\" 形式に変換する", () => {
    // UTC 2026-08-06T08:30:00Z → JST 2026-08-06 17:30
    expect(formatBuildTime("2026-08-06T08:30:00.000Z")).toBe("2026-08-06 17:30");
  });

  it("日付が変わる境界（UTC深夜）でもJSTの日付に正しく繰り上がる", () => {
    // UTC 2026-08-06T15:30:00Z → JST 2026-08-07 00:30（日付が繰り上がる）
    expect(formatBuildTime("2026-08-06T15:30:00.000Z")).toBe("2026-08-07 00:30");
  });
});

// src/components/settings/__tests__/minFontSize.test.ts
//
// v3.155：設定画面の最小文字サイズは12px（設計仕様 §4・CLAUDE.md Section 60）。
// 設定系・管理系のファイルに12px未満の fontSize を足すと落ちる（コメントは除去してから走査する。Section 59）。
// 既存で12px未満のまま残すファイルは ALLOWED_UNDER_12 に件数つきで登録する（件数は減る方向のみ。今は0）。
//
// 【わざと壊して赤くなることを確認した記録】SettingsTop.tsx に fontSize: "11px" を1行足す → このテストが赤になる
// ことを確認 → 削除して緑に戻した。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}

/** fontSize の指定（1行）に含まれる12px未満の数値の個数 */
export function countUnder12(src: string): number {
  let n = 0;
  for (const m of stripComments(src).matchAll(/fontSize:\s*([^,}\n]*)/g)) {
    for (const num of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(?:px)?/g)) {
      if (parseFloat(num[1]) < 12) n++;
    }
  }
  return n;
}

function listFiles(dirRel: string, exts: RegExp): string[] {
  const dir = path.join(SRC, dirRel);
  return fs.readdirSync(dir).filter(f => exts.test(f)).map(f => `${dirRel}/${f}`);
}

const TARGETS = [
  ...listFiles("components/settings", /\.tsx$/),
  ...listFiles("components/admin", /\.(tsx|ts)$/),
  "components/common/Card.tsx",
  "components/common/DangerZone.tsx",
  "components/common/saveUi.tsx",
];

/** 12px未満を残してよいファイルと、その件数の上限（減らす方向のみ。増やさない） */
const ALLOWED_UNDER_12: Record<string, number> = {};

describe("設定画面・管理ページの文字は12px以上（Section 60）", () => {
  it("検出器：12px未満を数え、12px以上・コメントは数えない", () => {
    expect(countUnder12('const s = { fontSize: "11px" };')).toBe(1);
    expect(countUnder12("const s = { fontSize: 10 };")).toBe(1);
    expect(countUnder12('const s = { fontSize: isMobile ? "10px" : "12px" };')).toBe(1);
    expect(countUnder12('const s = { fontSize: "12px", fontWeight: 600 };')).toBe(0);
    expect(countUnder12('// fontSize: "11px"\nconst a = 1;')).toBe(0);
  });

  it("対象ファイルが見つかっている（空走査への劣化を防ぐ）", () => {
    expect(TARGETS.length).toBeGreaterThan(15);
  });

  it.each(TARGETS)("%s", (file) => {
    const count = countUnder12(fs.readFileSync(path.join(SRC, file), "utf8"));
    expect(count).toBeLessThanOrEqual(ALLOWED_UNDER_12[file] ?? 0);
  });
});

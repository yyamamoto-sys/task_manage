// 【設計意図・v3.183】AI相談の「対象PJの切替確認」（M83）と「読み込み中の✕無効化」（M81）の検査。
// Reactレンダリング基盤が無いため配線はソース走査。CLAUDE.md Section 59：行頭コメント・行末コメントを除いて照合する。
// 修正前のソースに同じ検査を当てて赤くなることを確認する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldConfirmTargetChange } from "../aiTarget";

function read(rel: string): string {
  const src = readFileSync(resolve(__dirname, "../../../..", rel), "utf-8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

const panel = read("src/components/consultation/ConsultationPanel.tsx");
const attachments = read("src/components/consultation/ConsultAttachments.tsx");

const base = { currentPjId: "a", nextPjId: "b", turnCount: 0, proposalCount: 0, loading: false };

describe("shouldConfirmTargetChange：会話があるときだけ確認する", () => {
  it("会話が空なら確認しない", () => {
    expect(shouldConfirmTargetChange(base)).toBe(false);
  });
  it("履歴・表示中の提案・返答待ちのどれかがあれば確認する", () => {
    expect(shouldConfirmTargetChange({ ...base, turnCount: 2 })).toBe(true);
    expect(shouldConfirmTargetChange({ ...base, proposalCount: 1 })).toBe(true);
    expect(shouldConfirmTargetChange({ ...base, loading: true })).toBe(true);
  });
  it("PJが変わらないなら会話があっても確認しない（すべてのPJ＝null どうしも同じ）", () => {
    expect(shouldConfirmTargetChange({ ...base, nextPjId: "a", turnCount: 4 })).toBe(false);
    expect(shouldConfirmTargetChange({ ...base, currentPjId: null, nextPjId: null, turnCount: 4 })).toBe(false);
  });
  it("「すべてのPJ」との行き来も確認する", () => {
    expect(shouldConfirmTargetChange({ ...base, currentPjId: null, nextPjId: "b", turnCount: 2 })).toBe(true);
    expect(shouldConfirmTargetChange({ ...base, nextPjId: null, turnCount: 2 })).toBe(true);
  });
});

describe("対象PJの切替：パネルの配線", () => {
  it("PJ選択の onChange は確認つきの関数を通る（setTargetPjId を直接渡さない）", () => {
    expect(panel).toMatch(/onChange=\{requestTargetChange\}/);
    expect(panel).not.toMatch(/onChange=\{setTargetPjId\}/);
  });
  it("サイドバー追従も確認つきの関数を通る（開いているとき）", () => {
    expect(panel).toMatch(/requestTargetChangeRef\.current\(defaultTargetProjectId\)/);
  });
  it("確認の文言と、感嘆符を使わないこと", () => {
    expect(panel).toContain("対象のプロジェクトが変わりました。新しい相談として始めますか");
    const m = panel.match(/"(対象のプロジェクトが変わりました[^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/[!！]/);
  });
  it("「新しく始める」は handleReset を通してから対象を切り替える", () => {
    expect(panel).toMatch(/if \(!startNew\) return;[\s\S]*?handleReset\(\);[\s\S]*?setTargetPjId\(next\);/);
  });
  it("確認ダイアログの重なりを防ぐ", () => {
    expect(panel).toMatch(/if \(targetChangeAskingRef\.current\) return;\s*targetChangeAskingRef\.current = true;/);
  });
});

describe("資料添付：読み込み中は✕を無効にする（M81）", () => {
  it("「外す」ボタンの disabled に読み込み中を含める", () => {
    const i = attachments.indexOf("を外す`");
    expect(i).toBeGreaterThan(-1);
    const btn = attachments.slice(i, i + 400);
    expect(btn).toMatch(/disabled=\{disabled \|\| loading\}/);
  });
});

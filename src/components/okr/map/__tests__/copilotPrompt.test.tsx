// 会議の文字起こしを Copilot にまとめさせるプロンプト（v3.221）。
import "../../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { buildCopilotPrompt, COPILOT_SUMMARY_MAX_CHARS } from "../copilotPrompt";
import { CopilotPromptHelp } from "../parts/CopilotPromptHelp";

const krs = [
  { label: "KR1", text: "統合営業の商談を増やす", def: { bands: { 60: "出発点", 70: "月1件の商談", 80: "月3件の商談" }, evidence: "商談の記録" } },
  { label: "KR2", text: "知見を共有する", def: { bands: { 60: "出発点", 70: "週1回の共有", 80: "全員が使う", 90: "他部署が使う" }, evidence: "" } },
  { label: "KR3", text: "基準が未設定のKR", def: null },
];

describe("buildCopilotPrompt", () => {
  it("題名・段の要件（90段も）・字数の上限・推測禁止・決定と宿題の指示を含む", () => {
    const p = buildCopilotPrompt(krs);
    expect(p).toContain("KR1：統合営業の商談を増やす");
    expect(p).toContain("70の段の要件：月1件の商談");
    expect(p).toContain("90の段の要件：他部署が使う");
    expect(p).not.toContain("100の段の要件");
    expect(p).toContain("証拠として見るもの：商談の記録");
    expect(p).toContain("KR3：基準が未設定のKR");
    expect(p).toContain("未設定");
    expect(p).toContain(`${COPILOT_SUMMARY_MAX_CHARS}字以内`);
    expect(p).toContain("推測しない");
    expect(p).toContain("言及なし");
    expect(p).toContain("確認できた／一部／まだ");
    expect(p).toContain("宿題：");
  });
  it("KR が0本なら空文字", () => {
    expect(buildCopilotPrompt([])).toBe("");
  });
});

describe("CopilotPromptHelp", () => {
  it("KR があれば欄とコピーボタンを出し、0本なら何も出さない", () => {
    const c1 = document.createElement("div");
    const r1 = createRoot(c1);
    act(() => r1.render(createElement(CopilotPromptHelp, { krs })));
    expect(c1.textContent).toContain("会議の文字起こしは、Copilot にまとめさせてから読ませると確実です");
    expect(c1.textContent).toContain("プロンプトをコピー");
    act(() => r1.unmount());
    const c2 = document.createElement("div");
    const r2 = createRoot(c2);
    act(() => r2.render(createElement(CopilotPromptHelp, { krs: [] })));
    expect(c2.textContent).toBe("");
    act(() => r2.unmount());
  });
});

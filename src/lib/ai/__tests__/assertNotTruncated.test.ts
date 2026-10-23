import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
  buildMessageContent: vi.fn((text: string) => text),
  getContentText: vi.fn((c: unknown) => (typeof c === "string" ? c : "")),
}));

import { invokeAI } from "../invokeAI";
import { assertNotTruncated } from "../assertNotTruncated";
import { callKrReportAI } from "../krReportClient";
import { callQuarterPlanInitialAnalysis, callQuarterPlanDialogue, callQuarterPlanGenerate } from "../krQuarterPlanClient";
import { extractJointCheckinData, extractJointWinSessionData, extractFreeformSession } from "../krSessionExtractor";
import { callWhyDialogue, callWhySummary } from "../krWhyClient";
import { extractOkrImportData } from "../okrImportExtractor";
import { analyzeKr } from "../okrKrAnalysisClient";
import { analyzeObjective } from "../okrObjectiveAnalysisClient";
import { callTodoDecomposeAI } from "../todoDecomposeClient";

const mocked = vi.mocked(invokeAI);

// 出力上限で途中切れになった返答（JSONも文章も途中で終わっている）
const CUT = { content: [{ type: "text" as const, text: '{"summary": "途中で' }], stop_reason: "max_tokens" };

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(CUT);
});

describe("assertNotTruncated（M91）", () => {
  it("max_tokens のときだけ指定の文言で例外にする", () => {
    expect(() => assertNotTruncated({ stop_reason: "max_tokens" }, "切れました")).toThrow("切れました");
    expect(() => assertNotTruncated({ stop_reason: "end_turn" }, "切れました")).not.toThrow();
    expect(() => assertNotTruncated({}, "切れました")).not.toThrow();
  });
});

describe("出力切れを検知していなかった呼び出しが、機能の案内文で止まる（M91）", () => {
  it("KRレポート", async () => {
    await expect(
      callKrReportAI({ today: "2026-10-01", kr_title: "KR", task_forces: [], mode: "checkin", meeting_notes: "" }, "checkin"),
    ).rejects.toThrow("レポートが長すぎて途中で切れました");
  });

  it("クォーター計画（初回分析・対話・計画書生成）", async () => {
    await expect(callQuarterPlanInitialAnalysis([{ role: "user", content: "a" }])).rejects.toThrow("初回分析が長くなりすぎて");
    await expect(callQuarterPlanDialogue([{ role: "user", content: "a" }])).rejects.toThrow("返答が途中で切れました");
    await expect(callQuarterPlanGenerate("ctx", [])).rejects.toThrow("計画書が長すぎて途中で切れました");
  });

  it("セッション抽出（合同チェックイン・合同ウィン・自由形式）", async () => {
    const base = { memberShortNames: ["山本"], transcript: "x" };
    await expect(extractJointCheckinData({ ...base, krs: [{ id: "k", title: "KR" }] })).rejects.toThrow("2回に分けて");
    await expect(extractJointWinSessionData({ ...base, krs: [{ id: "k", title: "KR", previousDeclarations: [] }] })).rejects.toThrow("2回に分けて");
    await expect(extractFreeformSession({ ...base, krTitle: "KR", allKrTitles: ["KR"] })).rejects.toThrow("2回に分けて");
  });

  it("なぜなぜ分析（対話・サマリー）", async () => {
    await expect(callWhyDialogue([{ role: "user", content: "a" }])).rejects.toThrow("返答が途中で切れました");
    await expect(callWhySummary("ctx", [])).rejects.toThrow("サマリーが長くなりすぎて");
  });

  it("OKR取込は最初の返答でも自己修正リトライの返答でも止まる", async () => {
    await expect(extractOkrImportData({ transcript: "x" })).rejects.toThrow("2回に分けて取り込んで");
    expect(mocked).toHaveBeenCalledTimes(1);

    mocked.mockReset();
    mocked.mockResolvedValueOnce({ content: [{ type: "text" as const, text: "壊れた" }], stop_reason: "end_turn" });
    mocked.mockResolvedValueOnce(CUT);
    await expect(extractOkrImportData({ transcript: "x" })).rejects.toThrow("2回に分けて取り込んで");
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("KR分析・Objective分析・ToDo分解", async () => {
    await expect(analyzeKr({ kr: { title: "KR" }, tfs: [], sessions: [], declarations: [], today: "2026-10-01" })).rejects.toThrow("分析が長くなりすぎて");
    await expect(analyzeObjective({ objective: { title: "O" }, krs: [], today: "2026-10-01" })).rejects.toThrow("分析が長くなりすぎて");
    await expect(
      callTodoDecomposeAI({ todoTitle: "t", tfName: "tf", krTitle: "kr", memberShortNames: [], today: "2026-10-01" }),
    ).rejects.toThrow("分解結果が長すぎて");
  });
});

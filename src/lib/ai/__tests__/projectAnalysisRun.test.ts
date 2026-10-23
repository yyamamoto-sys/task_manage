// 【設計意図・v3.184】PJ別AI分析（巡回62回目・E）の検査。
// 修正前は、出力切れ・空の返答がそのまま共有保存され、PJを切り替えると別PJの結果が今のPJの一覧を上書きし、
// 部署を切り替えても前の部署の全PJ分析が残り、連打で二重に課金された。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invokeAIMock = vi.fn();
vi.mock("../invokeAI", () => ({ invokeAI: (...a: unknown[]) => invokeAIMock(...a) }));

import {
  analysisScopeKey, EMPTY_ANALYSIS_MESSAGE, finalizeAnalysisText, resultForScope, TRUNCATED_ANALYSIS_NOTE,
} from "../analysisRun";
import { analyzeProject } from "../projectAnalysisClient";
import { analyzeAllProjects } from "../allProjectsAnalysisClient";

describe("返答の仕上げ", () => {
  it("通常の返答はそのまま（前後の空白だけ除く）", () => {
    expect(finalizeAnalysisText("  ## ひとことで言うと\n順調  ", "end_turn")).toBe("## ひとことで言うと\n順調");
    expect(finalizeAnalysisText("本文", undefined)).toBe("本文");
  });
  it("出力上限で切れた返答には注記を付け、課金済みの本文は残す", () => {
    const out = finalizeAnalysisText("## 次の一手\n- 来週", "max_tokens");
    expect(out.startsWith("## 次の一手\n- 来週")).toBe(true);
    expect(out.endsWith(TRUNCATED_ANALYSIS_NOTE)).toBe(true);
  });
  it("空の返答は共有保存せずエラーにする", () => {
    expect(() => finalizeAnalysisText("  ", "end_turn")).toThrow(EMPTY_ANALYSIS_MESSAGE);
    expect(() => finalizeAnalysisText(undefined, undefined)).toThrow(EMPTY_ANALYSIS_MESSAGE);
  });
});

describe("全PJ分析の結果は、実行したときの範囲でだけ見せる", () => {
  it("範囲の識別子はPJのidの集合（順序に依らない）", () => {
    expect(analysisScopeKey(["b", "a"])).toBe(analysisScopeKey(["a", "b"]));
    expect(analysisScopeKey(["a"])).not.toBe(analysisScopeKey(["a", "b"]));
  });
  it("同じ範囲なら結果を返し、範囲が変わったら返さない（部署切替後に前の部署の分析を出さない）", () => {
    const k1 = analysisScopeKey(["a", "b"]);
    const k2 = analysisScopeKey(["c"]);
    expect(resultForScope("結果", k1, k1)).toBe("結果");
    expect(resultForScope("結果", k1, k2)).toBeNull();
    expect(resultForScope(null, k1, k1)).toBeNull();
    expect(resultForScope("結果", null, k1)).toBeNull();
  });
});

describe("分析クライアントは stop_reason と空の返答を見る", () => {
  beforeEach(() => invokeAIMock.mockReset());
  const pj = {
    project: { name: "P", purpose: "", status: "active", start_date: "", end_date: "", owner_short_names: [] },
    tasks: [], milestones: [], members_short_names: [], today: "2026-10-23",
  };
  it("PJ単体：途中切れに注記が付く", async () => {
    invokeAIMock.mockResolvedValue({ content: [{ text: "## a" }], stop_reason: "max_tokens" });
    expect(await analyzeProject(pj)).toContain(TRUNCATED_ANALYSIS_NOTE);
  });
  it("PJ単体：content が空でも TypeError ではなく案内のエラー", async () => {
    invokeAIMock.mockResolvedValue({ content: [] });
    await expect(analyzeProject(pj)).rejects.toThrow(EMPTY_ANALYSIS_MESSAGE);
  });
  it("全PJ：途中切れに注記が付く／空はエラー", async () => {
    const all = { projects: [], members_short_names: [], today: "2026-10-23" };
    invokeAIMock.mockResolvedValueOnce({ content: [{ text: "## a" }], stop_reason: "max_tokens" });
    expect(await analyzeAllProjects(all)).toContain(TRUNCATED_ANALYSIS_NOTE);
    invokeAIMock.mockResolvedValueOnce({ content: [{ text: "" }] });
    await expect(analyzeAllProjects(all)).rejects.toThrow(EMPTY_ANALYSIS_MESSAGE);
  });
});

// ===== 画面の配線（Reactレンダリング基盤が無いためソース走査。Section 59：行頭コメント・行末コメントを除く） =====
function read(rel: string): string {
  const src = readFileSync(resolve(__dirname, "../../../..", rel), "utf-8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}
const karte = read("src/components/dashboard/ProjectKarte.tsx");
const dash = read("src/components/dashboard/DashboardView.tsx");

describe("PJカルテのAI分析の配線", () => {
  it("実行中のPJをidで持ち、二重起動を止める", () => {
    expect(karte).toMatch(/if \(runningRef\.current\.has\(pid\)\) return;/);
    expect(karte).toMatch(/const analyzing = runningPjIds\.includes\(project\.id\)/);
    expect(karte).not.toContain("setAnalyzing(");
  });
  it("実行中にPJを切り替えたら、結果を今のPJの一覧へ出さない", () => {
    expect(karte).toMatch(/const isCurrent = \(\) => currentPjIdRef\.current === pid/);
    expect(karte).toMatch(/if \(isCurrent\(\)\) setAnalyses\(rows\)/);
    expect(karte).not.toMatch(/\n\s*setAnalyses\(rows\);/);
  });
  it("保存に失敗しても、課金済みの結果は画面に出して注意を添える", () => {
    expect(karte).toContain("saved = await insertProjectAnalysis(");
    expect(karte).toMatch(/setSaveWarning\(`/);
  });
  it("過去の分析の取得に失敗したら、そのことを画面に出す", () => {
    expect(karte).toContain("setAnalysesLoadFailed(true)");
  });
});

describe("全PJ分析の配線", () => {
  it("二重起動を止め、結果は範囲が同じときだけ見せる", () => {
    expect(dash).toMatch(/if \(allAnalysisRunningRef\.current\) return;\s*allAnalysisRunningRef\.current = true;/);
    expect(dash).toMatch(/resultForScope\(rawAllAnalysisResult, allAnalysisKey, aiScopeKey\)/);
    expect(dash).toMatch(/if \(aiScopeKeyRef\.current !== runKey\)/);
  });
  it("分析対象は aiTarget の判定を通す", () => {
    expect(dash).toMatch(/projects\.filter\(pj => isAiTargetProject\(pj\) && pj\.status === "active"\)/);
  });
});

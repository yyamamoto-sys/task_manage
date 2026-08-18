// src/lib/ai/__tests__/guestProjectAnalysisStore.test.ts
//
// 【v3.77バグ修正の回帰テスト】ゲストの「このPJをAI分析」がAI枠を消費するのに結果を
// 一度も表示できなかったバグの修正（ProjectKarte.tsx参照）。このモジュール自体は
// 純粋なMapベースのメモリ保持のみを担う。

import { describe, it, expect, beforeEach } from "vitest";
import { getGuestProjectAnalyses, addGuestProjectAnalysis } from "../guestProjectAnalysisStore";

describe("guestProjectAnalysisStore", () => {
  beforeEach(() => {
    // モジュール内のMapは他テストと共有されるグローバル状態のため、
    // テストごとに専用のprojectIdを使うことで独立性を確保する（クリア関数は用意しない＝
    // 本番でも「保存先を消す」操作は不要なため公開APIを増やさない）。
  });

  it("何も記録していないPJはgetで空配列を返す", () => {
    expect(getGuestProjectAnalyses("pj-empty-1")).toEqual([]);
  });

  it("addで積んだ結果がgetで新しい順に読める", () => {
    const projectId = "pj-order-1";
    const r1 = addGuestProjectAnalysis(projectId, "1回目の分析結果", "__guest__");
    const r2 = addGuestProjectAnalysis(projectId, "2回目の分析結果", "__guest__");
    const rows = getGuestProjectAnalyses(projectId);
    expect(rows.map(r => r.id)).toEqual([r2.id, r1.id]);
    expect(rows[0].content).toBe("2回目の分析結果");
    expect(rows[0].project_id).toBe(projectId);
    expect(rows[0].created_by).toBe("__guest__");
  });

  it("最新2件を超えたら古い分を切り捨てる（project_analysesのMAX_HISTORYと同じ）", () => {
    const projectId = "pj-history-1";
    addGuestProjectAnalysis(projectId, "1回目", "__guest__");
    addGuestProjectAnalysis(projectId, "2回目", "__guest__");
    addGuestProjectAnalysis(projectId, "3回目", "__guest__");
    const rows = getGuestProjectAnalyses(projectId);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.content)).toEqual(["3回目", "2回目"]);
  });

  it("PJごとに独立して保持する", () => {
    addGuestProjectAnalysis("pj-a-1", "PJ Aの分析", "__guest__");
    addGuestProjectAnalysis("pj-b-1", "PJ Bの分析", "__guest__");
    expect(getGuestProjectAnalyses("pj-a-1").map(r => r.content)).toEqual(["PJ Aの分析"]);
    expect(getGuestProjectAnalyses("pj-b-1").map(r => r.content)).toEqual(["PJ Bの分析"]);
  });
});

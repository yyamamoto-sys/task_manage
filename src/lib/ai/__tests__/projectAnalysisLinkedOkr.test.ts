// 【v3.214】カルテの「PJ別AI分析」に、PJが紐づくTF→KR→Objective を渡す。
// 修正前は「KR/TF/Objectiveは一切渡さない」設計で、OKRに紐づけてもAI分析に反映されなかった。

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeAIMock = vi.fn();
vi.mock("../invokeAI", () => ({ invokeAI: (...a: unknown[]) => invokeAIMock(...a) }));

import { analyzeProject, type ProjectAnalysisInput } from "../projectAnalysisClient";

const base: ProjectAnalysisInput = {
  project: { name: "AAS再設計", purpose: "", status: "active", start_date: "", end_date: "", owner_short_names: ["山本"] },
  tasks: [], milestones: [], members_short_names: ["山本"], today: "2026-11-10",
};

beforeEach(() => {
  invokeAIMock.mockReset();
  invokeAIMock.mockResolvedValue({ content: [{ text: "## ひとことで言うと\n順調" }], stop_reason: "end_turn" });
});

describe("analyzeProject — OKR連動", () => {
  it("紐づくKR・TF・Objectiveがユーザーメッセージに入る", async () => {
    await analyzeProject({
      ...base,
      linked_okr: [{
        tf_label: "TF1-2", tf_name: "エース再設計", tf_purpose: "索敵装置を作る", tf_leader: "山本",
        quarter: "4Q", is_current_quarter: true, kr_label: "KR1", kr_title: "営業の仕組みを3つ稼働",
        objective_title: "AIDの目標", objective_period: "2026年度", is_current_objective: true,
      }],
    });
    const msg = (invokeAIMock.mock.calls[0][1] as { content: string }[])[0].content;
    expect(msg).toContain("AIDの目標");
    expect(msg).toContain("営業の仕組みを3つ稼働");
    expect(msg).toContain("エース再設計");
    expect(msg).toContain("索敵装置を作る");
  });

  it("紐づけが無いときは『紐づけなし』と明示する", async () => {
    await analyzeProject(base);
    const msg = (invokeAIMock.mock.calls[0][1] as { content: string }[])[0].content;
    expect(msg).toContain("（紐づけなし）");
  });
});

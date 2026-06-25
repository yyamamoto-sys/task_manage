import { describe, it, expect } from "vitest";
import { parseAIResponse } from "../responseParser";

function wrap(proposals: unknown[]): string {
  return JSON.stringify({ proposals, follow_up_suggestions: [] });
}

describe("parseAIResponse", () => {
  it("info 提案で date_certainty が null でもパースでき、unknown に補完される", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "始め方のコツ",
      description: "タスクは...",
      action_type: "info",
      target_task_ids: [],
      target_pj_ids: [],
      date_certainty: null,
    }]);
    const res = parseAIResponse(raw);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].date_certainty).toBe("unknown");
    expect(res.proposals[0].needs_confirmation).toBe(false);
    expect(res.proposals[0].is_simulation).toBe(false);
  });

  it("target配列・description・booleanが欠落していても落ちない", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "情報",
      action_type: "info",
    }]);
    const res = parseAIResponse(raw);
    expect(res.proposals[0].target_task_ids).toEqual([]);
    expect(res.proposals[0].target_pj_ids).toEqual([]);
    expect(res.proposals[0].description).toBe("");
  });

  it("add_task の new_subtasks（子タスク）をパースする（name必須・他は任意）", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "大分類：会場準備",
      description: "x",
      action_type: "add_task",
      target_pj_ids: ["pj_001"],
      new_subtasks: [
        { name: "会場下見", suggested_assignee: "山本", suggested_due_date: "2026-06-10" },
        { name: "備品手配" },
        { name: "" },            // 空 name は捨てられる
        { suggested_assignee: "x" }, // name 無しは捨てられる
      ],
    }]);
    const res = parseAIResponse(raw);
    expect(res.proposals[0].new_subtasks).toHaveLength(2);
    expect(res.proposals[0].new_subtasks![0]).toEqual({
      name: "会場下見",
      suggested_assignee: "山本",
      suggested_start_date: undefined,
      suggested_due_date: "2026-06-10",
      suggested_description: undefined,
    });
    expect(res.proposals[0].new_subtasks![1].name).toBe("備品手配");
  });

  it("DB変更系（date_change）は needs_confirmation 未指定なら安全側で true", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "期日変更",
      description: "x",
      action_type: "date_change",
      suggested_date: "2026-06-01",
    }]);
    const res = parseAIResponse(raw);
    expect(res.proposals[0].needs_confirmation).toBe(true);
  });

  it("明示された needs_confirmation は尊重される", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "期日変更",
      description: "x",
      action_type: "date_change",
      needs_confirmation: false,
    }]);
    expect(parseAIResponse(raw).proposals[0].needs_confirmation).toBe(false);
  });

  it("不正な action_type は従来どおりエラー", () => {
    const raw = wrap([{ proposal_id: "p", title: "t", action_type: "bogus" }]);
    expect(() => parseAIResponse(raw)).toThrow();
  });

  it("proposal_id / title 欠落はエラー", () => {
    expect(() => parseAIResponse(wrap([{ title: "t", action_type: "info" }]))).toThrow();
    expect(() => parseAIResponse(wrap([{ proposal_id: "p", action_type: "info" }]))).toThrow();
  });

  it("コードブロック（```json）付きでもパースできる", () => {
    const raw = "```json\n" + wrap([{ proposal_id: "p", title: "t", description: "d", action_type: "info" }]) + "\n```";
    expect(parseAIResponse(raw).proposals).toHaveLength(1);
  });

  it("JSONの前後に説明文があってもパースできる（フォールバック抽出）", () => {
    const json = wrap([{ proposal_id: "p", title: "t", description: "d", action_type: "info" }]);
    const raw = "承知しました。以下が提案です。\n```json\n" + json + "\n```\nご確認ください。";
    expect(parseAIResponse(raw).proposals).toHaveLength(1);
    // フェンスなし・前後に文章があるケースも
    const raw2 = "提案: " + json + " 以上です。";
    expect(parseAIResponse(raw2).proposals).toHaveLength(1);
  });

  it("JSONオブジェクトが全く無ければ従来どおりエラー", () => {
    expect(() => parseAIResponse("プロジェクトの作り方を教えます。まず…")).toThrow();
  });

  it("add_project は new_project_tasks をパースし、needs_confirmation 未指定なら true", () => {
    const raw = wrap([{
      proposal_id: "prop_001",
      title: "新サイト構築PJ",
      description: "コーポレートサイトのリニューアル",
      action_type: "add_project",
      new_project_tasks: [
        { name: "要件定義", suggested_assignee: "山本", suggested_start_date: "2026-06-01", suggested_due_date: "2026-06-10" },
        { name: "デザイン", suggested_due_date: "2026-06-20" },
      ],
    }]);
    const res = parseAIResponse(raw);
    expect(res.proposals[0].action_type).toBe("add_project");
    expect(res.proposals[0].needs_confirmation).toBe(true);
    expect(res.proposals[0].new_project_tasks).toHaveLength(2);
    expect(res.proposals[0].new_project_tasks?.[0].name).toBe("要件定義");
    expect(res.proposals[0].new_project_tasks?.[0].suggested_assignee).toBe("山本");
    expect(res.proposals[0].new_project_tasks?.[1].suggested_assignee).toBeUndefined();
  });

  it("add_project の new_project_tasks は name 欠落・非配列を寛容に処理する", () => {
    // 非配列は undefined（フィールド省略扱い）
    const raw1 = wrap([{ proposal_id: "p", title: "PJ", description: "d", action_type: "add_project", new_project_tasks: "x" }]);
    expect(parseAIResponse(raw1).proposals[0].new_project_tasks).toBeUndefined();
    // name のない要素は除外され、name のある要素のみ採用
    const raw2 = wrap([{
      proposal_id: "p", title: "PJ", description: "d", action_type: "add_project",
      new_project_tasks: [{ suggested_assignee: "山本" }, { name: "有効タスク" }],
    }]);
    const tasks = parseAIResponse(raw2).proposals[0].new_project_tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].name).toBe("有効タスク");
  });
});

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
});

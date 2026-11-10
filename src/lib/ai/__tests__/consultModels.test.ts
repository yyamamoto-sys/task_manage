import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONSULT_MODEL_OPTIONS, DEFAULT_CONSULT_MODEL, normalizeConsultModel, consultModelLabel } from "../consultModels";

describe("consultModels", () => {
  it("既定は Sonnet 5.5。Haiku 5.5 が選べる", () => {
    expect(DEFAULT_CONSULT_MODEL).toBe("claude-sonnet-5-5");
    expect(CONSULT_MODEL_OPTIONS.map(o => o.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("選択肢に無い値・未指定は既定に戻す", () => {
    expect(normalizeConsultModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(normalizeConsultModel("claude-unknown")).toBe(DEFAULT_CONSULT_MODEL);
    expect(normalizeConsultModel(null)).toBe(DEFAULT_CONSULT_MODEL);
    expect(normalizeConsultModel(undefined)).toBe(DEFAULT_CONSULT_MODEL);
  });

  it("表示名は利用者に意味が通じる語", () => {
    expect(consultModelLabel("claude-sonnet-5-5")).toBe("標準（Sonnet 5.5）");
    expect(consultModelLabel("claude-haiku-5-5")).toBe("高速（Haiku 5.5）");
  });

  it("選択肢のモデルIDはすべて Edge Function の ALLOWED_MODELS に含まれる（片方だけ足し忘れない）", () => {
    const edge = readFileSync("supabase/functions/ai-consult/index.ts", "utf-8");
    const line = edge.split("\n").find(l => l.startsWith("const ALLOWED_MODELS"));
    expect(line).toBeTruthy();
    for (const o of CONSULT_MODEL_OPTIONS) expect(line).toContain(`"${o.id}"`);
  });
});

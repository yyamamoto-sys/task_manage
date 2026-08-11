import { describe, it, expect } from "vitest";
import { buildPersonalOkrChatSystemPrompt } from "../personalOkrChatPrompt";

describe("buildPersonalOkrChatSystemPrompt", () => {
  it("達成度バンドの定義と「今どの水準か・上げるには何が必要か」の答え方を含む", () => {
    const prompt = buildPersonalOkrChatSystemPrompt("【対象KR】エース（AAS）");
    expect(prompt).toContain("今どの水準か");
    expect(prompt).toContain("上げるには");
    expect(prompt).toContain("60=この取り組みがなくても到達していた水準");
  });

  it("渡された文脈テキストをそのまま埋め込む", () => {
    const contextText = "【対象KR】テストKR\n【8月の計画】狙いのバンド：70%";
    const prompt = buildPersonalOkrChatSystemPrompt(contextText);
    expect(prompt).toContain(contextText);
  });

  it("渡されていない情報（過去月・部署ナレッジ等）を憶測で埋めない旨の指示を含む", () => {
    const prompt = buildPersonalOkrChatSystemPrompt("dummy");
    expect(prompt).toContain("憶測で埋めない");
  });
});

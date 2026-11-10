import { describe, it, expect } from "vitest";
import { normalizeReplyBreaks, parseReplyLines } from "../replyLayout";
import { stripAliasIds } from "../displayText";

const REAL =
  "📋 PJ全体の状況と直近の注意点\n" +
  "【PJ全体】完了11件 / 進行中5件 / 未着手22件。PJ責任者は岩井さんです。" +
  "【期限を過ぎている未完了タスク】・フィードバック用HTMLレポートをメールで高瀬さんへ送付 岩井・優先度高・期限11/05　" +
  "・明後日の戦術会議でフィードバック用HTMLを配布・評価依頼 高瀬・優先度高・期限11/07　" +
  "・レポート改善・判定基準の策定 岩井・期限11/13。" +
  "【OKRとの関係】このPJはTFに紐づいていません。";

describe("normalizeReplyBreaks", () => {
  it("【の直前と、区切りの・（直前が句点・】・空白）の直前で改行する", () => {
    const out = normalizeReplyBreaks(REAL).split("\n");
    expect(out).toEqual([
      "📋 PJ全体の状況と直近の注意点",
      "【PJ全体】完了11件 / 進行中5件 / 未着手22件。PJ責任者は岩井さんです。",
      "【期限を過ぎている未完了タスク】",
      "・フィードバック用HTMLレポートをメールで高瀬さんへ送付 岩井・優先度高・期限11/05",
      "・明後日の戦術会議でフィードバック用HTMLを配布・評価依頼 高瀬・優先度高・期限11/07",
      "・レポート改善・判定基準の策定 岩井・期限11/13。",
      "【OKRとの関係】このPJはTFに紐づいていません。",
    ]);
  });

  it("タスク名の途中の・は割らない", () => {
    expect(normalizeReplyBreaks("・配布・評価依頼（担当：高瀬）")).toBe("・配布・評価依頼（担当：高瀬）");
  });

  it("すでに改行・字下げされた文はそのまま", () => {
    const t = "【見出し】\n・A\n　　・B\n・C";
    expect(normalizeReplyBreaks(t)).toBe(t);
  });

  it("「【」直前が括弧内ならそのまま", () => {
    expect(normalizeReplyBreaks("「【重要】」")).toBe("「【重要】」");
  });
});

describe("parseReplyLines", () => {
  it("見出し・箇条書き・通常行・空行に分類する", () => {
    const lines = parseReplyLines("結論です。\n\n【見出し】本文\n・A\n　　・B");
    expect(lines).toEqual([
      { kind: "text", text: "結論です。" },
      { kind: "blank" },
      { kind: "heading", text: "【見出し】本文" },
      { kind: "bullet", text: "A", depth: 0 },
      { kind: "bullet", text: "B", depth: 2 },
    ]);
  });
});

describe("属性括弧と識別記号の両立", () => {
  it("名前(task_001)（担当：…）は ID だけ消え、属性括弧は残る", () => {
    expect(stripAliasIds("タスク名(task_001)（担当：岩井／期限：11/05／優先度：高）"))
      .toBe("タスク名（担当：岩井／期限：11/05／優先度：高）");
  });
  it("名前を引ける場合も属性括弧が残る", () => {
    const resolve = (a: string) => (a === "task_001" ? "タスク名" : undefined);
    expect(stripAliasIds("・タスク名(task_001)（担当：岩井／期限：11/05）", resolve))
      .toBe("・タスク名（担当：岩井／期限：11/05）");
  });
});

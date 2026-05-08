import { describe, it, expect, vi, beforeEach } from "vitest";

// invokeAI をモック化（実 API を呼ばずに任意のレスポンスを返す）
vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
  buildMessageContent: vi.fn((text: string) => text),
}));

import { invokeAI } from "../invokeAI";
import { extractFreeformSession } from "../krSessionExtractor";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

describe("extractFreeformSession — 正常系", () => {
  it("4 フィールドが揃った JSON を構造化データとして返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: "今週の戦略会議で来期方向を決定。",
      decisions: ["A方針で進める", "Bは保留"],
      kr_mentions: [
        { kr_title_hint: "売上拡大", note: "進捗遅延" },
        { kr_title_hint: "顧客満足度", note: "改善傾向" },
      ],
      follow_up_tasks: [
        { member_short_name: "山本", content: "市場調査", due_date: "2026-05-15" },
        { member_short_name: "未特定", content: "次回までに案を出す", due_date: null },
      ],
    }));

    const result = await extractFreeformSession({
      krTitle: "売上拡大",
      allKrTitles: ["売上拡大", "顧客満足度"],
      memberShortNames: ["山本"],
      transcript: "（議事メモ）",
    });

    expect(result.summary).toContain("戦略会議");
    expect(result.decisions).toEqual(["A方針で進める", "Bは保留"]);
    expect(result.kr_mentions).toHaveLength(2);
    expect(result.kr_mentions[0]).toEqual({ kr_title_hint: "売上拡大", note: "進捗遅延" });
    expect(result.follow_up_tasks).toHaveLength(2);
    expect(result.follow_up_tasks[0].due_date).toBe("2026-05-15");
    expect(result.follow_up_tasks[1].due_date).toBeNull();
    expect(result.follow_up_tasks[1].member_short_name).toBe("未特定");
  });

  it("マークダウン ```json ブロック付きでも JSON を抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{
        type: "text" as const,
        text: '```json\n{"summary":"短い議論","decisions":[],"kr_mentions":[],"follow_up_tasks":[]}\n```',
      }],
    });

    const result = await extractFreeformSession({
      krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x",
    });
    expect(result.summary).toBe("短い議論");
    expect(result.decisions).toEqual([]);
  });

  it("AIIntent タグ 'kr-session-extract' で invokeAI を呼び出す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: "x", decisions: [], kr_mentions: [], follow_up_tasks: [],
    }));

    await extractFreeformSession({
      krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x",
    });

    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    const callArgs = mockedInvokeAI.mock.calls[0];
    // 第4引数が AIIntent
    expect(callArgs[3]).toBe("kr-session-extract");
  });
});

describe("extractFreeformSession — 異常系", () => {
  it("壊れた JSON でエラーを投げる", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "{ invalid" }],
    });

    await expect(
      extractFreeformSession({ krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x" }),
    ).rejects.toThrow();
  });

  it("summary が string でなければ summary を含むエラー", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: 123, decisions: [], kr_mentions: [], follow_up_tasks: [],
    }));

    await expect(
      extractFreeformSession({ krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x" }),
    ).rejects.toThrow(/summary/);
  });

  it("decisions が配列でなければエラー", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: "x", decisions: "not-an-array", kr_mentions: [], follow_up_tasks: [],
    }));

    await expect(
      extractFreeformSession({ krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x" }),
    ).rejects.toThrow(/decisions/);
  });

  it("kr_mentions の要素に kr_title_hint がなければエラー", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: "x",
      decisions: [],
      kr_mentions: [{ note: "メモ" }], // kr_title_hint 欠落
      follow_up_tasks: [],
    }));

    await expect(
      extractFreeformSession({ krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x" }),
    ).rejects.toThrow(/kr_title_hint/);
  });

  it("follow_up_tasks の due_date が文字列でも null でもなければエラー", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      summary: "x",
      decisions: [],
      kr_mentions: [],
      follow_up_tasks: [{ member_short_name: "山本", content: "x", due_date: 12345 }],
    }));

    await expect(
      extractFreeformSession({ krTitle: "KR", allKrTitles: [], memberShortNames: [], transcript: "x" }),
    ).rejects.toThrow(/due_date/);
  });
});

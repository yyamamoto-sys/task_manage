import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
  buildMessageContent: vi.fn((text: string) => text),
}));

import { invokeAI } from "../invokeAI";
import { extractOkrImportData, validateOkrImportAnalysis } from "../okrImportExtractor";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

const VALID_PAYLOAD = {
  objective: {
    title: "架空OKR 2026年度サンプル",
    purpose: "サンプル目的",
    background: "サンプル背景",
    period: "2026年度",
  },
  key_results: [
    {
      title: "サンプルKR1",
      task_forces: [
        {
          tf_number: "1",
          name: "サンプルTF1",
          description: "検証プロセスの要約",
          background: "設定背景",
          leader_name_hint: "山田太郎",
          source_quote: "原文引用",
        },
      ],
    },
  ],
};

describe("extractOkrImportData — 正常系", () => {
  it("Objective/KR/TFの構造をパースして返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));

    const result = await extractOkrImportData({ transcript: "（サンプルテキスト）" });

    expect(result.objective.title).toBe("架空OKR 2026年度サンプル");
    expect(result.objective.period).toBe("2026年度");
    expect(result.key_results).toHaveLength(1);
    expect(result.key_results[0].title).toBe("サンプルKR1");
    expect(result.key_results[0].task_forces).toHaveLength(1);
    expect(result.key_results[0].task_forces[0].leader_name_hint).toBe("山田太郎");
  });

  it("マークダウン```json ブロック付きでもJSONを抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "```json\n" + JSON.stringify(VALID_PAYLOAD) + "\n```" }],
    });
    const result = await extractOkrImportData({ transcript: "x" });
    expect(result.objective.title).toBe("架空OKR 2026年度サンプル");
  });

  it("AIIntent 'okr-import' で invokeAI を呼び出す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    await extractOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    expect(mockedInvokeAI.mock.calls[0][3]).toBe("okr-import");
  });

  it("JSON本体の前後に説明文が混じっても本体だけを抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "以下が抽出結果です。\n" + JSON.stringify(VALID_PAYLOAD) + "\n以上です。" }],
    });
    const result = await extractOkrImportData({ transcript: "x" });
    expect(result.objective.title).toBe("架空OKR 2026年度サンプル");
  });

  it("1回目が不正JSONでも自己修正リトライで救済される", async () => {
    // 1回目：末尾が壊れた不正JSON → 2回目：正しいJSON
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: '{ "objective": { "title": "壊れた' }] })
      .mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await extractOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.objective.title).toBe("架空OKR 2026年度サンプル");
    // リトライも同じ okr-import intent で計測に乗る
    expect(mockedInvokeAI.mock.calls[1][3]).toBe("okr-import");
  });

  it("null許容フィールドが欠けていてもnullで補完される", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText({
      objective: { title: "タイトルのみ" },
      key_results: [{ title: "KR", task_forces: [{ name: "TF" }] }],
    }));
    const result = await extractOkrImportData({ transcript: "x" });
    expect(result.objective.purpose).toBeNull();
    expect(result.objective.period).toBeNull();
    expect(result.key_results[0].task_forces[0].tf_number).toBeNull();
    expect(result.key_results[0].task_forces[0].leader_name_hint).toBeNull();
  });
});

describe("validateOkrImportAnalysis — 異常系", () => {
  it("objectiveが無ければ例外", () => {
    expect(() => validateOkrImportAnalysis({ key_results: [] })).toThrow();
  });
  it("objective.titleが無ければ例外", () => {
    expect(() => validateOkrImportAnalysis({ objective: {}, key_results: [] })).toThrow();
  });
  it("key_resultsが配列でなければ例外", () => {
    expect(() => validateOkrImportAnalysis({ objective: { title: "x" } })).toThrow();
  });
  it("TFにnameが無ければ例外", () => {
    expect(() => validateOkrImportAnalysis({
      objective: { title: "x" },
      key_results: [{ title: "KR", task_forces: [{}] }],
    })).toThrow();
  });
});

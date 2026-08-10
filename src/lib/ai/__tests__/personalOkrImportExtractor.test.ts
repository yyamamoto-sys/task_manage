import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
  buildMessageContent: vi.fn((text: string) => text),
}));

import { invokeAI } from "../invokeAI";
import { extractPersonalOkrImportData, validatePersonalOkrImportAnalysis } from "../personalOkrImportExtractor";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

const QUARTERLY_PAYLOAD = {
  detected_doc_type: "quarterly",
  fiscal_year: 2026,
  quarter: "3Q",
  krs: [
    {
      source_label: "個人KR_1",
      kr_kind_hint: "グループKR1",
      group_kr_hint: "グループKR1｜AAS",
      label: "AAS",
      weight_pct: 35,
      category: "対象業務カテゴリの本文",
      activity: "実施内容の本文",
      strength_role: "得意領域",
      weakness_role: "苦手領域",
      criteria: "達成基準",
      supplement: "補足",
      months: [],
    },
  ],
};

const MONTHLY_PAYLOAD = {
  detected_doc_type: "monthly_review",
  fiscal_year: 2026,
  quarter: "3Q",
  krs: [
    {
      source_label: "個人KR_1",
      kr_kind_hint: "グループKR1",
      group_kr_hint: "グループKR1｜AAS",
      label: "AAS",
      weight_pct: 35,
      category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null,
      months: [
        {
          month_index: 1,
          positioning: "位置づけの本文",
          activities: "取り組む内容",
          target_and_evidence: "達成目標と証拠",
          risks: "リスク",
          band_target: null,
          weight_override_pct: 25,
          review_text: "振り返りの本文",
          self_eval_pct: 80,
          gm_eval_pct: 75,
          gm_comment: "高瀬コメントの本文",
        },
      ],
    },
  ],
};

describe("extractPersonalOkrImportData — 四半期OKR（quarterly）", () => {
  it("KRの内容を抽出しmonthsは空配列のまま返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "（サンプル）" });
    expect(result.detected_doc_type).toBe("quarterly");
    expect(result.fiscal_year).toBe(2026);
    expect(result.quarter).toBe("3Q");
    expect(result.krs).toHaveLength(1);
    expect(result.krs[0].label).toBe("AAS");
    expect(result.krs[0].kr_kind_hint).toBe("グループKR1");
    expect(result.krs[0].months).toEqual([]);
  });

  it("AIIntent 'okr-personal-import' で invokeAI を呼び出す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    await extractPersonalOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI.mock.calls[0][3]).toBe("okr-personal-import");
  });

  it("```json ブロック付き・前後の説明文混入でも本体だけを抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "以下が結果です。\n```json\n" + JSON.stringify(QUARTERLY_PAYLOAD) + "\n```\n以上です。" }],
    });
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(result.krs[0].label).toBe("AAS");
  });

  it("1回目が不正JSONでも自己修正リトライで救済される", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: '{ "krs": [ { "label": "壊れた' }] })
      .mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.krs[0].label).toBe("AAS");
  });
});

describe("extractPersonalOkrImportData — 月次振返り（monthly_review）", () => {
  it("計画・振り返りの各欄を月ごとに抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(MONTHLY_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(result.detected_doc_type).toBe("monthly_review");
    const month = result.krs[0].months[0];
    expect(month.month_index).toBe(1);
    expect(month.positioning).toBe("位置づけの本文");
    expect(month.weight_override_pct).toBe(25);
    expect(month.self_eval_pct).toBe(80);
    expect(month.gm_eval_pct).toBe(75);
    expect(month.gm_comment).toBe("高瀬コメントの本文");
    expect(month.band_target).toBeNull(); // ルーブリックのみで単一目標が無いケース
  });
});

describe("validatePersonalOkrImportAnalysis — 異常系・フォールバック", () => {
  it("krsが配列でなければ例外", () => {
    expect(() => validatePersonalOkrImportAnalysis({ detected_doc_type: "quarterly" })).toThrow();
  });

  it("labelが欠けていてもsource_labelで補完し、無ければ「（名称未設定）」になる", () => {
    const result = validatePersonalOkrImportAnalysis({
      detected_doc_type: "quarterly",
      krs: [{ source_label: "個人KR_2" }, {}],
    });
    expect(result.krs[0].label).toBe("個人KR_2");
    expect(result.krs[1].label).toBe("（名称未設定）");
  });

  it("null許容フィールドが欠けていてもnullで補完される", () => {
    const result = validatePersonalOkrImportAnalysis({ detected_doc_type: "quarterly", krs: [{ label: "x" }] });
    expect(result.krs[0].weight_pct).toBeNull();
    expect(result.krs[0].category).toBeNull();
    expect(result.krs[0].months).toEqual([]);
  });

  it("detected_doc_typeが想定外でも、review_text等を持つKRがあればmonthly_reviewへフォールバックする", () => {
    const result = validatePersonalOkrImportAnalysis({
      detected_doc_type: "unknown-value",
      krs: [{ label: "x", months: [{ review_text: "振り返りの本文" }] }],
    });
    expect(result.detected_doc_type).toBe("monthly_review");
  });

  it("detected_doc_typeが想定外で振り返り内容も無ければquarterlyへフォールバックする", () => {
    const result = validatePersonalOkrImportAnalysis({ detected_doc_type: "unknown-value", krs: [{ label: "x" }] });
    expect(result.detected_doc_type).toBe("quarterly");
  });

  it("fiscal_year/quarterが不正な型・値ならnullになる", () => {
    const result = validatePersonalOkrImportAnalysis({
      detected_doc_type: "quarterly", fiscal_year: "2026", quarter: "5Q", krs: [],
    });
    expect(result.fiscal_year).toBeNull();
    expect(result.quarter).toBeNull();
  });
});

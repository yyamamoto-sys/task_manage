import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
  buildMessageContent: vi.fn((text: string) => text),
}));

import { invokeAI } from "../invokeAI";
import {
  extractPersonalOkrQuarterlyData,
  extractPersonalOkrMonthlyData,
  extractPersonalOkrImportData,
  validatePersonalOkrImportAnalysis,
  validatePersonalOkrImportMonthlyAnalysis,
  mergePersonalOkrImportResults,
  type PersonalOkrImportAnalysis,
  type PersonalOkrImportMonthlyAnalysis,
} from "../personalOkrImportExtractor";

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
    },
  ],
};

const MONTHLY_REVIEW_QUARTERLY_PART = {
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
    },
  ],
};

const MONTHLY_PART_PAYLOAD = {
  krs: [
    {
      source_label: "個人KR_1",
      label: "AAS",
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

// ===== extractPersonalOkrQuarterlyData（呼び出し1・単独） =====

describe("extractPersonalOkrQuarterlyData", () => {
  it("KRの基本情報を抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const result = await extractPersonalOkrQuarterlyData({ transcript: "（サンプル）" });
    expect(result.detected_doc_type).toBe("quarterly");
    expect(result.fiscal_year).toBe(2026);
    expect(result.quarter).toBe("3Q");
    expect(result.krs).toHaveLength(1);
    expect(result.krs[0].label).toBe("AAS");
    expect(result.krs[0].kr_kind_hint).toBe("グループKR1");
    expect(result.krs[0].months).toEqual([]); // 呼び出し1はmonthsを抽出しない
  });

  it("AIIntent 'okr-personal-import' で、既定モデル(claude-sonnet-4-6)を指定してinvokeAIを呼び出す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    await extractPersonalOkrQuarterlyData({ transcript: "x" });
    expect(mockedInvokeAI.mock.calls[0][3]).toBe("okr-personal-import");
    expect(mockedInvokeAI.mock.calls[0][4]).toBe("claude-sonnet-4-6");
  });

  it("max_tokensは8192で送る", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    await extractPersonalOkrQuarterlyData({ transcript: "x" });
    expect(mockedInvokeAI.mock.calls[0][2]).toBe(8192);
  });

  it("```json ブロック付き・前後の説明文混入でも本体だけを抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "以下が結果です。\n```json\n" + JSON.stringify(QUARTERLY_PAYLOAD) + "\n```\n以上です。" }],
    });
    const result = await extractPersonalOkrQuarterlyData({ transcript: "x" });
    expect(result.krs[0].label).toBe("AAS");
  });

  it("1回目が不正JSONでも自己修正リトライで救済される", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: '{ "krs": [ { "label": "壊れた' }] })
      .mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const result = await extractPersonalOkrQuarterlyData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.krs[0].label).toBe("AAS");
  });

  it("stop_reason=max_tokensならJSONパースを試みずに分かりやすいエラーを投げる（リトライしない）", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: '{ "krs": [ { "label": "途中で切れ' }],
      stop_reason: "max_tokens",
    });
    await expect(extractPersonalOkrQuarterlyData({ transcript: "x" })).rejects.toThrow(
      "個人KRの抽出結果が長すぎて途中で切れました。KRの件数を絞って取り込んでください。",
    );
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
  });

  it("stop_reason=max_tokensでもパースに成功する場合は誤検知しない", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(QUARTERLY_PAYLOAD), stop_reason: "end_turn" });
    const result = await extractPersonalOkrQuarterlyData({ transcript: "x" });
    expect(result.krs[0].label).toBe("AAS");
  });
});

// ===== extractPersonalOkrMonthlyData（呼び出し2・単独） =====

describe("extractPersonalOkrMonthlyData", () => {
  it("KRごとの月次計画・振り返りを抽出する", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    const result = await extractPersonalOkrMonthlyData({ transcript: "x" });
    expect(result.krs).toHaveLength(1);
    expect(result.krs[0].source_label).toBe("個人KR_1");
    const month = result.krs[0].months[0];
    expect(month.month_index).toBe(1);
    expect(month.positioning).toBe("位置づけの本文");
    expect(month.weight_override_pct).toBe(25);
    expect(month.self_eval_pct).toBe(80);
    expect(month.gm_eval_pct).toBe(75);
    expect(month.gm_comment).toBe("高瀬コメントの本文");
    expect(month.band_target).toBeNull();
  });

  it("max_tokensは8192・AIIntentは'okr-personal-import'で送る", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    await extractPersonalOkrMonthlyData({ transcript: "x" });
    expect(mockedInvokeAI.mock.calls[0][2]).toBe(8192);
    expect(mockedInvokeAI.mock.calls[0][3]).toBe("okr-personal-import");
  });

  it("stop_reason=max_tokensならエラーにする", async () => {
    mockedInvokeAI.mockResolvedValueOnce({
      content: [{ type: "text" as const, text: '{ "krs": [ { "source_label": "途中で切れ' }],
      stop_reason: "max_tokens",
    });
    await expect(extractPersonalOkrMonthlyData({ transcript: "x" })).rejects.toThrow(
      "月次計画・振り返りの抽出結果が長すぎて途中で切れました。KRの件数を絞って取り込んでください。",
    );
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
  });

  it("1回目が不正JSONでも自己修正リトライで救済される", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: '{ "krs": [ { "source_label": "壊れた' }] })
      .mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    const result = await extractPersonalOkrMonthlyData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.krs[0].source_label).toBe("個人KR_1");
  });
});

// ===== extractPersonalOkrImportData（オーケストレーター：分割呼び出し＋マージ） =====

describe("extractPersonalOkrImportData — 四半期OKR資料（月次呼び出しをスキップする）", () => {
  it("呼び出し1がquarterlyと判定したら呼び出し2は実行しない（invokeAIは1回だけ）", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    expect(result.detected_doc_type).toBe("quarterly");
    expect(result.krs[0].months).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("progressは{1,1}の完了報告のみ（総数2回を約束しない）", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(QUARTERLY_PAYLOAD));
    const progressCalls: { current: number; total: number; label: string }[] = [];
    await extractPersonalOkrImportData({ transcript: "x" }, p => progressCalls.push(p));
    expect(progressCalls[0]).toEqual({ current: 0, total: 2, label: "1/2 個人KRを抽出中" });
    expect(progressCalls[progressCalls.length - 1]).toEqual({ current: 1, total: 1, label: "抽出結果をまとめています" });
  });
});

describe("extractPersonalOkrImportData — 月次振返り資料（両方の呼び出しを実行してマージする）", () => {
  it("呼び出し1がmonthly_reviewと判定したら呼び出し2も実行し、結果をマージする", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce(aiText(MONTHLY_REVIEW_QUARTERLY_PART))
      .mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.detected_doc_type).toBe("monthly_review");
    expect(result.krs).toHaveLength(1);
    expect(result.krs[0].label).toBe("AAS"); // 呼び出し1の情報
    expect(result.krs[0].weight_pct).toBe(35); // 呼び出し1の情報
    expect(result.krs[0].months[0].review_text).toBe("振り返りの本文"); // 呼び出し2の情報
    expect(result.warnings).toEqual([]);
  });

  it("進捗コールバックが 1/2 → 2/2 → 完了 の順で呼ばれる", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce(aiText(MONTHLY_REVIEW_QUARTERLY_PART))
      .mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    const progressCalls: { current: number; total: number; label: string }[] = [];
    await extractPersonalOkrImportData({ transcript: "x" }, p => progressCalls.push(p));
    expect(progressCalls).toEqual([
      { current: 0, total: 2, label: "1/2 個人KRを抽出中" },
      { current: 1, total: 2, label: "2/2 月次計画を抽出中" },
      { current: 2, total: 2, label: "抽出結果をまとめています" },
    ]);
  });
});

describe("extractPersonalOkrImportData — 片方の呼び出しが失敗しても、成功した方を見せる", () => {
  it("呼び出し2（monthly）が失敗しても、呼び出し1（quarterly）の結果はwarnings付きで返る", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce(aiText(MONTHLY_REVIEW_QUARTERLY_PART))
      .mockRejectedValueOnce(new Error("ネットワークエラー"));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(result.krs[0].label).toBe("AAS");
    expect(result.krs[0].months).toEqual([]); // 月次は取れなかった
    expect(result.warnings).toEqual(["月次計画・振り返りの抽出に失敗しました：ネットワークエラー"]);
  });

  it("呼び出し1（quarterly）が失敗しても呼び出し2は保険的に実行され、monthly由来のKRがwarnings付きで返る", async () => {
    mockedInvokeAI
      .mockRejectedValueOnce(new Error("解析エラー"))
      .mockResolvedValueOnce(aiText(MONTHLY_PART_PAYLOAD));
    const result = await extractPersonalOkrImportData({ transcript: "x" });
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.detected_doc_type).toBe("monthly_review");
    expect(result.krs[0].source_label).toBe("個人KR_1");
    expect(result.krs[0].months[0].review_text).toBe("振り返りの本文");
    expect(result.warnings).toEqual(["個人KRの抽出に失敗しました：解析エラー"]);
  });

  it("両方失敗したら例外を投げる", async () => {
    mockedInvokeAI
      .mockRejectedValueOnce(new Error("エラー1"))
      .mockRejectedValueOnce(new Error("エラー2"));
    await expect(extractPersonalOkrImportData({ transcript: "x" })).rejects.toThrow("エラー1");
  });
});

// ===== mergePersonalOkrImportResults（純粋関数） =====

describe("mergePersonalOkrImportResults", () => {
  it("両方nullなら空のquarterly扱いを返す", () => {
    const result = mergePersonalOkrImportResults(null, null);
    expect(result).toEqual({ detected_doc_type: "quarterly", fiscal_year: null, quarter: null, krs: [] });
  });

  it("monthlyがnullならquarterlyをそのまま返す", () => {
    const quarterly: PersonalOkrImportAnalysis = {
      detected_doc_type: "quarterly", fiscal_year: 2026, quarter: "3Q",
      krs: [{
        source_label: "個人KR_1", kr_kind_hint: "グループKR1", group_kr_hint: null, label: "AAS",
        weight_pct: 35, category: null, activity: null, strength_role: null, weakness_role: null,
        criteria: null, supplement: null, months: [],
      }],
    };
    expect(mergePersonalOkrImportResults(quarterly, null)).toBe(quarterly);
  });

  it("quarterlyがnullならmonthlyのKRをnull埋めで返す", () => {
    const monthly: PersonalOkrImportMonthlyAnalysis = {
      krs: [{ source_label: "個人KR_1", label: "AAS", months: [{
        month_index: 1, positioning: null, activities: null, target_and_evidence: null, risks: null,
        band_target: null, weight_override_pct: null, review_text: "振り返り", self_eval_pct: 80,
        gm_eval_pct: null, gm_comment: null,
      }] }],
    };
    const result = mergePersonalOkrImportResults(null, monthly);
    expect(result.detected_doc_type).toBe("monthly_review");
    expect(result.krs[0].label).toBe("AAS");
    expect(result.krs[0].kr_kind_hint).toBeNull();
    expect(result.krs[0].weight_pct).toBeNull();
    expect(result.krs[0].months[0].review_text).toBe("振り返り");
  });

  it("両方成功：source_labelで対応するmonthsをマージする", () => {
    const quarterly: PersonalOkrImportAnalysis = {
      detected_doc_type: "monthly_review", fiscal_year: 2026, quarter: "3Q",
      krs: [
        { source_label: "個人KR_1", kr_kind_hint: null, group_kr_hint: null, label: "AAS", weight_pct: 35, category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null, months: [] },
        { source_label: "個人KR_2", kr_kind_hint: null, group_kr_hint: null, label: "統合営業", weight_pct: 20, category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null, months: [] },
      ],
    };
    const monthly: PersonalOkrImportMonthlyAnalysis = {
      krs: [
        { source_label: "個人KR_2", label: "統合営業", months: [{ month_index: 1, positioning: null, activities: null, target_and_evidence: null, risks: null, band_target: null, weight_override_pct: null, review_text: "KR2の振り返り", self_eval_pct: null, gm_eval_pct: null, gm_comment: null }] },
        { source_label: "個人KR_1", label: "AAS", months: [{ month_index: 1, positioning: null, activities: null, target_and_evidence: null, risks: null, band_target: null, weight_override_pct: null, review_text: "KR1の振り返り", self_eval_pct: null, gm_eval_pct: null, gm_comment: null }] },
      ],
    };
    const result = mergePersonalOkrImportResults(quarterly, monthly);
    expect(result.krs).toHaveLength(2);
    expect(result.krs[0].source_label).toBe("個人KR_1");
    expect(result.krs[0].months[0].review_text).toBe("KR1の振り返り");
    expect(result.krs[1].source_label).toBe("個人KR_2");
    expect(result.krs[1].months[0].review_text).toBe("KR2の振り返り");
  });

  it("source_label/labelが一致しない場合は位置（同じindex）でフォールバックする", () => {
    const quarterly: PersonalOkrImportAnalysis = {
      detected_doc_type: "monthly_review", fiscal_year: null, quarter: null,
      krs: [{ source_label: "個人KR_1", kr_kind_hint: null, group_kr_hint: null, label: "AAS", weight_pct: null, category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null, months: [] }],
    };
    const monthly: PersonalOkrImportMonthlyAnalysis = {
      krs: [{ source_label: null, label: null, months: [{ month_index: 1, positioning: null, activities: null, target_and_evidence: null, risks: null, band_target: null, weight_override_pct: null, review_text: "ラベル無しの振り返り", self_eval_pct: null, gm_eval_pct: null, gm_comment: null }] }],
    };
    const result = mergePersonalOkrImportResults(quarterly, monthly);
    expect(result.krs[0].months[0].review_text).toBe("ラベル無しの振り返り");
  });

  it("quarterly側に対応が無いmonthlyグループはデータを失わないよう末尾に追加する", () => {
    const quarterly: PersonalOkrImportAnalysis = {
      detected_doc_type: "monthly_review", fiscal_year: null, quarter: null,
      krs: [{ source_label: "個人KR_1", kr_kind_hint: null, group_kr_hint: null, label: "AAS", weight_pct: null, category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null, months: [] }],
    };
    const monthly: PersonalOkrImportMonthlyAnalysis = {
      krs: [
        { source_label: "個人KR_1", label: "AAS", months: [] },
        { source_label: "個人KR_9", label: "余剰KR", months: [{ month_index: 1, positioning: null, activities: null, target_and_evidence: null, risks: null, band_target: null, weight_override_pct: null, review_text: "余剰の振り返り", self_eval_pct: null, gm_eval_pct: null, gm_comment: null }] },
      ],
    };
    const result = mergePersonalOkrImportResults(quarterly, monthly);
    expect(result.krs).toHaveLength(2);
    expect(result.krs[1].label).toBe("余剰KR");
    expect(result.krs[1].months[0].review_text).toBe("余剰の振り返り");
  });
});

// ===== validatePersonalOkrImportAnalysis — 異常系・フォールバック =====

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

// ===== validatePersonalOkrImportMonthlyAnalysis =====

describe("validatePersonalOkrImportMonthlyAnalysis", () => {
  it("krsが配列でなければ例外", () => {
    expect(() => validatePersonalOkrImportMonthlyAnalysis({})).toThrow();
  });

  it("source_label/labelが欠けていてもnullで補完される", () => {
    const result = validatePersonalOkrImportMonthlyAnalysis({ krs: [{ months: [] }] });
    expect(result.krs[0].source_label).toBeNull();
    expect(result.krs[0].label).toBeNull();
    expect(result.krs[0].months).toEqual([]);
  });

  it("monthsの各項目がPersonalOkrImportMonthの形にバリデーションされる", () => {
    const result = validatePersonalOkrImportMonthlyAnalysis({
      krs: [{ source_label: "個人KR_1", label: "AAS", months: [{ month_index: 2, review_text: "本文" }] }],
    });
    expect(result.krs[0].months[0].month_index).toBe(2);
    expect(result.krs[0].months[0].review_text).toBe("本文");
    expect(result.krs[0].months[0].gm_comment).toBeNull();
  });
});

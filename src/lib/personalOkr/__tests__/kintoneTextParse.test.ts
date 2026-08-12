// src/lib/personalOkr/__tests__/kintoneTextParse.test.ts
//
// 【注記】山本さんは実際のKintone帳票のテキストを持っていない。ここで使うフィクスチャは
// personalOkrImportExtractor.ts の SYSTEM_PROMPT に書かれたラベル規則から組み立てた合成
// テキストであり、実データでの検証はできていない（ファイル冒頭コメント参照）。

import { describe, it, expect } from "vitest";
import {
  detectKintoneDocType,
  extractFiscalYearAndQuarter,
  parseKintoneQuarterlyText,
  parseKintoneMonthlyText,
  describeKintoneImportSource,
} from "../kintoneTextParse";

// ===== 合成フィクスチャ：四半期OKR設定フォーム（2KR・全欄が埋まっている想定） =====
const QUARTERLY_FIXTURE = `個人OKR設定フォーム
年度
2026
対象Q
3Q
KR種別_1
グループKR1
個人KR_1（グループKR1｜AAS）
個人KR_1_ウェイト
35%
●対象業務カテゴリ
対象業務カテゴリの本文（KR1）
●実施内容
実施内容の本文（KR1）
●得意領域の強化：（役割）
得意領域の本文（KR1）
●苦手領域の克服：（役割）
苦手領域の本文（KR1）
●達成基準
達成基準の本文（KR1）
●補足
補足の本文（KR1）
KR種別_2
全般
個人KR_2（統合営業）
個人KR_2_ウェイト
20%
●対象業務カテゴリ
対象業務カテゴリの本文（KR2）
●実施内容
実施内容の本文（KR2）
●得意領域の強化：（役割）
得意領域の本文（KR2）
●苦手領域の克服：（役割）
苦手領域の本文（KR2）
●達成基準
達成基準の本文（KR2）
●補足
補足の本文（KR2）
`;

// ===== 合成フィクスチャ：月次振返り記録（1KR・3か月分。暦月8/9/10を埋め込む） =====
function monthlyBlock(calendarMonth: number, reviewerName: string): string {
  return `▼${calendarMonth}月に取り組む内容（計画）
${calendarMonth}月に取り組む内容の本文
▼${calendarMonth}月末の達成目標と、その証拠（計画値）
${calendarMonth}月末の達成目標の本文
▼リスクと依存関係
リスクの本文（${calendarMonth}月）
▼${calendarMonth}月末 達成度バンド（計画）
70%
振り返り
振り返りの本文（${calendarMonth}月）
[自己評価：80%（本KR%）*係数=100%]
✔60 ✔70 ✖80
【${reviewerName}コメント】
${reviewerName}コメントの本文（${calendarMonth}月）
`;
}

const MONTHLY_FIXTURE = `個人OKR_月次振返り記録
対象Q
3Q
個人KR_1（グループKR1｜AAS）
分類
計画
【位置づけ】
位置づけの本文
${monthlyBlock(8, "高瀬")}
${monthlyBlock(9, "高瀬")}
${monthlyBlock(10, "高瀬")}
`;

const LABELS_MISSING_FIXTURE = `個人OKR設定フォーム
個人KR_1（グループKR1｜AAS）
（このKRの詳細は口頭で説明します。テキストには落とし込んでいません）
`;

const UNEXPECTED_ORDER_FIXTURE = `個人OKR設定フォーム
個人KR_2（統合営業）
●対象業務カテゴリ
カテゴリ2
●実施内容
実施2
●得意領域の強化：（役割）
強み2
●苦手領域の克服：（役割）
弱み2
●達成基準
基準2
●補足
補足2
個人KR_1（グループKR1｜AAS）
●対象業務カテゴリ
カテゴリ1
●実施内容
実施1
●得意領域の強化：（役割）
強み1
●苦手領域の克服：（役割）
弱み1
●達成基準
基準1
●補足
補足1
`;

describe("detectKintoneDocType", () => {
  it("タイトルが「個人OKR設定フォーム」ならquarterly", () => {
    expect(detectKintoneDocType(QUARTERLY_FIXTURE)).toBe("quarterly");
  });
  it("タイトルが「個人OKR_月次振返り記録」ならmonthly_review", () => {
    expect(detectKintoneDocType(MONTHLY_FIXTURE)).toBe("monthly_review");
  });
  it("タイトルが無く月マーカー＋自己評価が有ればmonthly_review", () => {
    expect(detectKintoneDocType("1か月目の自己評価はこちら")).toBe("monthly_review");
  });
  it("何の手がかりも無ければnull", () => {
    expect(detectKintoneDocType("無関係なテキストです")).toBeNull();
  });
});

describe("extractFiscalYearAndQuarter", () => {
  it("「年度」「対象Q」欄から取り出す", () => {
    const result = extractFiscalYearAndQuarter(QUARTERLY_FIXTURE);
    expect(result.fiscalYear).toBe(2026);
    expect(result.quarter).toBe("3Q");
  });
  it("見つからなければnull", () => {
    const result = extractFiscalYearAndQuarter("個人KR_1（AAS）\n●達成基準\n基準");
    expect(result.fiscalYear).toBeNull();
    expect(result.quarter).toBeNull();
  });
});

describe("parseKintoneQuarterlyText", () => {
  it("全欄が埋まっている資料はconfidence.ok=trueで2KRを抽出する", () => {
    const { analysis, confidence } = parseKintoneQuarterlyText(QUARTERLY_FIXTURE);
    expect(confidence.ok).toBe(true);
    expect(confidence.krCount).toBe(2);
    expect(analysis.detected_doc_type).toBe("quarterly");
    expect(analysis.fiscal_year).toBe(2026);
    expect(analysis.quarter).toBe("3Q");
    expect(analysis.krs).toHaveLength(2);

    const kr1 = analysis.krs[0];
    expect(kr1.source_label).toBe("個人KR_1");
    expect(kr1.kr_kind_hint).toBe("グループKR1");
    expect(kr1.group_kr_hint).toBe("グループKR1｜AAS");
    expect(kr1.label).toBe("AAS");
    expect(kr1.weight_pct).toBe(35);
    expect(kr1.category).toBe("対象業務カテゴリの本文（KR1）");
    expect(kr1.activity).toBe("実施内容の本文（KR1）");
    expect(kr1.strength_role).toBe("得意領域の本文（KR1）");
    expect(kr1.weakness_role).toBe("苦手領域の本文（KR1）");
    expect(kr1.criteria).toBe("達成基準の本文（KR1）");
    expect(kr1.supplement).toBe("補足の本文（KR1）");
    expect(kr1.months).toEqual([]);

    const kr2 = analysis.krs[1];
    expect(kr2.source_label).toBe("個人KR_2");
    expect(kr2.kr_kind_hint).toBe("全般");
    expect(kr2.label).toBe("統合営業");
    expect(kr2.weight_pct).toBe(20);
  });

  it("「個人KR_N」の見出しが1件も無ければconfidence.ok=falseで理由を返す", () => {
    const { confidence } = parseKintoneQuarterlyText("Kintoneとは無関係なテキストです。");
    expect(confidence.ok).toBe(false);
    expect(confidence.krCount).toBe(0);
    expect(confidence.reasons.length).toBeGreaterThan(0);
  });

  it("見出しはあるが本文欄がほとんど埋まっていない資料はconfidence.ok=false", () => {
    const { confidence } = parseKintoneQuarterlyText(LABELS_MISSING_FIXTURE);
    expect(confidence.ok).toBe(false);
    expect(confidence.reasons.some(r => r.includes("充足率"))).toBe(true);
  });

  it("KR見出しの出現順が1,2ではなく2,1の場合はconfidence.ok=false（順序が期待どおりであることを要求する）", () => {
    const { confidence } = parseKintoneQuarterlyText(UNEXPECTED_ORDER_FIXTURE);
    expect(confidence.ok).toBe(false);
    expect(confidence.reasons.some(r => r.includes("出現順"))).toBe(true);
  });
});

describe("parseKintoneMonthlyText", () => {
  it("3か月分の計画・振り返りをconfidence.ok=trueで抽出する", () => {
    const { analysis, confidence } = parseKintoneMonthlyText(MONTHLY_FIXTURE);
    expect(confidence.ok).toBe(true);
    expect(analysis.krs).toHaveLength(1);
    const months = analysis.krs[0].months;
    expect(months).toHaveLength(3);
    expect(months.map(m => m.month_index)).toEqual([1, 2, 3]);

    const month1 = months[0];
    expect(month1.activities).toBe("8月に取り組む内容の本文");
    expect(month1.target_and_evidence).toBe("8月末の達成目標の本文");
    expect(month1.risks).toContain("リスクの本文（8月）");
    expect(month1.review_text).toBe("振り返りの本文（8月）");
    expect(month1.self_eval_pct).toBe(80);
    expect(month1.gm_comment).toBe("高瀬コメントの本文（8月）");
    // 単一値が明記されていない場合はband_targetをnullにする方針だが、このフィクスチャは
    // "70%"の単一値のみを含むため数値が入ることを確認する
    expect(month1.band_target).toBe(70);

    const month3 = months[2];
    expect(month3.activities).toBe("10月に取り組む内容の本文");
  });

  it("見出しが無ければconfidence.ok=false", () => {
    const { confidence } = parseKintoneMonthlyText("Kintoneとは無関係なテキストです。");
    expect(confidence.ok).toBe(false);
  });

  it("月次フィールドが1件も見つからない資料（KR見出しのみ）はconfidence.ok=false", () => {
    const { confidence } = parseKintoneMonthlyText("個人OKR_月次振返り記録\n個人KR_1（AAS）\n（詳細は別紙）\n");
    expect(confidence.ok).toBe(false);
    expect(confidence.reasons.some(r => r.includes("月次フィールド"))).toBe(true);
  });

  it("達成度バンドが複数基準のルーブリック（60/70/80が並ぶ）ならband_targetはnullのまま", () => {
    const rubricText = `個人OKR_月次振返り記録
個人KR_1（AAS）
▼8月に取り組む内容（計画）
取り組む内容
▼8月末の達成目標と、その証拠（計画値）
達成目標
▼リスクと依存関係
リスク
▼8月末 達成度バンド（計画）
60%基準：普通 70%基準：良い 80%基準：優秀（90/100は設定しない）
分類
振り返り
振り返り
振り返りの本文
[自己評価：75%（本KR%）]
`;
    const { analysis } = parseKintoneMonthlyText(rubricText);
    expect(analysis.krs[0].months[0].band_target).toBeNull();
  });
});

describe("describeKintoneImportSource", () => {
  it("両方AI", () => expect(describeKintoneImportSource("ai", "ai")).toBe("🤖 AIで読み取りました"));
  it("両方決定的（月次無しを含む）", () => {
    expect(describeKintoneImportSource("deterministic", "none")).toBe("⚙ 画面の構造から読み取りました（AI未使用）");
    expect(describeKintoneImportSource("deterministic", "deterministic")).toBe("⚙ 画面の構造から読み取りました（AI未使用）");
  });
  it("四半期は決定的・月次はAI", () => {
    expect(describeKintoneImportSource("deterministic", "ai")).toBe(
      "⚙🤖 個人KRの基本情報は画面の構造から、月次計画・振り返りはAIで読み取りました",
    );
  });
  it("四半期はAI・月次は決定的", () => {
    expect(describeKintoneImportSource("ai", "deterministic")).toBe(
      "🤖⚙ 個人KRの基本情報はAIで、月次計画・振り返りは画面の構造から読み取りました",
    );
  });
});

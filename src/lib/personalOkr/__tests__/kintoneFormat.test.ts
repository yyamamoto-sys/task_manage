// src/lib/personalOkr/__tests__/kintoneFormat.test.ts
//
// 【設計意図】
// 「全文をコピー」機能（v3.103）のテキスト組み立て（buildKintonePlanCopyText/
// buildKintoneReviewCopyText）を検証する。🔴 最重要は「ラウンドトリップの担保」：
// コピー生成側が出したテキストを、取込側の決定的パーサ（kintoneTextParse.ts）が
// 同じ見出し定数を通じて正しく読み戻せることを、実際にparseKintoneMonthlyText()を
// 呼び出して検証する（片方だけ見出しが変わったら赤くなる）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildKintonePlanCopyText, buildKintoneReviewCopyText, selfEvalTag,
  headingActivities, headingTargetAndEvidence, headingBandTarget,
  HEADING_POSITIONING, HEADING_RISKS,
} from "../kintoneFormat";
import { parseKintoneMonthlyText } from "../kintoneTextParse";

describe("buildKintonePlanCopyText", () => {
  it("全項目が埋まっているとき、見出し・空行・trimを含む期待どおりの文字列になる", () => {
    const text = buildKintonePlanCopyText({
      positioning: "位置づけの本文",
      activities: "8月に取り組む内容の本文",
      targetAndEvidence: "8月末の達成目標の本文",
      risks: "リスクの本文",
      bandTarget: 70,
      monthNumber: 8,
    });
    expect(text).toBe(
      "【位置づけ】\n位置づけの本文\n\n" +
      "▼8月に取り組む内容（計画）\n8月に取り組む内容の本文\n\n" +
      "▼8月末の達成目標と、その証拠（計画値）\n8月末の達成目標の本文\n\n" +
      "▼リスクと依存関係\nリスクの本文\n\n" +
      "▼8月末 達成度バンド（計画）\n70%",
    );
  });

  it("月番号はmonth_indexではなく実際の月番号を使う（8月ならmonth_index=1でも見出しは8月）", () => {
    const text = buildKintonePlanCopyText({ activities: "内容", monthNumber: 8 });
    expect(text).toContain("▼8月に取り組む内容（計画）");
    expect(text).not.toContain("▼1月");
  });

  it("記入が無い項目は見出しごと省略する", () => {
    const text = buildKintonePlanCopyText({
      positioning: "位置づけのみ記入",
      activities: null,
      targetAndEvidence: undefined,
      risks: "",
      bandTarget: null,
      monthNumber: 8,
    });
    expect(text).toBe("【位置づけ】\n位置づけのみ記入");
    expect(text).not.toContain("取り組む内容");
    expect(text).not.toContain("達成目標");
    expect(text).not.toContain("リスク");
    expect(text).not.toContain("達成度バンド");
  });

  it("band_targetが未設定ならバンドのセクション自体が出ない", () => {
    const text = buildKintonePlanCopyText({ activities: "内容", bandTarget: null, monthNumber: 8 });
    expect(text).not.toContain("達成度バンド");
    expect(text).not.toContain("%");
  });

  it("全項目が空なら空文字列を返す", () => {
    expect(buildKintonePlanCopyText({ monthNumber: 8 })).toBe("");
    expect(buildKintonePlanCopyText({
      positioning: "", activities: "  ", targetAndEvidence: null, risks: undefined, bandTarget: null, monthNumber: 8,
    })).toBe("");
  });

  it("各本文の前後の空白はtrimされる", () => {
    const text = buildKintonePlanCopyText({ positioning: "  前後に空白  ", monthNumber: 8 });
    expect(text).toBe("【位置づけ】\n前後に空白");
  });

  it("末尾に余分な空行を残さない", () => {
    const text = buildKintonePlanCopyText({
      positioning: "位置づけ", activities: "内容", targetAndEvidence: "目標", risks: "リスク", bandTarget: 80, monthNumber: 8,
    });
    expect(text.endsWith("\n")).toBe(false);
    expect(text.endsWith("80%")).toBe(true);
  });
});

describe("buildKintoneReviewCopyText", () => {
  it("本文・自己評価%の両方があるとき", () => {
    const text = buildKintoneReviewCopyText({ reviewText: "振り返りの本文", selfEvalPct: 72 });
    expect(text).toBe("振り返りの本文\n\n[自己評価：72%]");
  });

  it("自己評価%が無いとき（本文のみ）", () => {
    const text = buildKintoneReviewCopyText({ reviewText: "振り返りの本文", selfEvalPct: null });
    expect(text).toBe("振り返りの本文");
  });

  it("本文が空で自己評価だけあるときも破綻しない", () => {
    const text = buildKintoneReviewCopyText({ reviewText: "", selfEvalPct: 90 });
    expect(text).toBe("[自己評価：90%]");
  });

  it("両方空なら空文字列", () => {
    expect(buildKintoneReviewCopyText({})).toBe("");
    expect(buildKintoneReviewCopyText({ reviewText: "  ", selfEvalPct: null })).toBe("");
  });

  it("小数の自己評価%も組み立てられる", () => {
    const text = buildKintoneReviewCopyText({ reviewText: "本文", selfEvalPct: 82.5 });
    expect(text).toBe("本文\n\n[自己評価：82.5%]");
  });
});

describe("selfEvalTag：取込パーサ（SELF_EVAL_RE）の仕様と矛盾しないこと", () => {
  it("[自己評価：72%] の形は「[自己評価：XX%（本KR%）…]の最初のXX%を取る」という取込仕様と矛盾しない", () => {
    // SELF_EVAL_RE = /\[自己評価[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/g（kintoneTextParse.ts）。
    // 末尾の「（本KR%）」等の注記は無くても正しくマッチする（注記は「あってもよい」だけで必須ではない）。
    const tag = selfEvalTag(72);
    const SELF_EVAL_RE = /\[自己評価[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/;
    const m = SELF_EVAL_RE.exec(tag);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("72");
  });
});

describe("ラウンドトリップ（🔴最重要）：コピー生成→決定的パーサでの読み戻し", () => {
  it("計画欄：生成した文字列を決定的パーサに通すと、元の入力どおりに読み戻せる", () => {
    const planText = buildKintonePlanCopyText({
      positioning: "  位置づけの本文  ", // 前後の空白は生成側でtrimされる
      activities: "取り組む内容の本文",
      targetAndEvidence: "達成目標の本文",
      risks: "リスクの本文",
      bandTarget: 70,
      monthNumber: 8,
    });
    const reviewText = buildKintoneReviewCopyText({ reviewText: "振り返りの本文", selfEvalPct: 82 });

    const fixtureText = `個人OKR_月次振返り記録
対象Q
3Q
個人KR_1（グループKR1｜AAS）
${planText}
振り返り
${reviewText}
`;

    const { analysis, confidence } = parseKintoneMonthlyText(fixtureText);
    expect(confidence.ok).toBe(true);
    expect(analysis.krs).toHaveLength(1);
    const month = analysis.krs[0].months.find(m => m.month_index === 1);
    expect(month).toBeDefined();
    expect(month?.positioning).toBe("位置づけの本文");
    expect(month?.activities).toBe("取り組む内容の本文");
    expect(month?.target_and_evidence).toBe("達成目標の本文");
    expect(month?.risks).toBe("リスクの本文");
    expect(month?.band_target).toBe(70);
    expect(month?.review_text).toBe("振り返りの本文");
    expect(month?.self_eval_pct).toBe(82);
  });

  it("計画欄：一部の項目が空でも、記入がある項目は正しく読み戻せる（見出し省略時の整合）", () => {
    const planText = buildKintonePlanCopyText({
      activities: "取り組む内容だけ記入",
      monthNumber: 9,
    });
    const fixtureText = `個人OKR_月次振返り記録
対象Q
3Q
個人KR_1（グループKR1｜AAS）
${planText}
`;
    const { analysis } = parseKintoneMonthlyText(fixtureText);
    const month = analysis.krs[0]?.months.find(m => m.month_index === 1);
    expect(month?.activities).toBe("取り組む内容だけ記入");
    expect(month?.positioning).toBeNull();
    expect(month?.risks).toBeNull();
    expect(month?.band_target).toBeNull();
  });
});

describe("見出し定数の単方向参照（取込プロンプトが定数を埋め込む形になっていること）", () => {
  const extractorSource = readFileSync(
    join(__dirname, "../../ai/personalOkrImportExtractor.ts"),
    "utf-8",
  );

  it("personalOkrImportExtractor.tsがkintoneFormat.tsからimportしている", () => {
    expect(extractorSource).toContain('from "../personalOkr/kintoneFormat"');
    expect(extractorSource).toContain("headingActivities");
    expect(extractorSource).toContain("headingTargetAndEvidence");
    expect(extractorSource).toContain("headingBandTarget");
    expect(extractorSource).toContain("HEADING_POSITIONING");
    expect(extractorSource).toContain("HEADING_RISKS");
  });

  it("見出し文字列がプロンプト本文へ直書きされていない（ハードコードに戻っていない）", () => {
    expect(extractorSource).not.toContain("▼◯月に取り組む内容（計画）");
    expect(extractorSource).not.toContain("▼◯月末の達成目標と、その証拠（計画値）");
    expect(extractorSource).not.toContain("▼◯月末 達成度バンド（計画）");
    expect(extractorSource).not.toContain("【位置づけ】の文章\n");
  });

  const parserSource = readFileSync(join(__dirname, "../kintoneTextParse.ts"), "utf-8");

  it("kintoneTextParse.tsが正規表現を見出し定数から導出している（正規表現リテラルを直書きしていない）", () => {
    expect(parserSource).toContain('from "./kintoneFormat"');
    expect(parserSource).not.toMatch(/const ACTIVITIES_RE = \/▼/);
    expect(parserSource).not.toMatch(/const BAND_RE = \/▼/);
  });
});

describe("見出し関数：実際の月番号を反映する（month_indexを使っていないことの直接確認）", () => {
  it("headingActivities/headingTargetAndEvidence/headingBandTargetは渡した数値をそのまま埋め込む", () => {
    expect(headingActivities(8)).toBe("▼8月に取り組む内容（計画）");
    expect(headingTargetAndEvidence(12)).toBe("▼12月末の達成目標と、その証拠（計画値）");
    expect(headingBandTarget(1)).toBe("▼1月末 達成度バンド（計画）");
  });

  it("HEADING_POSITIONING/HEADING_RISKSは月番号を含まない固定文字列", () => {
    expect(HEADING_POSITIONING).toBe("【位置づけ】");
    expect(HEADING_RISKS).toBe("▼リスクと依存関係");
  });
});

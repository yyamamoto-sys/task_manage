import { describe, expect, it } from "vitest";
import {
  buildPeriodReviewKrMonthEntry,
  buildPeriodReviewDraftContextText,
  buildPeriodReviewDraftContext,
  buildPeriodReviewMaterialSummaryLines,
  isPeriodReviewDraftMaterialEmpty,
  PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT,
  type PeriodReviewDraftContextInput,
  type PeriodReviewKrEntry,
} from "../periodReviewDraftContext";

const emptyTaskSummary = { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } };

describe("buildPeriodReviewKrMonthEntry", () => {
  it("review_text・gm_commentを800字でクリップする", () => {
    const long = "あ".repeat(1000);
    const entry = buildPeriodReviewKrMonthEntry({
      monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null,
      reviewText: long, selfEvalPct: 80, gmEvalPct: null, gmComment: long, taskSummary: emptyTaskSummary,
    });
    expect(entry.reviewText).toHaveLength(800);
    expect(entry.gmComment).toHaveLength(800);
  });

  it("undefinedはnullに正規化する", () => {
    const entry = buildPeriodReviewKrMonthEntry({
      monthLabel: "8月", positioning: undefined, activities: undefined, targetAndEvidence: undefined, risks: undefined,
      reviewText: undefined, selfEvalPct: undefined, gmEvalPct: undefined, gmComment: undefined, taskSummary: emptyTaskSummary,
    });
    expect(entry.positioning).toBeNull();
    expect(entry.reviewText).toBeNull();
    expect(entry.selfEvalPct).toBeNull();
  });
});

// ===== 実施記録（仕様書§W4・2026-08-27） =====
describe("buildPeriodReviewKrMonthEntry：実施記録", () => {
  it("1500字でクリップする（既存reviewText/gmCommentの800字とは別枠）", () => {
    const long = "あ".repeat(3000);
    const entry = buildPeriodReviewKrMonthEntry({
      monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null,
      reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, actualActivities: long, taskSummary: emptyTaskSummary,
    });
    expect(entry.actualActivities).toHaveLength(1500);
  });

  it("未指定はnullに正規化する", () => {
    const entry = buildPeriodReviewKrMonthEntry({
      monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null,
      reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary,
    });
    expect(entry.actualActivities).toBeNull();
  });
});

describe("buildPeriodReviewDraftContextText：対象期間そのものの実施記録（overallActualActivities）", () => {
  it("記入があれば【対象期間の実施記録】セクションを出す", () => {
    const input: PeriodReviewDraftContextInput = {
      periodLabel: "8月", periodKind: "month", overallActualActivities: "他部署の応援に入った",
      krEntries: [],
    };
    const text = buildPeriodReviewDraftContextText(input);
    expect(text).toContain("【対象期間の実施記録（どのKRにも属さない業務）】");
    expect(text).toContain("他部署の応援に入った");
  });

  it("🔴 記入が無ければセクションごと出さない", () => {
    const input: PeriodReviewDraftContextInput = {
      periodLabel: "8月", periodKind: "month", overallActualActivities: null, krEntries: [],
    };
    const text = buildPeriodReviewDraftContextText(input);
    expect(text).not.toContain("【対象期間の実施記録");
  });
});

describe("isPeriodReviewDraftMaterialEmpty", () => {
  it("全KR・全月が空なら true", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary })] },
    ];
    expect(isPeriodReviewDraftMaterialEmpty(krEntries)).toBe(true);
  });

  it("1つでも記入があれば false", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: "頑張った", selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary })] },
    ];
    expect(isPeriodReviewDraftMaterialEmpty(krEntries)).toBe(false);
  });

  it("KR単位の実施記録だけでも false", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, actualActivities: "急遽対応した", taskSummary: emptyTaskSummary })] },
    ];
    expect(isPeriodReviewDraftMaterialEmpty(krEntries)).toBe(false);
  });

  it("🔴 対象期間そのものの実施記録（overallActualActivities）だけでも false", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary })] },
    ];
    expect(isPeriodReviewDraftMaterialEmpty(krEntries, "他部署応援")).toBe(false);
  });

  it("タスク完了件数だけでも false", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: { ...emptyTaskSummary, completedTaskCount: 2 } })] },
    ];
    expect(isPeriodReviewDraftMaterialEmpty(krEntries)).toBe(false);
  });
});

describe("buildPeriodReviewDraftContextText", () => {
  it("記入が無い項目は行ごと出さない", () => {
    const input: PeriodReviewDraftContextInput = {
      periodLabel: "8月", periodKind: "month", overallActualActivities: null,
      krEntries: [
        { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: 80, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary })] },
      ],
    };
    const text = buildPeriodReviewDraftContextText(input);
    expect(text).toContain("自己評価＞80%");
    expect(text).not.toContain("振り返り＞");
    expect(text).not.toContain("GMコメント＞");
    expect(text).not.toContain("計画の要点＞");
  });

  it("四半期ブロックは複数月をまとめて出す", () => {
    const input: PeriodReviewDraftContextInput = {
      periodLabel: "2026年度 3Q", periodKind: "quarter", overallActualActivities: null,
      krEntries: [
        { krLabel: "KR1", weightPct: 100, months: [
          buildPeriodReviewKrMonthEntry({ monthLabel: "7月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: "7月やった", selfEvalPct: 70, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary }),
          buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: "8月やった", selfEvalPct: 80, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary }),
        ] },
      ],
    };
    const text = buildPeriodReviewDraftContextText(input);
    expect(text).toContain("7月やった");
    expect(text).toContain("8月やった");
  });
});

describe("buildPeriodReviewMaterialSummaryLines", () => {
  it("記録が無いKRは「記録なし」", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 50, months: [buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary })] },
    ];
    expect(buildPeriodReviewMaterialSummaryLines(krEntries)).toEqual(["KR1（ウェイト50%）：記録なし"]);
  });

  it("記入がある月だけを行に含める", () => {
    const krEntries: PeriodReviewKrEntry[] = [
      { krLabel: "KR1", weightPct: 100, months: [
        buildPeriodReviewKrMonthEntry({ monthLabel: "7月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary }),
        buildPeriodReviewKrMonthEntry({ monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null, risks: null, reviewText: "書いた", selfEvalPct: 80, gmEvalPct: null, gmComment: null, taskSummary: emptyTaskSummary }),
      ] },
    ];
    const lines = buildPeriodReviewMaterialSummaryLines(krEntries);
    expect(lines[0]).toContain("8月：自己評価80%・振り返り記入あり");
    expect(lines[0]).not.toContain("7月");
  });
});

function buildLargeInput(
  krCount: number, reviewLen: number, gmCommentLen: number, actualActivitiesLen = 0,
): PeriodReviewDraftContextInput {
  const krEntries: PeriodReviewKrEntry[] = [];
  for (let i = 0; i < krCount; i++) {
    const months = ["7月", "8月", "9月"].map(monthLabel => buildPeriodReviewKrMonthEntry({
      monthLabel,
      positioning: "位置づけ".repeat(20),
      activities: "取り組む内容".repeat(20),
      targetAndEvidence: "達成目標".repeat(20),
      risks: "リスク".repeat(20),
      reviewText: "あ".repeat(reviewLen),
      selfEvalPct: 80,
      gmEvalPct: 70,
      gmComment: "い".repeat(gmCommentLen),
      actualActivities: actualActivitiesLen > 0 ? "う".repeat(actualActivitiesLen) : null,
      taskSummary: { completedTaskCount: 3, incompleteTaskCount: 2, taskStats: { delayedCount: 1, stagnantCount: 1, blockedCount: 1 } },
    }));
    krEntries.push({ krLabel: `KR${i + 1}`, weightPct: 100 / krCount, months });
  }
  return { periodLabel: "2026年度 3Q", periodKind: "quarter", krEntries, overallActualActivities: null };
}

describe("buildPeriodReviewDraftContext（546対策・決定的な削減）", () => {
  it("上限以下ならそのまま返す（trimmed=false）", () => {
    const input = buildLargeInput(1, 100, 100);
    const result = buildPeriodReviewDraftContext(input);
    expect(result.trimmed).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT);
  });

  it("上限を超えたら決定的な順序で削り、①計画4欄→②タスク内訳→③GMコメント→④実施記録→⑤振り返り本文の順に消える", () => {
    // 8KR×3か月×800字クリップ後の本文でも上限を超える規模にする
    const input = buildLargeInput(8, 800, 800);
    const result = buildPeriodReviewDraftContext(input);
    expect(result.trimmed).toBe(true);
    // 計画4欄の要点は必ず消えている（①が最初に実行されるため）
    expect(result.text).not.toContain("計画の要点＞");
    // 完了/未完了の件数自体は最後まで残る
    expect(result.text).toContain("完了3件・未完了2件");
  });

  it("🔴 実施記録（④）を削れば十分な規模では、振り返り本文（⑤）はまだ削られず残る", () => {
    // GMコメントは無し（0字＝gmComment自体がnullになる）・振り返り本文は短く・実施記録だけを
    // 大きくして、上限超過の主犯を実施記録側に寄せる（①②③では収まらず、④で収まる規模）。
    const input = buildLargeInput(3, 100, 0, 3000);
    const untrimmedLen = buildPeriodReviewDraftContextText(input).length;
    expect(untrimmedLen).toBeGreaterThan(PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT);

    const result = buildPeriodReviewDraftContext(input);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT);
    expect(result.text).not.toContain("実施記録＞");
    // ⑤（振り返り本文）まで削らずに収まる規模のため、振り返り本文はまだ残っている
    expect(result.text).toContain("あ".repeat(100));
  });

  it("削減後も総文字数の上限に収まるよう努める（全て削っても超える極端ケースでは安全にそのまま返す）", () => {
    const input = buildLargeInput(20, 800, 800, 1500);
    const result = buildPeriodReviewDraftContext(input);
    expect(result.trimmed).toBe(true);
    // 振り返り本文（⑤）まで削られていれば、大幅に短くなっているはず
    expect(result.text).not.toContain("あ".repeat(800));
  });

  it("削り順が決定的であること（同じ入力なら同じ結果）", () => {
    const input = buildLargeInput(6, 800, 800, 1500);
    const r1 = buildPeriodReviewDraftContext(input);
    const r2 = buildPeriodReviewDraftContext(input);
    expect(r1.text).toBe(r2.text);
  });
});

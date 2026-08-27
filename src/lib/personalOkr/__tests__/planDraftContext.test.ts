import { describe, it, expect } from "vitest";
import {
  buildPlanDraftContextText,
  buildPlanDraftContext,
  buildPlanDraftPastMonthEntry,
  buildPlanDraftMaterialSummaryLines,
  isPlanDraftMaterialEmpty,
  resolveOverwrittenPlanFieldLabels,
  PLAN_DRAFT_CONTEXT_CHAR_LIMIT,
  type PlanDraftContextInput,
  type PlanDraftPastMonth,
} from "../planDraftContext";
import type { PersonalKrMonth } from "../../localData/types";

function baseInput(overrides: Partial<PlanDraftContextInput> = {}): PlanDraftContextInput {
  return {
    krLabel: "エース（AAS）",
    krKindLabel: "グループKR紐づけ",
    fiscalYear: 2026,
    quarter: "3Q",
    category: "カテゴリA",
    activity: "実施内容A",
    strengthRole: null,
    weaknessRole: null,
    criteria: "達成基準A",
    supplement: null,
    targetMonthLabel: "8月（2か月目／全3か月）",
    targetMonthIndex: 2,
    pastMonths: [],
    currentMonthPlan: null,
    recentMemos: [],
    ...overrides,
  };
}

function emptyPastMonth(monthLabel: string, overrides: Partial<PlanDraftPastMonth> = {}): PlanDraftPastMonth {
  return {
    monthLabel,
    positioning: null,
    activities: null,
    targetAndEvidence: null,
    risks: null,
    bandTarget: null,
    bandOverride: null,
    reviewText: null,
    selfEvalPct: null,
    gmEvalPct: null,
    gmComment: null,
    actualActivities: null,
    weeks: [],
    taskSummary: { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
    ...overrides,
  };
}

describe("buildPlanDraftContextText", () => {
  it("🔴 過去月ゼロ（1か月目）でも例外なく組み立ち、【過去月の実績】セクションが出ない", () => {
    const input = baseInput({ targetMonthIndex: 1, targetMonthLabel: "7月（1か月目／全3か月）", pastMonths: [] });
    expect(() => buildPlanDraftContextText(input)).not.toThrow();
    const text = buildPlanDraftContextText(input);
    expect(text).not.toContain("【過去月の実績】");
    expect(text).toContain("エース（AAS）");
    expect(text).toContain("達成基準A");
  });

  it("残り月数：1か月目なら残り3か月、2か月目なら残り2か月、3か月目なら残り1か月", () => {
    expect(buildPlanDraftContextText(baseInput({ targetMonthIndex: 1 }))).toContain("残り3か月（当月を含む）");
    expect(buildPlanDraftContextText(baseInput({ targetMonthIndex: 2 }))).toContain("残り2か月（当月を含む）");
    expect(buildPlanDraftContextText(baseInput({ targetMonthIndex: 3 }))).toContain("残り1か月（当月を含む）");
  });

  it("KRの6欄は記入がある欄だけ出す", () => {
    const text = buildPlanDraftContextText(baseInput({
      category: null, activity: null, strengthRole: null, weaknessRole: null, criteria: "達成基準A", supplement: null,
    }));
    expect(text).toContain("達成基準A");
    expect(text).not.toContain("対象業務カテゴリ");
    expect(text).not.toContain("実施内容");
  });

  it("🔴 記入が無い項目・記入が無い週が出力に現れない（未設定 未評価 記入なし なし 等が出ない）", () => {
    const input = baseInput({
      targetMonthIndex: 2,
      pastMonths: [emptyPastMonth("7月（1か月目）")],
    });
    const text = buildPlanDraftContextText(input);
    for (const banned of ["未設定", "未評価", "記入なし", "（なし）"]) {
      expect(text).not.toContain(banned);
    }
    // 過去月見出し・タスク行（機械集計は常に出す）だけが出て、他の行は一切出ない
    expect(text).toContain("▼ 7月（1か月目）");
    expect(text).toContain("＜タスク＞完了0件・未完了0件");
    expect(text).not.toContain("＜計画＞");
    expect(text).not.toContain("＜狙いのバンド＞");
    expect(text).not.toContain("＜振り返り＞");
    expect(text).not.toContain("＜自己評価＞");
    expect(text).not.toContain("＜上長評価＞");
    expect(text).not.toContain("＜上長コメント＞");
    expect(text).not.toContain("＜週の記録＞");
    expect(text).not.toContain("＜実施記録＞");
  });

  // ===== 実施記録（仕様書§W4・2026-08-27） =====
  it("実施記録が記入されている過去月では＜実施記録＞を出す", () => {
    const text = buildPlanDraftContextText(baseInput({
      pastMonths: [emptyPastMonth("7月（1か月目）", { actualActivities: "急遽A社対応で3日費やした" })],
    }));
    expect(text).toContain("＜実施記録＞急遽A社対応で3日費やした");
  });

  it("過去月の計画4欄は記入がある欄だけ出す", () => {
    const input = baseInput({
      pastMonths: [emptyPastMonth("7月（1か月目）", { positioning: "位置づけ本文", risks: null })],
    });
    const text = buildPlanDraftContextText(input);
    expect(text).toContain("位置づけ：位置づけ本文");
    expect(text).not.toContain("リスクと依存関係");
  });

  it("バンド行：狙い・決定のどちらか一方でも出す。両方無ければ出さない", () => {
    const withTargetOnly = buildPlanDraftContextText(baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）", { bandTarget: 70 })] }));
    expect(withTargetOnly).toContain("＜狙いのバンド＞70%");
    expect(withTargetOnly).not.toContain("決定：");

    const withBoth = buildPlanDraftContextText(baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）", { bandTarget: 70, bandOverride: 80 })] }));
    expect(withBoth).toContain("＜狙いのバンド＞70%（決定：80%）");

    const withOverrideOnly = buildPlanDraftContextText(baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）", { bandOverride: 60 })] }));
    expect(withOverrideOnly).toContain("＜狙いのバンド＞（決定：60%）");

    const withNeither = buildPlanDraftContextText(baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）")] }));
    expect(withNeither).not.toContain("＜狙いのバンド＞");
  });

  it("週の記録は埋まっている週だけ出す（既存のbuildFilledWeekLinesと同じ形式）", () => {
    const text = buildPlanDraftContextText(baseInput({
      pastMonths: [emptyPastMonth("7月（1か月目）", {
        weeks: [
          { label: "W1", goalState: "検証ログの形式が決まっている", selfRating: "o" },
          { label: "W2", goalState: null, selfRating: null },
        ],
      })],
    }));
    expect(text).toContain("＜週の記録＞");
    expect(text).toContain("W1：（検証ログの形式が決まっている）｜◯達成");
    expect(text).not.toContain("W2");
  });

  it("タスクの機械集計は常に出す（0件でも出す）。遅延・停滞・先行待ちは1件以上のときだけ内訳を付ける", () => {
    const zero = buildPlanDraftContextText(baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）")] }));
    expect(zero).toContain("＜タスク＞完了0件・未完了0件");
    expect(zero).not.toContain("うち");

    const withDelay = buildPlanDraftContextText(baseInput({
      pastMonths: [emptyPastMonth("7月（1か月目）", {
        taskSummary: { completedTaskCount: 8, incompleteTaskCount: 3, taskStats: { delayedCount: 2, stagnantCount: 1, blockedCount: 0 } },
      })],
    }));
    expect(withDelay).toContain("＜タスク＞完了8件・未完了3件（うち遅延2件・停滞1件）");
  });

  it("当月に既に書かれている計画：記入があれば出し、無ければセクションごと省略", () => {
    const withPlan = buildPlanDraftContextText(baseInput({
      currentMonthPlan: { positioning: "既存の位置づけ", activities: null, targetAndEvidence: null, risks: null },
    }));
    expect(withPlan).toContain("【当月に既に書かれている計画】");
    expect(withPlan).toContain("位置づけ：既存の位置づけ");

    const withoutPlan = buildPlanDraftContextText(baseInput({ currentMonthPlan: null }));
    expect(withoutPlan).not.toContain("【当月に既に書かれている計画】");
  });

  it("直近のメモ：記入があれば出し、無ければセクションごと省略", () => {
    const withMemo = buildPlanDraftContextText(baseInput({ recentMemos: ["高瀬さんとの合意が先"] }));
    expect(withMemo).toContain("【直近のメモ】");
    expect(withMemo).toContain("高瀬さんとの合意が先");

    const withoutMemo = buildPlanDraftContextText(baseInput({ recentMemos: [] }));
    expect(withoutMemo).not.toContain("【直近のメモ】");
  });

  it("過去月は渡された順（呼び出し側が古い順に渡す前提）で出力される", () => {
    const text = buildPlanDraftContextText(baseInput({
      targetMonthIndex: 3,
      pastMonths: [emptyPastMonth("7月（1か月目）"), emptyPastMonth("8月（2か月目）")],
    }));
    expect(text.indexOf("▼ 7月（1か月目）")).toBeLessThan(text.indexOf("▼ 8月（2か月目）"));
  });
});

describe("buildPlanDraftPastMonthEntry", () => {
  it("monthRecordがnullなら全欄null・タスク要約はそのまま渡す", () => {
    const entry = buildPlanDraftPastMonthEntry({
      monthLabel: "7月（1か月目）",
      monthRecord: null,
      weeks: [],
      taskSummary: { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
    });
    expect(entry.positioning).toBeNull();
    expect(entry.reviewText).toBeNull();
    expect(entry.gmComment).toBeNull();
  });

  it("🔴 review_text・gm_commentは1200字でクリップする", () => {
    const longReview = "あ".repeat(2000);
    const longComment = "い".repeat(2000);
    const monthRecord = { review_text: longReview, gm_comment: longComment, is_deleted: false } as unknown as PersonalKrMonth;
    const entry = buildPlanDraftPastMonthEntry({
      monthLabel: "7月（1か月目）", monthRecord,
      weeks: [], taskSummary: { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
    });
    expect(entry.reviewText?.length).toBe(1200);
    expect(entry.gmComment?.length).toBe(1200);
  });

  it("🔴 actual_activitiesは1500字でクリップする（review_text/gm_commentとは別枠）", () => {
    const long = "う".repeat(3000);
    const monthRecord = { actual_activities: long, is_deleted: false } as unknown as PersonalKrMonth;
    const entry = buildPlanDraftPastMonthEntry({
      monthLabel: "7月（1か月目）", monthRecord,
      weeks: [], taskSummary: { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
    });
    expect(entry.actualActivities?.length).toBe(1500);
  });

  it("1200字以下ならそのまま（クリップしない）", () => {
    const shortReview = "短い振り返り";
    const monthRecord = { review_text: shortReview, is_deleted: false } as unknown as PersonalKrMonth;
    const entry = buildPlanDraftPastMonthEntry({
      monthLabel: "7月（1か月目）", monthRecord,
      weeks: [], taskSummary: { completedTaskCount: 0, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
    });
    expect(entry.reviewText).toBe(shortReview);
  });
});

describe("isPlanDraftMaterialEmpty", () => {
  it("KR定義が空 かつ 過去月に材料が無ければtrue", () => {
    expect(isPlanDraftMaterialEmpty(true, [])).toBe(true);
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）")])).toBe(true);
  });

  it("🔴 1か月目（過去月ゼロ）でもKR定義があればfalse（生成できる）", () => {
    expect(isPlanDraftMaterialEmpty(false, [])).toBe(false);
  });

  it("KR定義が空でも過去月に計画・振り返り・自己評価・GMコメントのいずれかがあればfalse", () => {
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）", { positioning: "何か" })])).toBe(false);
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）", { reviewText: "振り返り本文" })])).toBe(false);
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）", { selfEvalPct: 70 })])).toBe(false);
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）", { gmComment: "上長コメント" })])).toBe(false);
    expect(isPlanDraftMaterialEmpty(true, [emptyPastMonth("7月（1か月目）", { actualActivities: "急遽対応した" })])).toBe(false);
  });
});

describe("buildPlanDraftMaterialSummaryLines", () => {
  it("自己評価・GM評価・振り返り記入あり・タスクをまとめた1行を作る", () => {
    const lines = buildPlanDraftMaterialSummaryLines([
      emptyPastMonth("7月（1か月目）", {
        selfEvalPct: 72, gmEvalPct: 68, reviewText: "本文",
        taskSummary: { completedTaskCount: 8, incompleteTaskCount: 3, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
      }),
    ]);
    expect(lines).toEqual(["7月（1か月目）：自己評価72%・GM評価68%・振り返り記入あり／タスク完了8件・未完了3件"]);
  });

  it("記入が無い項目はその項目ごと出さない", () => {
    const lines = buildPlanDraftMaterialSummaryLines([
      emptyPastMonth("7月（1か月目）", {
        taskSummary: { completedTaskCount: 5, incompleteTaskCount: 0, taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 0 } },
      }),
    ]);
    expect(lines).toEqual(["7月（1か月目）：タスク完了5件・未完了0件"]);
  });

  it("完全に記録が無い月はラベルのみ", () => {
    const lines = buildPlanDraftMaterialSummaryLines([emptyPastMonth("7月（1か月目）")]);
    expect(lines).toEqual(["7月（1か月目）"]);
  });

  it("実施記録があれば「実施記録あり」を含める", () => {
    const lines = buildPlanDraftMaterialSummaryLines([
      emptyPastMonth("7月（1か月目）", { actualActivities: "急遽対応した" }),
    ]);
    expect(lines).toEqual(["7月（1か月目）：実施記録あり"]);
  });
});

describe("resolveOverwrittenPlanFieldLabels", () => {
  it("記入がある欄だけラベルを返す", () => {
    const labels = resolveOverwrittenPlanFieldLabels({ positioning: "あり", activities: "", targetAndEvidence: "  ", risks: "あり" });
    expect(labels).toEqual(["位置づけ", "リスクと依存関係"]);
  });

  it("全欄空なら空配列（確認不要）", () => {
    expect(resolveOverwrittenPlanFieldLabels({ positioning: "", activities: "", targetAndEvidence: "", risks: "" })).toEqual([]);
  });
});

describe("buildPlanDraftContext（文字数上限のトリミング）", () => {
  function longText(marker: string, totalLen: number): string {
    const pad = "a".repeat(Math.max(0, totalLen - marker.length));
    return (marker + pad).slice(0, totalLen);
  }

  it("上限以下ならトリミングしない", () => {
    const input = baseInput({ pastMonths: [emptyPastMonth("7月（1か月目）", { positioning: "短い位置づけ" })] });
    const result = buildPlanDraftContext(input);
    expect(result.trimmed).toBe(false);
    expect(result.text).toBe(buildPlanDraftContextText(input));
  });

  it("🔴 上限超過時、古い月から順に週の記録を削り、上限内に収まる", () => {
    const heavyWeeks = (marker: string) => Array.from({ length: 6 }, (_, i) => (
      { label: `W${i + 1}`, goalState: longText(marker, 700), selfRating: "o" as const }
    ));
    const input = baseInput({
      targetMonthIndex: 3,
      pastMonths: [
        emptyPastMonth("7月（1か月目）", { weeks: heavyWeeks("M1WEEK") }),
        emptyPastMonth("8月（2か月目）", { weeks: heavyWeeks("M2WEEK") }),
      ],
    });
    const untrimmedLen = buildPlanDraftContextText(input).length;
    expect(untrimmedLen).toBeGreaterThan(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);

    const result = buildPlanDraftContext(input);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);
    // 古い月（7月）の週の記録だけが削られ、新しい月（8月）の週の記録は残る
    expect(result.text).not.toContain("M1WEEK");
    expect(result.text).toContain("M2WEEK");
  });

  it("🔴 週の記録を全部削っても超過するときは、古い月から順に実施記録を削る", () => {
    const heavyWeeks = (marker: string) => Array.from({ length: 6 }, (_, i) => (
      { label: `W${i + 1}`, goalState: longText(marker, 700), selfRating: "o" as const }
    ));
    // 実施記録を週の記録より十分大きくし、週の記録を両月とも削ってもなお上限を超える規模にする
    // （②実施記録の削除が実際に発火することを保証する）。
    const input = baseInput({
      targetMonthIndex: 3,
      pastMonths: [
        emptyPastMonth("7月（1か月目）", { weeks: heavyWeeks("M1WEEK"), actualActivities: longText("M1ACTUAL", 5000) }),
        emptyPastMonth("8月（2か月目）", { weeks: heavyWeeks("M2WEEK"), actualActivities: longText("M2ACTUAL", 5000) }),
      ],
    });
    const untrimmedLen = buildPlanDraftContextText(input).length;
    expect(untrimmedLen).toBeGreaterThan(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);

    const result = buildPlanDraftContext(input);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);
    // 週の記録は両月とも①で削られている（②に到達する前提が満たされている）
    expect(result.text).not.toContain("M1WEEK");
    expect(result.text).not.toContain("M2WEEK");
    // ②実施記録は古い月（7月）から削られる
    expect(result.text).not.toContain("M1ACTUAL");
  });

  it("🔴 週の記録を全部削っても超過するときはメモを削る", () => {
    const input = baseInput({
      targetMonthIndex: 2,
      pastMonths: [emptyPastMonth("7月（1か月目）", {
        positioning: longText("PLANFIELD", 3000),
        reviewText: longText("REVIEWFIELD", 1200),
      })],
      recentMemos: [longText("MEMOMARKER", 4000)],
    });
    const untrimmedLen = buildPlanDraftContextText(input).length;
    expect(untrimmedLen).toBeGreaterThan(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);

    const result = buildPlanDraftContext(input);
    expect(result.trimmed).toBe(true);
    expect(result.text).not.toContain("MEMOMARKER");
    // メモを削っても計画欄・週の記録の削除順は変わらない（この入力には週データが無いため計画欄は残る）
    expect(result.text).toContain("PLANFIELD");
  });

  it("🔴 週の記録・メモを削っても超過するときは、古い月から順に計画4欄を削る", () => {
    const input = baseInput({
      targetMonthIndex: 3,
      pastMonths: [
        emptyPastMonth("7月（1か月目）", {
          positioning: longText("M1FIELD", 2200),
          reviewText: longText("M1REVIEW", 1200),
          gmComment: longText("M1COMMENT", 1200),
        }),
        emptyPastMonth("8月（2か月目）", {
          positioning: longText("M2FIELD", 2200),
          reviewText: longText("M2REVIEW", 1200),
          gmComment: longText("M2COMMENT", 1200),
        }),
      ],
    });
    const untrimmedLen = buildPlanDraftContextText(input).length;
    expect(untrimmedLen).toBeGreaterThan(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);

    const result = buildPlanDraftContext(input);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PLAN_DRAFT_CONTEXT_CHAR_LIMIT);
    // 古い月（7月）の計画4欄が削られ、新しい月（8月）の計画4欄は残る。
    // 振り返り・GMコメントは計画4欄より後の削除対象のため、この入力（週・メモが無い）では
    // 4欄削除だけで上限内に収まり、両月とも review/comment は残る想定。
    expect(result.text).not.toContain("M1FIELD");
    expect(result.text).toContain("M2FIELD");
  });

  it("決定的に動く（同じ入力なら同じ結果）", () => {
    const heavyWeeks = (marker: string) => Array.from({ length: 6 }, (_, i) => (
      { label: `W${i + 1}`, goalState: longText(marker, 700), selfRating: "o" as const }
    ));
    const input = baseInput({
      targetMonthIndex: 3,
      pastMonths: [
        emptyPastMonth("7月（1か月目）", { weeks: heavyWeeks("M1WEEK") }),
        emptyPastMonth("8月（2か月目）", { weeks: heavyWeeks("M2WEEK") }),
      ],
    });
    const r1 = buildPlanDraftContext(input);
    const r2 = buildPlanDraftContext(input);
    expect(r1).toEqual(r2);
  });
});

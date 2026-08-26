// src/components/okr/personal/__tests__/personalOkrUnsavedEditors.test.ts
//
// 【設計意図】
// CLAUDE.md Section 46（未保存編集レジストリ）にPersonalKrPanel（計画欄）・MonthReviewBlock
// （振り返り欄）が正しく登録されることの回帰テスト。このリポジトリにReactレンダリングテスト
// 基盤が無いため、実際のコンポーネントをマウントする代わりに、各コンポーネントが登録時に
// 渡すgetter相当（computeMonthPlanDirty/computeMonthReviewDirtyの結果を返す関数）を
// unsavedEditorRegistryへ直接register/unregisterし、集計（hasUnsavedEditors）が正しく
// 効くことを検証する（unsavedEditorRegistry.test.tsと同じ「モジュールを直接叩く」方式）。
//
// 【修正前に赤くなることの確認（feedback_regression_test_must_fail_before_fix）】
// v3.100実装前は、PersonalKrPanel/MonthReviewBlockのどちらもregisterUnsavedEditorを
// 呼んでいなかった。このテストファイル自体は「registryの集計ロジックが正しいか」を
// 検証するものであり、component側の実装有無は別途ソース走査テスト
// （personalOkrRegistryWiring.test.ts）で固定する。

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerUnsavedEditor,
  unregisterUnsavedEditor,
  hasUnsavedEditors,
  _resetUnsavedEditorRegistryForTest,
} from "../../../../lib/editing/unsavedEditorRegistry";
import { computeMonthPlanDirty } from "../../../../lib/personalOkr/monthPlanForm";
import { computeMonthReviewDirty } from "../../../../lib/personalOkr/monthReviewForm";

describe("個人OKR：計画欄・振り返り欄がunsavedEditorRegistryに正しく反映される", () => {
  beforeEach(() => {
    _resetUnsavedEditorRegistryForTest();
  });

  it("計画欄がdirtyのときregistryが未保存ありを返す", () => {
    const current = { positioning: "変更した", activities: "", targetAndEvidence: "", risks: "", bandTarget: null };
    const saved = { positioning: "", activities: undefined, targetAndEvidence: undefined, risks: undefined, bandTarget: undefined };
    registerUnsavedEditor("plan-1", () => computeMonthPlanDirty(current, saved));
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("振り返り欄がdirtyのときregistryが未保存ありを返す", () => {
    const current = { reviewText: "書いた", selfEvalRaw: "", gmEvalRaw: "", gmComment: "" };
    const saved = { reviewText: undefined, selfEvalPct: undefined, gmEvalPct: undefined, gmComment: undefined };
    registerUnsavedEditor("review-1", () => computeMonthReviewDirty(current, saved));
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("計画欄・振り返り欄の両方がクリーンならregistryは未保存なしを返す", () => {
    const planCurrent = { positioning: "", activities: "", targetAndEvidence: "", risks: "", bandTarget: null };
    const planSaved = { positioning: undefined, activities: undefined, targetAndEvidence: undefined, risks: undefined, bandTarget: undefined };
    const reviewCurrent = { reviewText: "", selfEvalRaw: "", gmEvalRaw: "", gmComment: "" };
    const reviewSaved = { reviewText: undefined, selfEvalPct: undefined, gmEvalPct: undefined, gmComment: undefined };
    registerUnsavedEditor("plan-1", () => computeMonthPlanDirty(planCurrent, planSaved));
    registerUnsavedEditor("review-1", () => computeMonthReviewDirty(reviewCurrent, reviewSaved));
    expect(hasUnsavedEditors()).toBe(false);
  });

  it("片方だけdirtyでも検知できる（計画のみ）", () => {
    const planCurrent = { positioning: "書いた", activities: "", targetAndEvidence: "", risks: "", bandTarget: null };
    const planSaved = { positioning: undefined, activities: undefined, targetAndEvidence: undefined, risks: undefined, bandTarget: undefined };
    const reviewCurrent = { reviewText: "", selfEvalRaw: "", gmEvalRaw: "", gmComment: "" };
    const reviewSaved = { reviewText: undefined, selfEvalPct: undefined, gmEvalPct: undefined, gmComment: undefined };
    registerUnsavedEditor("plan-1", () => computeMonthPlanDirty(planCurrent, planSaved));
    registerUnsavedEditor("review-1", () => computeMonthReviewDirty(reviewCurrent, reviewSaved));
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("解除するとその分だけ集計から外れる（KR・月切替時のクリーンアップ相当）", () => {
    registerUnsavedEditor("plan-1", () => true);
    expect(hasUnsavedEditors()).toBe(true);
    unregisterUnsavedEditor("plan-1");
    expect(hasUnsavedEditors()).toBe(false);
  });
});

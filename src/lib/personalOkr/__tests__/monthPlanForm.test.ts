// src/lib/personalOkr/__tests__/monthPlanForm.test.ts
import { describe, it, expect } from "vitest";
import { computeMonthPlanDirty } from "../monthPlanForm";

const savedClean = {
  positioning: "位置づけ", activities: "内容", targetAndEvidence: "目標", risks: "リスク",
  bandTarget: 80 as const, weightOverridePct: undefined,
};
const currentClean = {
  positioning: "位置づけ", activities: "内容", targetAndEvidence: "目標", risks: "リスク",
  bandTarget: 80 as const, weightOverrideRaw: "",
};

describe("computeMonthPlanDirty", () => {
  it("全フィールドが保存済みと一致すればfalse", () => {
    expect(computeMonthPlanDirty(currentClean, savedClean)).toBe(false);
  });

  it("positioningが変わればtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, positioning: "別の位置づけ" }, savedClean)).toBe(true);
  });

  it("activitiesが変わればtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, activities: "別の内容" }, savedClean)).toBe(true);
  });

  it("targetAndEvidenceが変わればtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, targetAndEvidence: "別の目標" }, savedClean)).toBe(true);
  });

  it("risksが変わればtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, risks: "別のリスク" }, savedClean)).toBe(true);
  });

  it("bandTargetが変わればtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, bandTarget: 70 }, savedClean)).toBe(true);
  });

  it("bandTargetをnullに戻す変更もtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, bandTarget: null }, savedClean)).toBe(true);
  });

  it("savedのnull/undefinedは空文字列・nullとして正規化される（新規未保存レコード相当）", () => {
    const saved = { positioning: null, activities: undefined, targetAndEvidence: null, risks: undefined, bandTarget: null, weightOverridePct: undefined };
    expect(computeMonthPlanDirty({ positioning: "", activities: "", targetAndEvidence: "", risks: "", bandTarget: null, weightOverrideRaw: "" }, saved)).toBe(false);
    expect(computeMonthPlanDirty({ positioning: "何か書いた", activities: "", targetAndEvidence: "", risks: "", bandTarget: null, weightOverrideRaw: "" }, saved)).toBe(true);
  });

  // 【2026-08-26・v3.104】「今月のウェイト」欄（weight_override_pct）のdirty判定。
  it("weightOverrideRawが空欄・savedもundefinedならfalse", () => {
    expect(computeMonthPlanDirty(currentClean, savedClean)).toBe(false);
  });

  it("weightOverrideRawに数値を入れるとtrue", () => {
    expect(computeMonthPlanDirty({ ...currentClean, weightOverrideRaw: "25" }, savedClean)).toBe(true);
  });

  it("保存済みの上書き値と同じ文字列を入れ直すとfalse", () => {
    const saved = { ...savedClean, weightOverridePct: 25 };
    expect(computeMonthPlanDirty({ ...currentClean, weightOverrideRaw: "25" }, saved)).toBe(false);
  });

  it("🔴 保存済みの上書き値が0のとき、空欄に戻す変更はtrue（??が0を落とさないこと）", () => {
    const saved = { ...savedClean, weightOverridePct: 0 };
    expect(computeMonthPlanDirty({ ...currentClean, weightOverrideRaw: "0" }, saved)).toBe(false);
    expect(computeMonthPlanDirty({ ...currentClean, weightOverrideRaw: "" }, saved)).toBe(true);
  });

  it("weightOverrideRawが無効な入力（範囲外）ならdirty扱いにする", () => {
    expect(computeMonthPlanDirty({ ...currentClean, weightOverrideRaw: "150" }, savedClean)).toBe(true);
  });
});

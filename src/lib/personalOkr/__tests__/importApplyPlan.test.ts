import { describe, expect, it } from "vitest";
import { buildImportApplyPlan, type ImportKrDraftInput, type ImportMonthDraftInput } from "../importApplyPlan";
import type { PersonalKr, PersonalKrMonth } from "../../localData/types";

function makeMonthDraft(overrides: Partial<ImportMonthDraftInput>): ImportMonthDraftInput {
  return {
    checked: true,
    monthIndex: 1,
    newId: "new-month-id",
    positioning: null, activities: null, targetAndEvidence: null, risks: null,
    bandTarget: null, weightOverridePct: null,
    reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null,
    ...overrides,
  };
}

function makeKrDraft(overrides: Partial<ImportKrDraftInput>): ImportKrDraftInput {
  return {
    checked: true,
    mappedExistingId: null,
    newId: "new-kr-id",
    krKind: "group_kr",
    keyResultId: null,
    taskForceId: null,
    label: "エース（AAS）",
    weightPct: 35,
    category: null, activity: null, strengthRole: null, weaknessRole: null, criteria: null, supplement: null,
    months: [],
    ...overrides,
  };
}

const BASE_PARAMS = {
  fiscalYear: 2026,
  quarter: "3Q" as const,
  memberId: "member-1",
  groupId: "grp-aid",
  sourceLabel: "個人OKR設定フォーム 3Q・8/10取込",
  nowIso: "2026-08-10T00:00:00.000Z",
};

describe("buildImportApplyPlan — 既存の週・メモを失わないこと（最重要の回帰テスト）", () => {
  it("既存KRに対応づけた場合、新しいuuidを発行せず既存のpersonal_krs.idをそのまま使う（週・メモが参照する行が変わらない）", () => {
    const existingKr: PersonalKr = {
      id: "existing-kr-id-abc", member_id: "member-1", group_id: "grp-aid",
      fiscal_year: 2026, quarter: "3Q", kr_kind: "group_kr", label: "AAS（旧ラベル）",
      weight_pct: 30, display_order: 0, is_deleted: false, created_at: "2026-07-01T00:00:00.000Z",
    };
    // このKRには週の目標状態・メモが existing-kr-id-abc に紐づいている想定
    // （personal_kr_weeks/personal_kr_memosはpersonal_kr_idでのみ参照するため、
    //  ここではpersonal_kr_idの値そのものが変わらないことを検証すれば十分）
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({ mappedExistingId: "existing-kr-id-abc", label: "エース（AAS）" })],
      existingKrsById: { "existing-kr-id-abc": existingKr },
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 3,
    });

    expect(plan.krs).toHaveLength(1);
    expect(plan.krs[0].id).toBe("existing-kr-id-abc"); // ← 週・メモの参照先が保たれる決め手
    expect(plan.krs[0].id).not.toBe("new-kr-id");
    // 既存の display_order・created_at・group_id は保持される（取込で書き換えない）
    expect(plan.krs[0].display_order).toBe(0);
    expect(plan.krs[0].created_at).toBe("2026-07-01T00:00:00.000Z");
    // 本文フィールドは取込内容で更新される
    expect(plan.krs[0].label).toBe("エース（AAS）");
    expect(plan.krs[0].weight_pct).toBe(35);
  });

  it("新規作成（mappedExistingId=null）の場合のみ新しいidを使う", () => {
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({ mappedExistingId: null, newId: "brand-new-id" })],
      existingKrsById: {},
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 2,
    });
    expect(plan.krs[0].id).toBe("brand-new-id");
    expect(plan.krs[0].display_order).toBe(2);
  });

  it("既存にあって抽出結果に無いKRは、planに一切含まれない（削除も更新もしない）", () => {
    const untouchedExisting: PersonalKr = {
      id: "untouched-kr", member_id: "member-1", group_id: "grp-aid",
      fiscal_year: 2026, quarter: "3Q", kr_kind: "general", label: "自己研鑽",
      weight_pct: 10, display_order: 4, is_deleted: false,
    };
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({ mappedExistingId: null })], // untouched-kr には触れない抽出結果
      existingKrsById: { "untouched-kr": untouchedExisting },
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 5,
    });
    expect(plan.krs.some(k => k.id === "untouched-kr")).toBe(false);
  });

  it("checkedでないdraftは結果に含まれない", () => {
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({ checked: false })],
      existingKrsById: {},
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 0,
    });
    expect(plan.krs).toHaveLength(0);
  });
});

describe("buildImportApplyPlan — 月次計画の更新/新規判定", () => {
  it("既存のpersonal_kr_monthsが見つかれば、そのidを再利用して更新する（UNIQUE制約の衝突を避ける）", () => {
    const existingKr: PersonalKr = {
      id: "kr-1", member_id: "member-1", group_id: "grp-aid",
      fiscal_year: 2026, quarter: "3Q", kr_kind: "group_kr", label: "AAS",
      weight_pct: 35, display_order: 0, is_deleted: false,
    };
    const existingMonth: PersonalKrMonth = {
      id: "existing-month-id", personal_kr_id: "kr-1", month: "2026-07-01", month_index: 1,
      is_deleted: false, created_at: "2026-07-05T00:00:00.000Z",
      band_override: 80, band_override_by: "member-1", band_override_at: "2026-07-31T00:00:00.000Z",
    };
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({
        mappedExistingId: "kr-1",
        months: [makeMonthDraft({ monthIndex: 1, positioning: "新しい位置づけ", newId: "would-be-new-month-id" })],
      })],
      existingKrsById: { "kr-1": existingKr },
      existingMonthsByKrIdAndIndex: { "kr-1": { 1: existingMonth } },
      nextDisplayOrderStart: 1,
    });
    expect(plan.months).toHaveLength(1);
    expect(plan.months[0].id).toBe("existing-month-id"); // 新しいidを発行しない
    expect(plan.months[0].positioning).toBe("新しい位置づけ");
    // 人が既に決めたband_overrideは取込で上書き・消去されない
    expect(plan.months[0].band_override).toBe(80);
    expect(plan.months[0].band_override_by).toBe("member-1");
  });

  it("既存の月次計画が無ければ新規作成する", () => {
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({
        mappedExistingId: null, newId: "kr-new",
        months: [makeMonthDraft({ monthIndex: 2, newId: "month-new-id" })],
      })],
      existingKrsById: {},
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 0,
    });
    expect(plan.months).toHaveLength(1);
    expect(plan.months[0].id).toBe("month-new-id");
    expect(plan.months[0].personal_kr_id).toBe("kr-new");
    expect(plan.months[0].month_index).toBe(2);
    expect(plan.months[0].month).toBe("2026-08-01"); // 3Qの2か月目=8月
    expect(plan.months[0].band_override).toBeNull();
  });

  it("checkedでない月は結果に含まれない", () => {
    const plan = buildImportApplyPlan({
      ...BASE_PARAMS,
      drafts: [makeKrDraft({ months: [makeMonthDraft({ checked: false })] })],
      existingKrsById: {},
      existingMonthsByKrIdAndIndex: {},
      nextDisplayOrderStart: 0,
    });
    expect(plan.months).toHaveLength(0);
  });
});

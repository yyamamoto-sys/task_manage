import { describe, it, expect } from "vitest";
import { mergeMonthRecord } from "../monthRecordMerge";
import type { PersonalKrMonth } from "../../localData/types";

function existingMonth(overrides: Partial<PersonalKrMonth> = {}): PersonalKrMonth {
  return {
    id: "m1", personal_kr_id: "k1", month: "2026-08-01", month_index: 2,
    positioning: "既存の位置づけ", activities: "既存の取り組み内容", target_and_evidence: "既存の達成目標",
    risks: null, band_target: 70, band_override: 80, band_override_by: "member-1", band_override_at: "2026-08-10T00:00:00Z",
    review_text: "既存の振り返り本文", self_eval_pct: 75, gm_eval_pct: 70, gm_comment: "既存のGMコメント",
    source_label: "Kintone取込", imported_at: "2026-08-01T00:00:00Z",
    is_deleted: false, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-10T00:00:00Z", updated_by: "member-1",
    ...overrides,
  };
}

const fallback: PersonalKrMonth = {
  id: "new-id", personal_kr_id: "k1", month: "2026-08-01", month_index: 2, is_deleted: false, created_at: "2026-08-26T00:00:00Z",
};

describe("mergeMonthRecord", () => {
  it("🔴 計画欄だけのpatchでも振り返り・バンド決定フィールドが消えない（W1/W2保存の再発防止）", () => {
    const merged = mergeMonthRecord(existingMonth(), fallback, {
      positioning: "新しい位置づけ", activities: "新しい取り組み内容", updated_by: "member-1",
    });
    expect(merged.positioning).toBe("新しい位置づけ");
    expect(merged.activities).toBe("新しい取り組み内容");
    // 振り返り欄は今回のpatchに含めていないため、既存値が保持されること
    expect(merged.review_text).toBe("既存の振り返り本文");
    expect(merged.self_eval_pct).toBe(75);
    expect(merged.gm_eval_pct).toBe(70);
    expect(merged.gm_comment).toBe("既存のGMコメント");
    expect(merged.band_override).toBe(80);
    expect(merged.source_label).toBe("Kintone取込");
  });

  it("🔴 振り返り欄だけのpatchでも計画欄が消えない", () => {
    const merged = mergeMonthRecord(existingMonth(), fallback, {
      review_text: "新しい振り返り", self_eval_pct: 90, updated_by: "member-1",
    });
    expect(merged.review_text).toBe("新しい振り返り");
    expect(merged.self_eval_pct).toBe(90);
    expect(merged.positioning).toBe("既存の位置づけ");
    expect(merged.activities).toBe("既存の取り組み内容");
    expect(merged.band_override).toBe(80);
  });

  it("既存レコードが無ければfallbackを土台にpatchを適用する", () => {
    const merged = mergeMonthRecord(null, fallback, { positioning: "初めての位置づけ", updated_by: "member-1" });
    expect(merged.id).toBe("new-id");
    expect(merged.positioning).toBe("初めての位置づけ");
    expect(merged.review_text).toBeUndefined();
  });

  it("patchのnullは既存値を明示的に上書きする（クリア操作を許す）", () => {
    const merged = mergeMonthRecord(existingMonth(), fallback, { self_eval_pct: null });
    expect(merged.self_eval_pct).toBeNull();
    expect(merged.gm_eval_pct).toBe(70); // patchに含めていない項目は保持
  });
});

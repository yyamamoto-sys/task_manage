import { describe, it, expect } from "vitest";
import {
  buildPersonalOkrAiContextText, buildPersonalOkrAiContextChips, buildPersonalOkrAiStarters,
  type PersonalOkrAiContextInput,
} from "../personalOkrAiContext";

function baseInput(overrides: Partial<PersonalOkrAiContextInput> = {}): PersonalOkrAiContextInput {
  return {
    krLabel: "エース（AAS）",
    krKindLabel: "グループKR紐づけ",
    category: "カテゴリA",
    activity: "実施内容A",
    strengthRole: null,
    weaknessRole: null,
    criteria: "達成基準A",
    supplement: null,
    monthLabel: "8月（2か月目）",
    positioning: "位置づけの本文",
    activities: "取り組む内容",
    targetAndEvidence: "達成目標と証拠",
    risks: null,
    bandTarget: 70,
    weeks: [
      { label: "W1", goalState: "検証ログの形式が決まっている", selfRating: "o" },
      { label: "W2", goalState: "判定基準の合意が取れている", selfRating: "t" },
      { label: "W3", goalState: null, selfRating: null },
    ],
    taskSummary: { linkedTaskCount: 5, delayedCount: 1, stagnantCount: 0, blockedCount: 2 },
    recentMemos: ["高瀬さんとの合意が先", "検証ログはタスクコメントに寄せる"],
    ...overrides,
  };
}

describe("buildPersonalOkrAiContextText", () => {
  it("KRの内容・今月の計画・週・タスク要約・メモを含む", () => {
    const text = buildPersonalOkrAiContextText(baseInput());
    expect(text).toContain("エース（AAS）");
    expect(text).toContain("カテゴリA");
    expect(text).toContain("位置づけの本文");
    expect(text).toContain("狙いのバンド：70%");
    expect(text).toContain("W1：検証ログの形式が決まっている｜◯達成");
    expect(text).toContain("W3：（目標状態未設定）｜未評価");
    expect(text).toContain("紐づくタスク5件・遅延1件・停滞0件・先行待ち2件");
    expect(text).toContain("高瀬さんとの合意が先");
  });

  it("🔴 タスクの生データ（Task[]相当のフィールド名）を含まない。件数のみの要約であること", () => {
    const text = buildPersonalOkrAiContextText(baseInput());
    // タスク要約は件数の文言のみで構成され、個別タスク名・IDなどを含まない
    expect(text).not.toMatch(/task_id|assignee_member_id/);
  });

  it("6本文欄・4欄が全てnullなら該当セクションを削る（空行の量を増やさない）", () => {
    const text = buildPersonalOkrAiContextText(baseInput({
      category: null, activity: null, strengthRole: null, weaknessRole: null, criteria: null, supplement: null,
      positioning: null, activities: null, targetAndEvidence: null, risks: null,
    }));
    expect(text).not.toContain("【このKRの内容】");
    expect(text).toContain("【8月（2か月目）の計画】");
    expect(text).toContain("狙いのバンド：70%");
  });

  it("週データが空なら「週データなし」と明示する", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ weeks: [] }));
    expect(text).toContain("（週データなし）");
  });

  it("メモが無ければ【直近のメモ】セクションを出さない", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ recentMemos: [] }));
    expect(text).not.toContain("【直近のメモ】");
  });

  it("bandTargetが未設定ならそのまま明示する", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ bandTarget: null }));
    expect(text).toContain("狙いのバンド：未設定");
  });
});

describe("buildPersonalOkrAiContextChips", () => {
  it("週・タスク・メモの件数を反映したチップを返す", () => {
    const chips = buildPersonalOkrAiContextChips(baseInput());
    expect(chips).toContain("エース（AAS） の内容");
    expect(chips).toContain("8月（2か月目）の計画");
    expect(chips).toContain("W1〜W3の目標状態");
    expect(chips).toContain("自己評価 ◯△✕");
    expect(chips).toContain("タスク5件の実績");
    expect(chips).toContain("メモ2件");
  });

  it("週・メモが無ければ該当チップを含まない", () => {
    const chips = buildPersonalOkrAiContextChips(baseInput({ weeks: [], recentMemos: [] }));
    expect(chips.some(c => c.includes("週の目標状態"))).toBe(false);
    expect(chips.some(c => c.includes("自己評価"))).toBe(false);
    expect(chips.some(c => c.includes("メモ"))).toBe(false);
  });
});

describe("buildPersonalOkrAiStarters", () => {
  it("bandTargetがあればバンド名を含む質問文を返す", () => {
    const starters = buildPersonalOkrAiStarters(baseInput({ bandTarget: 70 }));
    expect(starters[0]).toContain("バンド70");
    expect(starters.length).toBe(4);
  });

  it("bandTargetが無ければ「当月の狙い」という汎用表現にする", () => {
    const starters = buildPersonalOkrAiStarters(baseInput({ bandTarget: null }));
    expect(starters[0]).toContain("当月の狙い");
  });
});

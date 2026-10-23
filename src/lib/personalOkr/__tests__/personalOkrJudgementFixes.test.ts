// src/lib/personalOkr/__tests__/personalOkrJudgementFixes.test.ts
//
// 【設計意図】v3.180：判断待ちだった個人OKR領域のうち、純関数・lib単位で検査できるもの
// （M55・M56・M58・M59・M62・M63・M64・M61・M65・M66）の回帰テスト。
// ストアの挙動は src/stores/__tests__/personalOkrUiStoreJudgementFixes.test.ts、
// 画面の配線は components/okr/personal/__tests__/personalOkrJudgementWiring.test.ts。

import { describe, it, expect, vi } from "vitest";
import {
  buildPersonalOkrAiContextText, AI_CONTEXT_TOTAL_CHAR_LIMIT, AI_CONTEXT_CLIP_MARK, FIELD_AI_CLIP_CHARS,
  type PersonalOkrAiContextInput,
} from "../personalOkrAiContext";
import { rollbackLastUserTurn, addTurn, createSession, MAX_TURNS_WARNING } from "../../ai/sessionManager";
import { detectNumericEvaluation, buildNumericEvalWarning } from "../draftNumericEvalCheck";
import { hasUnappliedDraftText, hasUnappliedDraftFields } from "../draftCloseGuard";
import { buildImportApplyPlan, lockDisplayOrderStart, type ImportKrDraftInput, type ImportMonthDraftInput } from "../importApplyPlan";
import { persistGeneratedRow } from "../persistGenerated";
import { classifyPeriodReviewsLoadError } from "../periodReviewsLoadError";
import { mergeResyncRows } from "../fetchMerge";
import { setPersonalOkrResyncHandler, requestPersonalOkrResync } from "../resyncRegistry";
import { resolveSaveConflict, PersonalOkrConflictError, CONFLICT_REFRESHED_MESSAGE } from "../conflictRefresh";
import { ConflictError } from "../../supabase/store";
import type { PersonalKr, PersonalKrMonth } from "../../localData/types";

// ===== M59 =====
function baseInput(over: Partial<PersonalOkrAiContextInput> = {}): PersonalOkrAiContextInput {
  return {
    krLabel: "KR", krKindLabel: "全般", category: null, activity: null, strengthRole: null, weaknessRole: null,
    criteria: null, supplement: null, monthLabel: "8月", positioning: null, activities: null,
    targetAndEvidence: null, risks: null, bandTarget: null, weeks: [],
    taskSummary: { linkedTaskCount: 0, delayedCount: 0, stagnantCount: 0, blockedCount: 0 },
    recentMemos: [], actualActivities: null, ...over,
  };
}

describe("M59：AI文脈の欄ごとのクリップと総量の上限", () => {
  it("1欄が上限を超えたら切り、切ったことが分かる印を付ける", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ criteria: "あ".repeat(5000) }));
    expect(text).toContain("あ".repeat(FIELD_AI_CLIP_CHARS) + AI_CONTEXT_CLIP_MARK);
    expect(text).not.toContain("あ".repeat(FIELD_AI_CLIP_CHARS + 1));
  });
  it("計画4欄も欄ごとに切る", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ positioning: "い".repeat(4000), risks: "う".repeat(4000) }));
    expect(text).not.toContain("い".repeat(FIELD_AI_CLIP_CHARS + 1));
    expect(text).not.toContain("う".repeat(FIELD_AI_CLIP_CHARS + 1));
    expect(text.split(AI_CONTEXT_CLIP_MARK).length - 1).toBe(2);
  });
  it("上限以内の欄は印も付けず、そのまま出す", () => {
    const text = buildPersonalOkrAiContextText(baseInput({ criteria: "短い達成基準" }));
    expect(text).toContain("短い達成基準");
    expect(text).not.toContain(AI_CONTEXT_CLIP_MARK);
  });
  it("総量が8000字を超える入力でも、全体は上限＋印の範囲に収まる", () => {
    const long = "え".repeat(FIELD_AI_CLIP_CHARS);
    const text = buildPersonalOkrAiContextText(baseInput({
      category: long, activity: long, strengthRole: long, weaknessRole: long, criteria: long, supplement: long,
      positioning: long, activities: long, targetAndEvidence: long, risks: long,
      recentMemos: ["メモ".repeat(100)],
    }));
    expect(text.length).toBeLessThanOrEqual(AI_CONTEXT_TOTAL_CHAR_LIMIT + AI_CONTEXT_CLIP_MARK.length);
    expect(text.endsWith(AI_CONTEXT_CLIP_MARK)).toBe(true);
  });
});

// ===== M58 =====
describe("M58：AI相談の送信失敗でユーザーのターンを巻き戻す", () => {
  const turn = (role: "user" | "assistant", content: string) => ({ role, content, timestamp: "2026-10-23T00:00:00Z" });
  it("末尾がuserターンなら取り除く", () => {
    const s = addTurn(addTurn(createSession(), turn("user", "q1")), turn("assistant", "a1"));
    const withUser = addTurn(s, turn("user", "q2"));
    expect(rollbackLastUserTurn(withUser).turns.map(t => t.content)).toEqual(["q1", "a1"]);
  });
  it("末尾がassistantなら何もしない（返答済みのターンを消さない）", () => {
    const s = addTurn(addTurn(createSession(), turn("user", "q1")), turn("assistant", "a1"));
    expect(rollbackLastUserTurn(s)).toBe(s);
  });
  it("空のセッションは何もしない", () => {
    const s = createSession();
    expect(rollbackLastUserTurn(s)).toBe(s);
  });
  it("巻き戻しでターン数が減れば tokenWarning も再計算される", () => {
    let s = createSession();
    for (let i = 0; i < MAX_TURNS_WARNING; i++) s = addTurn(s, turn(i % 2 === 0 ? "user" : "assistant", `t${i}`));
    s = addTurn(s, turn("user", "last"));
    expect(s.tokenWarning).toBe(true);
    expect(rollbackLastUserTurn(s).tokenWarning).toBe(false);
  });
});

// ===== M56 =====
describe("M56：下書きへの数値評価の混入を検出する", () => {
  it("[自己評価：70%] 形式を拾う", () => {
    expect(detectNumericEvaluation(["進捗は順調だった。[自己評価：70%]"])).toHaveLength(1);
    expect(detectNumericEvaluation(["【自己評価：△】"])).toHaveLength(1);
  });
  it("評価語の近くの◯%（自己評価・実績・達成度）を拾う", () => {
    expect(detectNumericEvaluation(["自己評価は80%とする"]).length).toBeGreaterThan(0);
    expect(detectNumericEvaluation(["実績70%で着地した"]).length).toBeGreaterThan(0);
    expect(detectNumericEvaluation(["達成度は100％"]).length).toBeGreaterThan(0);
    expect(detectNumericEvaluation(["バンド70を狙う"]).length).toBeGreaterThan(0);
  });
  it("評価と無関係な数値（売上10%増・3件）は拾わない", () => {
    expect(detectNumericEvaluation(["売上を10%増やす施策を3件実施した。"])).toEqual([]);
    expect(detectNumericEvaluation(["◯達成・△一部の週があった"])).toEqual([]);
  });
  it("複数の文章を渡せる・重複は1件にまとめる", () => {
    const r = detectNumericEvaluation(["[自己評価：70%]", "[自己評価：70%]", "実績50%"]);
    expect(r).toHaveLength(2);
  });
  it("警告文は混入があるときだけ返す（自動では消さない＝文面を返すだけ）", () => {
    expect(buildNumericEvalWarning(["問題のない本文"])).toBeNull();
    expect(buildNumericEvalWarning(["[自己評価：70%]"])).toContain("[自己評価：70%]");
  });
});

// ===== M62 =====
describe("M62：生成直後・未編集・未反映の下書きも閉じるときに確認する", () => {
  it("下書きがあり、まだ反映していなければ確認対象（編集していなくても）", () => {
    expect(hasUnappliedDraftText(true, "生成された本文", null)).toBe(true);
  });
  it("反映済みの本文と同じなら確認しない", () => {
    expect(hasUnappliedDraftText(true, "本文", "本文")).toBe(false);
  });
  it("反映後にさらに編集したら確認する", () => {
    expect(hasUnappliedDraftText(true, "本文＋追記", "本文")).toBe(true);
  });
  it("下書きが無い・空文字なら確認しない", () => {
    expect(hasUnappliedDraftText(false, "x", null)).toBe(false);
    expect(hasUnappliedDraftText(true, "  ", null)).toBe(false);
  });
  it("複数欄版：どれかの欄に内容があり未反映なら確認する", () => {
    const keys = ["a", "b"] as const;
    const f = { a: "あ", b: "" };
    expect(hasUnappliedDraftFields(true, f, null, keys)).toBe(true);
    expect(hasUnappliedDraftFields(true, f, { a: "あ", b: "" }, keys)).toBe(false);
    expect(hasUnappliedDraftFields(false, f, null, keys)).toBe(false);
  });
});

// ===== M63・M64 =====
const BASE = {
  fiscalYear: 2026, quarter: "3Q" as const, memberId: "m1", groupId: "g1", sourceLabel: "取込", nowIso: "2026-10-23T00:00:00.000Z",
};
function krDraft(over: Partial<ImportKrDraftInput> = {}): ImportKrDraftInput {
  return {
    checked: true, mappedExistingId: "kr-1", newId: "new-kr", krKind: "general", keyResultId: null, taskForceId: null,
    label: "KR1", weightPct: null, category: null, activity: null, strengthRole: null, weaknessRole: null,
    criteria: null, supplement: null, months: [], ...over,
  };
}
const existingKr: PersonalKr = {
  id: "kr-1", member_id: "m1", group_id: "g1", fiscal_year: 2026, quarter: "3Q", kr_kind: "general", label: "KR1",
  weight_pct: 35, category: "既存カテゴリ", activity: "既存活動", strength_role: "既存強み", weakness_role: "既存弱み",
  criteria: "既存の達成基準", supplement: "既存補足", display_order: 2, is_deleted: false,
};

describe("M63：既存KRへの対応づけでは空欄の項目は既存値を保つ", () => {
  it("ウェイトが空欄でも0にならず既存の35を保つ", () => {
    const plan = buildImportApplyPlan({ ...BASE, drafts: [krDraft()], existingKrsById: { "kr-1": existingKr }, existingMonthsByKrIdAndIndex: {}, nextDisplayOrderStart: 3 });
    expect(plan.krs[0].weight_pct).toBe(35);
  });
  it("カテゴリ・活動・強み弱み・達成基準・補足が空欄でも既存値を保つ", () => {
    const plan = buildImportApplyPlan({ ...BASE, drafts: [krDraft()], existingKrsById: { "kr-1": existingKr }, existingMonthsByKrIdAndIndex: {}, nextDisplayOrderStart: 3 });
    const kr = plan.krs[0];
    expect([kr.category, kr.activity, kr.strength_role, kr.weakness_role, kr.criteria, kr.supplement])
      .toEqual(["既存カテゴリ", "既存活動", "既存強み", "既存弱み", "既存の達成基準", "既存補足"]);
  });
  it("入力があればそれを使う（確認画面で直した値は反映される）", () => {
    const plan = buildImportApplyPlan({ ...BASE, drafts: [krDraft({ weightPct: 50, criteria: "新しい基準" })], existingKrsById: { "kr-1": existingKr }, existingMonthsByKrIdAndIndex: {}, nextDisplayOrderStart: 3 });
    expect(plan.krs[0].weight_pct).toBe(50);
    expect(plan.krs[0].criteria).toBe("新しい基準");
  });
  it("新規KRは空欄ならウェイト0・他はnull（従来どおり）", () => {
    const plan = buildImportApplyPlan({ ...BASE, drafts: [krDraft({ mappedExistingId: null })], existingKrsById: {}, existingMonthsByKrIdAndIndex: {}, nextDisplayOrderStart: 3 });
    expect(plan.krs[0].weight_pct).toBe(0);
    expect(plan.krs[0].criteria).toBeNull();
  });
  it("既存の月に対応づけたとき、月側の空欄も既存値を保つ", () => {
    const existingMonth: PersonalKrMonth = {
      id: "mo-1", personal_kr_id: "kr-1", month: "2026-07-01", month_index: 1, positioning: "既存の位置づけ",
      review_text: "既存の振り返り", self_eval_pct: 70, is_deleted: false,
    };
    const m: ImportMonthDraftInput = {
      checked: true, monthIndex: 1, newId: "n", positioning: null, activities: null, targetAndEvidence: null, risks: null,
      bandTarget: null, weightOverridePct: null, reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null,
    };
    const plan = buildImportApplyPlan({ ...BASE, drafts: [krDraft({ months: [m] })], existingKrsById: { "kr-1": existingKr }, existingMonthsByKrIdAndIndex: { "kr-1": { 1: existingMonth } }, nextDisplayOrderStart: 3 });
    expect(plan.months[0].positioning).toBe("既存の位置づけ");
    expect(plan.months[0].review_text).toBe("既存の振り返り");
    expect(plan.months[0].self_eval_pct).toBe(70);
  });
});

describe("M64：新規KRの display_order 開始値は初回実行時に固定する", () => {
  it("初回は現在の件数で固定し、再実行で件数が増えても同じ値を返す", () => {
    const first = lockDisplayOrderStart(null, "2026:3Q", 3);
    expect(first.value).toBe(3);
    const second = lockDisplayOrderStart(first, "2026:3Q", 5); // 1回目に2件保存済みで件数が増えた
    expect(second.value).toBe(3);
  });
  it("年度・四半期を変えたら取り直す", () => {
    const first = lockDisplayOrderStart(null, "2026:3Q", 3);
    expect(lockDisplayOrderStart(first, "2026:4Q", 7).value).toBe(7);
  });
  it("固定した開始値から連番になる（再実行でも保存済みKRの並びは同じ）", () => {
    const drafts = [krDraft({ mappedExistingId: null, newId: "a", label: "A" }), krDraft({ mappedExistingId: null, newId: "b", label: "B" })];
    const run = (start: number) => buildImportApplyPlan({ ...BASE, drafts, existingKrsById: {}, existingMonthsByKrIdAndIndex: {}, nextDisplayOrderStart: start }).krs.map(k => k.display_order);
    const lock = lockDisplayOrderStart(null, "k", 3);
    expect(run(lock.value)).toEqual([3, 4]);
    expect(run(lockDisplayOrderStart(lock, "k", 5).value)).toEqual([3, 4]);
  });
});

// ===== M55 =====
describe("M55：保存失敗を値で返し、例外にしない", () => {
  it("成功ならsaved:true", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    expect(await persistGeneratedRow(insert, { id: "r" })).toEqual({ saved: true });
    expect(insert).toHaveBeenCalledWith({ id: "r" });
  });
  it("INSERTが失敗してもrejectせず、エラーを返す", async () => {
    const err = new Error("boom");
    const r = await persistGeneratedRow(vi.fn().mockRejectedValue(err), { id: "r" });
    expect(r).toEqual({ saved: false, error: err });
  });
});

// ===== M61 =====
describe("M61：全体タブの取得エラーを種類で分ける", () => {
  it("テーブルが無い（42P01）・スキーマキャッシュに無い（PGRST205）は未適用", () => {
    expect(classifyPeriodReviewsLoadError(Object.assign(new Error('relation "personal_period_reviews" does not exist'), { code: "42P01" }))).toBe("not_applied");
    expect(classifyPeriodReviewsLoadError({ code: "PGRST205", message: "Could not find the table 'public.personal_period_reviews' in the schema cache" })).toBe("not_applied");
  });
  it("列が無い（42703・PGRST204）で対象テーブルの言及があれば未適用", () => {
    expect(classifyPeriodReviewsLoadError({ code: "42703", message: 'column personal_period_reviews.x does not exist' })).toBe("not_applied");
  });
  it("ネットワーク断・権限エラー・他テーブルの欠落は未適用ではない", () => {
    expect(classifyPeriodReviewsLoadError(new TypeError("Failed to fetch"))).toBe("other");
    expect(classifyPeriodReviewsLoadError({ code: "42501", message: "permission denied for table personal_period_reviews" })).toBe("other");
    expect(classifyPeriodReviewsLoadError({ code: "42P01", message: 'relation "other_table" does not exist' })).toBe("other");
    expect(classifyPeriodReviewsLoadError(null)).toBe("other");
  });
});

// ===== M65 =====
describe("M65：復帰時の再取得の部品", () => {
  const row = (id: string, updated_at: string) => ({ id, updated_at });
  it("取得結果を基準に、手元が新しい行だけ手元を採る", () => {
    const merged = mergeResyncRows(
      [row("a", "2026-10-23T01:00:00Z"), row("b", "2026-10-23T01:00:00Z")],
      [row("a", "2026-10-23T02:00:00Z"), row("b", "2026-10-23T00:00:00Z")],
    );
    expect(merged).toEqual([row("a", "2026-10-23T02:00:00Z"), row("b", "2026-10-23T01:00:00Z")]);
  });
  it("取得結果に無い手元だけの行は捨てる（別端末で削除された行を残さない）", () => {
    expect(mergeResyncRows([row("a", "2026-10-23T01:00:00Z")], [row("a", "2026-10-23T01:00:00Z"), row("gone", "2026-10-23T01:00:00Z")]).map(r => r.id)).toEqual(["a"]);
  });
  it("登録された再取得を要求できる・未登録なら何も起きない", () => {
    setPersonalOkrResyncHandler(null);
    expect(() => requestPersonalOkrResync()).not.toThrow();
    const fn = vi.fn();
    setPersonalOkrResyncHandler(fn);
    requestPersonalOkrResync();
    expect(fn).toHaveBeenCalledTimes(1);
    setPersonalOkrResyncHandler(null);
  });
});

// ===== M66 =====
describe("M66：保存の競合時に該当行だけ取り直す", () => {
  it("ConflictErrorなら最新の行を取り直してapplyし、利用者向けの文言のエラーを返す", async () => {
    const apply = vi.fn();
    const latest = { id: "r1", is_deleted: false, v: "他の人の内容" };
    const e = await resolveSaveConflict(new ConflictError("personal_kr_months", "r1"), async () => latest, apply);
    expect(apply).toHaveBeenCalledWith(latest);
    expect(e).toBeInstanceOf(PersonalOkrConflictError);
    expect(e).toBeInstanceOf(ConflictError);
    expect((e as Error).message).toBe(CONFLICT_REFRESHED_MESSAGE);
  });
  it("ConflictError以外はそのまま返し、取り直さない", async () => {
    const fetchLatest = vi.fn();
    const orig = new Error("network");
    expect(await resolveSaveConflict(orig, fetchLatest, vi.fn())).toBe(orig);
    expect(fetchLatest).not.toHaveBeenCalled();
  });
  it("取り直しに失敗しても競合の通知は出す（読み込めなかった案内に切り替える）", async () => {
    const apply = vi.fn();
    const e = await resolveSaveConflict(new ConflictError("t", "i"), async () => { throw new Error("offline"); }, apply);
    expect(apply).not.toHaveBeenCalled();
    expect((e as PersonalOkrConflictError).refreshed).toBe(false);
    expect((e as Error).message).not.toBe(CONFLICT_REFRESHED_MESSAGE);
  });
  it("論理削除済み・行なしならapplyしない", async () => {
    const apply = vi.fn();
    await resolveSaveConflict(new ConflictError("t", "i"), async () => ({ id: "i", is_deleted: true }), apply);
    await resolveSaveConflict(new ConflictError("t", "i"), async () => null, apply);
    expect(apply).not.toHaveBeenCalled();
  });
});

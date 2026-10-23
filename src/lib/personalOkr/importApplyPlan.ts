// src/lib/personalOkr/importApplyPlan.ts
//
// 【設計意図】🔴このファイルが「既存の週・メモを失わない」ことの本体保証
// Kintone取込の確認画面で人が確定した内容から、実際にupsertするPersonalKr[]・
// PersonalKrMonth[]の行を組み立てる純粋関数。副作用（Supabase呼び出し）は一切持たない
// ——呼び出し元（PersonalOkrImportModal）がこの関数の戻り値をそのまま
// usePersonalOkrUiStore.saveKr/saveMonthに渡すだけで登録が完了する。
//
// 【なぜ既存の週・メモが消えないか】
// personal_kr_weeks/personal_kr_memosは personal_kr_id（＝personal_krs.idそのもの）にしか
// 紐づいていない。既存KRに対応づけた（mappedExistingId）場合、この関数は必ず
// existingKrsById[mappedExistingId].id をそのままPersonalKr.idとして使い、新しいuuidを
// 発行しない。したがってupsert先の行はDB上の「同じ行」であり、その行にぶら下がる週・メモは
// 一切参照が変わらない（=孤立しない）。新規作成の場合だけ新しいuuid（newId）を使う。
// personal_kr_monthsも同様に、既存の月次計画行が見つかればそのidを再利用する（見つからない
// 場合だけ新規作成する。UNIQUE(personal_kr_id, month)制約の衝突を避けるため）。
//
// 【このファイルが「しないこと」】
// - 既存にあって抽出結果に無いKR・月の論理削除は一切行わない（checkedでないdraftは
//   結果に含めないだけで、既存行への削除操作は生成しない）
// - personal_kr_weeks/personal_kr_memos/personal_kr_week_tasksへの操作は一切生成しない
//   （このファイルの型定義にそもそも存在しない）

import type { PersonalKr, PersonalKrBand, PersonalKrKind, PersonalKrMonth, Quarter } from "../localData/types";
import { quarterMonthSlots, monthToDateStr } from "./quarterMonths";

export interface ImportMonthDraftInput {
  checked: boolean;
  monthIndex: 1 | 2 | 3;
  newId: string;
  positioning: string | null;
  activities: string | null;
  targetAndEvidence: string | null;
  risks: string | null;
  bandTarget: PersonalKrBand | null;
  weightOverridePct: number | null;
  reviewText: string | null;
  selfEvalPct: number | null;
  gmEvalPct: number | null;
  gmComment: string | null;
}

export interface ImportKrDraftInput {
  checked: boolean;
  /** null = 新規KRとして作成。既存personal_krs.idが入っていれば「対応づけ」=更新 */
  mappedExistingId: string | null;
  newId: string;
  krKind: PersonalKrKind;
  keyResultId: string | null;
  taskForceId: string | null;
  label: string;
  /** null＝確認画面で空欄。既存KRに対応づけたときは既存値を保つ（M63）。新規KRなら0 */
  weightPct: number | null;
  category: string | null;
  activity: string | null;
  strengthRole: string | null;
  weaknessRole: string | null;
  criteria: string | null;
  supplement: string | null;
  months: ImportMonthDraftInput[];
}

export interface BuildImportApplyPlanParams {
  fiscalYear: number;
  quarter: Quarter;
  memberId: string;
  groupId: string;
  sourceLabel: string;
  nowIso: string;
  drafts: ImportKrDraftInput[];
  /** mappedExistingIdで参照される既存personal_krsの実体（display_order/created_at/group_idの保持に使う） */
  existingKrsById: Record<string, PersonalKr>;
  /** 既存personal_kr_months。krId→month_index→既存行（idの再利用・band_override等の保持に使う） */
  existingMonthsByKrIdAndIndex: Record<string, Partial<Record<1 | 2 | 3, PersonalKrMonth>>>;
  /** 新規KRの display_order の開始値（既存KR件数）。新規KRは登場順にこの値から連番を振る */
  nextDisplayOrderStart: number;
}

export interface ImportApplyPlan {
  krs: PersonalKr[];
  months: PersonalKrMonth[];
}

export function buildImportApplyPlan(params: BuildImportApplyPlanParams): ImportApplyPlan {
  const krs: PersonalKr[] = [];
  const months: PersonalKrMonth[] = [];
  const monthSlots = quarterMonthSlots(params.fiscalYear, params.quarter);
  let newOrderOffset = 0;

  for (const d of params.drafts) {
    if (!d.checked) continue;
    const existingKr = d.mappedExistingId ? params.existingKrsById[d.mappedExistingId] ?? null : null;
    const krId = existingKr ? existingKr.id : d.newId;

    const kr: PersonalKr = {
      id: krId,
      member_id: params.memberId,
      group_id: existingKr?.group_id ?? params.groupId,
      fiscal_year: params.fiscalYear,
      quarter: params.quarter,
      kr_kind: d.krKind,
      key_result_id: d.krKind === "group_kr" ? d.keyResultId : null,
      task_force_id: d.krKind === "group_kr" ? d.taskForceId : null,
      label: d.label,
      // 🔴 M63：既存KRに対応づけたとき、確認画面で空欄の項目は既存値を保つ。月次振返りPDFのように
      // KR側の項目を持たない資料を対応づけても、ウェイトが0になる・活動や達成基準が消えることを防ぐ
      weight_pct: d.weightPct ?? existingKr?.weight_pct ?? 0,
      category: d.category ?? existingKr?.category ?? null,
      activity: d.activity ?? existingKr?.activity ?? null,
      strength_role: d.strengthRole ?? existingKr?.strength_role ?? null,
      weakness_role: d.weaknessRole ?? existingKr?.weakness_role ?? null,
      criteria: d.criteria ?? existingKr?.criteria ?? null,
      supplement: d.supplement ?? existingKr?.supplement ?? null,
      display_order: existingKr ? existingKr.display_order : params.nextDisplayOrderStart + newOrderOffset++,
      imported_at: params.nowIso,
      source_label: params.sourceLabel,
      is_deleted: false,
      created_at: existingKr?.created_at ?? params.nowIso,
      updated_by: params.memberId,
    };
    krs.push(kr);

    for (const m of d.months) {
      if (!m.checked) continue;
      const existingMonth = params.existingMonthsByKrIdAndIndex[krId]?.[m.monthIndex] ?? null;
      const slot = monthSlots.find(s => s.monthIndex === m.monthIndex);
      if (!slot) continue; // 想定外のmonthIndexは無視（1〜3のみ許可されるUIから来る前提）
      const month: PersonalKrMonth = {
        id: existingMonth ? existingMonth.id : m.newId,
        personal_kr_id: krId,
        month: monthToDateStr(slot.monthStart),
        month_index: m.monthIndex,
        // 既存の月に対応づけるときは月側の項目も同じ扱い（空欄は既存値を保つ。M63）
        positioning: m.positioning ?? existingMonth?.positioning ?? null,
        activities: m.activities ?? existingMonth?.activities ?? null,
        target_and_evidence: m.targetAndEvidence ?? existingMonth?.target_and_evidence ?? null,
        risks: m.risks ?? existingMonth?.risks ?? null,
        band_target: m.bandTarget ?? existingMonth?.band_target ?? null,
        // 人が既に決めたband_overrideは取込で上書き・消去しない（既存値をそのまま保持する）
        band_override: existingMonth?.band_override ?? null,
        band_override_by: existingMonth?.band_override_by ?? null,
        band_override_at: existingMonth?.band_override_at ?? null,
        weight_override_pct: m.weightOverridePct ?? existingMonth?.weight_override_pct ?? null,
        review_text: m.reviewText ?? existingMonth?.review_text ?? null,
        self_eval_pct: m.selfEvalPct ?? existingMonth?.self_eval_pct ?? null,
        gm_eval_pct: m.gmEvalPct ?? existingMonth?.gm_eval_pct ?? null,
        gm_comment: m.gmComment ?? existingMonth?.gm_comment ?? null,
        imported_at: params.nowIso,
        source_label: params.sourceLabel,
        is_deleted: false,
        created_at: existingMonth?.created_at ?? params.nowIso,
        updated_by: params.memberId,
      };
      months.push(month);
    }
  }

  return { krs, months };
}

/**
 * 登録前に「月次計画まで読み込めていること」を確かめる。
 * ensureKrDetailLoaded は取得に失敗しても例外を投げずに detailError を立てるだけなので、
 * 呼び出し側が await しただけで安心すると、既存KRの月次計画が空に見えたまま登録を進めてしまう
 * （既存月の id と band_override を引き継げず、UNIQUE(personal_kr_id, month) 違反や
 * 人が決めたバンドの消去につながる）。読み込めていない KR の id を返す。
 */
export function unloadedKrIds(targetIds: readonly string[], loadedIds: ReadonlySet<string>): string[] {
  return targetIds.filter(id => !loadedIds.has(id));
}

export interface DisplayOrderStartLock {
  key: string;
  value: number;
}

/**
 * 新規KRの display_order の開始値を、登録の初回実行時に固定する（M64）。
 * 登録が途中で失敗して再実行すると、保存済みの新規KRが「既存KR件数」に加わって開始値が増え、
 * 保存済みKRの並びが後ろへずれる。同じ key（年度・四半期）の間は最初の値を使い続ける。
 */
export function lockDisplayOrderStart(
  lock: DisplayOrderStartLock | null, key: string, currentExistingCount: number,
): DisplayOrderStartLock {
  return lock && lock.key === key ? lock : { key, value: currentExistingCount };
}

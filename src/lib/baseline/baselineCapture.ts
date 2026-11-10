// src/lib/baseline/baselineCapture.ts
//
// 【設計意図】
// タスクのベースライン（当初計画）記録（B4）。捕捉タイミングは
// 「start_date・due_date が初めて両方揃った時点」の1回のみ。一度セットされたら
// 二度と自動上書きしない（日付をクリアしても凍結値は残る）。
// 例外（v3.207）：期限前の延長は計画変更扱いで引き直す（resolveBaselineOnSave）。
// appStore.saveTask（唯一の choke point）から呼ぶことで、インライン編集・モーダル・
// カンバン・AI提案反映など全経路で同じ挙動になる。

import type { Task } from "../localData/types";

export interface BaselineDates {
  baseline_start_date: string | null;
  baseline_due_date: string | null;
}

/**
 * 保存しようとしているタスクの baseline_start_date / baseline_due_date を解決する。
 *
 * - 既にベースラインが凍結済み（既存タスクの baseline_start_date・baseline_due_date が
 *   両方セット済み）なら、その値をそのまま返す（candidate側の値は一切見ない＝上書き禁止）。
 * - まだ未凍結で、candidate（保存しようとしている値）の start_date・due_date が
 *   両方揃っていれば、それを新しいベースラインとして凍結する。
 * - まだ未凍結で、片方または両方が未設定なら null のまま（凍結しない）。
 */
export function resolveBaselineFields(
  existing: Pick<Task, "baseline_start_date" | "baseline_due_date"> | undefined,
  candidate: Pick<Task, "start_date" | "due_date">,
): BaselineDates {
  const frozenStart = existing?.baseline_start_date ?? null;
  const frozenDue = existing?.baseline_due_date ?? null;
  if (frozenStart && frozenDue) {
    return { baseline_start_date: frozenStart, baseline_due_date: frozenDue };
  }
  if (candidate.start_date && candidate.due_date) {
    return { baseline_start_date: candidate.start_date, baseline_due_date: candidate.due_date };
  }
  return { baseline_start_date: null, baseline_due_date: null };
}

/**
 * 期限前の延長で当初計画を引き直した記録（v3.207）。元に戻す（Undo）で日付が延長前に戻ったとき、
 * ベースラインも引き直す前へ戻すために使う。appStore がタスクごとに積む（セッション内のみ）。
 */
export interface RebaselineRecord {
  prevStart: string | null;
  prevDue: string;
  prevBaseline: BaselineDates;
  newBaseline: BaselineDates;
}

export interface BaselineOnSaveResult {
  fields: BaselineDates;
  /** push＝引き直した（record を積む）／pop＝Undo で引き直す前へ戻した／none＝記録は変えない */
  record: { kind: "push"; value: RebaselineRecord } | { kind: "pop" } | { kind: "none" };
}

/**
 * 保存時のベースライン解決（v3.207）。resolveBaselineFields（初回凍結）に次の2つを足す。
 * - 期限前の延長は計画変更扱い：凍結済み・期日が後ろへ延びる・更新前の期日が今日以降（期限切れでない）
 *   なら、ベースラインを更新後の開始日／期日に揃える。期限切れ後の延長・前倒し・期日以外の変更は据え置き。
 * - 直近の引き直し（lastRecord）の直後に、日付が延長前へ戻されたら（Undo 等）ベースラインも戻す。
 * today はアプリの期限切れ判定と同じローカル日付（todayStr）の YYYY-MM-DD。
 */
export function resolveBaselineOnSave(
  existing: Pick<Task, "start_date" | "due_date" | "baseline_start_date" | "baseline_due_date"> | undefined,
  candidate: Pick<Task, "start_date" | "due_date">,
  today: string,
  lastRecord?: RebaselineRecord,
): BaselineOnSaveResult {
  const fields = resolveBaselineFields(existing, candidate);
  const frozenStart = existing?.baseline_start_date ?? null;
  const frozenDue = existing?.baseline_due_date ?? null;
  if (!existing || !frozenStart || !frozenDue) return { fields, record: { kind: "none" } };

  if (
    lastRecord
    && lastRecord.newBaseline.baseline_start_date === frozenStart
    && lastRecord.newBaseline.baseline_due_date === frozenDue
    && (candidate.start_date ?? null) === lastRecord.prevStart
    && (candidate.due_date ?? null) === lastRecord.prevDue
  ) {
    return { fields: { ...lastRecord.prevBaseline }, record: { kind: "pop" } };
  }

  const oldDue = existing.due_date ?? null;
  const newDue = candidate.due_date ?? null;
  if (oldDue && newDue && newDue > oldDue && oldDue >= today) {
    const next: BaselineDates = { baseline_start_date: candidate.start_date ?? frozenStart, baseline_due_date: newDue };
    if (next.baseline_start_date === frozenStart && next.baseline_due_date === frozenDue) {
      return { fields, record: { kind: "none" } };
    }
    return {
      fields: next,
      record: {
        kind: "push",
        value: {
          prevStart: existing.start_date ?? null,
          prevDue: oldDue,
          prevBaseline: { baseline_start_date: frozenStart, baseline_due_date: frozenDue },
          newBaseline: next,
        },
      },
    };
  }
  return { fields, record: { kind: "none" } };
}

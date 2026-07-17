// src/lib/baseline/baselineCapture.ts
//
// 【設計意図】
// タスクのベースライン（当初計画）記録（B4）。捕捉タイミングは
// 「start_date・due_date が初めて両方揃った時点」の1回のみ。一度セットされたら
// 二度と自動上書きしない（日付をクリアしても凍結値は残る）。
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

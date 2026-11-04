// src/lib/dependencies/violation.ts
//
// 【設計意図・v3.200】依存の日付矛盾の検出（ガントの矢印を赤くするための純粋関数）。
// 制約の式は reschedule.ts と同一（暦日・負ラグ＝リード）：
//   FS＝先行.due+lag <= 後続.start／SS＝先行.start+lag <= 後続.start／
//   FF＝先行.due+lag <= 後続.due／SF＝先行.start+lag <= 後続.due。
// 検出しないもの：基準側・制約側の日付が欠けている依存、後続が完了・中止のもの
// （reschedule.ts が自動で動かさない対象＝終わった仕事の過去の並びを矛盾として騒がない）。

import type { Task, TaskDependency } from "../localData/types";
import { addDays, diffDays, toDate, toDateStr } from "../date";
import { depTypeOf, lagOf, predecessorAnchor, successorAnchor } from "./depType";

export interface DependencyViolation {
  /** 制約を満たすまでに足りない日数（暦日・1以上） */
  shortfallDays: number;
  /** ツールチップ用の理由 */
  message: string;
}

type TaskLike = Pick<Task, "name" | "status" | "start_date" | "due_date">;

export function findDependencyViolation(
  dep: Pick<TaskDependency, "dep_type" | "lag_days">,
  pred: TaskLike | undefined,
  succ: TaskLike | undefined,
): DependencyViolation | null {
  if (!pred || !succ) return null;
  if (succ.status === "done" || succ.status === "cancelled") return null;
  const type = depTypeOf(dep);
  const lag = lagOf(dep);
  const predAnchor = predecessorAnchor(type);
  const succAnchor = successorAnchor(type);
  const base = predAnchor === "start" ? pred.start_date : pred.due_date;
  const own = succAnchor === "start" ? succ.start_date : succ.due_date;
  if (!base || !own) return null;
  const baseDate = toDate(base);
  if (!baseDate) return null;
  const required = toDateStr(addDays(baseDate, lag));
  if (required <= own) return null;
  const shortfallDays = diffDays(own, required);
  const lagText = lag > 0 ? `＋${lag}日` : lag < 0 ? `${lag}日` : "";
  const predWord = predAnchor === "start" ? "開始" : "完了";
  const succWord = succAnchor === "start" ? "開始" : "完了";
  return {
    shortfallDays,
    message: `「${pred.name}」の${predWord}${lagText}より前に${succWord}しています（${shortfallDays}日不足）`,
  };
}

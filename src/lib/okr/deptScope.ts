// src/lib/okr/deptScope.ts
//
// 【設計意図】
// objectives.group_id 導入（2026-07-23）に伴う、OKR系（Objective/KR/TF）の部署スコープ
// 絞り込みを一元化する純粋関数。KR/TFはgroup_id列を持たず、Objective経由で部署を継承する
// （KR: objective_id → Objective.group_id／TF: kr_id → KR → Objective.group_id）。
//
// 【今回はUIの絞り込みのみ】OKR系テーブルはRLSで部署分離されていない（全ユーザーが
// 全部署のobjectives/key_results/task_forcesを受け取る。CLAUDE.md Section 1.6参照）。
// そのためsuper-admin/非super-adminの分岐は不要＝誰でも同じ関数で絞り込めばよい
// （appStore.tsのselectScopedTasks等とはこの点で設計が異なる）。
//
// 【DEFAULT_OKR_GROUP_ID について】
// 既存Objectiveはマイグレーションで全てgrp-eggへバックフィル済みのため、通常運用下で
// group_idがnullになることは無い。コードデプロイとマイグレーション適用の間の窓（デプロイ
// 順序次第で発生しうる。CLAUDE.md記載の教訓参照）でnullなObjectiveに遭遇した場合に
// 備えた安全網として、nullはgrp-egg扱いにフォールバックする。

import type { Objective, KeyResult, TaskForce } from "../localData/types";

export const DEFAULT_OKR_GROUP_ID = "grp-egg";

function objectiveGroupId(o: Objective): string {
  return o.group_id ?? DEFAULT_OKR_GROUP_ID;
}

/** 指定部署に属するObjectiveだけを返す（groupId未確定=nullなら空配列） */
export function objectivesInGroup(objectives: Objective[], groupId: string | null): Objective[] {
  if (!groupId) return [];
  return objectives.filter(o => objectiveGroupId(o) === groupId);
}

/**
 * 指定部署の「現在のObjective」を1件返す。
 * is_current な行を優先し、無ければ配下の先頭、それも無ければ null。
 */
export function pickCurrentObjectiveForGroup(objectives: Objective[], groupId: string | null): Objective | null {
  const inGroup = objectivesInGroup(objectives, groupId);
  return inGroup.find(o => o.is_current) ?? inGroup[0] ?? null;
}

/** 指定部署配下（＝その部署のObjectiveのいずれかにぶら下がる）のKRだけを返す */
export function keyResultsInGroup(
  keyResults: KeyResult[], objectives: Objective[], groupId: string | null,
): KeyResult[] {
  const objIds = new Set(objectivesInGroup(objectives, groupId).map(o => o.id));
  return keyResults.filter(kr => objIds.has(kr.objective_id));
}

/** 指定部署配下（＝その部署のKRのいずれかにぶら下がる）のTFだけを返す */
export function taskForcesInGroup(
  taskForces: TaskForce[], keyResults: KeyResult[], objectives: Objective[], groupId: string | null,
): TaskForce[] {
  const krIds = new Set(keyResultsInGroup(keyResults, objectives, groupId).map(k => k.id));
  return taskForces.filter(tf => krIds.has(tf.kr_id));
}

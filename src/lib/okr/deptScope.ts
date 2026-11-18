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
//
// 【QuarterlyObjectiveについて（2026-07-23追加）】
// quarterly_objectives.group_id追加（20260723c）に伴い、objectivesInGroup等と同型の
// 絞り込み関数を用意する。ただし【重要】QuarterlyObjective/QuarterlyKrTaskForceは
// 2026-05-26のTF四半期判定モデル移行（→TaskForce.quarter列）以降どの画面からも
// 表示されない死蔵データ（docs/REFACTORING.md M24）。以下の関数は将来の再設計に
// 備えた土台のみで、現状呼び出し元は無い。

import type { Objective, KeyResult, TaskForce, QuarterlyObjective, Quarter } from "../localData/types";

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

// ---------- 「今の期」の KR・TF（v3.218） ----------
// 部署の今の期＝is_current の Objective（pickCurrentObjectiveForGroup）を唯一の基準にする。
// 一覧・選択肢はここの関数を通す（コンポーネントごとに判定を書かない）。前の期は消さず、
// 履歴の画面は previous* で別見出しにする。keepIds は「既にその行に紐づいている KR／TF」で、
// 前の期でも選択肢・ラベルから消さないために渡す（紐づけを壊さない）。

/** 今の期の Objective の KR だけ（keepKrIds に含まれる KR は前の期でも残す） */
export function currentKeyResultsInGroup(
  keyResults: KeyResult[], objectives: Objective[], groupId: string | null, keepKrIds: Iterable<string> = [],
): KeyResult[] {
  const cur = pickCurrentObjectiveForGroup(objectives, groupId);
  const keep = new Set(keepKrIds);
  return keyResults.filter(kr => (cur !== null && kr.objective_id === cur.id) || keep.has(kr.id));
}

/** 今の期の KR の下の TF だけ（keepTfIds に含まれる TF は前の期でも残す） */
export function currentTaskForcesInGroup(
  taskForces: TaskForce[], keyResults: KeyResult[], objectives: Objective[], groupId: string | null,
  keepTfIds: Iterable<string> = [],
): TaskForce[] {
  const krIds = new Set(currentKeyResultsInGroup(keyResults, objectives, groupId).map(k => k.id));
  const keep = new Set(keepTfIds);
  return taskForces.filter(tf => krIds.has(tf.kr_id) || keep.has(tf.id));
}

/** 同じ部署の、今の期ではない Objective の KR（履歴の見出し用） */
export function previousKeyResultsInGroup(
  keyResults: KeyResult[], objectives: Objective[], groupId: string | null,
): KeyResult[] {
  const cur = pickCurrentObjectiveForGroup(objectives, groupId);
  const prevIds = new Set(objectivesInGroup(objectives, groupId).filter(o => o.id !== cur?.id).map(o => o.id));
  return keyResults.filter(kr => prevIds.has(kr.objective_id));
}

/** 同じ部署の、前の期の KR の下の TF（履歴の見出し用） */
export function previousTaskForcesInGroup(
  taskForces: TaskForce[], keyResults: KeyResult[], objectives: Objective[], groupId: string | null,
): TaskForce[] {
  const krIds = new Set(previousKeyResultsInGroup(keyResults, objectives, groupId).map(k => k.id));
  return taskForces.filter(tf => krIds.has(tf.kr_id));
}

/** 前の期の Objective（新しいものが先。作成日の降順） */
export function previousObjectivesInGroup(objectives: Objective[], groupId: string | null): Objective[] {
  const cur = pickCurrentObjectiveForGroup(objectives, groupId);
  return objectivesInGroup(objectives, groupId)
    .filter(o => o.id !== cur?.id)
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

/** KR の ID から表示ラベル用の KR を引く（前の期の KR に紐づいた行でもラベルが消えない） */
export function findKeyResultForLabel(keyResults: KeyResult[], krId: string | null | undefined): KeyResult | null {
  return krId ? keyResults.find(k => k.id === krId) ?? null : null;
}

function quarterlyObjectiveGroupId(qo: QuarterlyObjective): string {
  return qo.group_id ?? DEFAULT_OKR_GROUP_ID;
}

/** 指定部署に属するQuarterlyObjectiveだけを返す（groupId未確定=nullなら空配列） */
export function quarterlyObjectivesInGroup(
  quarterlyObjectives: QuarterlyObjective[], groupId: string | null,
): QuarterlyObjective[] {
  if (!groupId) return [];
  return quarterlyObjectives.filter(qo => quarterlyObjectiveGroupId(qo) === groupId);
}

/** 指定部署×指定四半期のQuarterlyObjectiveだけを返す */
export function quarterlyObjectivesInGroupForQuarter(
  quarterlyObjectives: QuarterlyObjective[], groupId: string | null, quarter: Quarter,
): QuarterlyObjective[] {
  return quarterlyObjectivesInGroup(quarterlyObjectives, groupId).filter(qo => qo.quarter === quarter);
}

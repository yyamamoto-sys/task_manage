// src/lib/project/projectTaskForceLinks.ts
//
// 【設計意図】PJ↔TF紐づけ（project_task_forces）の差分計算とピッカー用グループ化を1箇所に集約する。
// 呼び出し元は2つ：AdminView（部署横断のPJ編集）と ProjectSettingsModal（PJの設定画面）。
// どちらも同じ applyProjectTaskForceLinks を使い、重複実装しない。
//
// 【今期外の紐づけを消さない】設定画面のピッカーは今期のTFだけを出す。出ていないTFの紐づけ
// （過去期・来期の既存リンク）は「選ばれていない」のではなく「選択肢に無い」だけなので、
// managedTfIds（ピッカーに出したTFのid）を渡すと、その範囲の増減だけを差分にする。
// managedTfIds 省略時は全件が対象（AdminView従来の挙動）。

import type { KeyResult, TaskForce, ProjectTaskForce } from "../localData/types";
import { effectiveTfQuarter } from "../okr/tfQuarter";
import { currentQuarter } from "../date";

export interface TfLinkDiff { toAdd: string[]; toRemove: string[] }

export function diffTfLinks(
  beforeTfIds: Iterable<string>,
  desiredTfIds: Iterable<string>,
  managedTfIds?: ReadonlySet<string>,
): TfLinkDiff {
  const before = new Set(beforeTfIds);
  const after = new Set(desiredTfIds);
  const inScope = (id: string) => !managedTfIds || managedTfIds.has(id);
  return {
    toAdd: [...after].filter(id => !before.has(id)),
    toRemove: [...before].filter(id => !after.has(id) && inScope(id)),
  };
}

export async function applyProjectTaskForceLinks(opts: {
  projectId: string;
  desiredTfIds: string[];
  existingLinks: ProjectTaskForce[];
  managedTfIds?: ReadonlySet<string>;
  add: (ptf: ProjectTaskForce) => Promise<void>;
  remove: (projectId: string, tfId: string) => Promise<void>;
}): Promise<void> {
  const before = opts.existingLinks.filter(p => p.project_id === opts.projectId).map(p => p.tf_id);
  const { toAdd, toRemove } = diffTfLinks(before, opts.desiredTfIds, opts.managedTfIds);
  await Promise.all([
    ...toAdd.map(tfId => opts.add({ project_id: opts.projectId, tf_id: tfId })),
    ...toRemove.map(tfId => opts.remove(opts.projectId, tfId)),
  ]);
}

export interface KrTfGroup {
  kr: KeyResult;
  /** 「KR1」のような表示用番号（keyResults 配列内の順） */
  krLabel: string;
  tfs: { tf: TaskForce; label: string }[];
}

/** 今期（削除済み除外）のTFをKRごとにまとめる。TFの無いKRは出さない。 */
export function buildCurrentQuarterKrTfGroups(
  keyResults: KeyResult[],
  taskForces: TaskForce[],
  quarter = currentQuarter(),
): KrTfGroup[] {
  const groups: KrTfGroup[] = [];
  keyResults.forEach((kr, idx) => {
    const tfs = taskForces
      .filter(tf => !tf.is_deleted && tf.kr_id === kr.id && effectiveTfQuarter(tf) === quarter)
      .slice()
      .sort((a, b) => (a.tf_number ?? "").localeCompare(b.tf_number ?? ""))
      .map(tf => ({ tf, label: `TF${idx + 1}-${tf.tf_number || "?"}` }));
    if (tfs.length > 0) groups.push({ kr, krLabel: `KR${idx + 1}`, tfs });
  });
  return groups;
}

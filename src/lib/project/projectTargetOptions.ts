// src/lib/project/projectTargetOptions.ts
//
// 【設計意図】
// 「対象PJ」プルダウン（AIパネル・ダッシュボード共通。components/common/ProjectTargetSelect.tsx）の
// 選択肢を作る純粋関数。アーカイブ済み・削除済みは選択肢に出さない（判定は ai/aiTarget.ts の
// isAiTargetProject が唯一の元）。完了PJは出すが「（完了）」と分かるようにする。

import type { Project } from "../localData/types";
import type { SelectOption } from "../../components/common/CustomSelect";
import { aiTargetPickerProjects } from "../ai/aiTarget";

/** 「すべてのPJ」を表す値（CustomSelect の value は文字列のため） */
export const ALL_PJ_VALUE = "";
/** ダッシュボードのKRクリックで複数PJに絞られている状態の表示専用の値 */
export const MULTI_PJ_VALUE = "__multi__";

export const ALL_PJ_LABEL = "すべてのPJ";

export function projectTargetLabel(p: Pick<Project, "name" | "status">): string {
  return p.status === "completed" ? `${p.name}（完了）` : p.name;
}

export function buildProjectTargetOptions(
  projects: Project[],
  opts: { multiCount?: number } = {},
): SelectOption[] {
  const options: SelectOption[] = [{ value: ALL_PJ_VALUE, label: ALL_PJ_LABEL }];
  if (opts.multiCount && opts.multiCount > 1) {
    options.push({ value: MULTI_PJ_VALUE, label: `KRで絞り込み中（${opts.multiCount}PJ）`, dim: true });
  }
  for (const p of aiTargetPickerProjects(projects)) {
    options.push({
      value: p.id,
      label: projectTargetLabel(p),
      color: p.color_tag,
      dim: p.status === "completed",
    });
  }
  return options;
}

/** 検索付きにする閾値。選択肢（「すべて」を除く）がこの件数を超えたら検索欄を出す */
export const PROJECT_TARGET_SEARCH_THRESHOLD = 8;

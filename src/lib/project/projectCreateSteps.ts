// src/lib/project/projectCreateSteps.ts
//
// 【設計意図】
// 「他PJから引き継ぐ」プロジェクト作成モーダルをステップ式に作り直すための状態遷移ロジック
// （山本さん確定仕様・2026-08-12・v3.59）。「今何ステップあるか」「次に進めるか」の判定を
// UIコンポーネント（ProjectCreateModal.tsx）から切り離し、純粋関数としてテストする。
//
// ステップは固定5種類のうち、モードに応じて一部を省く：
// - まっさらな新規作成：作成方法 → 名前をつけて作成（2ステップ）
// - 他PJから引き継ぐ：作成方法 → 日程の引き継ぎ方 → インポートタスク → インポートメンバー
//   → 名前をつけて作成（5ステップ）
//
// 【v3.59でのUI選択肢の変更】日程の引き継ぎ方は2択のみ（スケジュール間隔を引き継ぐ／
// 日付を引き継がない）。v3.58で既定にした「元PJの開始日を基準にする」は山本さんの指示で
// 撤去した（CLAUDE.md Section 8参照。旧dateSlide.ts互換の回帰テストは関数レベルでは残す）。

export type CreateMode = "blank" | "inherit";
export type DateStrategy = "keep_interval" | "no_dates";
export type StepId = "method" | "schedule" | "tasks" | "members" | "finalize";

const STEP_LABEL: Record<StepId, string> = {
  method: "作成方法・引継ぎ元PJ",
  schedule: "日程の引き継ぎ方",
  tasks: "インポートするタスク",
  members: "インポートするメンバー",
  finalize: "名前をつけて作成",
};

/** モードに応じたステップ列を返す。「まっさらな新規作成」は引き継ぎ関連の3ステップを飛ばす。 */
export function resolveSteps(mode: CreateMode): StepId[] {
  return mode === "blank"
    ? ["method", "finalize"]
    : ["method", "schedule", "tasks", "members", "finalize"];
}

export function stepLabel(step: StepId): string {
  return STEP_LABEL[step];
}

/**
 * 引き継ぎ元PJのマイルストーン有無から、日程の引き継ぎ方の既定を返す。
 * マイルストーンが1件も無いPJでは「スケジュール間隔を引き継ぐ」に必要な基準が
 * そもそも選べないため、既定は「日付を引き継がない」にする。
 */
export function defaultDateStrategy(hasOriginMilestones: boolean): DateStrategy {
  return hasOriginMilestones ? "keep_interval" : "no_dates";
}

export interface CanGoNextState {
  mode: CreateMode;
  originProjectId: string;
  dateStrategy: DateStrategy;
  anchorMilestoneId: string | null;
  newAnchorDate: string;
}

/**
 * 現在のステップの入力が揃っていて「次へ」に進められるかを判定する。
 * 最終ステップ（finalize）は「次へ」ボタンを持たない（「作成」ボタンの可否は
 * 別途 canSave 相当の判定に任せる）ため、常に true を返す。
 */
export function canGoNext(step: StepId, state: CanGoNextState): boolean {
  switch (step) {
    case "method":
      return state.mode === "blank" || !!state.originProjectId;
    case "schedule":
      if (state.dateStrategy === "no_dates") return true;
      return !!state.anchorMilestoneId && !!state.newAnchorDate;
    case "tasks":
    case "members":
    case "finalize":
      return true;
    default:
      return true;
  }
}

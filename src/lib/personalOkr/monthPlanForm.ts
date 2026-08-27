// src/lib/personalOkr/monthPlanForm.ts
//
// 【設計意図】
// 「今月の計画」ブロック（PersonalKrPanel.tsx内。positioning/activities/target_and_evidence/
// risks/band_target の4欄+バンド）のdirty判定を純粋関数として切り出す。
// monthReviewForm.ts（振り返りブロック）と同じ設計方針：Reactレンダリングテスト基盤が
// 無いため、ロジックはここでテストする。
//
// 🔴 v3.100（未保存編集の無言消失対策・CLAUDE.md Section 46）でunsavedEditorRegistryへの
// 登録用に新設した。これ以前、計画欄の保存ボタンはdirty判定を持たず常に活性だった
// （MonthReviewBlock.tsxのSaveボタンとは異なる挙動）。この関数はレジストリ登録のためだけに
// 使い、保存ボタンのdisabled制御自体は今回のスコープ外（別の変更として扱う）。

import type { PersonalKrBand } from "../localData/types";
import { parseEvalPctInput } from "./monthReviewForm";

export interface MonthPlanDraft {
  positioning: string;
  activities: string;
  targetAndEvidence: string;
  risks: string;
  bandTarget: PersonalKrBand | null;
  /** 【2026-08-26・v3.104】「今月のウェイト」欄（weight_override_pct）の文字列state。
   *  空欄なら四半期共通値（weight_pct）を使う。0〜100の数値入力バリデーションは
   *  monthReviewForm.tsのparseEvalPctInputを再利用する（判定ロジックを二重化しない）。 */
  weightOverrideRaw: string;
}

export interface MonthPlanSaved {
  positioning: string | null | undefined;
  activities: string | null | undefined;
  targetAndEvidence: string | null | undefined;
  risks: string | null | undefined;
  bandTarget: PersonalKrBand | null | undefined;
  weightOverridePct: number | null | undefined;
}

/** dirty判定（値比較）。文字列はnull/undefinedを""として正規化してから比較する。 */
export function computeMonthPlanDirty(current: MonthPlanDraft, saved: MonthPlanSaved): boolean {
  if (current.positioning !== (saved.positioning ?? "")) return true;
  if (current.activities !== (saved.activities ?? "")) return true;
  if (current.targetAndEvidence !== (saved.targetAndEvidence ?? "")) return true;
  if (current.risks !== (saved.risks ?? "")) return true;
  if (current.bandTarget !== (saved.bandTarget ?? null)) return true;
  // 🔴 無効な入力（範囲外・数値でない）もまだ保存できない変更としてdirty=trueにする
  // （monthReviewForm.tsのcomputeMonthReviewDirtyと同じ考え方。保存ボタンを押させて
  // エラー表示に導く）。
  const weightEval = parseEvalPctInput(current.weightOverrideRaw);
  if (weightEval.error) return true;
  if (weightEval.value !== (saved.weightOverridePct ?? null)) return true;
  return false;
}

// src/components/tour/tourStepGate.ts
//
// 「利用者が操作したら進む」ステップの進み方（純関数）。DOM は引数 exists で受け取る（テスト用）。
// 優先順位：advanceOn（目的の要素が現れた）＞ whileVisible（必要な要素が消えた）。
// 同じ瞬間に「パネルが閉じた」と「モーダルが開いた」が起きる場面（パネル内のボタンを押した直後）で、
// 進む側を勝たせるため。

import type { TourStep } from "./tours/types";

export type StepGateResult = "stay" | "advance" | "back" | "end";

export function evaluateStepGate(
  step: Pick<TourStep, "advanceOn" | "whileVisible">,
  exists: (tourId: string) => boolean,
): StepGateResult {
  if (step.advanceOn && exists(step.advanceOn.appears)) return "advance";
  if (step.whileVisible && !exists(step.whileVisible.id)) return step.whileVisible.onLost;
  return "stay";
}

/** 「次へ」「戻る」・キー操作で進めてはいけないステップか */
export function isGatedStep(step: Pick<TourStep, "advanceOn">): boolean {
  return !!step.advanceOn;
}

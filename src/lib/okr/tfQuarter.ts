// src/lib/okr/tfQuarter.ts
//
// 【設計意図】
// 「TF が属する四半期」を単一の真実（TaskForce.quarter 列）から判定する共通ヘルパー。
// 以前は quarterly_kr_task_forces(QKTF) でTF→Qを表現していたが、各所でJOINを
// 忘れて他Qのデータが混ざる事故が起きていた。これを tf.quarter ベースに統一する。
// KR は通期固定（変更しない）。変えるのは「TF→Qの割り当て」だけ。

import type { TaskForce, Quarter } from "../localData/types";
import { currentQuarter } from "../date";

/** TFが属する四半期。未設定(legacy/未割当)は現在の四半期として扱う */
export function effectiveTfQuarter(tf: TaskForce): Quarter {
  return tf.quarter ?? currentQuarter();
}

/** あるKRの、指定四半期(既定=今期)に属するTFだけを返す */
export function tfsForKr(tfs: TaskForce[], krId: string, quarter: Quarter = currentQuarter()): TaskForce[] {
  return tfs.filter(tf => tf.kr_id === krId && effectiveTfQuarter(tf) === quarter);
}

// src/lib/ai/analysisRun.ts
//
// 【設計意図・v3.184】PJ別AI分析（PJ単体・全PJポートフォリオ）の「返答の仕上げ」と「古い結果の判定」を
// 画面から切り出した純粋ロジック（巡回62回目・E PJ別AI分析）。
//   1. 返答が空なら、空のレポートを共有保存しない（エラーにする）
//   2. 出力の上限（max_tokens）で途中切れなら、完結したレポートに見えないよう注記を付ける
//      （マークダウンの文章なので破棄せず、課金済みの内容は残す。他の抽出系のJSONとは違い読める）
//   3. 全PJ分析の結果は、実行したときの範囲（表示部署・PJの集合）と今の範囲が同じときだけ見せる

export const TRUNCATED_ANALYSIS_NOTE =
  "※ AIの出力上限に達したため、ここで途切れています。「再分析」で作り直せます。";

export const EMPTY_ANALYSIS_MESSAGE = "AIから分析結果が返りませんでした。もう一度お試しください。";

export function finalizeAnalysisText(text: string | undefined, stopReason: string | undefined): string {
  const body = (text ?? "").trim();
  if (!body) throw new Error(EMPTY_ANALYSIS_MESSAGE);
  return stopReason === "max_tokens" ? `${body}\n\n${TRUNCATED_ANALYSIS_NOTE}` : body;
}

/** 全PJ分析の範囲の識別子（分析対象になるPJのidの集合）。表示部署の切替・PJの増減で変わる */
export function analysisScopeKey(projectIds: readonly string[]): string {
  return [...projectIds].sort().join(",");
}

/** 実行したときの範囲と今の範囲が同じときだけ結果を返す（部署を切り替えたあとに前の部署の分析を見せない） */
export function resultForScope<T>(result: T | null, resultKey: string | null, currentKey: string): T | null {
  return result !== null && resultKey === currentKey ? result : null;
}

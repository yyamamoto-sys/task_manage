// src/lib/ai/assertNotTruncated.ts
//
// 【設計意図】
// AIの出力が上限（max_tokens）で途中切れになったときの共通検知（M91・v3.186）。
// JSONは壊れた構文エラーの汎用文言になり、文章は途中切れのまま保存・表示されるため、
// 返答を使う前に1回呼んで「機能ごとの案内文」で例外にする。
// 文言は機能ごとに違う（「2回に分けて」「質問を分けて」等）ので message で渡す。
// invokeAI.ts に置かないのは、各テストが invokeAI モジュールを丸ごとモックしており、
// 同じファイルに置くとモックに無い関数を呼んで落ちるため。
// 順序の注意：使用量の記録は invokeAI() の中で済んでいる（v3.185）。この関数は
// invokeAI が返った後に呼ぶので、出力切れでも課金済みの使用量は記録される。

export function assertNotTruncated(res: { stop_reason?: string }, message: string): void {
  if (res.stop_reason === "max_tokens") throw new Error(message);
}

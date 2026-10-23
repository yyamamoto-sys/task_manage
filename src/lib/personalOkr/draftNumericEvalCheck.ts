// src/lib/personalOkr/draftNumericEvalCheck.ts
//
// 【設計意図・M56】
// 振り返り下書き・計画下書きのプロンプトは「自己評価%・バンドの数値を書かない」と指示するが、
// 出力側の検査が無かった。AIが破ると本文に混入し、人がそのままKintoneへ貼ってしまう。
// この関数は混入の疑いがある記述を拾うだけの純関数。自動で消さない（警告を出して人が判断する。
// 本文中の正当な「10%増」等を勝手に壊さないため、評価を示す語の近くの数値に限って拾う）。

const EVAL_WORDS = "自己評価|GM評価|上長評価|実績|達成度|達成率|バンド";

const PATTERNS: RegExp[] = [
  // [自己評価：70%] 形式（角括弧・全角括弧・隅付き括弧）
  new RegExp("[\\[［【]\\s*(?:自己評価|GM評価)[^\\]］】]*[\\]］】]", "g"),
  // 評価語の直後（同じ文の中、10字以内）に「◯%」
  new RegExp("(?:" + EVAL_WORDS + ")[^。\\n]{0,10}?\\d+(?:\\.\\d+)?\\s*[%％]", "g"),
  // 「バンド70」のような％なしの数値
  new RegExp("バンド\\s*[:：]?\\s*\\d+", "g"),
];

/** 数値評価の混入が疑われる記述（重複を除く・最大5件）。無ければ空配列 */
export function detectNumericEvaluation(texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) {
        const s = m[0].trim();
        if (s && !found.includes(s)) found.push(s);
      }
    }
  }
  // 括弧形式と評価語＋％の両方に当たった同じ記述は、広い方の1件にまとめる
  return found.filter(f => !found.some(g => g !== f && g.includes(f))).slice(0, 5);
}

/** 警告の1文。混入が無ければnull */
export function buildNumericEvalWarning(texts: string[]): string | null {
  const found = detectNumericEvaluation(texts);
  if (found.length === 0) return null;
  return `下書きに自己評価・達成度の数値らしき記述があります（${found.map(f => `「${f}」`).join("")}）。評価の数値は人が決める欄です。必要なら削除してから使ってください。`;
}

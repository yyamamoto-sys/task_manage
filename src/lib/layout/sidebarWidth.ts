// src/lib/layout/sidebarWidth.ts
//
// 【設計意図】
// サイドバー幅（境界のドラッグ／キーボードでの変更）のクランプ（最小・最大への丸め）と
// localStorageからの復元値の検証を担う純粋関数。UI（MainLayout.tsx）から計算ロジックを
// 分離し、テストで固定する（filterByPeriod.ts・groupByMonth.tsと同じ「純粋関数に切り出す」
// 流儀。CLAUDE.md Section 20参照）。
//
// 【範囲の根拠】最小140px：ナビ項目の最長ラベル「ダッシュボード」（約130px）が省略されずに
// 収まる下限。これより狭い幅では長い見出しが省略表示・折り返しになる。
// 最大420px：メインエリア（ガント・カンバン等）が極端に狭くならない上限。
// 既定160px（v3.115で196pxから約2割細くした）：サイドバー内で最も幅を取る
// 「プロジェクト見出し・＋・自分/全件」行（約142px＋左右padding 16px）が1行に収まる最小値。

/** サイドバー展開時の幅（px）の最小値 */
export const SIDEBAR_MIN_WIDTH = 140;
/** サイドバー展開時の幅（px）の最大値 */
export const SIDEBAR_MAX_WIDTH = 420;
/** サイドバー展開時の既定幅（px）。ダブルクリックで戻す値でもある */
export const SIDEBAR_DEFAULT_WIDTH = 160;
/** キーボード操作（左右矢印キー）1回あたりの変化量（px） */
export const SIDEBAR_WIDTH_KEY_STEP = 12;

/** 幅を最小・最大の範囲に丸める。数値でない・無限大の場合は既定幅を返す。 */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * localStorageから読み出した生の文字列を、サイドバー幅（px）として検証・復元する。
 * - null・空文字列・数値に変換できない文字列 → 既定幅
 * - 範囲外の数値（負数・0・範囲外に大きい値） → 範囲内にクランプ
 * - 小数点を含む文字列 → 整数に丸める（parseIntと同じ切り捨てではなくclamp側でRound）
 */
export function parseStoredSidebarWidth(raw: string | null | undefined): number {
  if (!raw) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(parsed);
}

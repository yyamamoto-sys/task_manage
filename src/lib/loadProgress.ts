// src/lib/loadProgress.ts
//
// 【設計意図】起動画面（FullScreenLoading）の進行度の計算。
// 起動は「認証確認 → Phase 1 データ取得 → 自動同定（currentUser 確定）」の3段で、同じ画面・同じバーが出続ける。
// バーが 100% に届くのは自動同定が終わる画面切替の直前だけにするため、データ取得は上限 PHASE1_DATA_MAX%、
// 自動同定の間は PREPARING_PROGRESS% を保つ。Phase 1 完了で 0 に戻さない（戻すと「始めからやり直し」に見える）。

/** fetchCriticalData が並列に取る表の数（進行度の分母）。 */
export const CRITICAL_TABLE_COUNT = 9;
export const PHASE1_DATA_MAX = 90;
export const PREPARING_PROGRESS = 95;
export const READY_PROGRESS = 100;

/** 0〜1 の割合を 0〜PHASE1_DATA_MAX% に写す。範囲外は丸める。 */
export function fractionToPhase1Percent(fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.round(f * PHASE1_DATA_MAX);
}

/** Phase 1 のデータ取得の進行度（表の完了数 done/total を使う簡易版）。範囲外は丸める。 */
export function phase1Percent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return fractionToPhase1Percent(done / total);
}

// ---- 行数ベースの進行度（v3.212）

/** 表1つの取得状況。total は1ページ目の count で分かるまで null（count が取れない表は最後まで null）。 */
export interface TableLoad {
  loaded: number;
  total: number | null;
  done: boolean;
}

/** 総行数がまだ分からない表を数えるときの仮の行数（最低重み）。 */
export const FALLBACK_TABLE_ROWS = 100;

export function newTableLoad(): TableLoad {
  return { loaded: 0, total: null, done: false };
}

/**
 * 全表の「取得済み行数の合計 / 総行数の合計」（0〜1）。
 * ・総行数が分かっている表はその行数を重みにする（0行の表も重み1）。
 * ・分からない表は FALLBACK_TABLE_ROWS（取得済みがそれを超えたら取得済み行数）を重みにする。
 * ・完了した表は重みの全量を取得済みとして数える（count が取れない表・件数がずれた表でも完了で満たされる）。
 */
export function rowFraction(tables: readonly TableLoad[]): number {
  let num = 0;
  let den = 0;
  for (const t of tables) {
    const weight = Math.max(1, t.total ?? Math.max(FALLBACK_TABLE_ROWS, t.loaded));
    den += weight;
    num += t.done ? weight : Math.min(t.loaded, weight);
  }
  return den > 0 ? num / den : 0;
}

/**
 * 後退しない値の保持。総行数が後から分かって分母が増えると割合が下がりうるため、表示は最大値で止める。
 * リトライ時だけ reset() で戻す。
 */
export function createMonotonic() {
  let max = 0;
  return {
    push(v: number): number { if (v > max) max = v; return max; },
    reset(): void { max = 0; },
  };
}

// src/lib/okr/okrModeGate.ts
//
// 【設計意図】
// OKRモードへ初めて切り替えるときに「紹介ポップアップ＋データ読み込みの承認」を挟む
// ゲート（Human in the loop パターン③「承認して記憶」。CLAUDE.md Section 19）。
// 一度承認したら localStorage に真偽値だけを記録し、次回から聞かない
// （src/lib/chunkSizeGate.ts と同じ流儀）。
//
// 【chunkSizeGate.ts との違い】
// chunkSizeGate.ts はReact.lazyで分割した「コードチャンクのダウンロード」を対象にする
// のに対し、このゲートは「OKRモードで使うデータのフェッチ」（appStore.load()のPhase 2＝
// fetchOkrDataの6テーブル・OkrDashboardView自身のマウント時フェッチ等）を対象にする、
// 別のゲート。判定対象が違うため、承認フラグ（localStorageキー）も別に持つ。
//
// 【ゲストは対象外】ゲスト（サンプル閲覧）モードはSupabaseに一切接続しない設計
// （CLAUDE.md Section 23）。ゲストにはappStoreへ注入済みのサンプルデータしか見せないため、
// 「データを読み込みます」という承認を求める意味が無い。ゲストは常にポップアップを
// 出さずOKRモードへ直接入る（承認フラグは書かない＝後で実ユーザーがこのブラウザを使う
// ときに初回ポップアップが正しく出る）。

import { KEYS } from "../localData/localStore";

/**
 * 表示判定の純粋関数（テスト容易性のため副作用と分離）。
 * ゲストは常に false（ポップアップを出さず、承認済みと同じ扱いで直接入る）。
 */
export function shouldShowOkrModeIntro(alreadyApproved: boolean, isGuest: boolean): boolean {
  if (isGuest) return false;
  return !alreadyApproved;
}

export function hasApprovedOkrModeIntro(): boolean {
  try { return localStorage.getItem(KEYS.OKR_MODE_INTRO_APPROVED) === "1"; }
  catch { return false; }
}

export function markOkrModeIntroApproved(): void {
  try { localStorage.setItem(KEYS.OKR_MODE_INTRO_APPROVED, "1"); }
  catch { /* 利用不可・容量不足は無視（機能継続。次回また確認モーダルが出るだけ） */ }
}

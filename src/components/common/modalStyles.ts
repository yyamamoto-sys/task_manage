// src/components/common/modalStyles.ts
//
// 【設計意図】
// 中央寄せポップアップ（モーダル）が画面の上下を突き抜けて操作できなくなる不具合の再発防止。
// 2026-08-06、ProjectCreateModal で「他PJからタスクを引き継ぐ」モードを選ぶとタスク一覧が
// 伸びてモーダルが画面外に飛び出し、保存ボタンに到達できず PJ を作成できない不具合が発生した
// （原因＝箱に maxHeight が無く、コンテンツの高さまで無制限に伸びていた）。同じミスを別の
// モーダルで繰り返さないよう、契約を関数として1箇所に集約する。CLAUDE.md Section 21 参照。
//
// 【契約】
// - オーバーレイ＝画面いっぱい・中央寄せ・保険のスクロール（箱が想定外に大きくなっても
//   背景側をスクロールして到達できるようにする）
// - 箱＝画面内に必ず収まる高さ上限（maxHeight:"100%"。オーバーレイの padding を除いた内側）
//   ＋縦フレックス
// - 本文（ヘッダー・フッターに挟まれるスクロール領域）だけがスクロールする
// - ヘッダーとフッター（保存・キャンセル等の操作ボタン行）はコンテンツの長さに関わらず
//   常に見える
//
// 【使い方】既存の「オーバーレイdiv ＞ 箱div ＞ ヘッダー/本文/フッター」という構造を変えず、
// style を spread して使う。背景の濃さ・角丸・padding 等の上書きは spread の後に書く。
//
//   <div style={{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }}>
//     <div style={{ ...modalBoxStyle("min(480px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)" }}>
//       <div style={HEADER_STYLE}>...</div>
//       <div style={MODAL_BODY_STYLE}>...</div>
//       <div style={MODAL_FOOTER_STYLE}>...</div>
//     </div>
//   </div>
//
// 【対象外】横からのドロワー・サイドパネル（AI相談・TaskSidePanel・MemberDetailPanel・
// OKRラボの右ドロワー等）はこの契約の対象ではない。画面の高さいっぱいに出るのが正しい設計。

import type { CSSProperties } from "react";

/**
 * オーバーレイ（背景の暗幕）のスタイル。
 * `overflow: "auto"` が保険：箱の高さが何らかの理由で想定を超えても、背景側をスクロール
 * して箱の上下端に到達できるようにする（これが無いと今回のバグのように到達不能になる）。
 */
export function modalOverlayStyle(zIndex: number): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    overflow: "auto",
  };
}

/**
 * モーダル本体（箱）のスタイル。
 * `maxHeight: "100%"` はオーバーレイの padding を除いた内側＝ビューポート内に必ず収まる。
 * `overflow: "hidden"` は箱自身をクリップし、内側の本文（MODAL_BODY_STYLE）だけに
 * スクロールを担わせるため。
 */
export function modalBoxStyle(width: string): CSSProperties {
  return {
    width,
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
}

/**
 * 本文（ヘッダー・フッターに挟まれるスクロール領域）。
 * `minHeight: 0` は必須。フレックス子要素の既定 `min-height: auto` のせいで、箱の高さが
 * 制約されても本文が縮まずスクロールが発生しない、という典型的な罠を防ぐ。
 */
export const MODAL_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

/**
 * フッター（保存・キャンセル等の操作ボタン行）。
 * `flexShrink: 0` で、本文がどれだけ長くても押し縮められず常に見える状態を保つ。
 */
export const MODAL_FOOTER_STYLE: CSSProperties = {
  flexShrink: 0,
};

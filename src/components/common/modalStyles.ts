// src/components/common/modalStyles.ts
//
// 【設計意図】
// 中央寄せポップアップ（モーダル）が画面の上下を突き抜けて操作できなくなる不具合の再発防止。
// 2026-08-06、ProjectCreateModal で「他PJからタスクを引き継ぐ」モードを選ぶとタスク一覧が
// 伸びてモーダルが画面外に飛び出し、保存ボタンに到達できず PJ を作成できない不具合が発生した
// （原因＝箱に maxHeight が無く、コンテンツの高さまで無制限に伸びていた）。同じミスを別の
// モーダルで繰り返さないよう、契約を関数として1箇所に集約する。CLAUDE.md Section 21 参照。
//
// 【2026-08-12・v3.64で追記】alignItems:"center" 方式の既知の欠陥（田中さんからの実害報告）
// 上記の maxHeight 対策だけでは、縦の可視領域が狭い環境（Chrome拡大率100%超＋ブックマークバー
// 2段表示など）で「タスク追加モーダルの上端が画面外に切れ、タスク名の入力欄に到達できない」
// という別の不具合が起きた（ウィンドウを大きくすると直る＝縦の余白不足が引き金）。
//
// 原因は maxHeight の有無ではなく、中央寄せの手段そのもの。flexコンテナで
// `alignItems:"center"`（今回のように縦方向をalignItemsで中央寄せする場合）を使うと、箱が
// コンテナよりわずかでも大きくなった瞬間、上側にはみ出した分だけ「スクロールでは絶対に
// 到達できない領域」になる（下側のはみ出しは `overflow:"auto"` で普通にスクロールして
// 到達できるのに、上側だけ到達不能という非対称な既知のCSSの挙動）。`maxHeight:"100%"` で
// 箱の高さを厳密に制約していても、ブラウザの拡大率・ズームの丸め誤差でぴったり100%の
// 境界に近い箱はこの非対称性の影響を受け続ける。つまり `overflow:"auto"` は「保険」に
// なっていなかった（下方向にしか効いていなかった）。
//
// 対策として、縦方向の中央寄せを `alignItems:"center"` ではなく、箱側の `margin:"auto"`
// （flexboxのautoマージンによる中央寄せ）に変更した。auto マージンは空きがある間は中央に
// 配置するが、空きが無くなった（箱がコンテナより大きい）瞬間に 0 へ縮退し、箱は
// コンテナの先頭（上端）にぴったり揃う。この状態は通常のブロック要素のオーバーフローと
// 同じ扱いになり、`overflow:"auto"` で上から下まで普通にスクロールして到達できる
// （`align-items: safe center` という代替もあるが、対応ブラウザにばらつきがあるため
// 採用しなかった。margin:auto は全ブラウザで安定して同じ挙動になる）。
//
// 【契約】
// - オーバーレイ＝画面いっぱい・保険のスクロール（箱が想定外に大きくなっても背景側を
//   スクロールして到達できるようにする。上下どちらの方向にも到達できることが必須）
// - 箱＝画面内に必ず収まる高さ上限（maxHeight:"100%"。オーバーレイの padding を除いた内側）
//   ＋縦フレックス＋ margin:"auto" による中央寄せ（alignItems:"center" は使わない）
// - 本文（ヘッダー・フッターに挟まれるスクロール領域）だけがスクロールする
// - ヘッダーとフッター（保存・キャンセル等の操作ボタン行）はコンテンツの長さに関わらず
//   常に見える
//
// 【使い方】既存の「オーバーレイdiv ＞ 箱div ＞ ヘッダー/本文/フッター」という構造を変えず、
// style を spread して使う。背景の濃さ・角丸・padding 等の上書きは spread の後に書く。
// **オーバーレイ側で alignItems:"center" / justifyContent:"center" を上書きしないこと**
// （上記の理由で再発する）。
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
 * 中央寄せは行わない（`modalBoxStyle` 側の `margin:"auto"` に委ねる。上記の設計意図参照）。
 * `overflow: "auto"` が保険：箱の高さが何らかの理由で想定を超えても、背景側をスクロール
 * して箱の上下端に到達できるようにする（`margin:"auto"` と組み合わせてこそ上下双方向に効く）。
 */
export function modalOverlayStyle(zIndex: number): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex,
    display: "flex",
    padding: "24px",
    overflow: "auto",
  };
}

/**
 * モーダル本体（箱）のスタイル。
 * `maxHeight: "100%"` はオーバーレイの padding を除いた内側＝ビューポート内に必ず収まる。
 * `margin: "auto"` が中央寄せを担う（`alignItems:"center"` は使わない。上記の設計意図参照）。
 * `overflow: "hidden"` は箱自身をクリップし、内側の本文（MODAL_BODY_STYLE）だけに
 * スクロールを担わせるため。
 */
export function modalBoxStyle(width: string): CSSProperties {
  return {
    width,
    maxHeight: "100%",
    margin: "auto",
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

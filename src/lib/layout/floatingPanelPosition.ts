// src/lib/layout/floatingPanelPosition.ts
//
// 【設計意図・2026-08-20】
// トリガー要素の getBoundingClientRect() から position:"fixed" のポップアップ座標を
// 算出するときの「ビューポート端でのクランプ・反転」ロジックを1箇所に集約する。
//
// 【背景】`src/components/project/ProjectRowMenu.tsx` は元々このクランプ（左右端の
// クランプ・下に入らなければ上へ反転）を自前で実装しており完成していたが、
// `CustomSelect.tsx`（担当者・PJ・TF選択等で最頻出）・`MentionTextarea.tsx`
// （コメント欄の@メンション候補）・`InlineEditAssignee.tsx`（一覧・カンバンの担当者
// ドロップダウン）は同種の `getBoundingClientRect()` → `position:"fixed"` 座標という
// 手法を使いながらクランプを一切持たず、可視範囲の下端に近い行で開くと候補が画面外に
// 切れて選べない・スクロールしても到達できない、という不具合が複数箇所で同時多発していた
// （2026-08-20の横断監査で確定）。CLAUDE.md Section 21（中央寄せモーダルの高さ上限契約）
// とは別の系統の不具合——Section 21は「画面中央の箱」が対象、これは「トリガーに追従する
// 小さいポップオーバー」が対象（ProjectRowMenu.tsx冒頭コメントの分類と同じ）。
//
// 重複コピペが今回の再発の温床だったため、`ProjectRowMenu.tsx` 自身もこの関数を呼ぶ形に
// 揃えた（計算ロジックを複数箇所に持たない）。
//
// 【使い方】
// - align="left"（既定）：パネル左端をトリガー左端に揃える（CustomSelect・MentionTextarea・
//   InlineEditAssignee向け。ドロップダウンが左詰めで下に伸びる形）。
// - align="right"：パネル右端をトリガー右端に揃える（ProjectRowMenuの「⋮」メニュー向け。
//   サイドバー右端に寄ったトリガーからパネルが左に伸びる形）。
// - 高さは「実測前の見積もり」でよい（ProjectRowMenu方式を踏襲。呼び出し側が既知の
//   maxHeightやitem数から概算する）。見積もりが実際より小さくても、パネル自身の
//   maxHeight+overflow:autoが保険になる（見積もりが甘くて反転しなかった場合でも、
//   パネル内部のスクロールで下端には到達できる。上端への反転判定が過度に消極的になる
//   だけで、既存のSection 21のような「絶対に到達不能」にはならない）。

export interface FloatingPanelTriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingPanelPositionInput {
  /** トリガー要素の getBoundingClientRect()（テスト容易性のため必要なフィールドだけを受け取る） */
  triggerRect: FloatingPanelTriggerRect;
  /** パネルの実際の幅（px）。CustomSelectはトリガーと同じ幅、ProjectRowMenuは固定幅など呼び出し側で決める */
  panelWidth: number;
  /** パネルの高さの見積もり（px）。実測不要（呼び出し側が既知のmaxHeightや行数から概算する） */
  estimatedPanelHeight: number;
  /** ビューポートの幅（window.innerWidthをそのまま渡す。テストで固定値を渡せるよう引数化） */
  viewportWidth: number;
  /** ビューポートの高さ（window.innerHeightをそのまま渡す） */
  viewportHeight: number;
  /** 画面端からの最小余白（px）。既定8（ProjectRowMenuのVIEWPORT_MARGINと同じ） */
  margin?: number;
  /** 水平方向の基準。既定"left" */
  align?: "left" | "right";
}

export interface FloatingPanelPosition {
  top: number;
  left: number;
}

const DEFAULT_MARGIN = 8;

/**
 * トリガー位置からポップアップパネルの fixed 座標（クランプ済み）を算出する純粋関数。
 * - 横：ビューポート左右端から margin 分だけは必ず空ける。
 * - 縦：トリガー直下に置いたとき下端をはみ出すなら、トリガーの上に反転させる
 *   （反転後もはみ出すなら margin まで押し上げる＝それ以上は上げない。パネル自身の
 *   overflow:auto が保険になる設計はProjectRowMenu/CustomSelect/MentionTextarea/
 *   InlineEditAssignee全てが既に備えている）。
 */
export function computeFloatingPanelPosition(input: FloatingPanelPositionInput): FloatingPanelPosition {
  const {
    triggerRect, panelWidth, estimatedPanelHeight,
    viewportWidth, viewportHeight,
    margin = DEFAULT_MARGIN, align = "left",
  } = input;

  let left = align === "right" ? triggerRect.right - panelWidth : triggerRect.left;
  if (left + panelWidth > viewportWidth - margin) left = viewportWidth - panelWidth - margin;
  if (left < margin) left = margin; // 右端クランプの結果として再び左にはみ出す場合も含め、最後に必ず左端を保証する

  let top = triggerRect.bottom + 4;
  if (top + estimatedPanelHeight > viewportHeight - margin) {
    const flippedTop = triggerRect.top - estimatedPanelHeight - 4;
    top = flippedTop < margin ? margin : flippedTop;
  }

  return { top, left };
}

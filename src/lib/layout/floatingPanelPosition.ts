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
/** トリガーとパネルの間に空ける隙間（px）。従来のハードコード +4 を定数化したもの */
const DEFAULT_GAP = 4;

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

  let top = triggerRect.bottom + DEFAULT_GAP;
  if (top + estimatedPanelHeight > viewportHeight - margin) {
    const flippedTop = triggerRect.top - estimatedPanelHeight - DEFAULT_GAP;
    top = flippedTop < margin ? margin : flippedTop;
  }

  return { top, left };
}

// ============================================================================
// 【2026-08-26追記】v3.85（commit aedb241）でこの4箇所をPortal化したあとに残っていた
// 3つの穴を塞ぐために追加した純粋関数群。
//
//  ① スクロール連鎖：パネル内スクロールが端に達すると祖先へ連鎖する。
//     → FLOATING_PANEL_OVERSCROLL_BEHAVIOR をパネルのスクロール要素に必ず当てる。
//  ② 祖先スクロールで即座に閉じる：「目的の項目に手を伸ばしている最中に閉じる」不具合の
//     温床そのものだった。→ computeFloatingPanelCloseOnScroll で「トリガーが可視範囲から
//     出たときだけ閉じる」に変え、それ以外は位置を再計算して追従させる。
//  ③ 固定値の見積もり：maxHeight を 200/220/260 とハードコードしていたため、拡大率・
//     フォント設定・メンバー数によって実物とズレていた（v3.95で一斉に潰したのと同じ種類の
//     欠陥）。→ computeFloatingPanelMaxHeight で「トリガーの上下で実際に使える余白」から
//     算出する。
// ============================================================================

/**
 * パネル内のスクロールを祖先へ連鎖させないための overscroll-behavior 値。
 * パネルのスクロール要素（overflowY:"auto" を持つ要素）に必ず当てる。
 */
export const FLOATING_PANEL_OVERSCROLL_BEHAVIOR = "contain" as const;

export interface FloatingPanelCloseOnScrollInput {
  /** スクロールイベントの発生元がパネル内部か。true なら無条件で閉じない */
  scrolledInsidePanel: boolean;
  /** トリガーの getBoundingClientRect()。要素が外れていれば null */
  triggerRect: FloatingPanelTriggerRect | null;
  /**
   * トリガーを内包するスクロール祖先の矩形。表本体のような容器の外へトリガーが流れたら
   * 「見えなくなった」と判定する。祖先が無い（ビューポート直下）なら null。
   */
  clipRect?: FloatingPanelTriggerRect | null;
  viewportWidth: number;
  viewportHeight: number;
  /** トリガーがこの px 以上見えていれば「まだ可視」とみなす。既定4（境界での点滅を防ぐ） */
  minVisiblePx?: number;
}

/**
 * スクロールが起きたときにポップオーバーを閉じるべきかを判定する純粋関数。
 *
 * 旧実装は「パネル外で起きたスクロールなら閉じる」だったため、祖先の表本体が1px動いた
 * だけで閉じていた。ここでは「トリガーが可視範囲から出たときだけ閉じる」に変える
 * （それ以外は呼び出し側が位置を再計算してパネルを追従させる）。
 */
export function computeFloatingPanelCloseOnScroll(input: FloatingPanelCloseOnScrollInput): boolean {
  const {
    scrolledInsidePanel, triggerRect, clipRect = null,
    viewportWidth, viewportHeight, minVisiblePx = 4,
  } = input;

  if (scrolledInsidePanel) return false;
  if (!triggerRect) return true;

  let top = Math.max(triggerRect.top, 0);
  let bottom = Math.min(triggerRect.bottom, viewportHeight);
  let left = Math.max(triggerRect.left, 0);
  let right = Math.min(triggerRect.right, viewportWidth);

  if (clipRect) {
    top = Math.max(top, clipRect.top);
    bottom = Math.min(bottom, clipRect.bottom);
    left = Math.max(left, clipRect.left);
    right = Math.min(right, clipRect.right);
  }

  return bottom - top < minVisiblePx || right - left < minVisiblePx;
}

export interface FloatingPanelMaxHeightInput {
  triggerRect: FloatingPanelTriggerRect;
  viewportHeight: number;
  /** 出せるなら出したい高さ（px） */
  preferredHeight: number;
  /** 余白が足りなくてもこれ以上は縮めない下限（px） */
  minHeight: number;
  margin?: number;
  gap?: number;
}

export interface FloatingPanelMaxHeight {
  /** パネルに設定する maxHeight（px） */
  maxHeight: number;
  /** 広い側がどちらだったか。実際の座標は computeFloatingPanelPosition が同じ結論を出す */
  placement: "below" | "above";
  spaceBelow: number;
  spaceAbove: number;
}

/**
 * トリガーの上下で実際に使える余白から、パネルの maxHeight を算出する純粋関数。
 * - 下に希望値が入るなら下に出す（既定の向き）
 * - 下が足りず上に入るなら上に出す
 * - どちらも足りなければ広い側を選び、その余白に収める（ただし minHeight は下回らない）
 */
export function computeFloatingPanelMaxHeight(input: FloatingPanelMaxHeightInput): FloatingPanelMaxHeight {
  const {
    triggerRect, viewportHeight, preferredHeight, minHeight,
    margin = DEFAULT_MARGIN, gap = DEFAULT_GAP,
  } = input;

  const spaceBelow = Math.max(0, viewportHeight - margin - (triggerRect.bottom + gap));
  const spaceAbove = Math.max(0, triggerRect.top - gap - margin);

  if (spaceBelow >= preferredHeight) return { maxHeight: preferredHeight, placement: "below", spaceBelow, spaceAbove };
  if (spaceAbove >= preferredHeight) return { maxHeight: preferredHeight, placement: "above", spaceBelow, spaceAbove };

  const placement = spaceAbove > spaceBelow ? "above" : "below";
  const available = placement === "above" ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(minHeight, Math.min(preferredHeight, available));
  return { maxHeight, placement, spaceBelow, spaceAbove };
}

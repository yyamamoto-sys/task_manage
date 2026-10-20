// src/components/section/SectionDropIndicator.tsx
//
// グループ見出しをドラッグ中の見た目の共通部品（リスト・ガントの両方が使う）。
//  - SectionDropIndicator：落とす先の見出しに重ねる挿入位置の線（3px・ブランド色）と札
//  - SectionDragNotice：ビューのヘッダー直下に出す1行の案内
//  - sectionMovingStyle / SectionMovingBadge：つかんでいる見出しの「薄く＋移動中」表示
//
// 🔴 行の高さを変えない（ガントの見出し行は26px固定＝CLAUDE.md Section 80の左右の行ずれを壊さない）。
//    線も札も position:absolute の重ね描きで、親の行側に position:relative が要る。
// 🔴 pointerEvents:none（線・札が elementFromPoint の判定を横取りしない）。

import type { CSSProperties } from "react";
import type { SectionDropDescription } from "../../lib/section/describeSectionDrop";
import { withBellReserve } from "../../lib/layout/topRightBell";

const LINE_PX = 3;

export function SectionDropIndicator({ drop, showLabel = true }: { drop: SectionDropDescription; showLabel?: boolean }) {
  const edge = drop.side === "top" ? { top: 0 } : { bottom: 0 };
  return (
    <>
      <div
        aria-hidden="true"
        data-section-drop-line={drop.side}
        style={{
          position: "absolute", left: 0, right: 0, ...edge, height: LINE_PX,
          background: "var(--color-brand)", pointerEvents: "none", zIndex: 6,
        }}
      />
      {showLabel && (
        <div
          role="status"
          data-section-drop-label=""
          style={{
            position: "absolute", right: 8, ...(drop.side === "top" ? { top: LINE_PX + 1 } : { bottom: LINE_PX + 1 }),
            maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            padding: "1px 8px", fontSize: "10px", fontWeight: 600, lineHeight: "14px",
            color: "#fff", background: "var(--color-brand)", borderRadius: "var(--radius-sm)",
            pointerEvents: "none", zIndex: 6,
          }}
        >{drop.label}</div>
      )}
    </>
  );
}

/**
 * ビューのヘッダー直下の案内（ドラッグ中だけ描画する）。
 * 🔴 レイアウトを押し下げない：高さ0の枠の中に absolute で浮かせる（表がずれるとドラッグ中に落とす先が動くため）。
 *    pointerEvents:none（ドロップ操作を邪魔しない）。右はベル予約幅を空ける。
 */
export function SectionDragNotice({ name }: { name: string }) {
  return (
    <div style={{ position: "relative", height: 0, flexShrink: 0, zIndex: 30, pointerEvents: "none" }}>
      <div
        role="status"
        data-section-drag-notice=""
        style={{
          position: "absolute", top: 4, left: 14, right: withBellReserve(14), pointerEvents: "none",
          padding: "5px 12px", fontSize: "12px", fontWeight: 600,
          color: "var(--color-brand)", background: "var(--color-brand-light)",
          border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-sm)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)", minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >『{name}』を移動中：入れたい位置の見出しの上で離してください（Escでやめる）</div>
    </div>
  );
}

/** つかんでいる見出し（薄く表示＋ブランドの薄色の背景） */
export const sectionMovingStyle: CSSProperties = {
  opacity: 0.45, background: "var(--color-brand-light)",
};

export function SectionMovingBadge() {
  return (
    <span
      data-section-moving-badge=""
      style={{
        flexShrink: 0, padding: "0 6px", fontSize: "10px", fontWeight: 600, lineHeight: "14px",
        color: "var(--color-brand)", border: "1px solid var(--color-brand-border)",
        borderRadius: "var(--radius-sm)", whiteSpace: "nowrap",
      }}
    >移動中</span>
  );
}

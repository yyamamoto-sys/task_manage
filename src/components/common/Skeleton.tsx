// src/components/common/Skeleton.tsx
// ローディングスケルトン。lazy チャンク読込中（Suspense fallback）や
// データ待ちの間、白画面やスピナーの代わりにレイアウトの骨格を見せて体感速度を上げる。
// アニメーションは globals.css の .skeleton-pulse を使用。

import type { CSSProperties } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  style?: CSSProperties;
}

/** 単一のスケルトンブロック（グレーの明滅） */
export function Skeleton({ width = "100%", height = 14, radius = "var(--radius-sm)", style }: SkeletonProps) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width, height,
        borderRadius: radius,
        background: "var(--color-bg-tertiary)",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/**
 * ビュー切替時の汎用スケルトン（ツールバー1段＋リスト行）。
 * MainLayout の Suspense fallback として使用。
 */
export function ViewSkeleton() {
  return (
    <div style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px", overflow: "hidden" }}>
      {/* ツールバー */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Skeleton width={120} height={28} />
        <Skeleton width={180} height={28} />
        <Skeleton width={80} height={28} />
        <div style={{ flex: 1 }} />
        <Skeleton width={90} height={28} />
      </div>
      {/* リスト行（下に行くほど薄く＝視線誘導） */}
      {[0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2].map((opacity, i) => (
        <div key={i} style={{ display: "flex", gap: "12px", alignItems: "center", opacity }}>
          <Skeleton width={16} height={16} radius="50%" />
          <Skeleton width={`${45 + ((i * 17) % 30)}%`} height={13} />
          <div style={{ flex: 1 }} />
          <Skeleton width={60} height={13} />
          <Skeleton width={48} height={13} />
        </div>
      ))}
    </div>
  );
}

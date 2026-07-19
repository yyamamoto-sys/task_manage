// src/components/common/Card.tsx
//
// 【設計意図】
// ダッシュボード（DashboardView.tsx）で確立済みの「タイトル＋バッジ＋区切り線＋本文」の
// カード表現を、他画面（管理画面等）からも使えるよう共通化したもの。
// 見た目のみのプレゼンテーション部品。ロジックは一切持たない。

import type { ReactNode, CSSProperties } from "react";

export type CardBadgeColor = "info" | "danger" | "success" | "warning";

interface CardProps {
  title: string;
  badge?: string;
  badgeColor?: CardBadgeColor;
  /** ヘッダー右端に追加するコンテンツ（追加ボタン等） */
  headerExtra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}

const BADGE_STYLES: Record<CardBadgeColor, { bg: string; color: string; border: string }> = {
  info:    { bg: "var(--color-bg-info)",    color: "var(--color-text-info)",    border: "var(--color-border-info)" },
  danger:  { bg: "var(--color-bg-danger)",  color: "var(--color-text-danger)",  border: "var(--color-border-danger)" },
  success: { bg: "var(--color-bg-success)", color: "var(--color-text-success)", border: "var(--color-border-success)" },
  warning: { bg: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "var(--color-border-warning)" },
};

export function Card({ title, badge, badgeColor = "info", headerExtra, children, style, bodyStyle }: CardProps) {
  const bs = BADGE_STYLES[badgeColor];
  return (
    <div style={{
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "10px 14px 8px",
        borderBottom: "1px solid var(--color-border-primary)",
      }}>
        <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
            background: bs.bg, color: bs.color, border: `1px solid ${bs.border}`,
            fontWeight: "500", flexShrink: 0,
          }}>
            {badge}
          </span>
        )}
        {headerExtra}
      </div>
      <div style={{ padding: "12px 14px", ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

export type SummaryTileTone = "danger" | "warning" | "info" | "accent" | "success" | "purple";

interface SummaryTileProps {
  label: string;
  value: string | number;
  tone: SummaryTileTone;
  /** 特に注目してほしいタイルに左端の色ストライプを付ける */
  stripe?: boolean;
}

const TONE_COLORS: Record<SummaryTileTone, { fg: string; stripe: string }> = {
  danger:  { fg: "var(--color-text-danger)",  stripe: "var(--color-border-danger)" },
  warning: { fg: "var(--color-text-warning)", stripe: "var(--color-border-warning)" },
  info:    { fg: "var(--color-text-info)",    stripe: "var(--color-border-info)" },
  accent:  { fg: "var(--color-brand)",        stripe: "var(--color-brand-border)" },
  success: { fg: "var(--color-text-success)", stripe: "var(--color-border-success)" },
  purple:  { fg: "var(--color-text-purple)",  stripe: "var(--color-brand-border)" },
};

/** 件数サマリー行の1タイル。数値は大きく tabular-nums、ラベルは小さく（DashboardViewのKpiTileと同じ表現）。 */
export function SummaryTile({ label, value, tone, stripe = false }: SummaryTileProps) {
  const c = TONE_COLORS[tone];
  return (
    <div style={{
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderLeft: stripe ? `4px solid ${c.stripe}` : "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      padding: "8px 14px",
      minWidth: "88px",
      flex: "1 1 88px",
    }}>
      <div style={{
        fontSize: "20px", fontWeight: 700, color: c.fg,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.2,
      }}>
        {value}
      </div>
      <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

/** 件数サマリー行のコンテナ（横並び・折り返し可）。各セクション先頭に置く。 */
export function SummaryRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
      {children}
    </div>
  );
}

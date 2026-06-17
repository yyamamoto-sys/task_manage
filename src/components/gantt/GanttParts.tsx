// src/components/gantt/GanttParts.tsx
// ガントビューで使う小コンポーネント群

import type { Task } from "../../lib/localData/types";

// ===== TaskBarRow =====

export interface TaskBarRowProps {
  bar: { barX: number; barWidth: number } | null;
  barColor: string;
  barHeight?: number;
  borderRadius?: string;
  isDone: boolean;
  isStagnant: boolean;
  isChanged?: boolean;
  isHovered: boolean;
  isPreview: boolean;
  dateLabel: string;
  tooltip: string;
  onEdit: () => void;
  onResize: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function TaskBarRow({
  bar, barColor, barHeight = 18, borderRadius = "9px",
  isDone, isStagnant, isChanged = false,
  isHovered, isPreview,
  dateLabel, tooltip, onEdit, onResize, onMouseEnter, onMouseLeave,
}: TaskBarRowProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        height: 30, position: "relative",
        borderBottom: "1px solid var(--color-border-primary)",
        background: isChanged
          ? "rgba(127,119,221,0.06)"
          : isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
        transition: "background 0.1s",
      }}
    >
      {bar && (
        <>
          <div
            title={tooltip}
            onClick={isPreview ? undefined : onEdit}
            style={{
              position: "absolute",
              left: bar.barX, top: "50%", transform: "translateY(-50%)",
              width: bar.barWidth, height: barHeight,
              borderRadius,
              background: barColor,
              opacity: isDone ? 0.5 : 1,
              cursor: isPreview ? "default" : "pointer",
              zIndex: 2,
              outline: isChanged
                ? "2px solid var(--color-brand)"
                : isStagnant && !isDone ? "1.5px solid #f97316" : "none",
              outlineOffset: "1px",
              overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              filter: isHovered && !isPreview ? "brightness(1.15)" : "none",
              transition: "filter 0.1s",
            }}
          >
            {bar.barWidth > 52 && (
              <span style={{
                fontSize: "8px", color: "rgba(255,255,255,0.9)", fontWeight: "500",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                padding: "0 4px", pointerEvents: "none",
              }}>{dateLabel}</span>
            )}
          </div>
          {isStagnant && !isDone && !isPreview && (
            <div style={{
              position: "absolute", left: bar.barX + 2, top: "50%", transform: "translateY(-50%)",
              fontSize: "9px", zIndex: 5, pointerEvents: "none", lineHeight: 1,
            }}>⚠</div>
          )}
          {!isPreview && !isDone && (
            <div
              onMouseDown={onResize}
              style={{
                position: "absolute",
                left: bar.barX + bar.barWidth - 4,
                top: "50%", transform: "translateY(-50%)",
                width: 8, height: 22, cursor: "col-resize", zIndex: 3,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ===== StatusDot =====

export function StatusDot({ status }: { status: Task["status"] }) {
  const colors = {
    todo: "var(--color-border-secondary)",
    in_progress: "var(--color-text-info)",
    done: "var(--color-text-success)",
  };
  return (
    <div style={{
      width: 6, height: 6, borderRadius: "50%",
      background: colors[status], flexShrink: 0,
    }} />
  );
}

// ===== ZoomIcon =====

export function ZoomIcon({ minus = false }: { minus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: "block" }}>
      {/* 虫眼鏡の円 */}
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      {/* ハンドル */}
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* 横棒（共通） */}
      <line x1="3.8" y1="6" x2="8.2" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* 縦棒（＋のみ） */}
      {!minus && <line x1="6" y1="3.8" x2="6" y2="8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

// src/components/gantt/GanttParts.tsx
// ガントビューで使う小コンポーネント群

import { memo } from "react";
import type { Task, Member, Project } from "../../lib/localData/types";
import { getAssigneeIds } from "../../lib/taskMeta";
import { InlineEditAssignee } from "../common/InlineEditAssignee";

// ===== TaskBarRow =====
//
// 【設計意図】React.memo 化。GanttView は hoveredTaskId 等の状態が親コンポーネントに
// あるため、1本のバーへのマウスオーバーだけで画面全体のバーが再レンダリングされていた
// （カクつきの主因）。ここを memo 化し、コールバックは親側で useCallback により参照を
// 固定してもらうことで、実際に変化した行だけが再レンダリングされるようにする。
// ただし bar は毎レンダー calcTaskBar() が新しいオブジェクトを返すため、デフォルトの
// 浅い比較では常に「変化した」と判定されてしまう → barX/barWidth の値で比較するカスタム
// comparator を使う。

export interface TaskBarRowProps {
  taskId: string;
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
  /** B2：依存の相手（先行）が画面外のとき表示するバッジのツールチップ文言。undefined なら非表示 */
  depBadgeLeftTitle?: string;
  /** B2：依存の相手（後続）が画面外のとき表示するバッジのツールチップ文言。undefined なら非表示 */
  depBadgeRightTitle?: string;
  /** B4：ベースライン（当初計画）の座標。null/undefined なら描かない。bar と同一位置なら描画側で渡さない運用 */
  ghostBar?: { barX: number; barWidth: number } | null;
  /** B4：遅延/前倒しラベル（例："遅延3日"）。null/undefined なら非表示 */
  delayLabel?: string | null;
  /** B4：delayLabel が遅延（正）か前倒し（負）か。色分けに使う */
  isDelayed?: boolean;
  onEdit: (taskId: string) => void;
  onResize: (e: React.MouseEvent<HTMLDivElement>, taskId: string) => void;
  onMouseEnter: (taskId: string) => void;
  onMouseLeave: () => void;
}

function TaskBarRowImpl({
  taskId, bar, barColor, barHeight = 18, borderRadius = "9px",
  isDone, isStagnant, isChanged = false,
  isHovered, isPreview,
  dateLabel, tooltip, depBadgeLeftTitle, depBadgeRightTitle,
  ghostBar, delayLabel, isDelayed = false,
  onEdit, onResize, onMouseEnter, onMouseLeave,
}: TaskBarRowProps) {
  const rightEdge = Math.max(
    bar ? bar.barX + bar.barWidth : -Infinity,
    ghostBar ? ghostBar.barX + ghostBar.barWidth : -Infinity,
  );
  return (
    // ホバーによる背景ハイライトのみ（クリック操作は内側のバー要素が担う）
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onMouseEnter={() => onMouseEnter(taskId)}
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
      {/* B4：ベースライン（当初計画）のゴーストバー。実バーより下の層（zIndex 1）に描く */}
      {ghostBar && (
        <div
          title="当初計画（ベースライン）"
          style={{
            position: "absolute",
            left: ghostBar.barX, top: "50%", transform: "translateY(-50%)",
            width: ghostBar.barWidth, height: barHeight,
            borderRadius,
            background: "transparent",
            border: "1.5px dashed var(--color-text-tertiary)",
            opacity: 0.55,
            zIndex: 1,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      )}
      {bar && (
        <>
          <div
            title={tooltip}
            data-task-id={taskId}
            onClick={isPreview ? undefined : () => onEdit(taskId)}
            role={isPreview ? undefined : "button"}
            tabIndex={isPreview ? undefined : 0}
            onKeyDown={isPreview ? undefined : (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(taskId); } })}
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
          {/* B2：依存の相手が画面外（フィルタ除外・別グループ・折りたたみで非表示）のときのバッジ。
              先行が画面外＝バーの左側、後続が画面外＝バーの右側に出す */}
          {depBadgeLeftTitle && (
            <div
              title={depBadgeLeftTitle}
              style={{
                position: "absolute", left: bar.barX - 3, top: "50%", transform: "translate(-100%, -50%)",
                fontSize: "9px", zIndex: 6, lineHeight: 1, cursor: "default",
                background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-full)", padding: "1px 3px",
              }}
            >⏱</div>
          )}
          {depBadgeRightTitle && (
            <div
              title={depBadgeRightTitle}
              style={{
                position: "absolute", left: bar.barX + bar.barWidth + 3, top: "50%", transform: "translateY(-50%)",
                fontSize: "9px", zIndex: 6, lineHeight: 1, cursor: "default",
                background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-full)", padding: "1px 3px",
              }}
            >⏱</div>
          )}
          {!isPreview && !isDone && (
            // 右端ドラッグによる期日変更専用のハンドル。マウスのドラッグ操作専用でキーボード代替手段はない
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              onMouseDown={e => onResize(e, taskId)}
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
      {/* B4：遅延/前倒しラベル。バー・ゴーストバーどちらか右端の外側に小さく表示 */}
      {delayLabel && rightEdge > -Infinity && (
        <div
          style={{
            position: "absolute",
            left: rightEdge + (depBadgeRightTitle ? 18 : 3),
            top: "50%", transform: "translateY(-50%)",
            fontSize: "9px", zIndex: 4, lineHeight: 1, whiteSpace: "nowrap",
            pointerEvents: "none", fontWeight: isDelayed ? 600 : 400,
            color: isDelayed ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
          }}
        >{delayLabel}</div>
      )}
    </div>
  );
}

function barRowPropsEqual(prev: TaskBarRowProps, next: TaskBarRowProps): boolean {
  return (
    prev.taskId === next.taskId &&
    (prev.bar?.barX ?? null) === (next.bar?.barX ?? null) &&
    (prev.bar?.barWidth ?? null) === (next.bar?.barWidth ?? null) &&
    prev.barColor === next.barColor &&
    prev.barHeight === next.barHeight &&
    prev.borderRadius === next.borderRadius &&
    prev.isDone === next.isDone &&
    prev.isStagnant === next.isStagnant &&
    prev.isChanged === next.isChanged &&
    prev.isHovered === next.isHovered &&
    prev.isPreview === next.isPreview &&
    prev.dateLabel === next.dateLabel &&
    prev.tooltip === next.tooltip &&
    prev.depBadgeLeftTitle === next.depBadgeLeftTitle &&
    prev.depBadgeRightTitle === next.depBadgeRightTitle &&
    (prev.ghostBar?.barX ?? null) === (next.ghostBar?.barX ?? null) &&
    (prev.ghostBar?.barWidth ?? null) === (next.ghostBar?.barWidth ?? null) &&
    prev.delayLabel === next.delayLabel &&
    prev.isDelayed === next.isDelayed &&
    prev.onEdit === next.onEdit &&
    prev.onResize === next.onResize &&
    prev.onMouseEnter === next.onMouseEnter &&
    prev.onMouseLeave === next.onMouseLeave
  );
}

export const TaskBarRow = memo(TaskBarRowImpl, barRowPropsEqual);

// ===== GanttPjLabelRow（PJ別ビュー・ラベル列のタスク行） =====

export interface GanttPjLabelRowProps {
  task: Task;
  isChild: boolean;
  childCount: number;
  isHovered: boolean;
  isCollapsed: boolean;
  members: Member[];
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
  onToggleCollapse: (taskId: string) => void;
  onSaveAssignees: (task: Task, ids: string[]) => void;
}

export const GanttPjLabelRow = memo(function GanttPjLabelRow({
  task, isChild, childCount, isHovered, isCollapsed, members,
  onEdit, onHoverEnter, onHoverLeave, onToggleCollapse, onSaveAssignees,
}: GanttPjLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "5px", padding: isChild ? "0 8px 0 40px" : "0 8px 0 10px",
      borderBottom: "1px solid var(--color-border-primary)",
      borderTop: (!isChild && childCount > 0) ? "2px solid var(--color-border-primary)" : undefined,
      background: isHovered
        ? "var(--color-bg-secondary)"
        : isChild ? "var(--color-bg-primary)"
        : childCount > 0 ? "var(--color-bg-secondary)"
        : "var(--color-bg-primary)",
      boxShadow: !isChild && childCount > 0
        ? "inset 3px 0 0 var(--color-brand)"
        : isChild
        ? "inset 2px 0 0 var(--color-brand-border)"
        : "none",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      {isChild ? (
        <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, marginLeft: "-10px" }}>↳</span>
      ) : childCount > 0 ? (
        <span
          onClick={e => { e.stopPropagation(); onToggleCollapse(task.id); }}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onToggleCollapse(task.id); } }}
          aria-label={isCollapsed ? "子タスクを表示" : "子タスクを隠す"}
          aria-expanded={!isCollapsed}
          style={{
            fontSize: "11px", color: "var(--color-text-secondary)",
            transition: "transform 0.15s", display: "inline-block",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            flexShrink: 0, cursor: "pointer", width: 14, textAlign: "center",
          }}
        >▾</span>
      ) : (
        <span style={{ flexShrink: 0, width: 14 }} />
      )}
      <StatusDot status={task.status} />
      <span style={{
        fontSize: "11px",
        fontWeight: (!isChild && childCount > 0) ? "600" : "400",
        color: isChild ? "var(--color-text-tertiary)" : childCount > 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
        textDecoration: task.status === "done" ? "line-through" : "none",
        opacity: task.status === "done" ? 0.6 : 1,
      }}>
        {task.name}
      </span>
      {childCount > 0 && (
        <span style={{
          fontSize: "8px", fontWeight: "600", color: "var(--color-text-purple)",
          background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)",
          borderRadius: "var(--radius-full)", padding: "0 5px", flexShrink: 0,
        }}>
          子{childCount}
        </span>
      )}
      {/* 行クリックでタスク編集モーダルが開くため、アイコンクリックはそちらに伝播させない（クリックしても何も起きないラッパー） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => onSaveAssignees(task, ids)}
        />
      </div>
    </div>
  );
});

// ===== GanttTodoLabelRow（ToDo系グループ・ラベル列のタスク行） =====

export interface GanttTodoLabelRowProps {
  task: Task;
  isHovered: boolean;
  members: Member[];
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
  onSaveAssignees: (task: Task, ids: string[]) => void;
}

export const GanttTodoLabelRow = memo(function GanttTodoLabelRow({
  task, isHovered, members, onEdit, onHoverEnter, onHoverLeave, onSaveAssignees,
}: GanttTodoLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "6px", padding: "0 8px 0 26px",
      borderBottom: "1px solid var(--color-border-primary)",
      background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      <StatusDot status={task.status} />
      <span style={{
        fontSize: "11px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        textDecoration: task.status === "done" ? "line-through" : "none",
        opacity: task.status === "done" ? 0.6 : 1,
      }}>
        {task.name}
      </span>
      {/* 行クリックでタスク編集モーダルが開くため、アイコンクリックはそちらに伝播させない（クリックしても何も起きないラッパー） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => onSaveAssignees(task, ids)}
        />
      </div>
    </div>
  );
});

// ===== GanttPersonLabelRow（人別ビュー・ラベル列のタスク行） =====

export interface GanttPersonLabelRowProps {
  task: Task;
  isHovered: boolean;
  isOverdue: boolean;
  pj: Project | undefined;
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
}

export const GanttPersonLabelRow = memo(function GanttPersonLabelRow({
  task, isHovered, isOverdue, pj, onEdit, onHoverEnter, onHoverLeave,
}: GanttPersonLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "5px", padding: "0 8px 0 26px",
      borderBottom: "1px solid var(--color-border-primary)",
      background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      <StatusDot status={task.status} />
      {pj && (
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: pj.color_tag, flexShrink: 0,
        }} />
      )}
      <span style={{
        fontSize: "11px",
        color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
        textDecoration: task.status === "done" ? "line-through" : "none",
        opacity: task.status === "done" ? 0.6 : 1,
      }}>
        {task.parent_task_id ? "↳ " : ""}{task.name}
      </span>
    </div>
  );
});

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

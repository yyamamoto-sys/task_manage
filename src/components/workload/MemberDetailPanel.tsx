// src/components/workload/MemberDetailPanel.tsx
//
// 【設計意図】
// ワークロードビューでメンバー行をクリックした時のドリルダウン（状況詳細）。
// TaskSidePanel（List/Gantt/Kanban共通の右サイドパネル）と同じ視覚言語（animate-side-panel-in・
// var(--color-*)トークン）を使い、モバイルは既存のボトムシート流儀（animate-overlay背景＋
// panel-slide-up本体。MainLayoutのラボボトムシートと同型）に切り替える。
//
// データは呼び出し側（WorkloadView）が渡す時点で部署スコープ済み・PJ絞り込み適用済みである前提
// （素の s.tasks / s.members は扱わない）。タスク行クリックは呼び出し側の onOpenTask に委譲し、
// 実際のタスク編集は既存の TaskEditModal（MainLayoutのaiEditTaskId経由）に任せる。

import { useMemo } from "react";
import type { Member, Project, Task, TaskDependency } from "../../lib/localData/types";
import { getMemberActiveTasks } from "../../lib/workload/computeWorkload";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import { getIncompletePredecessors, formatBlockerNames } from "../../lib/dependencies/gate";
import { todayStr, formatMD, diffDaysFromToday } from "../../lib/date";
import { computeDelayDays, formatDelayLabel } from "../gantt/ganttUtils";
import { Avatar } from "../auth/UserSelectScreen";
import { EmptyState } from "../common/EmptyState";

interface Props {
  member: Member;
  /** PJ絞り込み適用後の部署スコープ済みタスク（行の集計値と詳細の中身を一致させるため） */
  tasks: Task[];
  /** PJ絞り込みなしの部署スコープ済みタスク全件（先行タスクの完了状態をPJフィルタに関係なく判定するため） */
  allTasks: Task[];
  projects: Project[];
  taskDependencies: TaskDependency[];
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
  isMobile: boolean;
}

interface ProjectGroup {
  key: string;
  project: Project | null;
  tasks: Task[];
  hasOverdue: boolean;
}

export function MemberDetailPanel({ member, tasks, allTasks, projects, taskDependencies, onOpenTask, onClose, isMobile }: Props) {
  const activeTasks = useMemo(() => getMemberActiveTasks(member.id, tasks), [tasks, member.id]);
  const today = todayStr();

  const todoCount = activeTasks.filter(t => t.status === "todo").length;
  const inProgressCount = activeTasks.filter(t => t.status === "in_progress").length;
  const overdueIds = useMemo(
    () => new Set(activeTasks.filter(t => t.due_date != null && t.due_date < today).map(t => t.id)),
    [activeTasks, today],
  );
  const withEstimate = activeTasks.filter(t => t.estimated_hours != null);
  const totalHours = withEstimate.length > 0
    ? withEstimate.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0)
    : null;

  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, Task[]>();
    for (const t of activeTasks) {
      const key = t.project_id ?? "__none";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const arr: ProjectGroup[] = [...map.entries()].map(([key, list]) => {
      const project = key === "__none" ? null : projects.find(p => p.id === key) ?? null;
      const sorted = list.slice().sort((a, b) => {
        const aOver = overdueIds.has(a.id) ? 0 : 1;
        const bOver = overdueIds.has(b.id) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return a.name.localeCompare(b.name, "ja");
      });
      return { key, project, tasks: sorted, hasOverdue: sorted.some(t => overdueIds.has(t.id)) };
    });
    arr.sort((a, b) => {
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
      const an = a.project?.name ?? "（プロジェクトなし）";
      const bn = b.project?.name ?? "（プロジェクトなし）";
      return an.localeCompare(bn, "ja");
    });
    return arr;
  }, [activeTasks, projects, overdueIds]);

  const header = (
    <div style={{
      padding: "12px", borderBottom: "1px solid var(--color-border-primary)",
      display: "flex", alignItems: "center", gap: "10px", flexShrink: 0,
    }}>
      <Avatar member={member} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {member.display_name}
          </span>
          {member.is_admin && (
            <span style={{ fontSize: "9px", color: "#fff", background: "var(--color-brand)", padding: "1px 6px", borderRadius: "3px" }}>
              管理者
            </span>
          )}
          {member.is_super_admin && (
            <span style={{ fontSize: "9px", color: "#fff", background: "#7c3aed", padding: "1px 6px", borderRadius: "3px" }}>
              全社スーパー管理者
            </span>
          )}
        </div>
      </div>
      <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{
        background: "none", border: "none", cursor: "pointer", fontSize: "16px",
        color: "var(--color-text-tertiary)", flexShrink: 0,
      }}>✕</button>
    </div>
  );

  const summary = (
    <div style={{
      padding: "10px 12px", borderBottom: "1px solid var(--color-border-primary)",
      display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          未着手 <strong style={{ color: "var(--color-text-primary)" }}>{todoCount}</strong>
          {"　"}進行中 <strong style={{ color: "var(--color-text-primary)" }}>{inProgressCount}</strong>
        </span>
        {overdueIds.size > 0 && (
          <span style={{
            fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
            background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
            border: "1px solid var(--color-border-danger)", fontWeight: 500,
          }}>
            期限超過 {overdueIds.size}件
          </span>
        )}
      </div>
      {withEstimate.length > 0 && (
        <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
          工数計 {totalHours}h（{withEstimate.length}件入力）
        </span>
      )}
    </div>
  );

  const content = (
    <div style={{ flex: 1, overflow: "auto", padding: "10px 12px 16px" }}>
      {activeTasks.length === 0 ? (
        <EmptyState icon="✅" title="アクティブなタスクはありません" hint="未着手・進行中のタスクがあるとここに表示されます。" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map(g => (
            <div key={g.key}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                {g.project && (
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.project.color_tag, flexShrink: 0 }} />
                )}
                <span style={{
                  fontSize: "11px", fontWeight: 600,
                  color: g.hasOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {g.project?.name ?? "（プロジェクトなし）"}
                </span>
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{g.tasks.length}件</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {g.tasks.map(t => (
                  <MemberTaskRow
                    key={t.id}
                    task={t}
                    isOverdue={overdueIds.has(t.id)}
                    blockers={getIncompletePredecessors(t.id, allTasks, taskDependencies)}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div
        className="animate-overlay"
        style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose(); }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          className="panel-slide-up"
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "85vh",
            display: "flex", flexDirection: "column",
            background: "var(--color-bg-primary)",
            borderRadius: "16px 16px 0 0", overflow: "hidden",
          }}
          onClick={e => e.stopPropagation()}
        >
          {header}
          {summary}
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-side-panel-in" style={{
      width: "360px", flexShrink: 0,
      borderLeft: "1px solid var(--color-border-primary)",
      background: "var(--color-bg-primary)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {header}
      {summary}
      {content}
    </div>
  );
}

function MemberTaskRow({
  task, isOverdue, blockers, onOpenTask,
}: {
  task: Task;
  isOverdue: boolean;
  blockers: Task[];
  onOpenTask: (taskId: string) => void;
}) {
  const statusStyle = TASK_STATUS_STYLE[task.status];
  const diff = task.due_date ? diffDaysFromToday(task.due_date) : null;
  const delayLabel = formatDelayLabel(computeDelayDays(task));

  return (
    <div
      onClick={() => onOpenTask(task.id)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenTask(task.id); } }}
      title="クリックでタスク詳細を開く"
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "7px 9px", borderRadius: "var(--radius-md)", cursor: "pointer",
        border: `1px solid ${isOverdue ? "var(--color-border-danger)" : "var(--color-border-primary)"}`,
        background: isOverdue ? "var(--color-bg-danger)" : "var(--color-bg-primary)",
      }}
    >
      <span style={{
        flex: 1, minWidth: 0, fontSize: "12px",
        color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-primary)",
        fontWeight: isOverdue ? 600 : 400,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {task.name}
      </span>
      {delayLabel && (
        <span
          title="当初計画（ベースライン）比"
          style={{
            fontSize: "9px", padding: "1px 6px", borderRadius: "var(--radius-full)", flexShrink: 0,
            background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)",
            border: "1px solid var(--color-border-primary)", fontWeight: 500,
          }}
        >
          {delayLabel}（当初比）
        </span>
      )}
      {blockers.length > 0 && (
        <span
          title={`先行未完了：${formatBlockerNames(blockers)}`}
          style={{
            fontSize: "9px", padding: "1px 6px", borderRadius: "var(--radius-full)", flexShrink: 0,
            background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
            border: "1px solid var(--color-border-warning)", fontWeight: 500,
          }}
        >
          ⏳先行未完了
        </span>
      )}
      <span style={{
        fontSize: "10px", padding: "1px 6px", borderRadius: "var(--radius-full)", flexShrink: 0,
        background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`,
      }}>
        {TASK_STATUS_LABEL[task.status]}
      </span>
      {task.due_date && (
        <span style={{
          fontSize: "10px", flexShrink: 0, fontWeight: isOverdue ? 700 : 500,
          color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
        }}>
          {isOverdue ? `${formatMD(task.due_date)}（${Math.abs(diff ?? 0)}日超過）` : formatMD(task.due_date)}
        </span>
      )}
    </div>
  );
}

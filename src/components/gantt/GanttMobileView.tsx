// src/components/gantt/GanttMobileView.tsx
// モバイル向けガント代替ビュー（縦スクロールカードリスト）

import type { Member, Project, Task, ToDo, Milestone, TaskDependency } from "../../lib/localData/types";
import { toDateStr } from "../../lib/date";
import { TaskEditModal } from "../task/TaskEditModal";
import { getAssigneeIds, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import { EmptyState } from "../common/EmptyState";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import { applyDependencyOrderWithinSiblings } from "../../lib/taskHierarchy";

interface GanttMobileViewProps {
  today: Date;
  viewMode: "pj" | "person";
  setViewMode: (mode: "pj" | "person") => void;
  visibleProjects: Project[];
  allTasks: Task[];
  todoGroups: Array<{ todo: ToDo; todoId: string; tasks: Task[] }>;
  personGroups: Array<{ member: Member; tasks: Task[] }>;
  milestones: Milestone[];
  projectById: Map<string, Project>;
  sortTasks: (tasks: Task[]) => Task[];
  /** 同じ親を共有するタスク同士の並びに依存関係順を適用するため（表示のみ・非破壊） */
  taskDependencies: TaskDependency[];
  previewChangedTaskIds?: Set<string>;
  isPreview?: boolean;
  editingTaskId: string | null;
  setEditingTaskId: (id: string | null) => void;
  mineOnly?: boolean;
  selectedProject: Project | null;
  krTaskIds?: Set<string> | null;
  currentUser: Member;
  /** 担当者アイコンをクリックしての変更（複数選択可）に使う */
  members: Member[];
  saveTask: (task: Task) => Promise<void> | void;
  /** 完了を隠すトグル（GanttView側のstateをそのまま使う。allTasks等は既に適用済みで渡される） */
  hideCompletedTasks?: boolean;
  onToggleHideCompletedTasks?: () => void;
}

export function GanttMobileView({
  today, viewMode, setViewMode,
  visibleProjects, allTasks, todoGroups, personGroups, milestones,
  projectById, sortTasks, taskDependencies,
  previewChangedTaskIds, isPreview,
  editingTaskId, setEditingTaskId,
  mineOnly, selectedProject, krTaskIds, currentUser,
  members, saveTask,
  hideCompletedTasks, onToggleHideCompletedTasks,
}: GanttMobileViewProps) {
  const todayStrVal = toDateStr(today);
  const md = (d?: string | null) => (d ? d.slice(5).replace("-", "/") : "");
  const rangeText = (t: Task): string => {
    const s = t.start_date ?? null;
    const e = t.due_date ?? null;
    if (s && e) return `${md(s)} → ${md(e)}`;
    if (e) return `〜 ${md(e)}`;
    if (s) return `${md(s)} 〜`;
    return "期日未定";
  };

  const renderCard = (task: Task) => {
    const pj = task.project_id ? projectById.get(task.project_id) : undefined;
    const isDone = task.status === "done";
    const isOverdue = !!task.due_date && task.due_date < todayStrVal && !isDone;
    const statusColor = TASK_STATUS_STYLE[task.status].color;
    const isChanged = previewChangedTaskIds?.has(task.id);
    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
        onKeyDown={e => {
          if (isPreview) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingTaskId(task.id); }
        }}
        style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: isChanged ? "var(--color-bg-info)" : "var(--color-bg-primary)",
          border: isChanged ? "1px solid var(--color-text-info)" : "1px solid var(--color-border-primary)",
          borderLeft: `4px solid ${pj?.color_tag ?? statusColor}`,
          borderRadius: "var(--radius-md)",
          padding: "10px 12px", marginBottom: "6px",
          cursor: isPreview ? "default" : "pointer", opacity: isDone ? 0.55 : 1,
          minHeight: "56px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)",
            lineHeight: 1.4, textDecoration: isDone ? "line-through" : "none",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{task.parent_task_id ? "↳ " : ""}{task.name}</div>
          <div style={{
            fontSize: "11px", marginTop: "3px",
            color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
            fontWeight: isOverdue ? 600 : 400,
          }}>
            {rangeText(task)}{isOverdue ? " ・期限超過" : ""}
          </div>
        </div>
        {/* カード全体クリックでモーダルが開くため、アイコンクリックはそちらに伝播させない（クリックしても何も起きないラッパー） */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <InlineEditAssignee
            assigneeIds={getAssigneeIds(task)}
            members={members}
            onSave={ids => saveTask({ ...task, assignee_member_ids: ids })}
          />
        </div>
      </div>
    );
  };

  const groupHeader = (color: string, label: string, count: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 4px 4px" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{count}件</span>
    </div>
  );

  const pjGroups = viewMode === "pj"
    ? visibleProjects
        .map(pj => ({
          pj,
          tasks: applyDependencyOrderWithinSiblings(
            sortTasks(allTasks.filter(t => t.project_id === pj.id)),
            taskDependencies,
          ),
          msList: milestones
            .filter(ms => ms.project_id === pj.id)
            .sort((a, b) => (a.date < b.date ? -1 : 1)),
        }))
        .filter(g => g.tasks.length > 0 || g.msList.length > 0)
    : [];

  const hasAny = viewMode === "pj"
    ? pjGroups.length > 0 || todoGroups.length > 0
    : personGroups.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* モバイル簡易ヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: isPreview ? "var(--color-bg-info)" : "var(--color-bg-primary)", flexShrink: 0,
      }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isPreview && <span style={{ fontSize: "10px", padding: "2px 8px", background: "var(--color-text-info)", color: "#fff", borderRadius: "var(--radius-full)", marginRight: "6px" }}>変更後（仮）</span>}
          {selectedProject ? selectedProject.name : krTaskIds ? "OKRタスク" : "全プロジェクト"}
        </div>
        {!isPreview && (
          <div style={{ display: "flex", gap: "2px", padding: "2px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", flexShrink: 0 }}>
            {(["pj", "person"] as const).map(mode => (
              <button
                key={mode}
                className="tap-compact"
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "6px 12px", fontSize: "12px", borderRadius: "var(--radius-sm)", border: "none",
                  background: viewMode === mode ? "var(--color-bg-primary)" : "transparent",
                  color: viewMode === mode ? "var(--color-brand)" : "var(--color-text-secondary)",
                  fontWeight: viewMode === mode ? 600 : 400,
                  boxShadow: viewMode === mode ? "var(--shadow-sm)" : "none",
                }}
              >
                {mode === "pj" ? "PJ別" : "人別"}
              </button>
            ))}
          </div>
        )}
        {!isPreview && onToggleHideCompletedTasks && (
          <button
            className="tap-compact"
            onClick={onToggleHideCompletedTasks}
            title={hideCompletedTasks ? "完了タスクも表示する" : "完了タスクを非表示にする（未完了のみ表示）"}
            aria-pressed={!!hideCompletedTasks}
            style={{
              padding: "6px 10px", fontSize: "12px", borderRadius: "var(--radius-sm)",
              border: hideCompletedTasks ? "1px solid var(--color-brand-border)" : "1px solid var(--color-border-primary)",
              background: hideCompletedTasks ? "var(--color-brand-light)" : "transparent",
              color: hideCompletedTasks ? "var(--color-text-purple)" : "var(--color-text-secondary)",
              fontWeight: hideCompletedTasks ? 600 : 400,
              flexShrink: 0,
            }}
          >🙈</button>
        )}
      </div>

      {/* 本体（縦スクロール） */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 10px 16px" }}>
        {!hasAny && (
          <EmptyState
            icon="📅"
            title="表示するタスクがありません"
            hint={mineOnly
              ? "「自分」モードで担当タスクが無いか、まだ登録されていません。サイドバー上部で「全件」に切り替えるか、＋ボタンで追加してください。"
              : "PJ やタスクを登録すると、ここに一覧で表示されます。"}
          />
        )}

        {viewMode === "pj" && (
          <>
            {pjGroups.map(g => (
              <div key={g.pj.id}>
                {groupHeader(g.pj.color_tag ?? "var(--color-text-tertiary)", g.pj.name, g.tasks.length)}
                {g.tasks.map(renderCard)}
                {g.msList.map(ms => (
                  <div key={ms.id} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "8px 12px", marginBottom: "6px", fontSize: "12px",
                    color: "var(--color-text-secondary)", background: "var(--color-bg-tertiary)",
                    borderRadius: "var(--radius-md)",
                  }}>
                    <span style={{ flexShrink: 0 }}>◆</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ms.name}</span>
                    <span style={{ flexShrink: 0, color: "var(--color-text-tertiary)" }}>{md(ms.date)}</span>
                  </div>
                ))}
              </div>
            ))}
            {todoGroups.map(g => (
              <div key={g.todoId}>
                {groupHeader("var(--color-text-tertiary)", g.todo?.title ?? "(ToDo)", g.tasks.length)}
                {applyDependencyOrderWithinSiblings(sortTasks(g.tasks), taskDependencies).map(renderCard)}
              </div>
            ))}
          </>
        )}

        {viewMode === "person" && personGroups.map(g => (
          <div key={g.member.id}>
            {groupHeader("var(--color-brand)", g.member.display_name, g.tasks.length)}
            {g.tasks.map(renderCard)}
          </div>
        ))}
      </div>

      {/* タスク編集（フルスクリーン） */}
      {!isPreview && editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onDeleted={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}

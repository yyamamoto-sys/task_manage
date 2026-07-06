// src/components/kanban/KanbanView.tsx
import { useState, useMemo, useCallback, memo } from "react";
import { useAppStore, selectScopedTasks } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE, getAssigneeIds, isAssignedTo } from "../../lib/taskMeta";
import { TaskEditModal } from "../task/TaskEditModal";
import { TaskSidePanel } from "../task/TaskSidePanel";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";
import { InlineEditText } from "../common/InlineEditText";
import { InlineEditDate } from "../common/InlineEditDate";
import { InlineEditAssignee } from "../common/InlineEditAssignee";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  selectedKrId?: string | null;
  krTaskIds?: Set<string> | null;
  /** サイドバーの「自分」トグル ON のとき true。自分が担当のタスクのみ表示 */
  mineOnly?: boolean;
}

export function KanbanView({ currentUser, selectedProject, projects, selectedKrId: _selectedKrId, krTaskIds, mineOnly = false }: Props) {
  const allTasks         = useAppStore(selectScopedTasks);
  const allMembers       = useAppStore(s => s.members);
  const rawTodos         = useAppStore(s => s.todos);
  const saveTask         = useAppStore(s => s.saveTask);
  const isMobile = useIsMobile();

  const tasks = useMemo(() => active(allTasks), [allTasks]);
  const members = useMemo(() => active(allMembers), [allMembers]);
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);

  // 子タスク表示用：id→タスク名（子カードに親名を出す）と 親id→子件数（親カードに「子N件」を出す）
  const taskNameById = useMemo(() => new Map(tasks.map(t => [t.id, t.name])), [tasks]);
  const childCountByParent = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.parent_task_id) m.set(t.parent_task_id, (m.get(t.parent_task_id) ?? 0) + 1);
    return m;
  }, [tasks]);

  // TaskCard を React.memo で軽量化するための「参照が安定した」ルックアップ。
  // .find()をそのまま呼ぶと毎回O(n)探索になり、ドラッグ中のホバーや編集モーダルの
  // 開閉など無関係な state 変化でも全カードが再レンダリングされてしまう。
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const todoById    = useMemo(() => new Map(todos.map(td => [td.id, td])), [todos]);

  // null=閉じている。値ありならその列のステータスでQuickAddTaskModalを開く
  const [addingStatus, setAddingStatus] = useState<Task["status"] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<Task["status"] | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (selectedProject) list = list.filter(t => t.project_id === selectedProject.id);
    else if (krTaskIds)  list = list.filter(t => krTaskIds.has(t.id));
    if (mineOnly) list = list.filter(t => isAssignedTo(t, currentUser.id));
    return list;
  }, [tasks, selectedProject, krTaskIds, mineOnly, currentUser.id]);

  const handleStatusChange = useCallback((taskId: string, newStatus: Task["status"]) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    // updated_at は触らない（CLAUDE.md Section 5）。zustand 側で
    // フォーム時点の値を expectedUpdatedAt として saveWithLock に渡す
    saveTask({ ...task, status: newStatus, updated_by: currentUser.id });
  }, [tasks, saveTask, currentUser.id]);

  // TaskCard に渡すコールバックは useCallback で参照を固定する（React.memo が効くようにするため）
  const handleDragStart = useCallback((taskId: string) => setDraggingId(taskId), []);
  const handleCardClick = useCallback((taskId: string) => setEditingTaskId(taskId), []);
  const handleDrop = (status: Task["status"]) => {
    if (draggingId) { handleStatusChange(draggingId, status); setDraggingId(null); }
    setDragOverStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ヘッダー */}
      <div style={{
        padding: "10px 18px", borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "10px",
        background: "var(--color-bg-primary)", flexShrink: 0,
      }}>
        <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
          {selectedProject ? selectedProject.name : krTaskIds ? "OKRタスク" : "全プロジェクト"}
        </div>
        {selectedProject?.purpose && (
          <div style={{
            fontSize: "10px", padding: "2px 8px", borderRadius: "var(--radius-full)",
            background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
            border: "1px solid var(--color-border-warning)",
            maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {selectedProject.purpose}
          </div>
        )}
        {/* 完了を隠すトグル */}
        <button onClick={() => setHideDone(v => !v)} style={{
          padding: "3px 10px", fontSize: "10px", borderRadius: "var(--radius-full)", cursor: "pointer",
          fontWeight: hideDone ? "500" : "400",
          background: hideDone ? "var(--color-brand-light)" : "transparent",
          color: hideDone ? "var(--color-text-purple)" : "var(--color-text-tertiary)",
          border: hideDone ? "1px solid var(--color-brand-border)" : "1px solid var(--color-border-primary)",
          transition: "all 0.1s",
        }}>完了を隠す</button>
      </div>

      {/* カンバン本体 */}
      <div style={{
        display: "flex", gap: isMobile ? "8px" : "12px",
        padding: isMobile ? "10px 12px" : "14px 16px",
        flex: 1, overflow: "auto",
        scrollSnapType: isMobile ? "x mandatory" : undefined,
        WebkitOverflowScrolling: "touch",
        alignItems: "flex-start",
      }}>
        {(["todo", "in_progress", "done"] as const).map(status => {
          const colTasks = visibleTasks.filter(t => t.status === status);
          const cfg = { label: TASK_STATUS_LABEL[status], ...TASK_STATUS_STYLE[status] };
          const isDoneCol = status === "done";
          const isDropTarget = dragOverStatus === status;
          return (
            <div
              key={status}
              style={{
                width: isMobile ? "calc(100vw - 40px)" : "260px",
                flexShrink: 0,
                scrollSnapAlign: isMobile ? "start" : undefined,
                borderRadius: "var(--radius-lg)",
                border: isDropTarget ? `2px solid ${cfg.border}` : "2px solid transparent",
                background: isDropTarget ? cfg.bg : "transparent",
                transition: "border-color 0.15s, background 0.15s",
                padding: "2px",
              }}
              onDragOver={e => e.preventDefault()}
              onDragEnter={() => setDragOverStatus(status)}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStatus(null); }}
              onDrop={() => handleDrop(status)}
            >
              {/* 列ヘッダー */}
              <div style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "6px 10px", borderRadius: "var(--radius-md)",
                background: cfg.bg, marginBottom: "8px",
              }}>
                <span style={{ fontSize: "12px", fontWeight: "500", color: cfg.color, flex: 1 }}>
                  {cfg.label}
                </span>
                <span style={{
                  fontSize: "10px", color: cfg.color, opacity: 0.8,
                  background: "rgba(255,255,255,0.6)", padding: "1px 6px",
                  borderRadius: "var(--radius-full)", border: `1px solid ${cfg.border}`,
                }}>
                  {colTasks.length}
                </span>
              </div>

              {/* タスクカード */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {/* done列でhideDoneの場合は折りたたみ */}
                {isDoneCol && hideDone ? (
                  <div style={{
                    padding: "10px", textAlign: "center", fontSize: "11px",
                    color: "var(--color-text-tertiary)",
                    border: "1px dashed var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                  }}>
                    {colTasks.length}件（非表示中）
                  </div>
                ) : (
                  colTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      project={task.project_id ? projectById.get(task.project_id) : undefined}
                      todo={task.todo_ids?.length ? todoById.get(task.todo_ids[0]) : undefined}
                      allMembers={members}
                      parentName={task.parent_task_id ? taskNameById.get(task.parent_task_id) : undefined}
                      childCount={childCountByParent.get(task.id) ?? 0}
                      onDragStart={handleDragStart}
                      onStatusChange={handleStatusChange}
                      isDragging={draggingId === task.id}
                      onClick={handleCardClick}
                      onSaveTask={saveTask}
                      currentUserId={currentUser.id}
                    />
                  ))
                )}
                {/* ＋ タスクを追加 */}
                <button
                  onClick={() => setAddingStatus(status)}
                  style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    padding: "6px 10px", fontSize: "11px",
                    color: "var(--color-text-tertiary)",
                    background: "transparent",
                    border: "1px dashed var(--color-border-primary)",
                    borderRadius: "var(--radius-md)", cursor: "pointer",
                    width: "100%",
                  }}
                >
                  ＋ タスクを追加
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {addingStatus !== null && (
        <QuickAddTaskModal
          currentUser={currentUser}
          projects={projects}
          defaultProjectId={selectedProject?.id}
          defaultStatus={addingStatus}
          onClose={() => setAddingStatus(null)}
        />
      )}

      {/* モバイル時のみ TaskEditModal でフルスクリーン表示（PCはサイドパネル） */}
      {isMobile && editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onDeleted={() => setEditingTaskId(null)}
        />
      )}
      </div>
      {!isMobile && editingTaskId && (
        <TaskSidePanel
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}

// ===== タスクカード =====

const TaskCard = memo(function TaskCard({
  task, project, todo, allMembers, parentName, childCount = 0, onDragStart, onStatusChange, isDragging, onClick, onSaveTask, currentUserId,
}: {
  task: Task;
  project?: Project;
  todo?: ToDo;
  allMembers: Member[];
  parentName?: string;
  childCount?: number;
  onDragStart: (taskId: string) => void;
  onStatusChange: (id: string, status: Task["status"]) => void;
  isDragging: boolean;
  onClick: (taskId: string) => void;
  onSaveTask: (task: Task) => void;
  currentUserId: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDone = task.status === "done";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onClick={() => onClick(task.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        // 親子の位置づけを視覚化：子＝左にインデント＋グレーの太い左罫線、親（子を持つ）＝ブランド色の左罫線
        borderLeft: parentName
          ? "3px solid var(--color-border-secondary)"
          : childCount > 0
            ? "3px solid var(--color-brand)"
            : "1px solid var(--color-border-primary)",
        marginLeft: parentName ? "14px" : 0,
        borderRadius: "var(--radius-lg)",
        padding: "9px 11px",
        cursor: "grab",
        opacity: isDragging ? 0.4 : isDone ? 0.55 : 1,
        boxShadow: isDragging ? "var(--shadow-lg)" : isHovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: isHovered && !isDragging ? "translateY(-1px)" : "none",
        transition: "opacity 0.15s, box-shadow 0.15s, transform 0.15s",
      }}
    >
      {/* PJバッジ or ToDoバッジ */}
      {project ? (
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "5px" }}>
          <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: project.color_tag, display: "inline-block" }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
            {project.name}
          </span>
        </div>
      ) : todo ? (
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "5px" }}>
          <span style={{ fontSize: "9px", fontWeight: "600", color: "#059669", background: "rgba(16,185,129,0.1)", padding: "1px 5px", borderRadius: "3px" }}>ToDo</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>
            {todo.title.split("\n")[0].slice(0, 18)}
          </span>
        </div>
      ) : null}

      {/* 子タスク：親タスク名（インデント＋左罫線で子は自明なので「の子タスク」は省略） */}
      {parentName && (
        <div style={{ display: "flex", alignItems: "center", gap: "3px", marginBottom: "5px" }} title={`「${parentName}」の子タスク`}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>↳</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
            {parentName}
          </span>
        </div>
      )}

      {/* タスク名（インライン編集） */}
      <div style={{
        fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)",
        marginBottom: "7px", lineHeight: 1.4,
        textDecoration: isDone ? "line-through" : "none",
        opacity: isDone ? 0.6 : 1,
        display: "flex", alignItems: "center", gap: "4px",
      }}
        onClick={e => e.stopPropagation()}
      >
        <InlineEditText
          value={task.name}
          onSave={name => onSaveTask({ ...task, name, updated_by: currentUserId })}
          style={{ fontSize: "12px", fontWeight: "500" }}
        />
        {childCount > 0 && (
          <span style={{
            fontSize: "9px", fontWeight: "600",
            color: "var(--color-text-purple)", background: "var(--color-brand-light)",
            border: "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-full)", padding: "1px 6px", whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            子{childCount}
          </span>
        )}
      </div>

      {/* フッター */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        {/* 担当者インライン編集 */}
        <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <InlineEditAssignee
            assigneeIds={getAssigneeIds(task)}
            members={allMembers}
            onSave={ids => onSaveTask({ ...task, assignee_member_ids: ids, assignee_member_id: ids[0] ?? "", updated_by: currentUserId })}
          />
        </div>
        {/* 期日インライン編集 */}
        <div onClick={e => e.stopPropagation()} style={{ flex: 1, fontSize: "10px" }}>
          <InlineEditDate
            value={task.due_date}
            onSave={due_date => onSaveTask({ ...task, due_date, updated_by: currentUserId })}
          />
        </div>
        {/* 工数バッジ */}
        {task.estimated_hours != null && (
          <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {task.estimated_hours}h
          </span>
        )}
        {/* コメントインジケーター */}
        {task.comment && (
          <span title="メモあり" style={{ fontSize: "10px", opacity: 0.45, flexShrink: 0 }}>💬</span>
        )}
        {/* 優先度バッジ */}
        {task.priority && TASK_PRIORITY_STYLE[task.priority] && (
          <span style={{
            fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
            background: TASK_PRIORITY_STYLE[task.priority].bg,
            color: TASK_PRIORITY_STYLE[task.priority].color,
            flexShrink: 0,
          }}>
            {TASK_PRIORITY_LABEL[task.priority]}
          </span>
        )}
        {/* ステータス前進ボタン（todo→進行中→完了）*/}
        {!isDone && (
          <button
            onClick={e => {
              e.stopPropagation();
              onStatusChange(task.id, task.status === "todo" ? "in_progress" : "done");
            }}
            title={task.status === "todo" ? "進行中にする" : "完了にする"}
            style={{
              width: "24px", height: "24px", borderRadius: "50%",
              border: "1.5px solid var(--color-border-secondary)",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", color: "var(--color-text-tertiary)",
              flexShrink: 0, transition: "border-color 0.1s, background 0.1s",
            }}
          >
            ✓
          </button>
        )}
        {/* 完了を戻すボタン */}
        {isDone && (
          <button
            onClick={e => {
              e.stopPropagation();
              onStatusChange(task.id, "in_progress");
            }}
            title="進行中に戻す"
            style={{
              width: "24px", height: "24px", borderRadius: "50%",
              border: "1.5px solid var(--color-border-secondary)",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", color: "var(--color-text-tertiary)",
              flexShrink: 0,
            }}
          >
            ↩
          </button>
        )}
      </div>
    </div>
  );
});


// src/components/kanban/KanbanView.tsx
import { useState, useMemo, useCallback } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, TaskForce, TaskTaskForce, TaskProject, ToDo } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { v4 as uuidv4 } from "uuid";
import { TaskEditModal } from "../task/TaskEditModal";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  selectedKrId?: string | null;
  krTaskIds?: Set<string> | null;
}

const STATUS_CONFIG = {
  todo:        { label: "ToDo",   color: "var(--color-text-secondary)", bg: "var(--color-bg-tertiary)", border: "var(--color-border-primary)" },
  in_progress: { label: "進行中", color: "var(--color-text-info)",     bg: "var(--color-bg-info)",     border: "var(--color-border-info)" },
  done:        { label: "完了",   color: "var(--color-text-success)",  bg: "var(--color-bg-success)",  border: "var(--color-border-success)" },
} as const;

const PRIORITY_CONFIG = {
  high: { label: "高", bg: "var(--color-bg-danger)",  color: "var(--color-text-danger)"  },
  mid:  { label: "中", bg: "var(--color-bg-warning)", color: "var(--color-text-warning)" },
  low:  { label: "低", bg: "var(--color-bg-success)", color: "var(--color-text-success)" },
} as const;

function todayStr() { return new Date().toISOString().split("T")[0]; }

export function KanbanView({ currentUser, selectedProject, projects, selectedKrId: _selectedKrId, krTaskIds }: Props) {
  const { tasks: allTasks, members: allMembers, taskForces: allTaskForces, todos: rawTodos, saveTask, deleteTask, addTaskTaskForce, addTaskProject } = useAppData();
  const isMobile = useIsMobile();

  const tasks = useMemo(() => allTasks.filter(t => !t.is_deleted), [allTasks]);
  const members = useMemo(() => allMembers.filter(m => !m.is_deleted), [allMembers]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addToStatus, setAddToStatus] = useState<Task["status"]>("todo");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<Task["status"] | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const visibleTasks = useMemo(() => {
    if (selectedProject) return tasks.filter(t => t.project_id === selectedProject.id);
    if (krTaskIds) return tasks.filter(t => krTaskIds.has(t.id));
    return tasks;
  }, [tasks, selectedProject, krTaskIds]);

  const handleStatusChange = useCallback((taskId: string, newStatus: Task["status"]) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    saveTask({ ...task, status: newStatus, updated_at: new Date().toISOString(), updated_by: currentUser.id });
  }, [tasks, saveTask, currentUser.id]);

  const taskForces = useMemo(() => allTaskForces.filter(t => !t.is_deleted), [allTaskForces]);
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);

  const handleAddTask = useCallback((
    name: string, assigneeIds: string[], projectId: string | null, dueDate: string,
    priority: Task["priority"], estimatedHours: number | null,
    tfIds: string[], extraProjectIds: string[], todoIds: string[],
  ) => {
    const now = new Date().toISOString();
    const taskId = uuidv4();
    const newTask: Task = {
      id: taskId,
      name,
      project_id: projectId,
      todo_ids: todoIds,
      assignee_member_ids: assigneeIds,
      assignee_member_id: assigneeIds[0] ?? "",
      status: addToStatus,
      priority,
      start_date: null,
      due_date: dueDate || null,
      estimated_hours: estimatedHours,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    saveTask(newTask);
    tfIds.forEach(tfId => addTaskTaskForce({ task_id: taskId, tf_id: tfId }));
    extraProjectIds.forEach(pjId => addTaskProject({ task_id: taskId, project_id: pjId }));
    setShowAddModal(false);
  }, [addToStatus, saveTask, addTaskTaskForce, addTaskProject, currentUser.id]);

  const assigneesForTask = useCallback((task: Task): Member[] => {
    const ids = task.assignee_member_ids?.length
      ? task.assignee_member_ids
      : task.assignee_member_id ? [task.assignee_member_id] : [];
    return members.filter(m => ids.includes(m.id));
  }, [members]);

  const projectForTask = (task: Task) => projects.find(p => p.id === task.project_id);
  const todoForTask    = (task: Task) => task.todo_ids?.length ? todos.find(td => td.id === task.todo_ids[0]) : undefined;

  const handleDragStart = (taskId: string) => setDraggingId(taskId);
  const handleDrop = (status: Task["status"]) => {
    if (draggingId) { handleStatusChange(draggingId, status); setDraggingId(null); }
    setDragOverStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
          const cfg = STATUS_CONFIG[status];
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
                      project={projectForTask(task)}
                      todo={todoForTask(task)}
                      assignees={assigneesForTask(task)}
                      onDragStart={() => handleDragStart(task.id)}
                      onStatusChange={handleStatusChange}
                      isDragging={draggingId === task.id}
                      onClick={() => setEditingTaskId(task.id)}
                    />
                  ))
                )}
                {/* ＋ タスクを追加 */}
                <button
                  onClick={() => { setAddToStatus(status); setShowAddModal(true); }}
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

      {showAddModal && (
        <AddTaskModal
          defaultStatus={addToStatus}
          projects={projects}
          members={members}
          taskForces={taskForces}
          todos={todos}
          defaultProjectId={selectedProject?.id ?? projects[0]?.id ?? ""}
          onAdd={handleAddTask}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onUpdated={() => setEditingTaskId(null)}
          onDeleted={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}

// ===== タスクカード =====

function TaskCard({
  task, project, todo, assignees, onDragStart, onStatusChange, isDragging, onClick,
}: {
  task: Task;
  project?: Project;
  todo?: ToDo;
  assignees: Member[];
  onDragStart: () => void;
  onStatusChange: (id: string, status: Task["status"]) => void;
  isDragging: boolean;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDone = task.status === "done";
  const isOverdue = task.due_date && !isDone && task.due_date < todayStr();

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
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

      {/* タスク名 */}
      <div style={{
        fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)",
        marginBottom: "7px", lineHeight: 1.4,
        textDecoration: isDone ? "line-through" : "none",
        opacity: isDone ? 0.6 : 1,
      }}>
        {task.name}
      </div>

      {/* フッター */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        {/* 複数担当者アバター */}
        {assignees.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
            {assignees.slice(0, 3).map(m => <Avatar key={m.id} member={m} size={16} />)}
            {assignees.length > 3 && (
              <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>+{assignees.length - 3}</span>
            )}
          </div>
        )}
        <span style={{
          fontSize: "10px", flex: 1,
          color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
          fontWeight: isOverdue ? "500" : "400",
        }}>
          {task.due_date ? `〜${task.due_date.slice(5).replace("-", "/")}` : ""}
        </span>
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
        {task.priority && PRIORITY_CONFIG[task.priority] && (
          <span style={{
            fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
            background: PRIORITY_CONFIG[task.priority].bg,
            color: PRIORITY_CONFIG[task.priority].color,
            flexShrink: 0,
          }}>
            {PRIORITY_CONFIG[task.priority].label}
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
}

// ===== タスク追加モーダル =====

function AddTaskModal({
  defaultStatus, projects, members, taskForces, todos, defaultProjectId, onAdd, onClose,
}: {
  defaultStatus: Task["status"];
  projects: Project[];
  members: Member[];
  taskForces: TaskForce[];
  todos: ToDo[];
  defaultProjectId: string;
  onAdd: (name: string, assigneeIds: string[], projectId: string | null, dueDate: string, priority: Task["priority"], estimatedHours: number | null, tfIds: string[], extraProjectIds: string[], todoIds: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(members[0]?.id ? [members[0].id] : []);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>(null);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [selectedTfIds, setSelectedTfIds] = useState<string[]>([]);
  const [extraProjectIds, setExtraProjectIds] = useState<string[]>([]);
  const [todoIds, setTodoIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name, assigneeIds, projectId || null, dueDate, priority, estimatedHours ? Number(estimatedHours) : null, selectedTfIds, extraProjectIds, todoIds);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "80px", zIndex: 100,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="animate-fadeIn"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-secondary)",
          borderRadius: "var(--radius-lg)",
          width: "480px", overflow: "hidden",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", padding: "12px 16px",
          borderBottom: "1px solid var(--color-border-primary)",
        }}>
          <span style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
            タスクを追加
          </span>
          <span style={{
            fontSize: "10px", padding: "2px 7px", borderRadius: "var(--radius-full)",
            background: STATUS_CONFIG[defaultStatus].bg,
            color: STATUS_CONFIG[defaultStatus].color,
            border: `1px solid ${STATUS_CONFIG[defaultStatus].border}`,
          }}>
            {STATUS_CONFIG[defaultStatus].label}
          </span>
          <button onClick={onClose} style={{ marginLeft: "10px", background: "none", border: "none", fontSize: "16px", color: "var(--color-text-tertiary)", cursor: "pointer" }}>×</button>
        </div>

        {/* フォーム */}
        <div style={{ padding: "16px" }}>
          <Field label="タスク名" required>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：メンバーへのヒアリング"
              maxLength={200}
              style={inputStyle}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            {/* 担当者（複数選択） */}
            <Field label="担当者">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: assigneeIds.length > 0 ? "6px" : 0 }}>
                {assigneeIds.map(id => {
                  const m = members.find(mb => mb.id === id);
                  return m ? (
                    <span key={id} style={chipStyle}>
                      <Avatar member={m} size={14} />
                      {m.short_name}
                      <button onClick={() => setAssigneeIds(prev => prev.filter(i => i !== id))} style={chipRemoveStyle}>×</button>
                    </span>
                  ) : null;
                })}
              </div>
              <select defaultValue="" onChange={e => {
                if (!e.target.value) return;
                setAssigneeIds(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value]);
                e.target.value = "";
              }} style={inputStyle}>
                <option value="">＋ 追加...</option>
                {members.filter(m => !assigneeIds.includes(m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </Field>
            <Field label="プロジェクト（任意）">
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
                <option value="">なし</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name.slice(0, 20)}</option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            <Field label="終了日（任意）">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="優先度（任意）">
              <select value={priority ?? ""} onChange={e => setPriority((e.target.value || null) as Task["priority"])} style={inputStyle}>
                <option value="">なし</option>
                <option value="high">高</option>
                <option value="mid">中</option>
                <option value="low">低</option>
              </select>
            </Field>
          </div>

          {/* 詳細オプション折りたたみ */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              marginTop: "12px", width: "100%", padding: "6px",
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-secondary)", border: "none",
              borderRadius: "var(--radius-md)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
            }}
          >
            <span style={{ transition: "transform 0.15s", display: "inline-block", transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            詳細オプション（工数・タスクフォース・ToDo紐づけ）
          </button>

          {showAdvanced && (
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <Field label="工数（任意・時間）">
                <input
                  type="number" min="0" step="0.5"
                  value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                  placeholder="例：2"
                  style={inputStyle}
                />
              </Field>

              <Field label="タスクフォース（任意）">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: selectedTfIds.length > 0 ? "6px" : 0 }}>
                  {selectedTfIds.map(tfId => {
                    const tf = taskForces.find(t => t.id === tfId);
                    return tf ? (
                      <span key={tfId} style={chipStyle}>
                        {tf.tf_number ? `${tf.tf_number} ` : ""}{tf.name}
                        <button onClick={() => setSelectedTfIds(prev => prev.filter(id => id !== tfId))} style={chipRemoveStyle}>×</button>
                      </span>
                    ) : null;
                  })}
                </div>
                <select defaultValue="" onChange={e => {
                  if (!e.target.value) return;
                  setSelectedTfIds(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value]);
                  e.target.value = "";
                }} style={inputStyle}>
                  <option value="">＋ 追加...</option>
                  {taskForces.filter(tf => !selectedTfIds.includes(tf.id)).map(tf => (
                    <option key={tf.id} value={tf.id}>{tf.tf_number ? `${tf.tf_number} ` : ""}{tf.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="追加プロジェクト（任意）">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: extraProjectIds.length > 0 ? "6px" : 0 }}>
                  {extraProjectIds.map(pjId => {
                    const pj = projects.find(p => p.id === pjId);
                    return pj ? (
                      <span key={pjId} style={chipStyle}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: pj.color_tag, flexShrink: 0, display: "inline-block" }} />
                        {pj.name}
                        <button onClick={() => setExtraProjectIds(prev => prev.filter(id => id !== pjId))} style={chipRemoveStyle}>×</button>
                      </span>
                    ) : null;
                  })}
                </div>
                <select defaultValue="" onChange={e => {
                  if (!e.target.value) return;
                  setExtraProjectIds(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value]);
                  e.target.value = "";
                }} style={inputStyle}>
                  <option value="">＋ 追加...</option>
                  {projects.filter(p => p.id !== projectId && !extraProjectIds.includes(p.id)).map(p => (
                    <option key={p.id} value={p.id}>{p.name.slice(0, 20)}</option>
                  ))}
                </select>
              </Field>

              {todos.length > 0 && (
                <Field label="ToDo（複数選択可）">
                  <div style={{
                    border: `1px solid ${inputStyle.border}`,
                    borderRadius: inputStyle.borderRadius,
                    padding: "6px 8px", maxHeight: "100px", overflowY: "auto",
                    background: inputStyle.background,
                  }}>
                    {todos.map(td => (
                      <label key={td.id} style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "3px 0", cursor: "pointer", fontSize: "12px", color: "var(--color-text-primary)" }}>
                        <input
                          type="checkbox"
                          checked={todoIds.includes(td.id)}
                          onChange={e => setTodoIds(prev => e.target.checked ? [...prev, td.id] : prev.filter(id => id !== td.id))}
                          style={{ marginTop: "2px", flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                        />
                        <span>{td.title.split("\n")[0].slice(0, 40)}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          )}
        </div>

        {/* フッター */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 16px", borderTop: "1px solid var(--color-border-primary)",
        }}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>Enter で追加</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onClose} style={ghostBtnStyle}>キャンセル</button>
            <button
              disabled={!name.trim()}
              onClick={handleAdd}
              style={{
                ...primaryBtnStyle,
                opacity: name.trim() ? 1 : 0.45,
                cursor: name.trim() ? "pointer" : "not-allowed",
              }}
            >
              追加する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
        {label}
        {required && <span style={{ color: "var(--color-text-danger)", marginLeft: "3px" }}>*</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
  outline: "none",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "5px 12px", fontSize: "12px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 16px", fontSize: "12px", fontWeight: "500",
  background: "var(--color-bg-info)", color: "var(--color-text-info)",
  border: "1px solid var(--color-border-info)",
  borderRadius: "var(--radius-md)",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "4px",
  padding: "2px 7px", borderRadius: "var(--radius-full)",
  fontSize: "11px", background: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)", border: "1px solid var(--color-border-primary)",
};

const chipRemoveStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "0", lineHeight: 1, fontSize: "12px",
  color: "var(--color-text-tertiary)",
};

import React from "react";

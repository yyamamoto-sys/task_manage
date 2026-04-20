// src/components/task/TaskEditModal.tsx
//
// 【設計意図】
// タスク詳細・編集モーダル。カンバン・リスト・ガントから共通で開く。
// 表示モードと編集モードを切り替え式にする。
// - 表示モード：全フィールドを読みやすく表示。コメントのURL自動リンク。
// - 編集モード：全フィールドをインライン編集。保存でSupabaseに反映（AppDataContext経由）。
// 削除は確認ダイアログ付き論理削除。

import { useState, useCallback, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo, TaskForce, TaskTaskForce, TaskProject } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog } from "../../lib/dialog";

interface Props {
  taskId: string;
  currentUser: Member;
  onClose: () => void;
  onUpdated?: (task: Task) => void;
  onDeleted?: (taskId: string) => void;
}

const STATUS_LABELS: Record<Task["status"], string> = {
  todo: "ToDo", in_progress: "進行中", done: "完了",
};
const STATUS_COLORS: Record<Task["status"], { bg: string; color: string; border: string }> = {
  todo:        { bg: "var(--color-bg-tertiary)",  color: "var(--color-text-secondary)", border: "var(--color-border-secondary)" },
  in_progress: { bg: "var(--color-bg-info)",      color: "var(--color-text-info)",      border: "var(--color-border-info)" },
  done:        { bg: "var(--color-bg-success)",   color: "var(--color-text-success)",   border: "var(--color-border-success)" },
};
const PRIORITY_LABELS: Record<string, string> = { high: "高", mid: "中", low: "低" };
const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  high: { bg: "var(--color-bg-danger)",  color: "var(--color-text-danger)"  },
  mid:  { bg: "var(--color-bg-warning)", color: "var(--color-text-warning)" },
  low:  { bg: "var(--color-bg-success)", color: "var(--color-text-success)" },
};

function todayStr() { return new Date().toISOString().split("T")[0]; }

// URLとネットワークパスを検出してリンク表示
function renderComment(text: string): React.ReactNode {
  const urlPat = /https?:\/\/[^\s]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m;
  while ((m = urlPat.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noreferrer"
        style={{ color: "var(--color-text-info)", textDecoration: "underline", wordBreak: "break-all" }}>
        {m[0]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function TaskEditModal({ taskId, currentUser, onClose, onUpdated, onDeleted }: Props) {
  const {
    tasks: allTasks, members: allMembers, projects: allProjects,
    taskForces: allTaskForces, todos: allTodos,
    taskTaskForces: allTaskTaskForces, taskProjects: allTaskProjects,
    saveTask, deleteTask, addTaskTaskForce, removeTaskTaskForce, addTaskProject, removeTaskProject,
  } = useAppData();
  const isMobile = useIsMobile();

  const members    = useMemo(() => allMembers.filter(m => !m.is_deleted), [allMembers]);
  const projects   = useMemo(() => allProjects.filter(p => !p.is_deleted), [allProjects]);
  const taskForces = useMemo(() => allTaskForces.filter(t => !t.is_deleted), [allTaskForces]);
  const todos      = useMemo(() => allTodos.filter(t => !t.is_deleted), [allTodos]);

  // このタスクに紐づくTF
  const linkedTfs = useMemo(() => {
    const tfIds = allTaskTaskForces.filter(t => t.task_id === taskId).map(t => t.tf_id);
    return taskForces.filter(tf => tfIds.includes(tf.id));
  }, [allTaskTaskForces, taskForces, taskId]);

  // このタスクに紐づく追加プロジェクト
  const linkedExtraProjects = useMemo(() => {
    const pjIds = allTaskProjects.filter(t => t.task_id === taskId).map(t => t.project_id);
    return projects.filter(p => pjIds.includes(p.id));
  }, [allTaskProjects, projects, taskId]);
  const originalTask = allTasks.find(t => t.id === taskId);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name:                 originalTask?.name ?? "",
    status:               originalTask?.status ?? "todo" as Task["status"],
    priority:             originalTask?.priority ?? "",
    assignee_member_ids:  originalTask?.assignee_member_ids?.length
                            ? originalTask.assignee_member_ids
                            : originalTask?.assignee_member_id ? [originalTask.assignee_member_id] : [] as string[],
    project_id:           originalTask?.project_id ?? null as string | null,
    todo_ids:             originalTask?.todo_ids ?? [] as string[],
    start_date:           originalTask?.start_date ?? "",
    due_date:             originalTask?.due_date ?? "",
    estimated_hours:      originalTask?.estimated_hours?.toString() ?? "",
    comment:              originalTask?.comment ?? "",
  });
  const [saved, setSaved] = useState(false);

  if (!originalTask) return null;

  const assigneeMembers = members.filter(m =>
    (originalTask.assignee_member_ids?.length
      ? originalTask.assignee_member_ids
      : originalTask.assignee_member_id ? [originalTask.assignee_member_id] : []
    ).includes(m.id)
  );
  const project    = projects.find(p => p.id === originalTask.project_id);
  const linkedTodos = todos.filter(t => (originalTask.todo_ids ?? []).includes(t.id));
  // ToDo選択肢をTFごとにグループ化
  const todosByTf = useMemo(() => {
    return taskForces
      .filter(tf => todos.some(t => t.tf_id === tf.id))
      .map(tf => ({ tf, items: todos.filter(t => t.tf_id === tf.id) }));
  }, [taskForces, todos]);
  const isOverdue = originalTask.due_date
    && originalTask.due_date < todayStr()
    && originalTask.status !== "done";

  const handleSave = useCallback(() => {
    const hours = parseFloat(form.estimated_hours);
    const updated: Task = {
      ...originalTask,
      name:                form.name.trim() || originalTask.name,
      status:              form.status,
      priority:            (form.priority as Task["priority"]) || null,
      assignee_member_ids: form.assignee_member_ids,
      assignee_member_id:  form.assignee_member_ids[0] ?? "",
      project_id:          form.project_id || null,
      todo_ids:            form.todo_ids,
      start_date:          form.start_date || null,
      due_date:            form.due_date || null,
      estimated_hours:     isNaN(hours) ? null : hours,
      comment:             form.comment,
      updated_at:          new Date().toISOString(),
      updated_by:          currentUser.id,
    };
    saveTask(updated);
    setSaved(true);
    setTimeout(() => { setSaved(false); setEditing(false); }, 800);
    onUpdated?.(updated);
  }, [form, originalTask, saveTask, onUpdated]);

  const handleDelete = useCallback(async () => {
    if (!await confirmDialog(`「${originalTask.name}」を削除しますか？`)) return;
    deleteTask(taskId, currentUser.id);
    onDeleted?.(taskId);
    onClose();
  }, [originalTask.name, taskId, currentUser.id, deleteTask, onDeleted, onClose]);

  const statusArr: Task["status"][] = ["todo", "in_progress", "done"];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: isMobile ? "flex-end" : "flex-start",
        justifyContent: "center",
        paddingTop: isMobile ? 0 : "60px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="animate-fadeIn"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-secondary)",
          borderRadius: isMobile
            ? "var(--radius-lg) var(--radius-lg) 0 0"
            : "var(--radius-lg)",
          width: isMobile ? "100%" : "520px",
          maxHeight: isMobile ? "92vh" : "80vh",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* ===== ヘッダー ===== */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
          flexShrink: 0,
        }}>
          {/* プロジェクトカラーバー */}
          {project && (
            <div style={{
              width: 4, height: 20, borderRadius: 2,
              background: project.color_tag, flexShrink: 0,
            }} />
          )}

          {editing ? (
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
              maxLength={200}
              style={{
                flex: 1, fontSize: "14px", fontWeight: "500",
                border: "none", outline: "none", padding: "2px 4px",
                borderBottom: "1.5px solid var(--color-brand)",
                color: "var(--color-text-primary)",
                background: "transparent",
              }}
            />
          ) : (
            <span style={{
              flex: 1, fontSize: "14px", fontWeight: "500",
              color: "var(--color-text-primary)",
            }}>
              {originalTask.name}
            </span>
          )}

          {/* アクションボタン */}
          {!editing && (
            <button onClick={() => setEditing(true)} style={ghostBtnSm}>
              ✏ 編集
            </button>
          )}
          {editing && (
            <>
              <button onClick={handleSave} style={{
                ...primaryBtnSm,
                background: saved ? "var(--color-bg-success)" : undefined,
                color: saved ? "var(--color-text-success)" : undefined,
                border: saved ? "1px solid var(--color-border-success)" : undefined,
              }}>
                {saved ? "✓ 保存済み" : "保存"}
              </button>
              <button onClick={() => setEditing(false)} style={ghostBtnSm}>
                キャンセル
              </button>
            </>
          )}
          <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "16px", color: "var(--color-text-tertiary)", flexShrink: 0,
          }}>✕</button>
        </div>

        {/* ===== ボディ ===== */}
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>

          {/* ステータス（セグメントコントロール） */}
          <FieldSection label="ステータス">
            <div style={{ display: "flex", gap: "4px" }}>
              {statusArr.map(s => {
                const cfg = STATUS_COLORS[s];
                const isActive = editing ? form.status === s : originalTask.status === s;
                return (
                  <button key={s}
                    onClick={() => editing && setForm(f => ({ ...f, status: s }))}
                    style={{
                      padding: "4px 12px", fontSize: "11px", borderRadius: "var(--radius-md)",
                      fontWeight: isActive ? "500" : "400",
                      background: isActive ? cfg.bg : "transparent",
                      color: isActive ? cfg.color : "var(--color-text-tertiary)",
                      border: isActive ? `1px solid ${cfg.border}` : "1px solid var(--color-border-primary)",
                      cursor: editing ? "pointer" : "default",
                      transition: "all 0.1s",
                    }}>
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </FieldSection>

          {/* 優先度（セグメントコントロール） */}
          <FieldSection label="優先度">
            <div style={{ display: "flex", gap: "4px" }}>
              {["", "high", "mid", "low"].map(p => {
                const isActive = editing ? form.priority === p : (originalTask.priority ?? "") === p;
                const cfg = p ? PRIORITY_COLORS[p] : null;
                return (
                  <button key={p}
                    onClick={() => editing && setForm(f => ({ ...f, priority: p }))}
                    style={{
                      padding: "4px 10px", fontSize: "11px", borderRadius: "var(--radius-md)",
                      fontWeight: isActive ? "500" : "400",
                      background: isActive && cfg ? cfg.bg : isActive ? "var(--color-bg-secondary)" : "transparent",
                      color: isActive && cfg ? cfg.color : isActive ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                      border: isActive ? "1px solid currentColor" : "1px solid var(--color-border-primary)",
                      cursor: editing ? "pointer" : "default",
                      transition: "all 0.1s",
                      opacity: isActive ? 1 : 0.5,
                    }}>
                    {p ? PRIORITY_LABELS[p] : "なし"}
                  </button>
                );
              })}
            </div>
          </FieldSection>

          {/* 担当者（複数可） */}
          <FieldSection label="担当者">
            {editing ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: form.assignee_member_ids.length > 0 ? "6px" : 0 }}>
                  {form.assignee_member_ids.map(id => {
                    const m = members.find(x => x.id === id);
                    if (!m) return null;
                    return (
                      <span key={id} style={chipStyle}>
                        <Avatar member={m} size={14} />
                        {m.display_name}
                        <button
                          onClick={() => setForm(f => ({ ...f, assignee_member_ids: f.assignee_member_ids.filter(i => i !== id) }))}
                          style={chipRemoveBtn}>×</button>
                      </span>
                    );
                  })}
                </div>
                <select
                  defaultValue=""
                  onChange={e => {
                    const id = e.target.value;
                    if (id && !form.assignee_member_ids.includes(id))
                      setForm(f => ({ ...f, assignee_member_ids: [...f.assignee_member_ids, id] }));
                    e.target.value = "";
                  }}
                  style={inputSm}>
                  <option value="">＋ 担当者を追加...</option>
                  {members.filter(m => !form.assignee_member_ids.includes(m.id)).map(m => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </>
            ) : assigneeMembers.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {assigneeMembers.map(m => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Avatar member={m} size={20} />
                    <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {m.display_name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>未担当</span>
            )}
          </FieldSection>

          {/* プロジェクト */}
          <FieldSection label="プロジェクト">
            {editing ? (
              <select value={form.project_id ?? ""}
                onChange={e => setForm(f => ({ ...f, project_id: e.target.value || null }))}
                style={inputSm}>
                <option value="">なし</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : project ? (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: project.color_tag, display: "inline-block",
                }} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {project.name}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>なし</span>
            )}
          </FieldSection>

          {/* ToDo */}
          <FieldSection label="ToDo（OKR系）">
            {editing ? (
              <div style={{
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                padding: "6px 10px",
                maxHeight: "150px",
                overflowY: "auto",
                background: "var(--color-bg-primary)",
              }}>
                {todosByTf.length === 0 && (
                  <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>ToDoがありません</span>
                )}
                {todosByTf.map(({ tf, items }) => (
                  <div key={tf.id}>
                    <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", padding: "4px 0 2px", fontWeight: 600 }}>
                      {tf.tf_number ? `TF ${tf.tf_number}` : ""}{tf.tf_number && tf.name ? " — " : ""}{tf.name}
                    </div>
                    {items.map(todo => (
                      <label key={todo.id} style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "3px 0", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={form.todo_ids.includes(todo.id)}
                          onChange={e => setForm(f => ({
                            ...f,
                            todo_ids: e.target.checked
                              ? [...f.todo_ids, todo.id]
                              : f.todo_ids.filter(id => id !== todo.id),
                          }))}
                          style={{ marginTop: "2px", flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                          {todo.title.slice(0, 50)}{todo.title.length > 50 ? "…" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            ) : linkedTodos.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {linkedTodos.map(td => {
                  const tf = taskForces.find(t => t.id === td.tf_id);
                  return (
                    <div key={td.id} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                      {tf && (
                        <span style={{
                          fontSize: "10px", padding: "1px 6px", borderRadius: "3px", marginRight: "6px",
                          background: "var(--color-brand-light)", color: "var(--color-text-purple)",
                          border: "1px solid var(--color-brand-border)",
                        }}>
                          {tf.tf_number ? `TF ${tf.tf_number} ` : ""}{tf.name}
                        </span>
                      )}
                      {td.title.slice(0, 50)}{td.title.length > 50 ? "…" : ""}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
            )}
          </FieldSection>

          {/* 追加プロジェクト */}
          <FieldSection label="追加プロジェクト">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: linkedExtraProjects.length > 0 || editing ? "6px" : 0 }}>
              {linkedExtraProjects.map(p => (
                <span key={p.id} style={chipStyle}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color_tag, flexShrink: 0 }} />
                  {p.name}
                  {editing && (
                    <button onClick={() => removeTaskProject(taskId, p.id)} style={chipRemoveBtn}>×</button>
                  )}
                </span>
              ))}
              {linkedExtraProjects.length === 0 && !editing && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
              )}
            </div>
            {editing && (
              <select
                defaultValue=""
                onChange={e => {
                  if (!e.target.value) return;
                  addTaskProject({ task_id: taskId, project_id: e.target.value });
                  e.target.value = "";
                }}
                style={inputSm}
              >
                <option value="">＋ プロジェクトを追加...</option>
                {projects
                  .filter(p => p.id !== form.project_id && !linkedExtraProjects.find(ep => ep.id === p.id))
                  .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                }
              </select>
            )}
          </FieldSection>

          {/* タスクフォース */}
          <FieldSection label="タスクフォース">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: linkedTfs.length > 0 || editing ? "6px" : 0 }}>
              {linkedTfs.map(tf => (
                <span key={tf.id} style={chipStyle}>
                  {tf.tf_number ? <span style={{ fontWeight: "600", marginRight: 2 }}>{tf.tf_number}</span> : null}
                  {tf.name}
                  {editing && (
                    <button onClick={() => removeTaskTaskForce(taskId, tf.id)} style={chipRemoveBtn}>×</button>
                  )}
                </span>
              ))}
              {linkedTfs.length === 0 && !editing && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未設定</span>
              )}
            </div>
            {editing && taskForces.length > 0 && (
              <select
                defaultValue=""
                onChange={e => {
                  if (!e.target.value) return;
                  addTaskTaskForce({ task_id: taskId, tf_id: e.target.value });
                  e.target.value = "";
                }}
                style={inputSm}
              >
                <option value="">＋ タスクフォースを追加...</option>
                {taskForces
                  .filter(tf => !linkedTfs.find(lt => lt.id === tf.id))
                  .map(tf => (
                    <option key={tf.id} value={tf.id}>
                      {tf.tf_number ? `${tf.tf_number} ` : ""}{tf.name}
                    </option>
                  ))
                }
              </select>
            )}
            {editing && taskForces.length === 0 && (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                管理画面でTask Forceを先に登録してください
              </span>
            )}
          </FieldSection>

          {/* 開始日 + 終了日 + 工数（3列） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <FieldSection label="開始日">
              {editing ? (
                <input type="date" value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  style={inputSm} />
              ) : (
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {originalTask.start_date ?? "未設定"}
                </span>
              )}
            </FieldSection>

            <FieldSection label="終了日">
              {editing ? (
                <input type="date" value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  style={inputSm} />
              ) : (
                <span style={{
                  fontSize: "12px",
                  color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                  fontWeight: isOverdue ? "500" : "400",
                }}>
                  {originalTask.due_date ?? "未設定"}
                  {isOverdue && (
                    <span style={{ marginLeft: 5, fontSize: "10px",
                      background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
                      padding: "1px 5px", borderRadius: "3px" }}>
                      期限超過
                    </span>
                  )}
                </span>
              )}
            </FieldSection>

            <FieldSection label="工数（時間）">
              {editing ? (
                <input type="number" min="0" step="0.5"
                  value={form.estimated_hours}
                  onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))}
                  placeholder="例：2.5"
                  style={inputSm} />
              ) : (
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {originalTask.estimated_hours != null
                    ? `${originalTask.estimated_hours}h`
                    : "未設定"}
                </span>
              )}
            </FieldSection>
          </div>

          {/* コメント */}
          <FieldSection label="コメント・メモ">
            {editing ? (
              <textarea
                value={form.comment}
                onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                rows={5}
                placeholder={
                  "メモやURLを入力できます\n" +
                  "例：https://docs.example.com\n" +
                  "URLは表示時に自動でリンクになります"
                }
                style={{
                  ...inputSm,
                  resize: "vertical",
                  lineHeight: 1.6,
                  minHeight: "80px",
                }}
              />
            ) : originalTask.comment ? (
              <div style={{
                fontSize: "12px", color: "var(--color-text-secondary)",
                lineHeight: 1.7, whiteSpace: "pre-wrap",
                background: "var(--color-bg-secondary)",
                padding: "8px 10px", borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border-primary)",
              }}>
                {renderComment(originalTask.comment)}
              </div>
            ) : (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                コメントなし
              </span>
            )}
          </FieldSection>

          {/* メタ情報 */}
          <div style={{
            marginTop: "16px", padding: "8px 10px",
            background: "var(--color-bg-secondary)",
            borderRadius: "var(--radius-md)",
            fontSize: "10px", color: "var(--color-text-tertiary)",
            lineHeight: 1.8,
          }}>
            <div>タスクID：{originalTask.id.slice(0, 8)}…</div>
            <div>作成日：{originalTask.created_at ? new Date(originalTask.created_at).toLocaleDateString("ja-JP") : "—"}</div>
          </div>
        </div>

        {/* ===== フッター ===== */}
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--color-border-primary)",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", flexShrink: 0,
          background: "var(--color-bg-secondary)",
        }}>
          <button onClick={handleDelete} style={{
            padding: "5px 12px", fontSize: "11px",
            color: "var(--color-text-danger)",
            border: "1px solid var(--color-border-danger)",
            borderRadius: "var(--radius-md)", cursor: "pointer",
            background: "transparent",
            transition: "background 0.1s",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-danger)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            🗑 削除
          </button>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
            {editing ? "編集中" : "Escで閉じる"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{
        fontSize: "10px", fontWeight: "500",
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase", letterSpacing: "0.05em",
        marginBottom: "5px",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputSm: React.CSSProperties = {
  width: "100%", padding: "5px 8px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  outline: "none",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "4px",
  fontSize: "11px", padding: "2px 8px",
  background: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "99px", color: "var(--color-text-secondary)",
};

const chipRemoveBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "0", color: "var(--color-text-tertiary)",
  fontSize: "11px", lineHeight: 1, marginLeft: "2px",
};

const ghostBtnSm: React.CSSProperties = {
  padding: "4px 10px", fontSize: "11px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};

const primaryBtnSm: React.CSSProperties = {
  padding: "4px 12px", fontSize: "11px", fontWeight: "500",
  background: "var(--color-bg-info)", color: "var(--color-text-info)",
  border: "1px solid var(--color-border-info)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
};

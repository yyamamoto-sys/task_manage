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
import type { Member, Project, Task } from "../../lib/localData/types";
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
  high: { bg: "#fee2e2", color: "#b91c1c" },
  mid:  { bg: "#fef3c7", color: "#92400e" },
  low:  { bg: "#dcfce7", color: "#15803d" },
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
  const { tasks: allTasks, members: allMembers, projects: allProjects, saveTask, deleteTask } = useAppData();
  const isMobile = useIsMobile();

  const members  = useMemo(() => allMembers.filter(m => !m.is_deleted), [allMembers]);
  const projects = useMemo(() => allProjects.filter(p => !p.is_deleted), [allProjects]);
  const originalTask = allTasks.find(t => t.id === taskId);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name:                originalTask?.name ?? "",
    status:              originalTask?.status ?? "todo" as Task["status"],
    priority:            originalTask?.priority ?? "",
    assignee_member_id:  originalTask?.assignee_member_id ?? "",
    project_id:          originalTask?.project_id ?? "",
    due_date:            originalTask?.due_date ?? "",
    estimated_hours:     originalTask?.estimated_hours?.toString() ?? "",
    comment:             originalTask?.comment ?? "",
  });
  const [saved, setSaved] = useState(false);

  if (!originalTask) return null;

  const member  = members.find(m => m.id === originalTask.assignee_member_id);
  const project = projects.find(p => p.id === originalTask.project_id);
  const isOverdue = originalTask.due_date
    && originalTask.due_date < todayStr()
    && originalTask.status !== "done";

  const handleSave = useCallback(() => {
    const hours = parseFloat(form.estimated_hours);
    const updated: Task = {
      ...originalTask,
      name:               form.name.trim() || originalTask.name,
      status:             form.status,
      priority:           (form.priority as Task["priority"]) || null,
      assignee_member_id: form.assignee_member_id,
      project_id:         form.project_id,
      due_date:           form.due_date || null,
      estimated_hours:    isNaN(hours) ? null : hours,
      comment:            form.comment,
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
          <button onClick={onClose} style={{
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

          {/* 担当者 */}
          <FieldSection label="担当者">
            {editing ? (
              <select value={form.assignee_member_id}
                onChange={e => setForm(f => ({ ...f, assignee_member_id: e.target.value }))}
                style={inputSm}>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            ) : member ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Avatar member={member} size={20} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {member.display_name}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>未担当</span>
            )}
          </FieldSection>

          {/* プロジェクト */}
          <FieldSection label="プロジェクト">
            {editing ? (
              <select value={form.project_id}
                onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                style={inputSm}>
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
            ) : null}
          </FieldSection>

          {/* 期日 + 工数（横並び） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
            <div>作成日：{originalTask.id ? "—" : "—"}</div>
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

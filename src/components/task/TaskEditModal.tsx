// src/components/task/TaskEditModal.tsx
//
// タスク詳細・編集モーダル（モバイル時のフォールバック・各ビューから共通利用）。
// 全フィールドを 600ms デバウンス自動保存。削除は確認ダイアログ付き論理削除。

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAppStore } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Task } from "../../lib/localData/types";
import {
  TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE,
  getAssigneeIds, buildTfLabelMap,
} from "../../lib/taskMeta";
import { todayStr } from "../../lib/date";
import { getEligibleTfIds } from "../../lib/okr/eligibleTaskForces";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  taskId: string;
  currentUser: Member;
  onClose: () => void;
  onDeleted?: (taskId: string) => void;
}

export function TaskEditModal({ taskId, currentUser, onClose, onDeleted }: Props) {
  const allTasks            = useAppStore(s => s.tasks);
  const allMembers          = useAppStore(s => s.members);
  const allProjects         = useAppStore(s => s.projects);
  const allTaskForces       = useAppStore(s => s.taskForces);
  const allKeyResults       = useAppStore(s => s.keyResults);
  const allTaskTaskForces   = useAppStore(s => s.taskTaskForces);
  const allTaskProjects     = useAppStore(s => s.taskProjects);
  const allQuarterlyObjs    = useAppStore(s => s.quarterlyObjectives);
  const allQuarterlyKrTfs   = useAppStore(s => s.quarterlyKrTaskForces);
  const objective           = useAppStore(s => s.objective);
  const saveTask            = useAppStore(s => s.saveTask);
  const deleteTask          = useAppStore(s => s.deleteTask);
  const addTaskTaskForce    = useAppStore(s => s.addTaskTaskForce);
  const removeTaskTaskForce = useAppStore(s => s.removeTaskTaskForce);
  const addTaskProject      = useAppStore(s => s.addTaskProject);
  const removeTaskProject   = useAppStore(s => s.removeTaskProject);
  const isMobile = useIsMobile();

  const members    = useMemo(() => allMembers.filter(m => !m.is_deleted), [allMembers]);
  const projects   = useMemo(() => allProjects.filter(p => !p.is_deleted), [allProjects]);
  const taskForces = useMemo(() => allTaskForces.filter(t => !t.is_deleted), [allTaskForces]);
  const keyResults = useMemo(() => allKeyResults.filter(k => !k.is_deleted), [allKeyResults]);

  const tfLabelById = useMemo(() => buildTfLabelMap(taskForces, keyResults), [taskForces, keyResults]);

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

  const eligibleTfIds = useMemo(
    () => getEligibleTfIds(originalTask, objective, allQuarterlyObjs, allQuarterlyKrTfs),
    [originalTask?.due_date, originalTask?.start_date, objective, allQuarterlyObjs, allQuarterlyKrTfs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [form, setForm] = useState({
    name:                 originalTask?.name ?? "",
    status:               originalTask?.status ?? "todo" as Task["status"],
    priority:             originalTask?.priority ?? "",
    assignee_member_ids:  originalTask ? getAssigneeIds(originalTask) : [] as string[],
    project_id:           originalTask?.project_id ?? null as string | null,
    start_date:           originalTask?.start_date ?? "",
    due_date:             originalTask?.due_date ?? "",
    estimated_hours:      originalTask?.estimated_hours?.toString() ?? "",
    comment:              originalTask?.comment ?? "",
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  // 自動保存ハンドラを ref に保持し、useEffect の依存配列を form のみに絞る
  // （originalTask の realtime 更新などで saveTask が再発火しないようにする）
  const handleAutoSaveRef = useRef<() => Promise<void>>(async () => {});
  handleAutoSaveRef.current = async () => {
    if (!originalTask) return;
    const hours = parseFloat(form.estimated_hours);
    const updated: Task = {
      ...originalTask,
      name:                form.name.trim() || originalTask.name,
      status:              form.status,
      priority:            (form.priority as Task["priority"]) || null,
      assignee_member_ids: form.assignee_member_ids,
      assignee_member_id:  form.assignee_member_ids[0] ?? "",
      project_id:          form.project_id || null,
      start_date:          form.start_date || null,
      due_date:            form.due_date || null,
      estimated_hours:     isNaN(hours) ? null : hours,
      comment:             form.comment,
      // updated_at は触らない（CLAUDE.md Section 5）。zustand 側で
      // フォーム時点の値を expectedUpdatedAt として saveWithLock に渡す
      updated_by:          currentUser.id,
    };
    try {
      await saveTask(updated);
      setSaveStatus("saved");
      // 自動保存ではモーダルを閉じない。親側は zustand 経由で自動的に
      // 再レンダーされるので、明示的な「保存後のフック」呼び出しは不要。
      setTimeout(() => {
        setSaveStatus(s => (s === "saved" ? "idle" : s));
      }, 1500);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  // 自動保存：form 変更後 600ms のデバウンスで保存
  // 自己衝突防止のシリアライズは zustand saveTask 側に集約されているため、
  // ここでは単純にデバウンスで saveTask を呼ぶだけで OK（同一 task id への
  // 連続保存は zustand が直列化して expectedUpdatedAt を正しく読み直す）。
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setSaveStatus("saving");
    setSaveError(null);
    const timer = setTimeout(() => {
      void handleAutoSaveRef.current();
    }, 600);
    return () => clearTimeout(timer);
  }, [form]);

  const handleDelete = useCallback(async () => {
    if (!originalTask) return;
    if (!await confirmDialog(`「${originalTask.name}」を削除しますか？`)) return;
    deleteTask(taskId, currentUser.id);
    onDeleted?.(taskId);
    onClose();
  }, [originalTask, taskId, currentUser.id, deleteTask, onDeleted, onClose]);

  // 全 Hooks を呼び終えた後に early return（react-hooks/rules-of-hooks 遵守）
  if (!originalTask) return null;

  const project = projects.find(p => p.id === originalTask.project_id);
  const isOverdue = !!form.due_date && form.due_date < todayStr() && form.status !== "done";

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

          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            maxLength={200}
            placeholder="タスク名"
            aria-label="タスク名"
            style={{
              flex: 1, fontSize: "14px", fontWeight: "500",
              border: "none", outline: "none", padding: "4px 6px",
              borderBottom: "1px solid transparent",
              color: "var(--color-text-primary)",
              background: "transparent",
              transition: "border-color 0.1s",
            }}
            onFocus={e => (e.currentTarget.style.borderBottomColor = "var(--color-brand)")}
            onBlur={e => (e.currentTarget.style.borderBottomColor = "transparent")}
          />

          {/* 保存状態インジケータ */}
          <SaveIndicator status={saveStatus} />

          <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "16px", color: "var(--color-text-tertiary)", flexShrink: 0,
          }}>✕</button>
        </div>

        {/* 保存エラー表示 */}
        {saveStatus === "error" && saveError && (
          <div style={{
            padding: "8px 16px",
            background: "var(--color-bg-danger)",
            color: "var(--color-text-danger)",
            fontSize: "11px",
            borderBottom: "1px solid var(--color-border-danger)",
          }}>
            {saveError}
          </div>
        )}

        {/* ===== ボディ ===== */}
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>

          {/* ステータス（セグメントコントロール） */}
          <FieldSection label="ステータス">
            <div style={{ display: "flex", gap: "4px" }}>
              {statusArr.map(s => {
                const cfg = TASK_STATUS_STYLE[s];
                const isActive = form.status === s;
                return (
                  <button key={s}
                    onClick={() => setForm(f => ({ ...f, status: s }))}
                    style={{
                      padding: "4px 12px", fontSize: "11px", borderRadius: "var(--radius-md)",
                      fontWeight: isActive ? "500" : "400",
                      background: isActive ? cfg.bg : "transparent",
                      color: isActive ? cfg.color : "var(--color-text-tertiary)",
                      border: isActive ? `1px solid ${cfg.border}` : "1px solid var(--color-border-primary)",
                      cursor: "pointer",
                      transition: "all 0.1s",
                    }}>
                    {TASK_STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </FieldSection>

          {/* 優先度（セグメントコントロール） */}
          <FieldSection label="優先度">
            <div style={{ display: "flex", gap: "4px" }}>
              {["", "high", "mid", "low"].map(p => {
                const isActive = form.priority === p;
                const cfg = p ? TASK_PRIORITY_STYLE[p] : null;
                return (
                  <button key={p}
                    onClick={() => setForm(f => ({ ...f, priority: p }))}
                    style={{
                      padding: "4px 10px", fontSize: "11px", borderRadius: "var(--radius-md)",
                      fontWeight: isActive ? "500" : "400",
                      background: isActive && cfg ? cfg.bg : isActive ? "var(--color-bg-secondary)" : "transparent",
                      color: isActive && cfg ? cfg.color : isActive ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                      border: isActive ? "1px solid currentColor" : "1px solid var(--color-border-primary)",
                      cursor: "pointer",
                      transition: "all 0.1s",
                      opacity: isActive ? 1 : 0.5,
                    }}>
                    {p ? TASK_PRIORITY_LABEL[p] : "なし"}
                  </button>
                );
              })}
            </div>
          </FieldSection>

          {/* 担当者（複数可） */}
          <FieldSection label="担当者">
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
                      aria-label={`${m.display_name} を担当者から外す`}
                      style={chipRemoveBtn}>×</button>
                  </span>
                );
              })}
              {form.assignee_member_ids.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未担当</span>
              )}
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
          </FieldSection>

          {/* プロジェクト */}
          <FieldSection label="プロジェクト">
            <select value={form.project_id ?? ""}
              onChange={e => setForm(f => ({ ...f, project_id: e.target.value || null }))}
              style={inputSm}>
              <option value="">なし</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </FieldSection>

          {/* 追加プロジェクト */}
          <FieldSection label="追加プロジェクト">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {linkedExtraProjects.map(p => (
                <span key={p.id} style={chipStyle}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color_tag, flexShrink: 0 }} />
                  {p.name}
                  <button
                    onClick={() => removeTaskProject(taskId, p.id)}
                    aria-label={`${p.name} を解除`}
                    style={chipRemoveBtn}>×</button>
                </span>
              ))}
              {linkedExtraProjects.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
              )}
            </div>
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
          </FieldSection>

          {/* タスクフォース */}
          <FieldSection label="タスクフォース">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {linkedTfs.map(tf => (
                <span key={tf.id} style={chipStyle}>
                  <span style={{ fontWeight: "600", marginRight: 4 }}>
                    {tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}
                  </span>
                  {tf.name}
                  <button
                    onClick={() => removeTaskTaskForce(taskId, tf.id)}
                    aria-label={`${tf.name} を解除`}
                    style={chipRemoveBtn}>×</button>
                </span>
              ))}
              {linkedTfs.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未設定</span>
              )}
            </div>
            {taskForces.length > 0 ? (
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
                  .filter(tf => eligibleTfIds == null || eligibleTfIds.has(tf.id))
                  // 並び：所属KR の index → tf_number の昇順で揃え、どのKRのTFか
                  // ぱっと見で分かるようにする
                  .slice()
                  .sort((a, b) => {
                    const ka = keyResults.findIndex(k => k.id === a.kr_id);
                    const kb = keyResults.findIndex(k => k.id === b.kr_id);
                    if (ka !== kb) return ka - kb;
                    return (a.tf_number ?? "").localeCompare(b.tf_number ?? "");
                  })
                  .map(tf => (
                    <option key={tf.id} value={tf.id}>
                      {(tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`)}{tf.name ? ` ${tf.name}` : ""}
                    </option>
                  ))
                }
              </select>
            ) : (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                管理画面でTask Forceを先に登録してください
              </span>
            )}
          </FieldSection>

          {/* 開始日 + 終了日 + 工数（3列） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <FieldSection label="開始日">
              <input type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                style={inputSm} />
            </FieldSection>

            <FieldSection label="終了日">
              <input type="date" value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                style={{
                  ...inputSm,
                  ...(isOverdue ? {
                    borderColor: "var(--color-border-danger)",
                    color: "var(--color-text-danger)",
                  } : {}),
                }} />
              {isOverdue && (
                <span style={{ marginTop: 4, fontSize: "10px", display: "inline-block",
                  background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
                  padding: "1px 5px", borderRadius: "3px" }}>
                  期限超過
                </span>
              )}
            </FieldSection>

            <FieldSection label="工数（時間）">
              <input type="number" min="0" step="0.5"
                value={form.estimated_hours}
                onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))}
                placeholder="例：2.5"
                style={inputSm} />
            </FieldSection>
          </div>

          {/* コメント */}
          <FieldSection label="コメント・メモ">
            <textarea
              value={form.comment}
              onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
              rows={5}
              placeholder={
                "メモやURLを入力できます\n" +
                "例：https://docs.example.com"
              }
              style={{
                ...inputSm,
                resize: "vertical",
                lineHeight: 1.6,
                minHeight: "80px",
              }}
            />
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
            変更は自動で保存されます
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const styles: Record<"saving" | "saved" | "error", { bg: string; color: string; label: string }> = {
    saving: { bg: "transparent", color: "var(--color-text-tertiary)", label: "保存中…" },
    saved:  { bg: "var(--color-bg-success)", color: "var(--color-text-success)", label: "✓ 保存しました" },
    error:  { bg: "var(--color-bg-danger)", color: "var(--color-text-danger)", label: "保存失敗" },
  };
  const s = styles[status];
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        fontSize: "10px", padding: "2px 8px",
        background: s.bg, color: s.color,
        borderRadius: "99px",
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      {s.label}
    </span>
  );
}

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


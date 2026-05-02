// src/components/task/QuickAddTaskModal.tsx
// FABから開くグローバルタスク追加モーダル。
// MainLayout.tsx から切り出し。

import { useState, useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project, Task, TaskForce, ToDo, KeyResult, Quarter } from "../../lib/localData/types";
import { CustomSelect } from "../common/CustomSelect";
import { v4 as uuidv4 } from "uuid";

interface Props {
  currentUser: Member;
  projects: Project[];
  onClose: () => void;
}

/** ToDoに紐づかない「その他」選択肢の仮想ID。保存時に todo_ids からは除外する */
const TODO_OTHER_ID = "__other__";

export function QuickAddTaskModal({ currentUser, projects, onClose }: Props) {
  const saveTask                = useAppStore(s => s.saveTask);
  const rawMembers              = useAppStore(s => s.members);
  const rawTfs                  = useAppStore(s => s.taskForces);
  const rawTodos                = useAppStore(s => s.todos);
  const rawKrs                  = useAppStore(s => s.keyResults);
  const objective               = useAppStore(s => s.objective);
  const quarterlyObjectives     = useAppStore(s => s.quarterlyObjectives);
  const quarterlyKrTaskForces   = useAppStore(s => s.quarterlyKrTaskForces);
  const members = useMemo(() => rawMembers.filter((m: Member) => !m.is_deleted), [rawMembers]);
  const tfs = useMemo(() => (rawTfs ?? []).filter((tf: TaskForce) => !tf.is_deleted), [rawTfs]);
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const krs = useMemo(() => (rawKrs ?? []).filter((kr: KeyResult) => !kr.is_deleted), [rawKrs]);

  // 今日の日付から現在のQを計算（1Q=1-3月 / 2Q=4-6月 / 3Q=7-9月 / 4Q=10-12月）
  const currentQ = useMemo<Quarter>(() => {
    const m = new Date().getMonth() + 1;
    if (m <= 3) return "1Q";
    if (m <= 6) return "2Q";
    if (m <= 9) return "3Q";
    return "4Q";
  }, []);

  // 現在Qに属するTF IDのSet
  const currentQTfIds = useMemo(() => {
    const qObj = (quarterlyObjectives ?? []).find(
      q => q.quarter === currentQ && q.objective_id === (objective?.id ?? "") && !q.is_deleted
    );
    if (!qObj) return new Set<string>();
    return new Set(
      (quarterlyKrTaskForces ?? [])
        .filter(q => q.quarterly_objective_id === qObj.id)
        .map(q => q.tf_id)
    );
  }, [quarterlyObjectives, quarterlyKrTaskForces, objective, currentQ]);

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [projectId, setProjectId] = useState("");
  const [krId, setKrId] = useState("");
  const [tfId, setTfId] = useState("");
  const [todoIds, setTodoIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [tooltipTodo, setTooltipTodo] = useState<ToDo | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, left: 0, y: 0 });

  const handleKrChange = (val: string) => { setKrId(val); setTfId(""); setTodoIds([]); };
  const handleTfChange = (val: string) => { setTfId(val); setTodoIds([]); };

  // 現在QのKR一覧（TFが存在するKRのみ）
  const filteredKrs = useMemo(() => {
    return krs.filter(kr => {
      const krTfs = tfs.filter(tf => tf.kr_id === kr.id && (currentQTfIds.size === 0 || currentQTfIds.has(tf.id)));
      return krTfs.length > 0;
    });
  }, [krs, tfs, currentQTfIds]);

  // 選択中KRのTF一覧（TF番号順）
  const filteredTfs = useMemo(() => {
    if (!krId) return [];
    return tfs
      .filter(tf => tf.kr_id === krId && (currentQTfIds.size === 0 || currentQTfIds.has(tf.id)))
      .sort((a, b) => (parseInt(a.tf_number) || 0) - (parseInt(b.tf_number) || 0));
  }, [krId, tfs, currentQTfIds]);

  // 選択中TFに属するToDo一覧
  const filteredTodos = useMemo(
    () => tfId ? todos.filter(td => td.tf_id === tfId) : [],
    [tfId, todos],
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      name: name.trim(),
      project_id: projectId || null,
      todo_ids: todoIds.filter(id => id !== TODO_OTHER_ID),
      assignee_member_id: assigneeId,
      assignee_member_ids: assigneeId ? [assigneeId] : [],
      status: "todo",
      priority: null,
      start_date: null,
      due_date: dueDate || null,
      estimated_hours: null,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    try {
      await saveTask(task);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const TOOLTIP_W = 280;
  const TOOLTIP_GAP = 10;
  const tooltipLeft = tooltipPos.x + TOOLTIP_GAP + TOOLTIP_W <= window.innerWidth
    ? tooltipPos.x + TOOLTIP_GAP
    : tooltipPos.left - TOOLTIP_W - TOOLTIP_GAP;
  const tooltipTop = Math.min(tooltipPos.y, window.innerHeight - 180);

  return (
    <>
      {/* ToDoホバーツールチップ（モーダル外・最前面） */}
      {tooltipTodo && (
        <div style={{
          position: "fixed", left: tooltipLeft, top: tooltipTop, zIndex: 500,
          width: TOOLTIP_W,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          padding: "10px 12px",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: tooltipTodo.memo ? "6px" : 0 }}>
            {tooltipTodo.title}
          </div>
          {tooltipTodo.memo && (
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.4, borderTop: "1px solid var(--color-border-primary)", paddingTop: "6px", marginTop: "2px" }}>
              {tooltipTodo.memo}
            </div>
          )}
          {tooltipTodo.due_date && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
              期日: {tooltipTodo.due_date}
            </div>
          )}
        </div>
      )}
      {/* オーバーレイ */}
      <div
        className="animate-overlay"
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }}
      />
      {/* モーダル本体 */}
      <div
        className="animate-modalEnter"
        style={{
          position: "fixed", top: "50%", left: "50%", zIndex: 201,
          transform: "translate(-50%, -50%)",
          width: "min(480px, calc(100vw - 32px))",
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "20px",
        }}>
        <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "16px" }}>
          タスクを追加
        </div>

        {/* タスク名 */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>タスク名 *</div>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="タスク名を入力..."
            maxLength={200}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
            style={{
              width: "100%", padding: "8px 12px", fontSize: "13px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>担当者</div>
            <CustomSelect
              value={assigneeId}
              onChange={setAssigneeId}
              options={[
                { value: "", label: "（なし）" },
                ...members.map(m => ({ value: m.id, label: m.display_name })),
              ]}
              placeholder="担当者を選択..."
            />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>期日（任意）</div>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
        </div>

        {/* KR選択 */}
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>KR（任意）</div>
          <CustomSelect
            value={krId}
            onChange={handleKrChange}
            options={[
              { value: "", label: "KRを選択..." },
              ...filteredKrs.map(kr => ({ value: kr.id, label: kr.title })),
            ]}
            placeholder="KRを選択..."
          />
        </div>

        {/* タスクフォース（KR選択後に表示） */}
        {krId && (
          <div className="animate-slideDown" style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>タスクフォース（任意）</div>
            <CustomSelect
              value={tfId}
              onChange={handleTfChange}
              options={[
                { value: "", label: "タスクフォースを選択..." },
                ...filteredTfs.map(tf => ({
                  value: tf.id,
                  label: `${tf.tf_number ? `TF ${tf.tf_number}` : ""}${tf.tf_number && tf.name ? " — " : ""}${tf.name}`,
                })),
              ]}
              placeholder="タスクフォースを選択..."
            />
          </div>
        )}

        {/* ToDo（TF選択時のみ・複数選択可） */}
        {tfId && (
          <div className="animate-slideDown" style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
              ToDo（複数選択可）
            </div>
            <div style={{
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              padding: "6px 10px",
              maxHeight: "140px",
              overflowY: "auto",
              background: "var(--color-bg-primary)",
            }}>
              {filteredTodos.map((td) => (
                <label
                  key={td.id}
                  onMouseEnter={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltipTodo(td);
                    setTooltipPos({ x: rect.right, left: rect.left, y: rect.top });
                  }}
                  onMouseLeave={() => setTooltipTodo(null)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "7px",
                    padding: "4px 0", cursor: "pointer",
                    fontSize: "12px", color: "var(--color-text-primary)",
                    borderBottom: "1px solid var(--color-border-primary)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={todoIds.includes(td.id)}
                    onChange={e => setTodoIds(prev =>
                      e.target.checked ? [...prev, td.id] : prev.filter(id => id !== td.id)
                    )}
                    style={{ marginTop: "2px", flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                  />
                  <span style={{ lineHeight: 1.4 }}>
                    {(() => {
                      const label = td.name || td.title.split("\n")[0];
                      return label.length > 60 ? label.slice(0, 60) + "…" : label;
                    })()}
                  </span>
                </label>
              ))}
              <label style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "4px 0", cursor: "pointer",
                fontSize: "12px", color: "var(--color-text-secondary)",
              }}>
                <input
                  type="checkbox"
                  checked={todoIds.includes(TODO_OTHER_ID)}
                  onChange={e => setTodoIds(prev =>
                    e.target.checked ? [...prev, TODO_OTHER_ID] : prev.filter(id => id !== TODO_OTHER_ID)
                  )}
                  style={{ flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                />
                <span>その他</span>
              </label>
            </div>
          </div>
        )}

        {/* プロジェクト */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>プロジェクト（任意）</div>
          <CustomSelect
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: "", label: "プロジェクトを選択..." },
              ...projects.map(p => ({ value: p.id, label: p.name })),
            ]}
            placeholder="プロジェクトを選択..."
          />
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>キャンセル</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      </div>
    </>
  );
}

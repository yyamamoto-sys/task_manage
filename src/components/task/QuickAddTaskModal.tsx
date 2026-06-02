// src/components/task/QuickAddTaskModal.tsx
// FABから開くグローバルタスク追加モーダル。
// MainLayout.tsx から切り出し。

import { useState, useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project, Task, TaskForce, ToDo, KeyResult, Quarter } from "../../lib/localData/types";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { effectiveTfQuarter } from "../../lib/okr/tfQuarter";
import { currentQuarter } from "../../lib/date";
import { parentTaskCandidates } from "../../lib/taskHierarchy";
import { v4 as uuidv4 } from "uuid";

interface Props {
  currentUser: Member;
  projects: Project[];
  /** 開いた時点で選択中のPJ。指定があればプロジェクト欄の初期値にする
   *  （PJ選択中に追加したタスクがそのPJのリスト/ガントにそのまま出るように） */
  defaultProjectId?: string;
  /** 子タスクとして追加するときの親タスクID。指定があれば親タスク欄の初期値にする
   *  （リスト画面の「＋子タスク」から、親を固定してこのモーダルを開く用途）。
   *  保存時は project_id が親のPJに揃う（handleSave）。 */
  defaultParentId?: string;
  onClose: () => void;
}

/** ToDoに紐づかない「その他」選択肢の仮想ID。保存時に todo_ids からは除外する */
const TODO_OTHER_ID = "__other__";

export function QuickAddTaskModal({ currentUser, projects, defaultProjectId, defaultParentId, onClose }: Props) {
  const saveTask                = useAppStore(s => s.saveTask);
  const rawTasks                = useAppStore(s => s.tasks);
  const rawMembers              = useAppStore(s => s.members);
  const rawTfs                  = useAppStore(s => s.taskForces);
  const rawTodos                = useAppStore(s => s.todos);
  const rawKrs                  = useAppStore(s => s.keyResults);
  const members = useMemo(() => rawMembers.filter((m: Member) => !m.is_deleted), [rawMembers]);
  const tfs = useMemo(() => (rawTfs ?? []).filter((tf: TaskForce) => !tf.is_deleted), [rawTfs]);
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const krs = useMemo(() => (rawKrs ?? []).filter((kr: KeyResult) => !kr.is_deleted), [rawKrs]);

  // 今日の日付から現在のQを計算（1Q=1-3月 / 2Q=4-6月 / 3Q=7-9月 / 4Q=10-12月）
  // 判定ロジックは lib/date.ts の currentQuarter() に一元化済み。
  const currentQ = useMemo<Quarter>(() => currentQuarter(), []);

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  // 選択中PJがあればそれを初期選択（無ければ「プロジェクト（任意）」のまま）
  const [projectId, setProjectId] = useState(
    () => (defaultProjectId && projects.some(p => p.id === defaultProjectId) ? defaultProjectId : ""),
  );
  const [parentId, setParentId] = useState(defaultParentId ?? "");
  const [krId, setKrId] = useState("");
  const [tfId, setTfId] = useState("");
  const [todoIds, setTodoIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [tooltipTodo, setTooltipTodo] = useState<ToDo | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, left: 0, y: 0 });

  const handleKrChange = (val: string) => { setKrId(val); setTfId(""); setTodoIds([]); };
  const handleTfChange = (val: string) => { setTfId(val); setTodoIds([]); };
  // PJ を変えても選択中の親タスクはクリアしない（他PJ親も許容するため）。
  // 親を選んで保存すると project_id は親のPJに揃う（handleSave）。
  const handleProjectChange = (val: string) => { setProjectId(val); };

  // 親タスク候補＝全PJの最上位タスク。選択中PJを先頭に、他PJはPJ名を併記。
  // （子を選ぶと子は親のPJに揃うため他PJ親も許容。同一PJを優先表示）
  const parentOptions = useMemo<SelectOption[]>(() => {
    const cur = projectId || null;
    const pjOf = (id: string | null) => (id ? projects.find(p => p.id === id) : undefined);
    const currentPjColor = pjOf(cur)?.color_tag ?? "var(--color-border-secondary)";
    const cands = parentTaskCandidates(rawTasks, cur);
    const same  = cands.filter(t => (t.project_id ?? null) === cur);
    const other = cands.filter(t => (t.project_id ?? null) !== cur);
    const opts: SelectOption[] = [{ value: "", label: "（なし＝親タスク）" }];
    if (same.length) {
      opts.push({ value: "__h_same", label: "このプロジェクト", header: true });
      for (const t of same) opts.push({ value: t.id, label: t.name, color: currentPjColor });
    }
    if (other.length) {
      opts.push({ value: "__h_other", label: "他のプロジェクト", header: true });
      for (const t of other) opts.push({
        value: t.id, label: t.name,
        color: pjOf(t.project_id)?.color_tag ?? "var(--color-border-secondary)",
        meta: pjOf(t.project_id)?.name, dim: true,
      });
    }
    return opts;
  }, [rawTasks, projectId, projects]);

  // 現在QのKR一覧（今期のTFが存在するKRのみ。tf.quarter基準・未設定legacyは今期扱い）
  const filteredKrs = useMemo(() => {
    return krs.filter(kr => {
      const krTfs = tfs.filter(tf => tf.kr_id === kr.id && effectiveTfQuarter(tf) === currentQ);
      return krTfs.length > 0;
    });
  }, [krs, tfs, currentQ]);

  // 選択中KRのTF一覧（今期のみ・TF番号順）
  const filteredTfs = useMemo(() => {
    if (!krId) return [];
    return tfs
      .filter(tf => tf.kr_id === krId && effectiveTfQuarter(tf) === currentQ)
      .sort((a, b) => (parseInt(a.tf_number) || 0) - (parseInt(b.tf_number) || 0));
  }, [krId, tfs, currentQ]);

  // 選択中TFに属するToDo一覧
  const filteredTodos = useMemo(
    () => tfId ? todos.filter(td => td.tf_id === tfId) : [],
    [tfId, todos],
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    // 親を選んだら project_id は親のPJ（候補は選択PJで絞り込み済みなので一致するはず）
    const parent = parentId ? rawTasks.find(t => t.id === parentId) : null;
    const effectiveProjectId = parent ? (parent.project_id ?? null) : (projectId || null);
    // display_order：同じ親（または最上位）内の兄弟の最大 display_order + 1
    // 兄弟＝同 project_id かつ同 parent_task_id の非削除タスク
    const siblings = rawTasks.filter(t =>
      !t.is_deleted &&
      (t.project_id ?? null) === effectiveProjectId &&
      (t.parent_task_id ?? null) === (parentId || null),
    );
    const nextOrder = siblings.length === 0
      ? 0
      : Math.max(...siblings.map(t => t.display_order ?? 0)) + 1;
    const task: Task = {
      id: uuidv4(),
      name: name.trim(),
      project_id: effectiveProjectId,
      parent_task_id: parentId || null,
      display_order: nextOrder,
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
              searchable
              searchPlaceholder="名前で検索..."
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
            searchable
            searchPlaceholder="KR名で検索..."
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
              searchable
              searchPlaceholder="TF名で検索..."
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
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>プロジェクト（任意）</div>
          <CustomSelect
            value={projectId}
            onChange={handleProjectChange}
            options={[
              { value: "", label: "プロジェクトを選択..." },
              ...projects.map(p => ({ value: p.id, label: p.name })),
            ]}
            placeholder="プロジェクトを選択..."
            searchable
            searchPlaceholder="プロジェクト名で検索..."
          />
        </div>

        {/* 親タスク（任意・2階層固定。他PJの親も選べる＝選ぶと子は親のPJに揃う） */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>親タスク（任意）</div>
          <CustomSelect
            value={parentId}
            onChange={setParentId}
            options={parentOptions}
            placeholder="（なし＝親タスク）"
            searchable
            searchPlaceholder="親タスクを検索..."
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

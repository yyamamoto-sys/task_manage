// src/components/task/QuickAddTaskModal.tsx
// FABから開くグローバルタスク追加モーダル。
// MainLayout.tsx から切り出し。
//
// 【v3.149】KR→タスクフォース→ToDo の選択欄を外した（タスクフォースに依存して ToDo を選ぶ作りのため、
// 一緒に外す。データと集計はそのまま。Section 78）。ToDo パネル・ToDo グループの追加行から開いたとき
// だけ、渡された ToDo（defaultTodoId）に紐づけて作る（選択欄は無く、紐づけ先を文で示す）。
// 代わりにPJ内の「グループ」選択欄と「成果物」欄を置いた。

import { useState, useMemo } from "react";
import { useAppStore, selectScopedTasks } from "../../stores/appStore";
import type { Member, Project, Task } from "../../lib/localData/types";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { SectionSelect, DeliverableField } from "./SectionField";
import { MentionTextarea } from "../common/MentionTextarea";
import { useAssigneeCandidates } from "../../hooks/useAssigneeCandidates";
import { prepareNewTask, validateTaskDateRange } from "../../lib/task/newTask";
import { showToast } from "../common/Toast";
import { buildParentOptions } from "../../lib/task/parentOptions";
import { v4 as uuidv4 } from "uuid";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE } from "../common/modalStyles";

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
  /** 作成するタスクの初期ステータス（未指定は "todo"）。
   *  カンバンビューの列ごとの「＋ タスクを追加」から、その列のステータスを渡す用途。 */
  defaultStatus?: Task["status"];
  /** 紐づけるToDo ID。管理画面のToDoパネルの「＋ タスクを追加」・ToDoグループの追加行から
   *  このモーダルを開く用途（選択欄は無い。このToDoに紐づけて作る）。 */
  defaultTodoId?: string;
  /** グループの初期値（リストのグループ別の追加行から開く用途）。そのPJのグループでなければ未分類 */
  defaultSectionId?: string;
  /** 作成するタスクの初期期日（YYYY-MM-DD）。カレンダーの日付セルから開く用途。 */
  defaultDueDate?: string;
  /** リストの追加行の「詳細を入れて追加」から：入力済みの内容を引き継ぐ用途 */
  defaultName?: string;
  /** 担当者の初期値。未指定は自分。空文字は「担当者なし」（追加行の既定に合わせる） */
  defaultAssigneeId?: string;
  defaultStartDate?: string;
  /** タグ別グループから開いたとき、そのタグを付けて作る */
  defaultTags?: string[];
  onClose: () => void;
}

export function QuickAddTaskModal({ currentUser, projects, defaultProjectId, defaultParentId, defaultStatus, defaultTodoId, defaultSectionId, defaultDueDate, defaultName, defaultAssigneeId, defaultStartDate, defaultTags, onClose }: Props) {
  const saveTask                = useAppStore(s => s.saveTask);
  const rawTasks                = useAppStore(selectScopedTasks);
  const rawTodos                = useAppStore(s => s.todos);
  // 紐づけ先ToDoの表示名（defaultTodoId があるときだけ使う）
  const defaultTodo = useMemo(
    () => (defaultTodoId ? (rawTodos ?? []).find(td => td.id === defaultTodoId && !td.is_deleted) : undefined),
    [rawTodos, defaultTodoId],
  );

  const [name, setName] = useState(defaultName ?? "");
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? currentUser.id);
  // 選択中PJがあればそれを初期選択（無ければ「プロジェクト（任意）」のまま）
  const [projectId, setProjectId] = useState(
    () => (defaultProjectId && projects.some(p => p.id === defaultProjectId) ? defaultProjectId : ""),
  );
  // 担当者・メンションの候補（表示部署のメンバー＋選択中PJの参加者＋今の担当者）
  const members = useAssigneeCandidates(projectId || null, assigneeId ? [assigneeId] : []);
  const [parentId, setParentId] = useState(defaultParentId ?? "");
  const [sectionId, setSectionId] = useState<string | null>(defaultSectionId ?? null);
  const [deliverable, setDeliverable] = useState("");
  const todoIds = useMemo<string[]>(() => (defaultTodoId ? [defaultTodoId] : []), [defaultTodoId]);
  const [startDate, setStartDate] = useState(defaultStartDate ?? "");
  const [dueDate, setDueDate] = useState(defaultDueDate ?? "");
  const [priority, setPriority] = useState<Task["priority"]>(null);
  const [comment, setComment] = useState("");
  // 子タスク（1行1タスク）。作成するタスクの直下の子として一括作成する。
  const [childDraft, setChildDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // 親は同じPJの中から選ぶ。PJを別のPJに変えたら選択中の親は外す。
  // PJを変えたらグループも外す（別PJのグループを指さない）。
  const handleProjectChange = (val: string) => {
    if (val !== projectId) setSectionId(null);
    setProjectId(val);
    const cur = parentId ? rawTasks.find(t => t.id === parentId) : undefined;
    if (cur && (cur.project_id ?? null) !== (val || null)) setParentId("");
  };

  // 親タスクを選んでいる間、グループは親と同じ（選べない）
  const formParent = parentId ? rawTasks.find(t => t.id === parentId) : undefined;

  // 親タスク候補＝同じPJの任意のタスク（パス表示）。親が決まっている間はその親のPJ
  const parentCandidateProjectId = formParent ? (formParent.project_id ?? null) : (projectId || null);
  const parentOptions = useMemo<SelectOption[]>(
    () => buildParentOptions(rawTasks, parentCandidateProjectId, undefined, parentId || null, projects, "（なし＝最上位）"),
    [rawTasks, parentCandidateProjectId, parentId, projects],
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    const dateError = validateTaskDateRange(startDate, dueDate);
    if (dateError) { showToast(dateError, "error"); return; }
    setSaving(true);
    const now = new Date().toISOString();
    // 親のPJ追従・display_order の採番・メンション確定は、リストのその場追加と共通の prepareNewTask に集約
    const task = prepareNewTask({
      name,
      projectId: projectId || null,
      parentId: parentId || null,
      todoIds,
      assigneeIds: assigneeId ? [assigneeId] : [],
      status: defaultStatus ?? "todo",
      priority,
      startDate,
      dueDate,
      comment,
      sectionId,
      deliverable,
      tags: defaultTags,
      updatedBy: currentUser.id,
    }, rawTasks, now);
    const effectiveProjectId = task.project_id;
    // 最上位タスク作成時のみ：子タスクを一括作成（1行1タスク・空行は無視）。
    // 2階層固定のため、親を選んでいる（＝このタスク自体が子）場合は子を作らない。
    const childNames = !parentId
      ? childDraft.split("\n").map(s => s.trim()).filter(Boolean)
      : [];
    const childTasks: Task[] = childNames.map((cn, idx) => ({
      id: uuidv4(),
      name: cn,
      project_id: effectiveProjectId,
      parent_task_id: task.id,
      display_order: idx,
      todo_ids: [],
      assignee_member_id: "",
      assignee_member_ids: [],
      status: "todo",
      priority: null,
      start_date: null,
      due_date: null,
      estimated_hours: null,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    }));
    try {
      // 親を先に保存（子の parent_task_id が親IDを参照するため）→ その後に子を順次保存
      await saveTask(task);
      for (const child of childTasks) {
        await saveTask(child);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* オーバーレイ：背景クリックで閉じる（マウス操作の補助）。閉じる操作自体はキャンセルボタンで
          キーボードから可能なため、背景要素をフォーカス可能にする必要はない */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="animate-overlay"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        style={{ ...modalOverlayStyle(200), background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }}
      >
        {/* モーダル本体 */}
        <div
          className="animate-modalEnter"
          style={{
            ...modalBoxStyle("min(480px, calc(100vw - 32px))"),
            background: "var(--color-bg-primary)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
          }}>
          <div style={{ ...MODAL_BODY_STYLE, padding: "20px" }}>
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

        {/* 担当者 */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>担当者</div>
          <CustomSelect
            value={assigneeId}
            onChange={setAssigneeId}
            options={[
              { value: "", label: "（なし）" },
              // 自分自身を先頭に、残りは元の順
              ...[...members].sort((a, b) =>
                a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
              ).map(m => ({ value: m.id, label: m.display_name })),
            ]}
            placeholder="担当者を選択..."
            searchable
            searchPlaceholder="名前で検索..."
          />
        </div>

        {/* 開始日・期日・優先度 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>開始日（任意）</div>
            <input
              type="date"
              value={startDate}
              max={dueDate || undefined}
              onChange={e => setStartDate(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>期日（任意）</div>
            <input
              type="date"
              value={dueDate}
              min={startDate || undefined}
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

        {/* 優先度 */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>優先度（任意）</div>
          <CustomSelect
            value={priority ?? ""}
            onChange={value => setPriority((value || null) as Task["priority"])}
            options={[
              { value: "", label: "なし" },
              { value: "high", label: "高" },
              { value: "mid", label: "中" },
              { value: "low", label: "低" },
            ]}
          />
        </div>

        {/* ToDo への紐づけ先（ToDo パネル・ToDo グループの追加行から開いたときだけ。選択欄は無い） */}
        {defaultTodoId && (
          <div style={{
            marginBottom: "12px", padding: "6px 10px", fontSize: "11px",
            color: "var(--color-text-secondary)", background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
          }}>
            ToDo「{(defaultTodo?.name || defaultTodo?.title?.split("\n")[0] || "（名前なし）").slice(0, 60)}」に紐づけて追加します
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

        {/* グループ（PJ内の区分。v3.149）。親タスクを選んだら親と同じ（選べない） */}
        <SectionSelect
          projectId={formParent ? (formParent.project_id ?? null) : (projectId || null)}
          value={sectionId}
          onChange={setSectionId}
          parentLocked={formParent ? { sectionId: formParent.section_id ?? null } : null}
        />

        {/* 親タスク（任意・同じPJの任意のタスク。パスで表示・検索できる。なし＝最上位） */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>親タスク（任意）</div>
          <CustomSelect
            value={parentId}
            onChange={setParentId}
            options={parentOptions}
            placeholder="（なし＝最上位）"
            searchable
            searchPlaceholder="親タスクを検索（A > B > C）..."
          />
        </div>

        {/* 子タスク（任意。1行に1つ＝まとめて子タスクを作成） */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>子タスク（任意・1行に1つ）</div>
          <textarea
            value={childDraft}
            onChange={e => setChildDraft(e.target.value)}
            placeholder={"子タスク名を1行に1つ入力...\n例：\n要件整理\nデザイン案作成"}
            rows={3}
            style={{
              width: "100%", padding: "8px 12px", fontSize: "12px", lineHeight: 1.6,
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              outline: "none", resize: "vertical", fontFamily: "inherit",
            }}
          />
        </div>

        {/* 成果物（v3.149）。URL を書くとリストの📎から開ける */}
        <DeliverableField
          value={deliverable}
          onChange={setDeliverable}
          rows={2}
          inputStyle={{
            width: "100%", padding: "8px 12px", fontSize: "12px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            outline: "none", fontFamily: "inherit",
          }}
        />

        {/* メモ（@ でメンバーをメンション可） */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>メモ（任意）</div>
          <MentionTextarea
            value={comment}
            onChange={setComment}
            members={members}
            rows={2}
            placeholder="補足・メモを入力... @名前 でメンション"
            style={{
              width: "100%", padding: "8px 12px", fontSize: "12px", lineHeight: 1.6,
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              outline: "none", resize: "vertical", fontFamily: "inherit",
            }}
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
        </div>
      </div>
    </>
  );
}

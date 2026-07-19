// src/components/kanban/KanbanView.tsx
import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAppStore, selectScopedTasks } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useBulkTaskActions } from "../../hooks/useBulkTaskActions";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE, TASK_PRIORITY_STRIPE_COLOR, getAssigneeIds, isAssignedTo } from "../../lib/taskMeta";
import { computeRangeSelection } from "../../lib/selectionRange";
import { computeKanbanOrderedIds } from "../../lib/kanbanOrder";
import { buildParentDerivedMap, type ParentDerived } from "../../lib/taskHierarchy";
import { todayStr } from "../../lib/date";
import { TaskEditModal } from "../task/TaskEditModal";
import { TaskSidePanel } from "../task/TaskSidePanel";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";
import { InlineEditText } from "../common/InlineEditText";
import { InlineEditDate } from "../common/InlineEditDate";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import { CustomSelect } from "../common/CustomSelect";

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
  // 親カードのサブタスク進捗ミニバー用（done/total/pct）。フィルタ前の tasks から算出し、
  // childCountByParent と同じ考え方で常に全体の進捗を出す
  const parentDerivedById = useMemo(() => buildParentDerivedMap(tasks), [tasks]);

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

  // 一括操作用：複数選択（リストビューと同じ流儀）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Shift+クリック範囲選択のアンカー（直近に単一クリック／Ctrl+クリックしたカード）。
  // レンダーを介す必要が無いため ref で持つ（ガント/リストの selectionAnchorRef と同じ流儀）
  const selectionAnchorRef = useRef<string | null>(null);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectedIds(new Set());
  }, []);

  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (selectedProject) list = list.filter(t => t.project_id === selectedProject.id);
    else if (krTaskIds)  list = list.filter(t => krTaskIds.has(t.id));
    if (mineOnly) list = list.filter(t => isAssignedTo(t, currentUser.id));
    return list;
  }, [tasks, selectedProject, krTaskIds, mineOnly, currentUser.id]);

  // Ctrl/Cmd+A・Shift+クリック範囲選択の対象となる「現在の表示順」
  // （列＝todo→in_progress→done を左→右、各列内は上→下でフラット化。hideDone中はdone列を除外）
  const orderedTaskIds = useMemo(() => computeKanbanOrderedIds(visibleTasks, hideDone), [visibleTasks, hideDone]);

  // 表示中のPJ/KR/自分フィルタが変わって見えなくなったカードは選択から外す
  useEffect(() => {
    const visible = new Set(visibleTasks.map(t => t.id));
    setSelectedIds(prev => {
      const next = new Set<string>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [visibleTasks]);

  const { bulkUpdateStatus, bulkUpdatePriority, bulkUpdateAssignee, bulkDelete } = useBulkTaskActions(
    tasks, members, selectedIds, currentUser.id, clearSelection,
  );

  const handleStatusChange = useCallback((taskId: string, newStatus: Task["status"]) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    // updated_at は触らない（CLAUDE.md Section 5）。zustand 側で
    // フォーム時点の値を expectedUpdatedAt として saveWithLock に渡す
    saveTask({ ...task, status: newStatus, updated_by: currentUser.id });
  }, [tasks, saveTask, currentUser.id]);

  // TaskCard に渡すコールバックは useCallback で参照を固定する（React.memo が効くようにするため）
  const handleDragStart = useCallback((taskId: string) => setDraggingId(taskId), []);

  // カードクリック：修飾キー無し＝従来どおり詳細を開く＋アンカー更新。Ctrl/Cmd+クリック＝
  // 選択のみトグル（詳細は開かない）。Shift+クリック＝アンカー〜クリック先の範囲を現在の
  // 表示順（orderedTaskIds）で選択に追加（詳細は開かない）。KeyboardEventもctrlKey/shiftKey/
  // metaKeyを持つため、Enter/Spaceでのキーボード操作も同じハンドラで扱える
  const handleCardClick = useCallback((e: ReactMouseEvent | ReactKeyboardEvent, taskId: string) => {
    if (e.shiftKey) {
      const anchorId = selectionAnchorRef.current;
      const rangeIds = computeRangeSelection(orderedTaskIds, anchorId, taskId);
      setSelectedIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(id => next.add(id));
        return next;
      });
      selectionAnchorRef.current = anchorId ?? taskId;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(taskId);
      selectionAnchorRef.current = taskId;
      return;
    }
    selectionAnchorRef.current = taskId;
    setEditingTaskId(taskId);
  }, [orderedTaskIds, toggleSelect]);

  // ドロップ：ドラッグ中のカードが選択中（かつ選択が複数）なら、選択中の全カードを
  // まとめてその列（ステータス）へ移動する＝一括ステータス変更として1つのUndoにまとまる。
  // それ以外（単体ドラッグ）は従来どおり1件だけステータス変更。
  const handleDrop = (status: Task["status"]) => {
    if (draggingId) {
      if (selectedIds.has(draggingId) && selectedIds.size > 1) {
        bulkUpdateStatus(status);
      } else {
        handleStatusChange(draggingId, status);
      }
      setDraggingId(null);
    }
    setDragOverStatus(null);
  };

  // ===== キーボードショートカット（Ctrl/Cmd+A=表示中の全選択／Esc=選択解除） =====
  // ガード：①入力中（input/textarea/select/contenteditable）は一切ハイジャックしない。
  // ②タスク詳細（editingTaskId＝PCサイドパネル/モバイルのTaskEditModal共用）・
  // 子タスク追加モーダル（QuickAddTaskModal＝addingStatus!==null）のいずれかが開いている間は
  // 発火しない。③モバイル（isMobile）では無効化。④カンバンビューがアクティブなときのみ発火する点は
  // MainLayoutでviewMode==="kanban"の間だけKanbanViewが条件レンダーされる既存構造で自然に満たされる
  // （リスト/ガントと同じ設計方針）
  useEffect(() => {
    if (isMobile) return;
    if (editingTaskId || addingStatus !== null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
      if (isTyping) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedIds(new Set(orderedTaskIds));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, editingTaskId, addingStatus, orderedTaskIds, clearSelection]);

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

      {/* ===== 一括操作バー（選択時のみ表示・リストビューと同等のUI/挙動） ===== */}
      <div style={{ overflow: "hidden", maxHeight: selectedIds.size > 0 ? "100px" : "0", transition: "max-height 0.18s ease", flexShrink: 0 }}>
      {selectedIds.size > 0 && (
        <div style={{
          padding: "8px 12px",
          background: "var(--color-brand-light)",
          borderBottom: "1px solid var(--color-brand-border)",
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: "12px", fontWeight: 600,
            color: "var(--color-brand)",
            padding: "4px 10px",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-full)",
            whiteSpace: "nowrap",
          }}>
            {selectedIds.size} 件選択中
          </span>

          {/* ステータス一括変更 */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["todo", "in_progress", "done"] as const).map(s => (
              <button
                key={s}
                onClick={() => bulkUpdateStatus(s)}
                title={`選択中タスクを「${TASK_STATUS_LABEL[s]}」に変更`}
                style={{
                  padding: "4px 10px", fontSize: "11px", fontWeight: 500,
                  background: TASK_STATUS_STYLE[s].bg,
                  color: TASK_STATUS_STYLE[s].color,
                  border: `1px solid ${TASK_STATUS_STYLE[s].color}`,
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                → {TASK_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {/* 優先度一括変更 */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["", "high", "mid", "low"] as const).map(p => {
              const cfg = p ? TASK_PRIORITY_STYLE[p] : null;
              return (
                <button
                  key={p || "none"}
                  onClick={() => bulkUpdatePriority(p || null)}
                  title={`選択中タスクの優先度を「${p ? TASK_PRIORITY_LABEL[p] : "なし"}」に変更`}
                  style={{
                    padding: "4px 10px", fontSize: "11px", fontWeight: 500,
                    background: cfg ? cfg.bg : "var(--color-bg-tertiary)",
                    color: cfg ? cfg.color : "var(--color-text-secondary)",
                    border: `1px solid ${cfg ? cfg.color : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  → {p ? TASK_PRIORITY_LABEL[p] : "なし"}
                </button>
              );
            })}
          </div>

          {/* 担当者一括変更 */}
          <CustomSelect
            value=""
            onChange={value => { if (value) bulkUpdateAssignee(value); }}
            options={[
              { value: "", label: "担当者を変更…" },
              ...[...members].sort((a, b) =>
                a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
              ).map(m => ({ value: m.id, label: m.display_name })),
            ]}
            searchable searchPlaceholder="メンバーで検索..."
            style={{ width: "160px" }} />

          <span style={{ flex: 1 }} />

          {/* 一括削除 */}
          <button
            onClick={bulkDelete}
            style={{
              padding: "4px 12px", fontSize: "11px", fontWeight: 500,
              color: "var(--btn-danger-text)",
              background: "var(--btn-danger-bg)",
              border: `1px solid ${"var(--btn-danger-border)"}`,
              borderRadius: "var(--radius-md)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            🗑 削除
          </button>

          {/* クリア */}
          <button
            onClick={clearSelection}
            style={{
              padding: "4px 10px", fontSize: "11px",
              color: "var(--color-text-tertiary)",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            ✕ 選択解除
          </button>
        </div>
      )}
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
            // ドラッグ&ドロップ専用の列（ドロップでステータス変更）。マウス操作専用でキーボード代替手段はない
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
                      progress={parentDerivedById.get(task.id)}
                      onDragStart={handleDragStart}
                      onStatusChange={handleStatusChange}
                      isDragging={draggingId === task.id}
                      onClick={handleCardClick}
                      isSelected={selectedIds.has(task.id)}
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
  task, project, todo, allMembers, parentName, childCount = 0, progress, onDragStart, onStatusChange, isDragging, onClick, isSelected, onSaveTask, currentUserId,
}: {
  task: Task;
  project?: Project;
  todo?: ToDo;
  allMembers: Member[];
  parentName?: string;
  childCount?: number;
  /** 親タスク（子を持つ）のみ渡される、子からのロールアップ進捗（done/total/pct） */
  progress?: ParentDerived;
  onDragStart: (taskId: string) => void;
  onStatusChange: (id: string, status: Task["status"]) => void;
  isDragging: boolean;
  onClick: (e: ReactMouseEvent | ReactKeyboardEvent, taskId: string) => void;
  isSelected: boolean;
  onSaveTask: (task: Task) => void;
  currentUserId: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDone = task.status === "done";
  const isOverdue = !isDone && !!task.due_date && task.due_date < todayStr();
  // 優先度の左ストライプ色（親子のインデント表現＝marginLeft/子バッジとは独立。優先度未設定は無彩色）
  const stripeColor = task.priority ? TASK_PRIORITY_STRIPE_COLOR[task.priority] : "var(--color-border-primary)";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onClick={e => onClick(e, task.id)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e, task.id); } }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: isSelected ? "var(--color-brand-light)" : "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        borderLeft: `3px solid ${stripeColor}`,
        // 子タスクは左にインデントして親子関係を視覚化（優先度ストライプの色とは独立）
        marginLeft: parentName ? "14px" : 0,
        borderRadius: "var(--radius-lg)",
        padding: "9px 11px",
        cursor: "grab",
        opacity: isDragging ? 0.4 : isDone ? 0.55 : 1,
        boxShadow: isDragging ? "var(--shadow-lg)" : isSelected ? "0 0 0 2px var(--color-brand)" : isHovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: isHovered && !isDragging ? "translateY(-1px)" : "none",
        transition: "opacity 0.15s, box-shadow 0.15s, transform 0.15s, background 0.1s",
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

      {/* タスク名（インライン編集）。カードクリックで詳細が開くため、こちらはそちらに伝播させない（クリックしても何も起きないラッパー） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
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

      {/* タグチップ */}
      {(task.tags?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "7px" }}>
          {task.tags!.map((tag, ti) => (
            <span key={ti} style={{
              fontSize: "9px", padding: "0 5px", lineHeight: 1.6, borderRadius: "99px",
              background: "var(--color-brand-light)", color: "var(--color-text-purple)",
              border: "1px solid var(--color-brand-border)",
            }}>#{tag}</span>
          ))}
        </div>
      )}

      {/* サブタスク進捗ミニバー（親タスクのみ） */}
      {progress && progress.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "7px" }}>
          <span style={{ width: "36px", height: "4px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", overflow: "hidden", display: "inline-block", flexShrink: 0 }}>
            <span style={{ display: "block", height: "100%", width: `${progress.pct}%`, background: "var(--color-brand)", borderRadius: "var(--radius-full)" }} />
          </span>
          <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>{progress.done}/{progress.total}</span>
        </div>
      )}

      {/* フッター */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        {/* 担当者インライン編集（クリックしても何も起きないラッパー） */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <InlineEditAssignee
            assigneeIds={getAssigneeIds(task)}
            members={allMembers}
            onSave={ids => onSaveTask({ ...task, assignee_member_ids: ids, assignee_member_id: ids[0] ?? "", updated_by: currentUserId })}
          />
        </div>
        {/* 期日チップ（期限超過は赤・完了は✓）。クリックしても何も起きないラッパー */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "3px",
            padding: task.due_date ? "2px 7px" : "1px 2px",
            borderRadius: "var(--radius-full)", fontSize: "10px",
            background: !task.due_date ? "transparent" : isDone ? "var(--color-bg-success)" : isOverdue ? "var(--color-bg-danger)" : "var(--color-bg-tertiary)",
            border: !task.due_date ? "none" : `1px solid ${isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : "var(--color-border-primary)"}`,
          }}>
            {isDone && task.due_date && <span aria-hidden style={{ color: "var(--color-text-success)" }}>✓</span>}
            <InlineEditDate
              value={task.due_date}
              isDone={isDone}
              onSave={due_date => onSaveTask({ ...task, due_date, updated_by: currentUserId })}
            />
          </span>
        </div>
        <span style={{ flex: 1 }} />
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


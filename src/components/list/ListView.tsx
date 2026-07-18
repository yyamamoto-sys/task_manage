// src/components/list/ListView.tsx
import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useAppStore, selectScopedTasks, selectScopedTaskDependencies } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE, getAssigneeIds, isAssignedTo } from "../../lib/taskMeta";
import { InlineEditText } from "../common/InlineEditText";
import { InlineEditDate } from "../common/InlineEditDate";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import { todayStr, addDaysFromToday } from "../../lib/date";
import { KEYS, active } from "../../lib/localData/localStore";
import { confirmDialog } from "../../lib/dialog";
import { showToast } from "../common/Toast";
import { childrenOf, isParentTask, buildParentDerivedMap, type ParentDerived } from "../../lib/taskHierarchy";
import { Avatar } from "../auth/UserSelectScreen";
import { TaskEditModal } from "../task/TaskEditModal";
import { TaskSidePanel } from "../task/TaskSidePanel";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";
import { EmptyState } from "../common/EmptyState";
import { CustomSelect } from "../common/CustomSelect";
import { computeRangeSelection } from "../../lib/selectionRange";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  selectedKrId?: string | null;
  krTaskIds?: Set<string> | null;
  /** サイドバーの「自分」トグル ON のとき true。自分が担当のタスクのみ表示 */
  mineOnly?: boolean;
}

type GroupBy = "project" | "assignee" | "status" | "tag";
type SortKey = "name" | "due_date" | "priority" | "estimated_hours" | "status" | "assignee" | "manual";
type SortDir = "asc" | "desc";
/** ドラッグ中タスクをドロップ先の行のどこに落としたか。before/after=並び替え、nest=ドロップ先の子にする */
type DropZone = "before" | "nest" | "after";

const PRIO: Record<string, number> = { high: 0, mid: 1, low: 2, "": 3 };
const STATUS_ORDER: Record<Task["status"], number> = { in_progress: 0, todo: 1, done: 2 };

/** 行のうち上30%/下30%＝before/after（並び替え）、中央40%＝nest（子にする）。
 *  ドロップ先が既に子タスクの場合は「孫禁止」のため中央帯を作らず上下半分でbefore/afterのみにする。 */
function computeDropZone(e: React.DragEvent, target: Task): DropZone {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
  if (target.parent_task_id) return ratio < 0.5 ? "before" : "after";
  return ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "nest";
}

function exportCSV(tasks: Task[], projects: Project[], members: Member[]) {
  const header = ["タスク名","ステータス","担当者","プロジェクト","優先度","開始日","期日","工数(h)","コメント"];
  const rows = tasks.map(t => {
    const pj = projects.find(p => p.id === t.project_id);
    const m  = members.find(mb => mb.id === t.assignee_member_id);
    return [
      t.name, TASK_STATUS_LABEL[t.status], m?.display_name ?? "",
      pj?.name ?? "", t.priority ? TASK_PRIORITY_LABEL[t.priority] : "",
      t.start_date ?? "", t.due_date ?? "",
      t.estimated_hours?.toString() ?? "",
      t.comment.replace(/,/g,"，").replace(/\n/g," "),
    ];
  });
  const csv = [header,...rows].map(r=>r.map(v=>`"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`tasks_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ===== ビュー設定の永続化ヘルパー =====
const LIST_LS_KEY = KEYS.LIST_VIEW_SETTINGS;
function lsGet<T>(field: string, fallback: T): T {
  try { return ((JSON.parse(localStorage.getItem(LIST_LS_KEY) ?? "{}") as Record<string, T>)[field] ?? fallback); }
  catch { return fallback; }
}
function lsSet(field: string, value: unknown) {
  try {
    const all = JSON.parse(localStorage.getItem(LIST_LS_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(LIST_LS_KEY, JSON.stringify({ ...all, [field]: value }));
  } catch { /* ignore */ }
}

export function ListView({ currentUser, selectedProject, projects, krTaskIds, mineOnly = false }: Props) {
  const rawTasks   = useAppStore(selectScopedTasks);
  const taskDependencies = useAppStore(selectScopedTaskDependencies);
  const rawMembers = useAppStore(s => s.members);
  const rawTodos   = useAppStore(s => s.todos);
  const saveTask   = useAppStore(s => s.saveTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const restoreTask = useAppStore(s => s.restoreTask);
  const todos    = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const isMobile = useIsMobile();
  const allTasks = useMemo(() => active(rawTasks), [rawTasks]);
  const members  = useMemo(() => active(rawMembers), [rawMembers]);
  // 行の描画ループで .find() を毎回呼ぶと O(件数×行数) になるため、O(1)ルックアップ用のMapを用意する
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const todoById    = useMemo(() => new Map(todos.map(td => [td.id, td])), [todos]);
  const memberById  = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  // モバイルカード行（ListMobileTaskRow）を React.memo で軽量化するための参照安定な担当者配列。
  // .filter() をそのまま渡すと毎回新しい配列になりmemoが効かない。
  const assigneesByTaskId = useMemo(() => {
    const m = new Map<string, Member[]>();
    for (const t of allTasks) m.set(t.id, getAssigneeIds(t).map(id => memberById.get(id)).filter((x): x is Member => !!x));
    return m;
  }, [allTasks, memberById]);

  // 永続化フィルター
  const [groupBy,        setGroupByState       ] = useState<GroupBy>(() => lsGet("groupBy", "project"));
  const [filterStatus,   setFilterStatusState  ] = useState<Task["status"]|"all">(() => lsGet("filterStatus", "all"));
  const [filterPriority, setFilterPriorityState] = useState<"all"|"high"|"mid"|"low">(() => lsGet("filterPriority", "all"));
  const [sortKey,        setSortKeyState       ] = useState<SortKey>(() => lsGet("sortKey", "due_date"));
  const [sortDir,        setSortDirState       ] = useState<SortDir>(() => lsGet("sortDir", "asc"));

  const setGroupBy       = (v: GroupBy)                   => { setGroupByState(v);        lsSet("groupBy", v); };
  const setFilterStatus  = (v: Task["status"]|"all")      => { setFilterStatusState(v);   lsSet("filterStatus", v); };
  const setFilterPriority= (v: "all"|"high"|"mid"|"low")  => { setFilterPriorityState(v); lsSet("filterPriority", v); };

  // セッション限りのフィルター
  const [filterMyOnly,   setFilterMyOnly  ] = useState(false);
  const [filterThisWeek, setFilterThisWeek] = useState(false);
  const [filterHideDone, setFilterHideDone] = useState(false);
  const [filterMember,   setFilterMember  ] = useState<string>("all");
  const [searchText,     setSearchText    ] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string|null>(null);
  const [editingTaskId,  setEditingTaskId ] = useState<string|null>(null);

  // 親タスクの折りたたみ状態：localStorage には「折りたたみ中の親ID集合」を保存（既定＝展開）。
  // 展開集合ではなく折りたたみ集合を持つことで、新規親は既定で展開表示になる。
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(lsGet<string[]>("collapsedParents", [])),
  );
  const toggleCollapse = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      lsSet("collapsedParents", Array.from(next));
      return next;
    });
  }, []);

  // 「＋子タスク」：親を固定して QuickAddTaskModal（親タスク追加と同じモーダル）を開く。
  // 値＝親タスクID、null＝閉じている。
  const [quickAddParentId, setQuickAddParentId] = useState<string | null>(null);

  // タスクのドラッグ並べ替え・親子変更（PJ別表示時）。display_order / parent_task_id を更新して全員に共有。
  // dropZone：ドラッグ中のタスクがホバー中の行のどこに居るか（before=上端/nest=中央=子にする/after=下端）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ id: string; zone: "before" | "nest" | "after" } | null>(null);

  // 一括操作用：複数選択
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Shift+クリック範囲選択のアンカー（直近に単一クリック／Ctrl+クリックした行）。
  // レンダーを介す必要が無いため ref で持つ（GanttViewの selectionAnchorRef と同じ流儀）。
  // 選択が丸ごとクリアされる操作（Esc・チェックボックスでの全解除等）では必ずアンカーも一緒に
  // リセットする（clearSelection に集約）。
  const selectionAnchorRef = useRef<string | null>(null);
  const toggleSelect = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
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


  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      const d: SortDir = sortDir === "asc" ? "desc" : "asc";
      setSortDirState(d); lsSet("sortDir", d);
    } else {
      setSortKeyState(key); lsSet("sortKey", key);
      setSortDirState("asc"); lsSet("sortDir", "asc");
    }
  }, [sortKey, sortDir]);

  const t0 = useRef(todayStr()).current;
  const t7 = useRef(addDaysFromToday(7)).current;

  const filteredTasks = useMemo(() => {
    let tasks = allTasks;
    if (selectedProject)         tasks = tasks.filter(t => t.project_id === selectedProject.id);
    else if (krTaskIds)          tasks = tasks.filter(t => krTaskIds.has(t.id));
    if (filterStatus !== "all")  tasks = tasks.filter(t => t.status === filterStatus);
    if (filterHideDone)          tasks = tasks.filter(t => t.status !== "done");
    // 「担当者=自分」フィルタ：内部チップ(filterMyOnly) または サイドバー(mineOnly) のどちらかが ON
    if (filterMyOnly || mineOnly) tasks = tasks.filter(t => isAssignedTo(t, currentUser.id));
    if (filterMember !== "all")  tasks = tasks.filter(t =>
      t.assignee_member_ids?.includes(filterMember) || t.assignee_member_id === filterMember
    );
    if (filterThisWeek)          tasks = tasks.filter(t => t.due_date && t.due_date >= t0 && t.due_date <= t7);
    if (filterPriority !== "all")tasks = tasks.filter(t => t.priority === filterPriority);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      tasks = tasks.filter(t => t.name.toLowerCase().includes(q) || t.comment.toLowerCase().includes(q));
    }
    return [...tasks].sort((a, b) => {
      // 手動順：display_order（ドラッグで保存した並び）をそのまま尊重する（完了を下に送らない）
      if (sortKey === "manual") {
        return (a.display_order ?? 0) - (b.display_order ?? 0)
          || (a.created_at ?? "").localeCompare(b.created_at ?? "");
      }
      // 完了は常に下に。sortKey=status のときは既存ロジック（昇順/降順）を尊重し優先しない
      if (sortKey !== "status") {
        const aDone = a.status === "done" ? 1 : 0;
        const bDone = b.status === "done" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
      }
      let va: string|number = "", vb: string|number = "";
      if      (sortKey === "name")            { va = a.name;                               vb = b.name; }
      else if (sortKey === "due_date")        { va = a.due_date ?? "9999";                 vb = b.due_date ?? "9999"; }
      else if (sortKey === "priority")        { va = PRIO[a.priority ?? ""];               vb = PRIO[b.priority ?? ""]; }
      else if (sortKey === "estimated_hours") { va = a.estimated_hours ?? 999;             vb = b.estimated_hours ?? 999; }
      else if (sortKey === "status")          { va = STATUS_ORDER[a.status];               vb = STATUS_ORDER[b.status]; }
      else if (sortKey === "assignee")        {
        va = members.find(m => m.id === a.assignee_member_id)?.display_name ?? "zzz";
        vb = members.find(m => m.id === b.assignee_member_id)?.display_name ?? "zzz";
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [allTasks, selectedProject, krTaskIds, filterStatus, filterHideDone, filterMyOnly, mineOnly, filterMember,
      filterThisWeek, filterPriority, searchText, sortKey, sortDir, currentUser.id, t0, t7, members]);

  // 親タスクの導出ステータス・進捗（PC表の行ごとに effectiveStatus/parentProgress を呼ぶと
  // 呼ぶたびに childrenOf() が全タスクを走査する上、毎回新しいオブジェクトを返すため
  // React.memo の props 比較が効かなくなる。taskHierarchy.ts の buildParentDerivedMap で
  // 1回だけ集計し、Mapの値をそのまま props に渡すことで、filteredTasks が変わらない限り
  // 同じ参照を返し続ける（＝無関係な再レンダーでは行が固定される）。
  const derivedByParentId = useMemo(() => buildParentDerivedMap(filteredTasks), [filteredTasks]);

  // フィルタ変更で見えなくなったタスクは選択から外す
  useEffect(() => {
    const visible = new Set(filteredTasks.map(t => t.id));
    setSelectedIds(prev => {
      const next = new Set<string>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredTasks]);

  // 表示中タスクの全選択トグル
  const allFilteredSelected = filteredTasks.length > 0
    && filteredTasks.every(t => selectedIds.has(t.id));
  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredTasks.map(t => t.id)));
  }, [allFilteredSelected, filteredTasks]);

  // 一括ステータス変更
  const bulkUpdateStatus = useCallback(async (status: Task["status"]) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前ステータスを控える。巻き戻しは「Undo時点の最新タスク」に
    // 旧ステータスだけ適用する（古いスナップショット全体を保存すると楽観ロックと衝突するため）
    const prevStatusById = new Map(targets.map(t => [t.id, t.status]));
    try {
      await Promise.all(targets.map(t =>
        saveTask({ ...t, status, updated_by: currentUser.id }),
      ));
      showToast(`${targets.length}件のステータスを「${TASK_STATUS_LABEL[status]}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          prevStatusById.forEach((prevStatus, id) => {
            const t = tasksNow.find(x => x.id === id);
            if (t) saveTask({ ...t, status: prevStatus, updated_by: currentUser.id });
          });
        },
      });
      clearSelection();
    } catch (err) {
      showToast(`一括変更に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUser.id, clearSelection]);

  // 一括担当者変更
  const bulkUpdateAssignee = useCallback(async (memberId: string) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前の担当者を控える（方式はbulkUpdateStatusと同じ）
    const prevAssigneesById = new Map(targets.map(t => [
      t.id,
      { single: t.assignee_member_id, multi: t.assignee_member_ids },
    ]));
    try {
      await Promise.all(targets.map(t => saveTask({
        ...t,
        assignee_member_id: memberId,
        assignee_member_ids: [memberId],
        updated_by: currentUser.id,
      })));
      const m = members.find(mm => mm.id === memberId);
      showToast(`${targets.length}件の担当者を「${m?.display_name ?? memberId}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          prevAssigneesById.forEach((prev, id) => {
            const t = tasksNow.find(x => x.id === id);
            if (t) saveTask({
              ...t,
              assignee_member_id: prev.single,
              assignee_member_ids: prev.multi,
              updated_by: currentUser.id,
            });
          });
        },
      });
      clearSelection();
    } catch (err) {
      showToast(`一括変更に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUser.id, members, clearSelection]);

  // 一括削除
  const bulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = await confirmDialog(`選択中の ${count} 件のタスクを削除します。\n（変更履歴から復元できます）`);
    if (!ok) return;
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map(id => deleteTask(id, currentUser.id)));
      showToast(`${count}件のタスクを削除しました`, "info", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => { ids.forEach(id => restoreTask(id)); },
      });
      clearSelection();
    } catch (err) {
      showToast(`一括削除に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [selectedIds, deleteTask, restoreTask, currentUser.id, clearSelection]);

  // タスクをドロップ先タスクの行の「どこ」に落としたかで挙動を分ける：
  // - 上端/下端（before/after）：ドロップ先と同じ階層（同じ親、または両方最上位）の並びに挿入
  //   ドロップ先が最上位で dragged が子だった場合はここで最上位に昇格する（＝子→親）
  //   ドロップ先が子で dragged が最上位だった場合はここでその子の兄弟になる（＝親→子）
  // - 中央（nest）：ドロップ先の子にする（最上位タスクへの nest のみ・孫禁止のため子への nest は前段で before/after に丸める）
  // 親→子の変更（子持ちタスクを子にする）は2階層固定と矛盾するため拒否する。
  const handleTaskDrop = useCallback(async (draggedId: string, targetId: string, zone: DropZone) => {
    if (draggedId === targetId) return;
    const dragged = allTasks.find(t => t.id === draggedId);
    const target  = allTasks.find(t => t.id === targetId);
    if (!dragged || !target) return;

    if (zone === "nest") {
      if (target.parent_task_id === dragged.id) return; // 自分の子には入れない（循環防止）
      if (dragged.parent_task_id === target.id) return; // 既に子
      if (isParentTask(dragged, allTasks)) {
        showToast("子タスクを持つタスクは子にできません（先に子タスクを別の親に移動するか、解除してください）", "error");
        return;
      }
      try {
        await saveTask({ ...dragged, parent_task_id: target.id, project_id: target.project_id, updated_by: currentUser.id });
        if (sortKey !== "manual") { setSortKeyState("manual"); lsSet("sortKey", "manual"); }
      } catch (err) {
        showToast(`親子変更に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
      }
      return;
    }

    // before/after：ドロップ先と同じ階層・同じPJに合わせて挿入（見えている順を起点に、隠れた分は末尾に補完）
    const newParentId = target.parent_task_id ?? null;
    const newProjectId = target.project_id ?? null;
    if (newParentId && isParentTask(dragged, allTasks)) {
      showToast("子タスクを持つタスクは子にできません（先に子タスクを別の親に移動するか、解除してください）", "error");
      return;
    }
    const isSibling = (t: Task) => (t.parent_task_id ?? null) === newParentId && (t.project_id ?? null) === newProjectId;
    const visible = filteredTasks.filter(isSibling);
    const visibleSet = new Set(visible.map(t => t.id));
    const hidden = allTasks.filter(t => isSibling(t) && !visibleSet.has(t.id))
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const ids = [...visible, ...hidden].map(t => t.id).filter(id => id !== draggedId);
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx < 0) return;
    ids.splice(zone === "before" ? targetIdx : targetIdx + 1, 0, draggedId);
    try {
      await Promise.all(ids.map((id, idx) => {
        if (id === draggedId) {
          if ((dragged.display_order ?? 0) === idx && (dragged.parent_task_id ?? null) === newParentId && (dragged.project_id ?? null) === newProjectId) return Promise.resolve();
          return saveTask({ ...dragged, parent_task_id: newParentId, project_id: newProjectId, display_order: idx, updated_by: currentUser.id });
        }
        const t = allTasks.find(x => x.id === id);
        if (!t || (t.display_order ?? 0) === idx) return Promise.resolve();
        return saveTask({ ...t, display_order: idx, updated_by: currentUser.id });
      }));
      if (sortKey !== "manual") { setSortKeyState("manual"); lsSet("sortKey", "manual"); }
    } catch (err) {
      showToast(`並べ替えに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, filteredTasks, saveTask, currentUser.id, sortKey]);

  // PJ見出しへのドロップ＝親を解除して指定PJの最上位タスクの末尾に追加する（子→親）。
  const handleUnparentDrop = useCallback(async (draggedId: string, projectId: string) => {
    const dragged = allTasks.find(t => t.id === draggedId);
    if (!dragged) return;
    if (!dragged.parent_task_id && (dragged.project_id ?? null) === projectId) return; // 変化なし
    const isTop = (t: Task) => !t.parent_task_id && (t.project_id ?? null) === projectId;
    const maxOrder = allTasks.filter(isTop).reduce((m, t) => Math.max(m, t.display_order ?? 0), -1);
    try {
      await saveTask({ ...dragged, parent_task_id: null, project_id: projectId, display_order: maxOrder + 1, updated_by: currentUser.id });
      if (sortKey !== "manual") { setSortKeyState("manual"); lsSet("sortKey", "manual"); }
    } catch (err) {
      showToast(`親の解除に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, saveTask, currentUser.id, sortKey]);

  // 「＋子タスク」：親を展開してから、親を固定した QuickAddTaskModal を開く。
  // （登録UIを親タスク追加と同じモーダルに統一。実際の作成・display_order 採番は
  //   QuickAddTaskModal.handleSave 側に一元化されている）。
  const openAddChild = useCallback((parent: Task) => {
    setCollapsedIds(prev => {
      if (!prev.has(parent.id)) return prev;
      const next = new Set(prev); next.delete(parent.id);
      lsSet("collapsedParents", Array.from(next));
      return next;
    });
    setQuickAddParentId(parent.id);
  }, []);

  const groups = useMemo(() => {
    if (groupBy === "project") {
      const map = new Map<string, Task[]>();
      projects.forEach(p => map.set(p.id, []));
      filteredTasks.forEach(t => { const a = t.project_id ? map.get(t.project_id) : undefined; if (a) a.push(t); });
      const pjGroups = projects.filter(p => (map.get(p.id)?.length ?? 0) > 0)
        .map(p => ({ label: p.name, color: p.color_tag, tasks: map.get(p.id) ?? [], projectId: p.id as string | null }));
      const noPjTasks = filteredTasks.filter(t => t.project_id == null);
      const todoMap = new Map<string, Task[]>();
      const noTodoTasks: Task[] = [];
      noPjTasks.forEach(t => {
        const id = (t.todo_ids ?? [])[0];
        if (id) { if (!todoMap.has(id)) todoMap.set(id, []); todoMap.get(id)!.push(t); }
        else noTodoTasks.push(t);
      });
      const todoGroups = [...todoMap.entries()].map(([todoId, tasks]) => {
        const td = todos.find(t => t.id === todoId);
        return { label: td ? `[ToDo] ${td.title.split("\n")[0].slice(0, 30)}` : "[ToDo]", color: "#6ee7b7", tasks, projectId: null as string | null };
      });
      const unassigned = noTodoTasks.length > 0
        ? [{ label: "プロジェクト未設定", color: "var(--color-text-tertiary)", tasks: noTodoTasks, projectId: null as string | null }] : [];
      return [...pjGroups, ...todoGroups, ...unassigned];
    }
    if (groupBy === "assignee") {
      const map = new Map<string, Task[]>();
      members.forEach(m => map.set(m.id, []));
      filteredTasks.forEach(t => { const a = map.get(t.assignee_member_id); if (a) a.push(t); });
      return members.filter(m => (map.get(m.id)?.length ?? 0) > 0)
        .map(m => ({ label: m.display_name, color: m.color_bg, tasks: map.get(m.id)!, projectId: null as string | null }));
    }
    if (groupBy === "tag") {
      // タグ別：1タスクが複数タグを持つ場合は各タグ群に重複して現れる。タグなしは末尾にまとめる。
      const map = new Map<string, Task[]>();
      const noTag: Task[] = [];
      filteredTasks.forEach(t => {
        const tags = t.tags ?? [];
        if (tags.length === 0) { noTag.push(t); return; }
        tags.forEach(tag => { if (!map.has(tag)) map.set(tag, []); map.get(tag)!.push(t); });
      });
      const tagGroups = [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "ja"))
        .map(([tag, tasks]) => ({ label: `# ${tag}`, color: "var(--color-brand)", tasks, projectId: null as string | null }));
      const noTagGroup = noTag.length > 0
        ? [{ label: "タグなし", color: "var(--color-text-tertiary)", tasks: noTag, projectId: null as string | null }] : [];
      return [...tagGroups, ...noTagGroup];
    }
    return (["in_progress", "todo", "done"] as const)
      .map(s => ({ label: TASK_STATUS_LABEL[s], color: TASK_STATUS_STYLE[s].color, tasks: filteredTasks.filter(t => t.status === s), projectId: null as string | null }))
      .filter(g => g.tasks.length > 0);
  }, [filteredTasks, groupBy, projects, members, todos]);

  const selectedTask = selectedTaskId ? allTasks.find(t => t.id === selectedTaskId) ?? null : null;

  // ===== 親子ツリーの行構築 =====
  // groupBy="project"（および ToDo/未設定）では親→子をネスト表示。
  // groupBy="assignee"/"status" では親子が別グループに散り得るためネストせず、
  // 子行に「↳ 親タスク名」注記を出す（ツリーが壊れない範囲で対応）。
  // 派生値（親ステータス・進捗）は保存せず taskHierarchy で都度算出する。
  const nestTree = groupBy === "project";

  // 注記用：親タスク名を引く（フィルタで親が除外されても allTasks から名前を取得し「孤児の親名」を出す）
  const parentNameOf = useCallback((task: Task): string | undefined => {
    if (!task.parent_task_id) return undefined;
    return allTasks.find(p => p.id === task.parent_task_id)?.name;
  }, [allTasks]);

  type RenderRow = { task: Task; depth: 0 | 1; parentNote?: string; isParent: boolean };

  // グループ内タスク配列 → 描画順の行配列（ネスト or フラット）に変換する。
  // group.tasks は既存のソート順を保持しているのでその順序を尊重しつつ、
  // ネスト時のみ親直下に子（display_order 順）を差し込む。
  const buildRows = useCallback((groupTasks: Task[]): RenderRow[] => {
    const idsInGroup = new Set(groupTasks.map(t => t.id));
    if (!nestTree) {
      // フラット（担当/状態/タグ別）：同一グループに親子が揃う場合のみネスト・トグルを有効化。
      // 別グループに散った子は従来どおり parentNote（↳ 親名）で注記表示のみ。
      const rows: RenderRow[] = [];
      for (const t of groupTasks) {
        // 同一グループに親がいて折りたたみ中の場合はスキップ
        if (t.parent_task_id && idsInGroup.has(t.parent_task_id) && collapsedIds.has(t.parent_task_id)) {
          continue;
        }
        const parentInGroup = !!(t.parent_task_id && idsInGroup.has(t.parent_task_id));
        const isParentHere = groupTasks.some(g => g.parent_task_id === t.id);
        rows.push({
          task: t,
          depth: (parentInGroup ? 1 : 0) as 0 | 1,
          parentNote: parentInGroup ? undefined : parentNameOf(t),
          isParent: isParentHere,
        });
      }
      return rows;
    }
    // ネスト：このグループ内の子IDを把握し、親の直下に寄せる。
    const rows: RenderRow[] = [];
    for (const t of groupTasks) {
      if (t.parent_task_id) {
        // 親が同じグループ内に居る子は、親の直下で描画するのでここではスキップ。
        // 親がこのグループに居ない（フィルタ除外/別PJ）孤児の子は最上位行＋注記で出す。
        if (idsInGroup.has(t.parent_task_id)) continue;
        rows.push({ task: t, depth: 0, parentNote: parentNameOf(t), isParent: false });
        continue;
      }
      // 最上位タスク
      const parent = t;
      const childrenHere = isParentTask(parent, filteredTasks);
      rows.push({ task: parent, depth: 0, isParent: childrenHere });
      // 子（フィルタ後に表示対象として残っているもののみ）を display_order 順で差し込む
      if (childrenHere && !collapsedIds.has(parent.id)) {
        for (const c of childrenOf(filteredTasks, parent.id, taskDependencies)) {
          if (idsInGroup.has(c.id)) {
            rows.push({ task: c, depth: 1, isParent: false });
          }
        }
      }
    }
    return rows;
  }, [nestTree, parentNameOf, filteredTasks, collapsedIds, taskDependencies]);

  // buildRows() は isParentTask/childrenOf を親タスクごとに呼ぶため実質 O(件数²)。
  // ドラッグ中は dropZone が高頻度（ほぼ毎フレーム）で更新されるため、buildRows を
  // render のたびに呼び直すとドラッグ中に顕著なカクつきが出る。groups が変わらない限り
  // （＝実データや折りたたみ状態が変わらない限り）同じ結果を使い回すようグループ単位でキャッシュする。
  const rowsByGroup = useMemo(() => {
    const map = new Map<string, RenderRow[]>();
    for (const g of groups) map.set(g.label, buildRows(g.tasks));
    return map;
  }, [groups, buildRows]);

  // Ctrl/Cmd+A・Shift+クリック範囲選択の対象となる「現在の表示順」。rowsByGroup が既に
  // グルーピング・階層ネスト・折りたたみを反映した描画順そのものなので、ガント側のような
  // 専用の順序組み立て関数は不要（groups→rowsByGroup をそのまま辿るだけで一致する）。
  const visibleOrderedTaskIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of groups) {
      for (const row of rowsByGroup.get(g.label) ?? []) ids.push(row.task.id);
    }
    return ids;
  }, [groups, rowsByGroup]);

  // 行クリックのハンドラ（ガントのタスクバー用ハンドラと同じ流儀）。
  // 修飾キー無し＝従来どおり詳細（TaskSidePanel）を開く＋アンカー更新。既存のチェックボックス
  // 選択（selectedIds）はクリアしない（詳細をプレビューしながら一括選択を保ちたいケースがあるため、
  // ガントの「通常クリックで選択クリア」とはあえて挙動を変えている）。
  // Ctrl/Cmd+クリック＝選択のみトグル（詳細は開かない）。Shift+クリック＝アンカー〜クリック先の
  // 範囲を現在の表示順（visibleOrderedTaskIds）で選択に追加（詳細は開かない）。
  const handleRowClick = useCallback((e: React.MouseEvent, taskId: string) => {
    if (e.shiftKey) {
      const anchorId = selectionAnchorRef.current;
      const rangeIds = computeRangeSelection(visibleOrderedTaskIds, anchorId, taskId);
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
    setSelectedTaskId(prev => prev === taskId ? null : taskId);
  }, [visibleOrderedTaskIds, toggleSelect]);

  // ===== キーボードショートカット（Ctrl/Cmd+A=表示中の全選択／Esc=選択解除） =====
  //
  // 【設計意図】ListViewがマウントされている間だけ（＝MainLayoutでviewMode==="list"の間だけ
  // ListViewが条件レンダーされる既存構造）有効にする＝「リストビューがアクティブなときのみ」は
  // コンポーネントのライフサイクルで自然に満たされる（GanttViewの既存ショートカットと同じ考え方）。
  // ガードは以下：①入力中（input/textarea/select/contenteditableにフォーカス）は一切
  // ハイジャックしない（タイピング・インライン編集・ブラウザのテキスト全選択を壊さないため）。
  // ②タスク詳細（TaskSidePanel=selectedTaskId、モバイルのTaskEditModal=editingTaskId）・
  // 子タスク追加モーダル（QuickAddTaskModal=quickAddParentId）のいずれかが開いている間は発火しない。
  // ③モバイル（isMobile）では無効化（タッチ操作主体・GanttViewのisMobile除外と同じ扱い）。
  useEffect(() => {
    if (isMobile) return;
    if (selectedTaskId || editingTaskId || quickAddParentId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
      if (isTyping) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedIds(new Set(filteredTasks.map(t => t.id)));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, selectedTaskId, editingTaskId, quickAddParentId, filteredTasks, clearSelection]);

  const SortIcon = ({ k }: { k: SortKey }) => sortKey === k
    ? <span style={{ marginLeft: 3, opacity: .8 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
    : <span style={{ marginLeft: 3, opacity: .2 }}>↕</span>;

  // 「シンプル」モードでは詳細列（優先度・工数）を非表示にして読みやすさを優先
  const [density, setDensityState] = useState<"simple" | "detailed">(() => lsGet("density", "simple"));
  const setDensity = (v: "simple" | "detailed") => { setDensityState(v); lsSet("density", v); };

  const allCols: { key: string; label: string; w: string; sortKey?: SortKey; simple: boolean }[] = [
    { key: "select",          label: "",         w: "32px",  simple: true  },
    { key: "assignee",        label: "担当者",   w: "90px",  sortKey: "assignee",        simple: true  },
    { key: "priority",        label: "優先度",   w: "55px",  sortKey: "priority",        simple: false },
    { key: "name",            label: "タスク名", w: "auto",  sortKey: "name",            simple: true  },
    { key: "status",          label: "状態",     w: "75px",  sortKey: "status",          simple: true  },
    { key: "due_date",        label: "期日",     w: "80px",  sortKey: "due_date",        simple: true  },
    { key: "estimated_hours", label: "工数",     w: "52px",  sortKey: "estimated_hours", simple: false },
  ];
  const cols = density === "simple" ? allCols.filter(c => c.simple) : allCols;

  // アクティブフィルター数（バッジ用）
  const activeFilterCount = [
    filterStatus !== "all", filterPriority !== "all",
    filterMember !== "all", filterMyOnly, filterThisWeek, filterHideDone,
  ].filter(Boolean).length;

  const clearAllFilters = useCallback(() => {
    setFilterStatus("all"); setFilterPriority("all"); setFilterMember("all");
    setFilterMyOnly(false); setFilterThisWeek(false); setFilterHideDone(false);
    setSearchText("");
  }, []);

  // 空状態プレースホルダー：絞り込み中 / 全くタスク無し で別メッセージ
  const emptyStateProps = activeFilterCount > 0 || searchText.trim()
    ? {
        icon: "🔍",
        title: "該当するタスクがありません",
        hint: "",
        actions: [{ label: "フィルタを解除", onClick: clearAllFilters, variant: "primary" as const }],
      }
    : {
        icon: "📋",
        title: "タスクがまだありません",
        hint: "右下の ＋ から追加できます。",
      };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ===== ツールバー 1段目：グループ + 検索 + 件数 + CSV ===== */}
        <div style={{
          padding: "7px 12px 6px",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-primary)", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          {/* グループ切替 */}
          <div style={{ display: "flex", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", padding: "2px" }}>
            {(["project", "assignee", "status", "tag"] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)}
                title={g === "project" ? "プロジェクト別にまとめる" : g === "assignee" ? "担当者別にまとめる" : g === "status" ? "ステータス別にまとめる" : "タグ別にまとめる"}
                style={{
                padding: "3px 9px", fontSize: "10px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                fontWeight: groupBy === g ? "500" : "400",
                background: groupBy === g ? "var(--color-bg-primary)" : "transparent",
                color: groupBy === g ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                boxShadow: groupBy === g ? "var(--shadow-sm)" : "none",
              }}>
                {g === "project" ? "PJ" : g === "assignee" ? "担当" : g === "status" ? "状態" : "タグ"}
              </button>
            ))}
          </div>

          {/* 手動並べ替えトグル（ON時：PJ別＋display_order順＝ドラッグで親タスクを並べ替え可能） */}
          <button
            onClick={() => {
              const enable = sortKey !== "manual";
              setSortKeyState(enable ? "manual" : "due_date"); lsSet("sortKey", enable ? "manual" : "due_date");
              if (enable) { setGroupByState("project"); lsSet("groupBy", "project"); }
            }}
            title={sortKey === "manual" ? "手動並べ替えを終了（期日順に戻す）" : "親タスクをドラッグで並べ替え（全員に共有）"}
            aria-label="手動並べ替え"
            style={{
              padding: "3px 9px", fontSize: "11px", borderRadius: "var(--radius-md)", cursor: "pointer",
              border: `1px solid ${sortKey === "manual" ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
              background: sortKey === "manual" ? "var(--color-brand-light)" : "transparent",
              color: sortKey === "manual" ? "var(--color-text-purple)" : "var(--color-text-tertiary)",
              whiteSpace: "nowrap", flexShrink: 0,
            }}
          >⠿ 並べ替え</button>

          {/* タスク並び順トグル（期日順⇔名前順・ガントビューと同じ見た目） */}
          <div style={{ display: "flex", gap: "2px", padding: "2px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", flexShrink: 0 }}>
            {(["due_date", "name"] as const).map(k => (
              <button
                key={k}
                onClick={() => {
                  setSortKeyState(k); lsSet("sortKey", k);
                  setSortDirState("asc"); lsSet("sortDir", "asc");
                }}
                title={k === "due_date" ? "期日順に並べる" : "名前順に並べる"}
                aria-label={k === "due_date" ? "期日順" : "名前順"}
                style={{
                  padding: "3px 8px", fontSize: "10px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                  background: sortKey === k ? "var(--color-bg-primary)" : "transparent",
                  color: sortKey === k ? "var(--color-brand)" : "var(--color-text-secondary)",
                  fontWeight: sortKey === k ? "600" : "400",
                  boxShadow: sortKey === k ? "var(--shadow-sm)" : "none",
                }}
              >
                {k === "due_date" ? "📅" : "🔠"}
              </button>
            ))}
          </div>

          {/* 検索 */}
          <input value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="🔍 タスク名・メモで検索" style={{
              flex: 1, minWidth: "120px", padding: "4px 10px", fontSize: "11px",
              border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
            }} />

          {/* 件数 */}
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
            {filteredTasks.length}件
            {activeFilterCount > 0 && (
              <span style={{
                marginLeft: 5, fontSize: "9px", padding: "1px 5px", borderRadius: "99px",
                background: "var(--color-brand-light)", color: "var(--color-text-purple)",
                border: "1px solid var(--color-brand-border)",
              }}>
                フィルター {activeFilterCount}
              </span>
            )}
          </span>

          {/* 表示密度トグル */}
          <div style={{ display: "flex", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", padding: "2px" }}>
            {(["simple", "detailed"] as const).map(d => (
              <button key={d} onClick={() => setDensity(d)}
                title={d === "simple" ? "主要4列のみ" : "全列（優先度・工数を含む）"}
                style={{
                  padding: "3px 9px", fontSize: "10px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                  fontWeight: density === d ? "500" : "400",
                  background: density === d ? "var(--color-bg-primary)" : "transparent",
                  color: density === d ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  boxShadow: density === d ? "var(--shadow-sm)" : "none",
                }}>
                {d === "simple" ? "▤" : "▦"}
              </button>
            ))}
          </div>

          {/* CSV（アイコンのみ・tooltip） */}
          <button onClick={() => exportCSV(filteredTasks, projects, members)} title="CSV出力" aria-label="CSV出力" style={{
            padding: "4px 8px", fontSize: "11px", color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
            cursor: "pointer", background: "transparent", whiteSpace: "nowrap",
          }}>⭳</button>
        </div>

        {/* ===== ツールバー 2段目：フィルター群 ===== */}
        <div style={{
          padding: "5px 12px",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap",
        }}>
          <CustomSelect value={filterStatus} onChange={value => setFilterStatus(value as Task["status"] | "all")}
            options={[
              { value: "all", label: "状態：すべて" },
              { value: "todo", label: "ToDo" },
              { value: "in_progress", label: "進行中" },
              { value: "done", label: "完了" },
            ]}
            style={{ width: "130px" }} />

          <CustomSelect value={filterPriority} onChange={value => setFilterPriority(value as "all"|"high"|"mid"|"low")}
            options={[
              { value: "all", label: "優先度：すべて" },
              { value: "high", label: "高" },
              { value: "mid", label: "中" },
              { value: "low", label: "低" },
            ]}
            style={{ width: "120px" }} />

          {/* 担当者別グループ中は担当者フィルターを非表示（冗長のため） */}
          {groupBy !== "assignee" && (
            <CustomSelect value={filterMember} onChange={value => { setFilterMember(value); setFilterMyOnly(false); }}
              options={[
                { value: "all", label: "担当者：全員" },
                ...[...members].sort((a, b) =>
                  a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
                ).map(m => ({ value: m.id, label: m.display_name })),
              ]}
              searchable searchPlaceholder="メンバーで検索..."
              style={{ width: "150px" }} />
          )}

          <div style={{ width: 1, height: 14, background: "var(--color-border-primary)", margin: "0 2px" }} />

          <Chip active={filterMyOnly}   onClick={() => { setFilterMyOnly(v => !v); setFilterMember("all"); }} label="👤" title="自分担当のみ" />
          <Chip active={filterThisWeek} onClick={() => setFilterThisWeek(v => !v)} label="📅" title="今週期限のみ" />
          <Chip active={filterHideDone} onClick={() => setFilterHideDone(v => !v)} label="🙈" title="完了を隠す" />

          {/* フィルタークリア */}
          {activeFilterCount > 0 && (
            <button onClick={() => {
              setFilterStatus("all"); setFilterPriority("all");
              setFilterMember("all"); setFilterMyOnly(false);
              setFilterThisWeek(false); setFilterHideDone(false);
            }} title="フィルターをクリア" aria-label="フィルターをクリア" style={{
              marginLeft: "auto", padding: "2px 8px", fontSize: "11px",
              color: "var(--color-text-tertiary)", border: "none",
              background: "transparent", cursor: "pointer",
            }}>✕</button>
          )}
        </div>

        {/* ===== 一括操作バー（選択時のみ表示・スムーズ展開でレイアウト飛びを防止） ===== */}
        <div style={{ overflow: "hidden", maxHeight: selectedIds.size > 0 ? "120px" : "0", transition: "max-height 0.18s ease", flexShrink: 0 }}>
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

        {/* ===== テーブル（PC）/ カード（モバイル） ===== */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {isMobile ? (
            /* モバイル：カードリスト */
            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {groups.map(group => (
                <div key={group.label}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 4px 4px" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: group.color, display: "inline-block" }} />
                    <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-secondary)" }}>{group.label}</span>
                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{group.tasks.length}件</span>
                  </div>
                  {(rowsByGroup.get(group.label) ?? []).map(({ task, depth, parentNote, isParent }) => {
                    const pj = task.project_id ? projectById.get(task.project_id) : undefined;
                    // 親のステータス・進捗は derivedByParentId から引く（参照安定＝React.memo が効く）
                    const derived = isParent ? derivedByParentId.get(task.id) : undefined;
                    const dispStatus = derived?.status ?? task.status;
                    const isDone = dispStatus === "done";
                    return (
                      <ListMobileTaskRow
                        key={task.id}
                        task={task}
                        depth={depth}
                        parentNote={parentNote}
                        isParent={isParent}
                        pj={pj}
                        assignees={assigneesByTaskId.get(task.id) ?? []}
                        dispStatus={dispStatus}
                        isOverdue={!!(task.due_date && task.due_date < t0 && !isDone)}
                        isChecked={selectedIds.has(task.id)}
                        isCollapsed={collapsedIds.has(task.id)}
                        prog={derived ?? null}
                        onOpen={setEditingTaskId}
                        onToggleSelect={toggleSelect}
                        onToggleCollapse={toggleCollapse}
                      />
                    );
                  })}
                </div>
              ))}
              {filteredTasks.length === 0 && <EmptyState {...emptyStateProps} />}
            </div>
          ) : (
            /* PC：テーブル */
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
                <tr style={{ background: "var(--color-bg-secondary)" }}>
                  {cols.map(col => (
                    <th
                      key={col.key}
                      onClick={() => {
                        if (col.key === "select") return;
                        if (col.sortKey) handleSort(col.sortKey);
                      }}
                      style={{
                        padding: col.key === "select" ? "6px 6px 6px 12px" : "6px 10px",
                        textAlign: "left",
                        borderBottom: "1px solid var(--color-border-primary)",
                        fontWeight: "500", color: "var(--color-text-secondary)",
                        width: col.w, cursor: col.sortKey ? "pointer" : "default",
                        userSelect: "none", whiteSpace: "nowrap",
                      }}
                    >
                      {col.key === "select" ? (
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          ref={el => { if (el) el.indeterminate = !allFilteredSelected && selectedIds.size > 0; }}
                          onChange={toggleSelectAll}
                          onClick={e => e.stopPropagation()}
                          aria-label="全選択"
                          style={{ cursor: "pointer", width: 14, height: 14, accentColor: "var(--color-brand)" }}
                        />
                      ) : (
                        <>
                          {col.label}
                          {col.sortKey && <SortIcon k={col.sortKey} />}
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let rowIdx = 0;
                  return groups.map(group => {
                    // PJ見出しへドロップ＝親解除（最上位化）。実PJを持つ見出しでのみ有効。
                    const canUnparentHere = groupBy === "project" && group.projectId != null;
                    return (
                    <React.Fragment key={group.label}>
                      <tr
                        onDragOver={canUnparentHere ? (e => { if (draggingId) e.preventDefault(); }) : undefined}
                        onDrop={canUnparentHere ? (e => {
                          e.preventDefault();
                          if (draggingId) handleUnparentDrop(draggingId, group.projectId!);
                          setDraggingId(null); setDropZone(null);
                        }) : undefined}
                      >
                        <td colSpan={cols.length} style={{
                          padding: "7px 10px 4px",
                          background: "var(--color-bg-secondary)",
                          borderBottom: "1px solid var(--color-border-primary)",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: group.color, display: "inline-block" }} />
                            <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-secondary)" }}>{group.label}</span>
                            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{group.tasks.length}件</span>
                            {canUnparentHere && (
                              // ドラッグ開始時にこのspanが出現/消滅すると、その瞬間だけ見出し行の
                              // 幅が変わりレイアウトが動く（複数PJ見出しで同時に発生）。
                              // visibility で常時マウントし、幅は最初から確保しておくことで
                              // ドラッグ開始時のガタつきを防ぐ
                              <span style={{
                                fontSize: "10px", color: "var(--color-brand)",
                                visibility: draggingId ? "visible" : "hidden",
                              }}>↑ ここに落とすと最上位タスクになります</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {(() => {
                        const rows = rowsByGroup.get(group.label) ?? [];
                        return rows.map(({ task, depth, parentNote, isParent }, ri) => {
                        const closesGroup = depth === 1 && (!rows[ri + 1] || rows[ri + 1].depth === 0);
                        const isEven = rowIdx % 2 === 0;
                        rowIdx++;
                        const pj = task.project_id ? projectById.get(task.project_id) : undefined;
                        const todoItem = (task.todo_ids ?? [])[0] ? todoById.get(task.todo_ids[0]) : undefined;
                        // 親行のステータス・進捗は derivedByParentId から引く（参照安定＝React.memo が効く）
                        const derived = isParent ? derivedByParentId.get(task.id) : undefined;
                        const dispStatus = derived?.status ?? task.status;
                        // ＋子タスクを出せるのは最上位タスク（親を持たない）のみ。孤児の子（depth0だが parent あり）は除外。
                        const canAddChild = !task.parent_task_id;
                        // PJ別表示中は全行がドラッグ元・ドロップ先の両方になれる（並び替え・親子変更とも可能）
                        const canDrag = groupBy === "project";
                        const showHandleCol = groupBy === "project";
                        const myZone = dropZone?.id === task.id ? dropZone.zone : null;
                        return (
                          <ListTaskRow
                            key={task.id}
                            task={task}
                            depth={depth}
                            parentNote={parentNote}
                            isParent={isParent}
                            closesGroup={closesGroup}
                            isEven={isEven}
                            pj={pj}
                            todoItem={todoItem}
                            dispStatus={dispStatus}
                            isSelected={selectedTaskId === task.id}
                            isChecked={selectedIds.has(task.id)}
                            canAddChild={canAddChild}
                            isCollapsed={collapsedIds.has(task.id)}
                            prog={derived ?? null}
                            canDrag={canDrag}
                            showHandleCol={showHandleCol}
                            myZone={myZone}
                            density={density}
                            groupBy={groupBy}
                            members={members}
                            currentUser={currentUser}
                            draggingId={draggingId}
                            saveTask={saveTask}
                            onRowClick={handleRowClick}
                            toggleSelect={toggleSelect}
                            toggleCollapse={toggleCollapse}
                            openAddChild={openAddChild}
                            setDraggingId={setDraggingId}
                            setDropZone={setDropZone}
                            handleTaskDrop={handleTaskDrop}
                          />
                        );
                      });
                        })()}
                    </React.Fragment>
                    );
                  });
                })()}
                {filteredTasks.length === 0 && (
                  <tr><td colSpan={cols.length}><EmptyState {...emptyStateProps} /></td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedTask && !isMobile && (
        <TaskSidePanel
          taskId={selectedTask.id}
          currentUser={currentUser}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onDeleted={() => { setEditingTaskId(null); setSelectedTaskId(null); }}
        />
      )}

      {/* 子タスク追加：親タスク追加と同じモーダル（親を固定・PJは親に追従） */}
      {quickAddParentId && (
        <QuickAddTaskModal
          currentUser={currentUser}
          projects={projects}
          defaultParentId={quickAddParentId}
          defaultProjectId={allTasks.find(t => t.id === quickAddParentId)?.project_id ?? undefined}
          onClose={() => setQuickAddParentId(null)}
        />
      )}
    </div>
  );
}

// ===== ListMobileTaskRow（モバイルのカード行） =====
//
// 【設計意図】React.memo 化。PC表の行と同じ理由（選択・折りたたみ操作のたびに
// 全カードが再レンダリングされるのを防ぐ）。

interface ListMobileTaskRowProps {
  task: Task;
  depth: 0 | 1;
  parentNote?: string;
  isParent: boolean;
  pj?: Project;
  assignees: Member[];
  dispStatus: Task["status"];
  isOverdue: boolean;
  isChecked: boolean;
  isCollapsed: boolean;
  prog: ParentDerived | null;
  onOpen: (taskId: string) => void;
  onToggleSelect: (id: string, e?: React.MouseEvent) => void;
  onToggleCollapse: (id: string, e?: React.MouseEvent) => void;
}

const ListMobileTaskRow = memo(function ListMobileTaskRow({
  task, depth, parentNote, isParent, pj, assignees, dispStatus, isOverdue,
  isChecked, isCollapsed, prog, onOpen, onToggleSelect, onToggleCollapse,
}: ListMobileTaskRowProps) {
  const isDone = dispStatus === "done";
  // モバイルは「タスク名＋担当者＋期日」のみのシンプル表示。
  // 状態は左カラーバーと文字スタイルで表現し、詳細はタップで TaskEditModal が開く。
  const statusColor = TASK_STATUS_STYLE[dispStatus].color;
  return (
    <div onClick={() => onOpen(task.id)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpen(task.id); }}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        marginLeft: depth === 1 ? 18 : 0,
        background: isChecked ? "var(--color-brand-light)" : "var(--color-bg-primary)",
        border: isChecked
          ? "1px solid var(--color-brand-border)"
          : "1px solid var(--color-border-primary)",
        borderLeft: `4px solid ${pj?.color_tag ?? statusColor}`,
        borderRadius: "var(--radius-md)",
        padding: "12px 12px", marginBottom: "6px",
        cursor: "pointer", opacity: isDone ? 0.55 : 1,
        minHeight: "52px",
      }}>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={() => onToggleSelect(task.id)}
        onClick={e => e.stopPropagation()}
        aria-label={`${task.name} を選択`}
        style={{ cursor: "pointer", width: 18, height: 18, accentColor: "var(--color-brand)", flexShrink: 0 }}
      />
      {isParent && (
        <button
          onClick={e => onToggleCollapse(task.id, e)}
          aria-label={isCollapsed ? "子タスクを表示" : "子タスクを隠す"}
          aria-expanded={!isCollapsed}
          style={{
            flexShrink: 0, width: 18, height: 18, padding: 0, border: "none",
            background: "transparent", cursor: "pointer", fontSize: "10px",
            color: "var(--color-text-tertiary)",
          }}
        >{isCollapsed ? "▶" : "▼"}</button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "13px", fontWeight: isParent ? 700 : 500,
          color: "var(--color-text-primary)",
          lineHeight: 1.4, textDecoration: isDone ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {depth === 1 && !parentNote && <span style={{ color: "var(--color-text-tertiary)", marginRight: 3 }}>↳</span>}
          {task.name}
        </div>
        {isParent && prog && (
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>子 {prog.done}/{prog.total}・{prog.pct}%</span>
        )}
        {(task.tags?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "2px" }}>
            {task.tags!.map((tag, ti) => (
              <span key={ti} style={{ fontSize: "9px", padding: "0 5px", lineHeight: 1.6, borderRadius: "99px", background: "var(--color-brand-light)", color: "var(--color-text-purple)", border: "1px solid var(--color-brand-border)" }}>#{tag}</span>
            ))}
          </div>
        )}
        {parentNote && (
          <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ {parentNote}</div>
        )}
      </div>
      {assignees.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
          {assignees.slice(0, 2).map(m => <Avatar key={m.id} member={m} size={20} />)}
          {assignees.length > 2 && (
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>+{assignees.length - 2}</span>
          )}
        </div>
      )}
      {task.due_date && (
        <span style={{
          fontSize: "11px", flexShrink: 0, minWidth: "42px", textAlign: "right",
          color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
          fontWeight: isOverdue ? 600 : 400,
        }}>{task.due_date.slice(5).replace("-", "/")}</span>
      )}
    </div>
  );
});

// ===== ListTaskRow（PC表の1行） =====
//
// 【設計意図】React.memo 化。以前は行のJSXをListViewの描画ループに直接書いていたため、
// 選択・ドラッグ中のホバーなど無関係な state 変化のたびに全行が再レンダリングされていた
// （カクつきの主因）。行を切り出して memo 化し、コールバックは呼び出し側で useCallback/
// useState のsetterをそのまま渡すことで、実際に変化した行だけが再レンダリングされるようにする。

interface ListTaskRowProps {
  task: Task;
  depth: 0 | 1;
  parentNote?: string;
  isParent: boolean;
  closesGroup: boolean;
  isEven: boolean;
  pj?: Project;
  todoItem?: ToDo;
  dispStatus: Task["status"];
  isSelected: boolean;
  isChecked: boolean;
  canAddChild: boolean;
  isCollapsed: boolean;
  prog: ParentDerived | null;
  canDrag: boolean;
  showHandleCol: boolean;
  myZone: DropZone | null;
  density: "simple" | "detailed";
  groupBy: GroupBy;
  members: Member[];
  currentUser: Member;
  draggingId: string | null;
  saveTask: (task: Task) => Promise<void>;
  onRowClick: (e: React.MouseEvent, taskId: string) => void;
  toggleSelect: (id: string, e?: React.MouseEvent) => void;
  toggleCollapse: (id: string, e?: React.MouseEvent) => void;
  openAddChild: (task: Task) => void;
  setDraggingId: React.Dispatch<React.SetStateAction<string | null>>;
  setDropZone: React.Dispatch<React.SetStateAction<{ id: string; zone: DropZone } | null>>;
  handleTaskDrop: (draggedId: string, targetId: string, zone: DropZone) => void;
}

const ListTaskRow = memo(function ListTaskRow({
  task, depth, parentNote, isParent, closesGroup, isEven, pj, todoItem,
  dispStatus, isSelected, isChecked, canAddChild, isCollapsed, prog,
  canDrag, showHandleCol, myZone, density, groupBy, members, currentUser,
  draggingId, saveTask, onRowClick, toggleSelect, toggleCollapse,
  openAddChild, setDraggingId, setDropZone, handleTaskDrop,
}: ListTaskRowProps) {
  const isDone = dispStatus === "done";
  const zebraBg = isEven ? "var(--color-bg-primary)" : "var(--color-bg-secondary)";

  // 【重要】強調表示（ドロップ位置・親子ライン等）はすべて box-shadow の inset で表現し、
  // border は常に固定値のまま変えない。以前は border-top/border-bottom の「幅」を
  // ホバー時だけ 1px→2px（あるいは 0→2px）に変えていたため、ホバーした瞬間に行の高さが
  // 変わって行がわずかにずれ、その結果マウスが行の外に出て dragleave→（隣接行への）
  // dragover→…を高頻度で往復するフィードバックループが発生し、ドラッグ移動中の激しい
  // カクつき・フリーズの原因になっていた。box-shadow はレイアウト（行の高さ・位置）に
  // 一切影響しないため、複数の状態を重ねても行のジオメトリは常に不変になる。
  const shadowLayers: string[] = [];
  if (myZone === "nest") shadowLayers.push("inset 0 0 0 2px var(--color-brand)");
  if (isChecked || isSelected || isParent) shadowLayers.push("inset 3px 0 0 var(--color-brand)");
  else if (depth === 1) shadowLayers.push("inset 2px 0 0 var(--color-brand-border)");
  if (myZone === "before") shadowLayers.push("inset 0 2px 0 var(--color-brand)");
  else if (isParent && depth === 0) shadowLayers.push("inset 0 2px 0 var(--color-border-primary)");
  if (myZone === "after") shadowLayers.push("inset 0 -2px 0 var(--color-brand)");
  else if (closesGroup) shadowLayers.push("inset 0 -2px 0 var(--color-border-primary)");

  return (
    <tr
      onClick={e => onRowClick(e, task.id)}
      onDragOver={canDrag ? (e => {
        if (!draggingId || draggingId === task.id) return;
        e.preventDefault();
        const zone = computeDropZone(e, task);
        setDropZone(z => (z && z.id === task.id && z.zone === zone) ? z : { id: task.id, zone });
      }) : undefined}
      onDragLeave={canDrag ? (() => setDropZone(z => (z?.id === task.id ? null : z))) : undefined}
      onDrop={canDrag ? (e => {
        e.preventDefault();
        if (draggingId && myZone) handleTaskDrop(draggingId, task.id, myZone);
        setDraggingId(null); setDropZone(null);
      }) : undefined}
      style={{
      // 常に 1px 固定（幅は変えない・色も固定）。強調表示は上の shadowLayers（box-shadow）側で行う
      borderBottom: "1px solid var(--color-bg-tertiary)",
      background: myZone === "nest"
        ? "var(--color-brand-light)"
        : isChecked
        ? "var(--color-brand-light)"
        : isSelected ? "var(--color-brand-light)"
        : isDone ? "var(--color-bg-secondary)" : zebraBg,
      cursor: "pointer", opacity: isDone ? 0.65 : 1, transition: "background 0.1s",
      boxShadow: shadowLayers.length > 0 ? shadowLayers.join(", ") : "none",
    }}>
      {/* チェックボックス（行選択）＋ 手動順時はドラッグハンドル */}
      <td style={{ padding: "6px 6px 6px 12px", whiteSpace: "nowrap" }}
          onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {/* ハンドル列：ドラッグで並べ替え。他タスクの行の中央に落とすとその子に、上下端に落とすと並び替え */}
          {showHandleCol && (
            canDrag ? (
              // ドラッグハンドル（並べ替え・親子付け替え専用）。マウスのドラッグ操作専用でキーボード代替手段はない
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <span
                draggable
                onDragStart={e => { setDraggingId(task.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDraggingId(null); setDropZone(null); }}
                title="ドラッグして並べ替え／他のタスクの中央に落とすとその子タスクにできます"
                style={{ width: 12, textAlign: "center", flexShrink: 0, cursor: "grab", color: "var(--color-text-tertiary)", fontSize: "12px", lineHeight: 1, userSelect: "none" }}
              >⠿</span>
            ) : (
              <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
            )
          )}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => toggleSelect(task.id)}
            aria-label={`${task.name} を選択`}
            style={{ cursor: "pointer", width: 14, height: 14, accentColor: "var(--color-brand)" }}
          />
        </div>
      </td>
      {/* 担当者（インライン編集） */}
      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
        onClick={e => e.stopPropagation()}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => saveTask({ ...task, assignee_member_ids: ids, assignee_member_id: ids[0] ?? "", updated_by: currentUser.id })}
        />
      </td>
      {/* 優先度（詳細モードのみ） */}
      {density === "detailed" && (
        <td style={{ padding: "6px 10px" }}>
          {task.priority && (
            <span style={{
              fontSize: "9px", padding: "2px 5px", borderRadius: "3px",
              background: TASK_PRIORITY_STYLE[task.priority].bg, color: TASK_PRIORITY_STYLE[task.priority].color,
            }}>{TASK_PRIORITY_LABEL[task.priority]}</span>
          )}
        </td>
      )}
      {/* タスク名（depth に応じたインデント＋親トグル＋子注記） */}
      <td style={{ padding: "6px 10px", paddingLeft: depth === 1 ? 10 + 22 : 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {/* 折りたたみトグル（子を持つ親のみ） */}
          {isParent ? (
            <button
              onClick={e => toggleCollapse(task.id, e)}
              aria-label={isCollapsed ? "子タスクを表示" : "子タスクを隠す"}
              aria-expanded={!isCollapsed}
              style={{
                flexShrink: 0, width: 16, height: 16, lineHeight: "16px", padding: 0,
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: "9px", color: "var(--color-text-tertiary)",
              }}
            >{isCollapsed ? "▶" : "▼"}</button>
          ) : depth === 1 && (
            <span style={{ flexShrink: 0, width: 12, color: "var(--color-text-tertiary)", fontSize: "10px" }}>↳</span>
          )}
          {/* 行クリックでタスク詳細が開くため、名前部分のインライン編集はそちらに伝播させない（クリックしても何も起きないラッパー） */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              overflow: "hidden", maxWidth: "360px",
              textDecoration: isDone ? "line-through" : "none",
              fontWeight: isSelected ? "500" : isParent ? "600" : "400",
              color: isSelected ? "var(--color-text-purple)" : "var(--color-text-primary)",
            }}>
            <InlineEditText
              value={task.name}
              onSave={name => saveTask({ ...task, name, updated_by: currentUser.id })}
              style={{ fontWeight: "inherit", color: "inherit" }}
            />
          </div>
          {/* 親：子 n/m・◯% バッジ */}
          {isParent && prog && (
            <span title="子タスクの完了状況（自動算出）" style={{
              flexShrink: 0, fontSize: "9px", padding: "1px 6px", borderRadius: "99px",
              background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)",
              whiteSpace: "nowrap",
            }}>子 {prog.done}/{prog.total}・{prog.pct}%</span>
          )}
          {task.comment && (
            <span title="メモあり" style={{ fontSize: "11px", opacity: 0.45, flexShrink: 0 }}>💬</span>
          )}
          {isSelected && (
            <span style={{ fontSize: "10px", color: "var(--color-text-purple)", flexShrink: 0 }}>›</span>
          )}
        </div>
        {/* タグ */}
        {(task.tags?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "2px" }}>
            {task.tags!.map((tag, ti) => (
              <span key={ti} style={{ fontSize: "9px", padding: "0 5px", lineHeight: 1.6, borderRadius: "99px", background: "var(--color-brand-light)", color: "var(--color-text-purple)", border: "1px solid var(--color-brand-border)" }}>#{tag}</span>
            ))}
          </div>
        )}
        {/* 親タスク名の注記（ネストできない/孤児の子） */}
        {parentNote && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>
              ↳ {parentNote}
            </span>
          </div>
        )}
        {groupBy !== "project" && pj && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />
            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>{pj.name.slice(0, 14)}</span>
          </div>
        )}
        {!pj && todoItem && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
            <span style={{ fontSize: "9px", color: "#059669", fontWeight: "500" }}>ToDo</span>
            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>
              {todoItem.title.split("\n")[0].slice(0, 20)}
            </span>
          </div>
        )}
        {/* ＋子タスク（最上位行のみ・親を固定して追加モーダルを開く＝親タスク追加と同じUI） */}
        {canAddChild && (
          <button
            onClick={e => { e.stopPropagation(); openAddChild(task); }}
            style={{
              marginTop: "2px", padding: "1px 4px", fontSize: "9px",
              color: "var(--color-text-tertiary)", border: "none",
              background: "transparent", cursor: "pointer",
            }}
          >＋ 子タスク</button>
        )}
      </td>
      {/* 状態（親は導出値・バッジのみ＝手動変更UIは出さない） */}
      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
        <span title={isParent ? "子から自動算出" : undefined} style={{
          fontSize: "9px", padding: "2px 6px", borderRadius: "3px",
          background: TASK_STATUS_STYLE[dispStatus].bg, color: TASK_STATUS_STYLE[dispStatus].color,
        }}>{TASK_STATUS_LABEL[dispStatus]}</span>
      </td>
      {/* 期日（インライン編集） */}
      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
        onClick={e => e.stopPropagation()}>
        {task.start_date && (
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
            {task.start_date.slice(5).replace("-", "/")}〜
          </span>
        )}
        <InlineEditDate
          value={task.due_date}
          onSave={due_date => saveTask({ ...task, due_date, updated_by: currentUser.id })}
        />
      </td>
      {/* 工数（詳細モードのみ） */}
      {density === "detailed" && (
        <td style={{ padding: "6px 10px", color: "var(--color-text-tertiary)", textAlign: "right" }}>
          {task.estimated_hours != null ? `${task.estimated_hours}h` : "—"}
        </td>
      )}
    </tr>
  );
});

function Chip({ active, onClick, label, title }: { active: boolean; onClick: () => void; label: string; title?: string }) {
  return (
    <button onClick={onClick} title={title} aria-label={title ?? label} style={{
      padding: "3px 9px", fontSize: "12px", borderRadius: "var(--radius-full)", cursor: "pointer",
      lineHeight: 1.2,
      fontWeight: active ? "500" : "400",
      background: active ? "var(--color-brand-light)" : "transparent",
      color: active ? "var(--color-text-purple)" : "var(--color-text-tertiary)",
      border: active ? "1px solid var(--color-brand-border)" : "1px solid var(--color-border-primary)",
      transition: "all 0.1s",
    }}>{label}</button>
  );
}


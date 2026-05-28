// src/components/list/ListView.tsx
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE, getAssigneeIds, isAssignedTo } from "../../lib/taskMeta";
import { todayStr, addDaysFromToday } from "../../lib/date";
import { KEYS } from "../../lib/localData/localStore";
import { confirmDialog } from "../../lib/dialog";
import { showToast } from "../common/Toast";
import { childrenOf, isParentTask, effectiveStatus, parentProgress } from "../../lib/taskHierarchy";
import { v4 as uuidv4 } from "uuid";
import { Avatar } from "../auth/UserSelectScreen";
import { TaskEditModal } from "../task/TaskEditModal";
import { TaskSidePanel } from "../task/TaskSidePanel";
import { EmptyState } from "../common/EmptyState";
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

type GroupBy = "project" | "assignee" | "status";
type SortKey = "name" | "due_date" | "priority" | "estimated_hours" | "status" | "assignee";
type SortDir = "asc" | "desc";

const PRIO: Record<string, number> = { high: 0, mid: 1, low: 2, "": 3 };
const STATUS_ORDER: Record<Task["status"], number> = { in_progress: 0, todo: 1, done: 2 };

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
  const rawTasks   = useAppStore(s => s.tasks);
  const rawMembers = useAppStore(s => s.members);
  const rawTodos   = useAppStore(s => s.todos);
  const saveTask   = useAppStore(s => s.saveTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const todos    = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const isMobile = useIsMobile();
  const allTasks = useMemo(() => rawTasks.filter(t => !t.is_deleted), [rawTasks]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

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

  // 「＋子タスク」インライン追加：開いている親ID（最上位）と入力中テキスト
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [childDraft, setChildDraft] = useState("");

  // 一括操作用：複数選択
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);


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
  }, [allTasks, selectedProject, filterStatus, filterHideDone, filterMyOnly, mineOnly, filterMember,
      filterThisWeek, filterPriority, searchText, sortKey, sortDir, currentUser.id, t0, t7, members]);

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
    try {
      await Promise.all(targets.map(t =>
        saveTask({ ...t, status, updated_by: currentUser.id }),
      ));
      showToast(`${targets.length}件のステータスを「${TASK_STATUS_LABEL[status]}」に変更しました`);
      clearSelection();
    } catch (err) {
      showToast(`一括変更に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUser.id, clearSelection]);

  // 一括担当者変更
  const bulkUpdateAssignee = useCallback(async (memberId: string) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    try {
      await Promise.all(targets.map(t => saveTask({
        ...t,
        assignee_member_id: memberId,
        assignee_member_ids: [memberId],
        updated_by: currentUser.id,
      })));
      const m = members.find(mm => mm.id === memberId);
      showToast(`${targets.length}件の担当者を「${m?.display_name ?? memberId}」に変更しました`);
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
      showToast(`${count}件のタスクを削除しました`);
      clearSelection();
    } catch (err) {
      showToast(`一括削除に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [selectedIds, deleteTask, currentUser.id, clearSelection]);

  // 「＋子タスク」インライン作成。QuickAddTaskModal の既定に合わせる
  // （parent_task_id=親id・project_id=親のPJ・status="todo"・display_order=兄弟max+1・他は既定値）。
  const createChildTask = useCallback(async (parent: Task, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const siblings = allTasks.filter(t => t.parent_task_id === parent.id);
    const nextOrder = siblings.length === 0
      ? 0
      : Math.max(...siblings.map(t => t.display_order ?? 0)) + 1;
    const child: Task = {
      id: uuidv4(),
      name,
      project_id: parent.project_id ?? null,
      parent_task_id: parent.id,
      display_order: nextOrder,
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
    };
    try {
      await saveTask(child);
      // 追加直後は親を展開状態にして子が見えるようにする
      setCollapsedIds(prev => {
        if (!prev.has(parent.id)) return prev;
        const next = new Set(prev); next.delete(parent.id);
        lsSet("collapsedParents", Array.from(next));
        return next;
      });
      setChildDraft("");
    } catch (err) {
      showToast(`子タスクの追加に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`, "error");
    }
  }, [allTasks, saveTask, currentUser.id]);

  const groups = useMemo(() => {
    if (groupBy === "project") {
      const map = new Map<string, Task[]>();
      projects.forEach(p => map.set(p.id, []));
      filteredTasks.forEach(t => { const a = t.project_id ? map.get(t.project_id) : undefined; if (a) a.push(t); });
      const pjGroups = projects.filter(p => (map.get(p.id)?.length ?? 0) > 0)
        .map(p => ({ label: p.name, color: p.color_tag, tasks: map.get(p.id) ?? [] }));
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
        return { label: td ? `[ToDo] ${td.title.split("\n")[0].slice(0, 30)}` : "[ToDo]", color: "#6ee7b7", tasks };
      });
      const unassigned = noTodoTasks.length > 0
        ? [{ label: "プロジェクト未設定", color: "var(--color-text-tertiary)", tasks: noTodoTasks }] : [];
      return [...pjGroups, ...todoGroups, ...unassigned];
    }
    if (groupBy === "assignee") {
      const map = new Map<string, Task[]>();
      members.forEach(m => map.set(m.id, []));
      filteredTasks.forEach(t => { const a = map.get(t.assignee_member_id); if (a) a.push(t); });
      return members.filter(m => (map.get(m.id)?.length ?? 0) > 0)
        .map(m => ({ label: m.display_name, color: m.color_bg, tasks: map.get(m.id)! }));
    }
    return (["in_progress", "todo", "done"] as const)
      .map(s => ({ label: TASK_STATUS_LABEL[s], color: TASK_STATUS_STYLE[s].color, tasks: filteredTasks.filter(t => t.status === s) }))
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
    if (!nestTree) {
      // フラット：親子はネストしない。親を持つ子には注記を付ける。
      return groupTasks.map(t => ({
        task: t,
        depth: 0 as const,
        parentNote: parentNameOf(t),
        isParent: isParentTask(t, filteredTasks),
      }));
    }
    // ネスト：このグループ内の子IDを把握し、親の直下に寄せる。
    const idsInGroup = new Set(groupTasks.map(t => t.id));
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
        for (const c of childrenOf(filteredTasks, parent.id)) {
          if (idsInGroup.has(c.id)) {
            rows.push({ task: c, depth: 1, isParent: false });
          }
        }
      }
    }
    return rows;
  }, [nestTree, parentNameOf, filteredTasks, collapsedIds]);

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
        title: "条件に一致するタスクがありません",
        hint: "フィルタや検索条件を変更してみてください。",
        actions: [{ label: "フィルタを解除", onClick: clearAllFilters, variant: "primary" as const }],
      }
    : {
        icon: "📋",
        title: "タスクがまだありません",
        hint: "画面右下の ＋ ボタン、またはダッシュボードから追加できます。",
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
            {(["project", "assignee", "status"] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} style={{
                padding: "3px 9px", fontSize: "10px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                fontWeight: groupBy === g ? "500" : "400",
                background: groupBy === g ? "var(--color-bg-primary)" : "transparent",
                color: groupBy === g ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                boxShadow: groupBy === g ? "var(--shadow-sm)" : "none",
              }}>
                {g === "project" ? "PJ別" : g === "assignee" ? "担当者別" : "ステータス別"}
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
                {d === "simple" ? "シンプル" : "詳細"}
              </button>
            ))}
          </div>

          {/* CSV */}
          <button onClick={() => exportCSV(filteredTasks, projects, members)} style={{
            padding: "4px 10px", fontSize: "10px", color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
            cursor: "pointer", background: "transparent", whiteSpace: "nowrap",
          }}>↓ CSV</button>
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
                ...members.map(m => ({ value: m.id, label: m.display_name })),
              ]}
              searchable searchPlaceholder="メンバーで検索..."
              style={{ width: "150px" }} />
          )}

          <div style={{ width: 1, height: 14, background: "var(--color-border-primary)", margin: "0 2px" }} />

          <Chip active={filterMyOnly}   onClick={() => { setFilterMyOnly(v => !v); setFilterMember("all"); }} label="自分担当" />
          <Chip active={filterThisWeek} onClick={() => setFilterThisWeek(v => !v)} label="今週期限" />
          <Chip active={filterHideDone} onClick={() => setFilterHideDone(v => !v)} label="完了を隠す" />

          {/* フィルタークリア */}
          {activeFilterCount > 0 && (
            <button onClick={() => {
              setFilterStatus("all"); setFilterPriority("all");
              setFilterMember("all"); setFilterMyOnly(false);
              setFilterThisWeek(false); setFilterHideDone(false);
            }} style={{
              marginLeft: "auto", padding: "2px 8px", fontSize: "10px",
              color: "var(--color-text-tertiary)", border: "none",
              background: "transparent", cursor: "pointer",
            }}>✕ クリア</button>
          )}
        </div>

        {/* ===== 一括操作バー（選択時のみ表示） ===== */}
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
                ...members.map(m => ({ value: m.id, label: m.display_name })),
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
                  {buildRows(group.tasks).map(({ task, depth, parentNote, isParent }) => {
                    const taskAssigneeIds = getAssigneeIds(task);
                    const taskAssignees   = members.filter(mb => taskAssigneeIds.includes(mb.id));
                    const pj = projects.find(p => p.id === task.project_id);
                    // 親はステータス・進捗を子から導出
                    const dispStatus = isParent ? effectiveStatus(task, filteredTasks) : task.status;
                    const isDone    = dispStatus === "done";
                    const isOverdue = task.due_date && task.due_date < t0 && !isDone;
                    const isSelected = selectedIds.has(task.id);
                    const collapsed = collapsedIds.has(task.id);
                    const prog = isParent ? parentProgress(filteredTasks, task.id) : null;
                    // モバイルは「タスク名＋担当者＋期日」のみのシンプル表示。
                    // 状態は左カラーバーと文字スタイルで表現し、詳細はタップで TaskEditModal が開く。
                    const statusColor = TASK_STATUS_STYLE[dispStatus].color;
                    return (
                      <div key={task.id} onClick={() => setEditingTaskId(task.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          marginLeft: depth === 1 ? 18 : 0,
                          background: isSelected ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                          border: isSelected
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
                          checked={isSelected}
                          onChange={() => toggleSelect(task.id)}
                          onClick={e => e.stopPropagation()}
                          aria-label={`${task.name} を選択`}
                          style={{ cursor: "pointer", width: 18, height: 18, accentColor: "var(--color-brand)", flexShrink: 0 }}
                        />
                        {isParent && (
                          <button
                            onClick={e => toggleCollapse(task.id, e)}
                            aria-label={collapsed ? "子タスクを表示" : "子タスクを隠す"}
                            aria-expanded={!collapsed}
                            style={{
                              flexShrink: 0, width: 18, height: 18, padding: 0, border: "none",
                              background: "transparent", cursor: "pointer", fontSize: "10px",
                              color: "var(--color-text-tertiary)",
                            }}
                          >{collapsed ? "▶" : "▼"}</button>
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
                          {parentNote && (
                            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ {parentNote}</div>
                          )}
                        </div>
                        {taskAssignees.length > 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
                            {taskAssignees.slice(0, 2).map(m => <Avatar key={m.id} member={m} size={20} />)}
                            {taskAssignees.length > 2 && (
                              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>+{taskAssignees.length - 2}</span>
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
                  })}
                </div>
              ))}
              {filteredTasks.length === 0 && <EmptyState {...emptyStateProps} />}
            </div>
          ) : (
            /* PC：テーブル */
            <table style={{ width: "auto", borderCollapse: "collapse", fontSize: "11px" }}>
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
                  return groups.map(group => (
                    <React.Fragment key={group.label}>
                      <tr>
                        <td colSpan={cols.length} style={{
                          padding: "7px 10px 4px",
                          background: "var(--color-bg-secondary)",
                          borderBottom: "1px solid var(--color-border-primary)",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: group.color, display: "inline-block" }} />
                            <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-secondary)" }}>{group.label}</span>
                            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{group.tasks.length}件</span>
                          </div>
                        </td>
                      </tr>
                      {buildRows(group.tasks).map(({ task, depth, parentNote, isParent }) => {
                        const isEven = rowIdx % 2 === 0;
                        rowIdx++;
                        const taskAssigneeIds = getAssigneeIds(task);
                        const taskAssignees   = members.filter(mb => taskAssigneeIds.includes(mb.id));
                        const pj = projects.find(p => p.id === task.project_id);
                        const td = (task.todo_ids ?? [])[0] ? todos.find(t => t.id === task.todo_ids[0]) : undefined;
                        // 親行のステータスは子から導出（rollupStatus）。子無しは自身の値。
                        const dispStatus = isParent ? effectiveStatus(task, filteredTasks) : task.status;
                        const isDone    = dispStatus === "done";
                        const isOverdue = task.due_date && task.due_date < t0 && !isDone;
                        const isSel     = selectedTaskId === task.id;
                        const zebraBg   = isEven ? "var(--color-bg-primary)" : "var(--color-bg-secondary)";
                        // ＋子タスクを出せるのは最上位タスク（親を持たない）のみ。孤児の子（depth0だが parent あり）は除外。
                        const canAddChild = !task.parent_task_id;
                        const collapsed = collapsedIds.has(task.id);
                        const prog = isParent ? parentProgress(filteredTasks, task.id) : null;
                        return (
                          <tr key={task.id} onClick={() => setSelectedTaskId(isSel ? null : task.id)} style={{
                            borderBottom: "1px solid var(--color-bg-tertiary)",
                            background: selectedIds.has(task.id)
                              ? "var(--color-brand-light)"
                              : isSel ? "var(--color-brand-light)"
                              : isDone ? "var(--color-bg-secondary)" : zebraBg,
                            cursor: "pointer", opacity: isDone ? 0.65 : 1, transition: "background 0.1s",
                            boxShadow: isSel ? "inset 3px 0 0 var(--color-brand)" : "none",
                          }}>
                            {/* チェックボックス（行選択） */}
                            <td style={{ padding: "6px 6px 6px 12px", whiteSpace: "nowrap" }}
                                onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(task.id)}
                                onChange={() => toggleSelect(task.id)}
                                aria-label={`${task.name} を選択`}
                                style={{ cursor: "pointer", width: 14, height: 14, accentColor: "var(--color-brand)" }}
                              />
                            </td>
                            {/* 担当者 */}
                            <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                              {taskAssignees.length > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                  {taskAssignees.slice(0, 3).map(m => <Avatar key={m.id} member={m} size={16} />)}
                                  {taskAssignees.length === 1 && <span style={{ color: "var(--color-text-secondary)", fontSize: "10px" }}>{taskAssignees[0].short_name}</span>}
                                  {taskAssignees.length > 3 && <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>+{taskAssignees.length - 3}</span>}
                                </div>
                              )}
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
                                    aria-label={collapsed ? "子タスクを表示" : "子タスクを隠す"}
                                    aria-expanded={!collapsed}
                                    style={{
                                      flexShrink: 0, width: 16, height: 16, lineHeight: "16px", padding: 0,
                                      border: "none", background: "transparent", cursor: "pointer",
                                      fontSize: "9px", color: "var(--color-text-tertiary)",
                                    }}
                                  >{collapsed ? "▶" : "▼"}</button>
                                ) : depth === 1 && (
                                  <span style={{ flexShrink: 0, width: 12, color: "var(--color-text-tertiary)", fontSize: "10px" }}>↳</span>
                                )}
                                <div style={{
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  maxWidth: "360px",
                                  color: isSel ? "var(--color-text-purple)" : "var(--color-text-primary)",
                                  textDecoration: isDone ? "line-through" : "none",
                                  fontWeight: isSel ? "500" : isParent ? "600" : "400",
                                }}>{task.name}</div>
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
                                {isSel && (
                                  <span style={{ fontSize: "10px", color: "var(--color-text-purple)", flexShrink: 0 }}>›</span>
                                )}
                              </div>
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
                              {!pj && td && (
                                <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
                                  <span style={{ fontSize: "9px", color: "#059669", fontWeight: "500" }}>ToDo</span>
                                  <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>
                                    {td.title.split("\n")[0].slice(0, 20)}
                                  </span>
                                </div>
                              )}
                              {/* ＋子タスク（最上位行のみ） */}
                              {canAddChild && (
                                addingChildFor === task.id ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "3px" }}>
                                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>↳</span>
                                    <input
                                      // eslint-disable-next-line jsx-a11y/no-autofocus -- インライン追加の即時入力のため
                                      autoFocus
                                      value={childDraft}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => setChildDraft(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") { e.preventDefault(); createChildTask(task, childDraft); }
                                        else if (e.key === "Escape") { setAddingChildFor(null); setChildDraft(""); }
                                      }}
                                      placeholder="子タスク名を入力して Enter"
                                      style={{
                                        flex: 1, minWidth: "120px", maxWidth: "300px", padding: "3px 8px", fontSize: "11px",
                                        border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
                                        background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
                                      }}
                                    />
                                    <button onClick={e => { e.stopPropagation(); setAddingChildFor(null); setChildDraft(""); }} style={{
                                      padding: "2px 6px", fontSize: "10px", color: "var(--color-text-tertiary)",
                                      border: "none", background: "transparent", cursor: "pointer",
                                    }}>✕</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={e => { e.stopPropagation(); setChildDraft(""); setAddingChildFor(task.id); }}
                                    style={{
                                      marginTop: "2px", padding: "1px 4px", fontSize: "9px",
                                      color: "var(--color-text-tertiary)", border: "none",
                                      background: "transparent", cursor: "pointer",
                                    }}
                                  >＋ 子タスク</button>
                                )
                              )}
                            </td>
                            {/* 状態（親は導出値・バッジのみ＝手動変更UIは出さない） */}
                            <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                              <span title={isParent ? "子から自動算出" : undefined} style={{
                                fontSize: "9px", padding: "2px 6px", borderRadius: "3px",
                                background: TASK_STATUS_STYLE[dispStatus].bg, color: TASK_STATUS_STYLE[dispStatus].color,
                              }}>{TASK_STATUS_LABEL[dispStatus]}</span>
                            </td>
                            {/* 期日 */}
                            <td style={{
                              padding: "6px 10px", whiteSpace: "nowrap",
                              color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                              fontWeight: isOverdue ? "500" : "400",
                            }}>
                              {task.start_date ? `${task.start_date.slice(5).replace("-", "/")}〜` : ""}
                              {task.due_date ? task.due_date.slice(5).replace("-", "/") : "—"}
                            </td>
                            {/* 工数（詳細モードのみ） */}
                            {density === "detailed" && (
                              <td style={{ padding: "6px 10px", color: "var(--color-text-tertiary)", textAlign: "right" }}>
                                {task.estimated_hours != null ? `${task.estimated_hours}h` : "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ));
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
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px", fontSize: "10px", borderRadius: "var(--radius-full)", cursor: "pointer",
      fontWeight: active ? "500" : "400",
      background: active ? "var(--color-brand-light)" : "transparent",
      color: active ? "var(--color-text-purple)" : "var(--color-text-tertiary)",
      border: active ? "1px solid var(--color-brand-border)" : "1px solid var(--color-border-primary)",
      transition: "all 0.1s",
    }}>{label}</button>
  );
}


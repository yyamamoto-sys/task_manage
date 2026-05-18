// src/components/list/ListView.tsx
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE } from "../../lib/taskMeta";
import { todayStr, addDaysFromToday } from "../../lib/date";
import { renderLinks } from "../../lib/renderLinks";
import { KEYS } from "../../lib/localData/localStore";
import { confirmDialog } from "../../lib/dialog";
import { showToast } from "../common/Toast";
import { Avatar } from "../auth/UserSelectScreen";
import { TaskEditModal } from "../task/TaskEditModal";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  selectedKrId?: string | null;
  krTaskIds?: Set<string> | null;
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

export function ListView({ currentUser, selectedProject, projects, krTaskIds }: Props) {
  const rawTasks   = useAppStore(s => s.tasks);
  const rawMembers = useAppStore(s => s.members);
  const rawTodos   = useAppStore(s => s.todos);
  const saveTask   = useAppStore(s => s.saveTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const rawTaskForces       = useAppStore(s => s.taskForces);
  const rawKeyResults       = useAppStore(s => s.keyResults);
  const allTaskTaskForces   = useAppStore(s => s.taskTaskForces);
  const allTaskProjects     = useAppStore(s => s.taskProjects);
  const addTaskTaskForce    = useAppStore(s => s.addTaskTaskForce);
  const removeTaskTaskForce = useAppStore(s => s.removeTaskTaskForce);
  const addTaskProject      = useAppStore(s => s.addTaskProject);
  const removeTaskProject   = useAppStore(s => s.removeTaskProject);
  const todos      = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const taskForces = useMemo(() => rawTaskForces.filter(t => !t.is_deleted), [rawTaskForces]);
  const keyResults = useMemo(() => rawKeyResults.filter(k => !k.is_deleted), [rawKeyResults]);
  const isMobile = useIsMobile();
  const allTasks = useMemo(() => rawTasks.filter(t => !t.is_deleted), [rawTasks]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  // tf.id → "TF{KR index+1}-{tf_number}" 形式のラベル
  const tfLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tf of taskForces) {
      const krIdx = keyResults.findIndex(k => k.id === tf.kr_id);
      const krLabel = krIdx >= 0 ? `${krIdx + 1}` : "?";
      map.set(tf.id, `TF${krLabel}-${tf.tf_number || "?"}`);
    }
    return map;
  }, [taskForces, keyResults]);

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

  // サイドバー編集フォーム（タスク全フィールド対応・自動保存）
  type SidebarForm = {
    name: string;
    status: Task["status"];
    priority: string;
    assignee_member_ids: string[];
    project_id: string | null;
    todo_ids: string[];
    start_date: string;
    due_date: string;
    estimated_hours: string;
    comment: string;
  };
  const [sidebarForm, setSidebarForm] = useState<SidebarForm | null>(null);
  const [sidebarSaveStatus, setSidebarSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sidebarSaveError, setSidebarSaveError] = useState<string | null>(null);
  const sidebarInitialMount = useRef(true);

  // タスク選択切替で sidebarForm を初期化
  useEffect(() => {
    const task = selectedTaskId ? rawTasks.find(t => t.id === selectedTaskId) ?? null : null;
    if (task) {
      setSidebarForm({
        name:                task.name,
        status:              task.status,
        priority:            task.priority ?? "",
        assignee_member_ids: task.assignee_member_ids?.length
                               ? task.assignee_member_ids
                               : task.assignee_member_id ? [task.assignee_member_id] : [],
        project_id:          task.project_id ?? null,
        todo_ids:            task.todo_ids ?? [],
        start_date:          task.start_date ?? "",
        due_date:            task.due_date ?? "",
        estimated_hours:     task.estimated_hours?.toString() ?? "",
        comment:             task.comment,
      });
      setSidebarSaveStatus("idle");
      setSidebarSaveError(null);
      sidebarInitialMount.current = true;
    } else {
      setSidebarForm(null);
    }
  }, [selectedTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (filterMyOnly)            tasks = tasks.filter(t =>
      (t.assignee_member_ids?.length ? t.assignee_member_ids : t.assignee_member_id ? [t.assignee_member_id] : []).includes(currentUser.id)
    );
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
  }, [allTasks, selectedProject, filterStatus, filterHideDone, filterMyOnly, filterMember,
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
    const now = new Date().toISOString();
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
    const now = new Date().toISOString();
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

  // 選択中タスクに紐づくTF / 追加PJ / ToDoグループ
  const sidebarLinkedTfs = useMemo(() => {
    if (!selectedTaskId) return [];
    const ids = allTaskTaskForces.filter(t => t.task_id === selectedTaskId).map(t => t.tf_id);
    return taskForces.filter(tf => ids.includes(tf.id));
  }, [allTaskTaskForces, taskForces, selectedTaskId]);

  const sidebarLinkedExtraProjects = useMemo(() => {
    if (!selectedTaskId) return [];
    const ids = allTaskProjects.filter(t => t.task_id === selectedTaskId).map(t => t.project_id);
    return projects.filter(p => ids.includes(p.id));
  }, [allTaskProjects, projects, selectedTaskId]);

  const sidebarTodosByTf = useMemo(() => {
    return taskForces
      .filter(tf => todos.some(t => t.tf_id === tf.id))
      .map(tf => ({ tf, items: todos.filter(t => t.tf_id === tf.id) }));
  }, [taskForces, todos]);

  // 自動保存：sidebarForm 変更後 600ms のデバウンスで保存
  const sidebarSaveRef = useRef<() => Promise<void>>(async () => {});
  sidebarSaveRef.current = async () => {
    if (!selectedTask || !sidebarForm) return;
    const hours = parseFloat(sidebarForm.estimated_hours);
    const updated: Task = {
      ...selectedTask,
      name:                sidebarForm.name.trim() || selectedTask.name,
      status:              sidebarForm.status,
      priority:            (sidebarForm.priority as Task["priority"]) || null,
      assignee_member_ids: sidebarForm.assignee_member_ids,
      assignee_member_id:  sidebarForm.assignee_member_ids[0] ?? "",
      project_id:          sidebarForm.project_id || null,
      todo_ids:            sidebarForm.todo_ids,
      start_date:          sidebarForm.start_date || null,
      due_date:            sidebarForm.due_date || null,
      estimated_hours:     isNaN(hours) ? null : hours,
      comment:             sidebarForm.comment,
      updated_by:          currentUser.id,
    };
    try {
      await saveTask(updated);
      setSidebarSaveStatus("saved");
      setTimeout(() => {
        setSidebarSaveStatus(s => (s === "saved" ? "idle" : s));
      }, 1500);
    } catch (e) {
      setSidebarSaveStatus("error");
      setSidebarSaveError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  useEffect(() => {
    if (sidebarInitialMount.current) {
      sidebarInitialMount.current = false;
      return;
    }
    if (!sidebarForm) return;
    setSidebarSaveStatus("saving");
    setSidebarSaveError(null);
    const timer = setTimeout(() => {
      void sidebarSaveRef.current();
    }, 600);
    return () => clearTimeout(timer);
  }, [sidebarForm]);

  const SortIcon = ({ k }: { k: SortKey }) => sortKey === k
    ? <span style={{ marginLeft: 3, opacity: .8 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
    : <span style={{ marginLeft: 3, opacity: .2 }}>↕</span>;

  const cols: { key: string; label: string; w: string; sortKey?: SortKey }[] = [
    { key: "select",          label: "",         w: "32px"   },
    { key: "assignee",        label: "担当者",   w: "90px",  sortKey: "assignee" },
    { key: "priority",        label: "優先度",   w: "55px",  sortKey: "priority" },
    { key: "name",            label: "タスク名", w: "auto",  sortKey: "name" },
    { key: "status",          label: "状態",     w: "75px",  sortKey: "status" },
    { key: "due_date",        label: "期日",     w: "80px",  sortKey: "due_date" },
    { key: "estimated_hours", label: "工数",     w: "52px",  sortKey: "estimated_hours" },
  ];

  // アクティブフィルター数（バッジ用）
  const activeFilterCount = [
    filterStatus !== "all", filterPriority !== "all",
    filterMember !== "all", filterMyOnly, filterThisWeek, filterHideDone,
  ].filter(Boolean).length;

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
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Task["status"] | "all")} style={selStyle}>
            <option value="all">状態：すべて</option>
            <option value="todo">ToDo</option>
            <option value="in_progress">進行中</option>
            <option value="done">完了</option>
          </select>

          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as "all"|"high"|"mid"|"low")} style={selStyle}>
            <option value="all">優先度：すべて</option>
            <option value="high">高</option>
            <option value="mid">中</option>
            <option value="low">低</option>
          </select>

          {/* 担当者別グループ中は担当者フィルターを非表示（冗長のため） */}
          {groupBy !== "assignee" && (
            <select value={filterMember} onChange={e => { setFilterMember(e.target.value); setFilterMyOnly(false); }} style={selStyle}>
              <option value="all">担当者：全員</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
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
            <select
              value=""
              onChange={e => { if (e.target.value) bulkUpdateAssignee(e.target.value); }}
              style={{
                padding: "4px 24px 4px 10px", fontSize: "11px",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
              }}
            >
              <option value="">担当者を変更…</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>

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
                  {group.tasks.map(task => {
                    const taskAssigneeIds = task.assignee_member_ids?.length ? task.assignee_member_ids : task.assignee_member_id ? [task.assignee_member_id] : [];
                    const taskAssignees   = members.filter(mb => taskAssigneeIds.includes(mb.id));
                    const pj = projects.find(p => p.id === task.project_id);
                    const td = (task.todo_ids ?? [])[0] ? todos.find(t => t.id === task.todo_ids[0]) : undefined;
                    const isDone    = task.status === "done";
                    const isOverdue = task.due_date && task.due_date < t0 && !isDone;
                    return (
                      <div key={task.id} onClick={() => setEditingTaskId(task.id)}
                        style={{
                          background: selectedIds.has(task.id)
                            ? "var(--color-brand-light)"
                            : "var(--color-bg-primary)",
                          border: selectedIds.has(task.id)
                            ? "1px solid var(--color-brand-border)"
                            : "1px solid var(--color-border-primary)",
                          borderRadius: "var(--radius-lg)",
                          padding: "10px 12px", marginBottom: "4px",
                          cursor: "pointer", opacity: isDone ? 0.6 : 1,
                          transition: "background 0.1s, border-color 0.1s",
                        }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "5px" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelect(task.id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`${task.name} を選択`}
                            style={{ cursor: "pointer", width: 16, height: 16, marginTop: 2, accentColor: "var(--color-brand)", flexShrink: 0 }}
                          />
                          <div style={{
                            flex: 1, fontSize: "12px", fontWeight: "500",
                            color: "var(--color-text-primary)",
                            lineHeight: 1.4, textDecoration: isDone ? "line-through" : "none",
                          }}>{task.name}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                            {task.comment && <span title="メモあり" style={{ fontSize: "11px", opacity: 0.5 }}>💬</span>}
                            <span style={{
                              fontSize: "9px", padding: "2px 6px", borderRadius: "3px",
                              background: TASK_STATUS_STYLE[task.status].bg, color: TASK_STATUS_STYLE[task.status].color,
                            }}>{TASK_STATUS_LABEL[task.status]}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          {taskAssignees.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            {taskAssignees.slice(0, 3).map(m => <Avatar key={m.id} member={m} size={14} />)}
                            {taskAssignees.length === 1 && <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>{taskAssignees[0].short_name}</span>}
                            {taskAssignees.length > 3 && <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>+{taskAssignees.length - 3}</span>}
                          </div>}
                          {task.due_date && <span style={{
                            fontSize: "10px",
                            color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
                            fontWeight: isOverdue ? "500" : "400",
                          }}>{task.due_date.slice(5).replace("-", "/")}</span>}
                          {task.priority && <span style={{
                            fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
                            background: TASK_PRIORITY_STYLE[task.priority].bg, color: TASK_PRIORITY_STYLE[task.priority].color,
                          }}>{TASK_PRIORITY_LABEL[task.priority]}</span>}
                          {groupBy !== "project" && pj && <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            <span style={{ width: 4, height: 4, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />
                            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>{pj.name.slice(0, 12)}</span>
                          </div>}
                          {!pj && td && <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            <span style={{ fontSize: "9px", color: "#059669", fontWeight: "500" }}>ToDo</span>
                            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>{td.title.split("\n")[0].slice(0, 16)}</span>
                          </div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {filteredTasks.length === 0 && (
                <div style={{ padding: "36px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>
                  条件に一致するタスクがありません
                </div>
              )}
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
                        col.sortKey && handleSort(col.sortKey);
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
                      {group.tasks.map(task => {
                        const isEven = rowIdx % 2 === 0;
                        rowIdx++;
                        const taskAssigneeIds = task.assignee_member_ids?.length ? task.assignee_member_ids : task.assignee_member_id ? [task.assignee_member_id] : [];
                        const taskAssignees   = members.filter(mb => taskAssigneeIds.includes(mb.id));
                        const pj = projects.find(p => p.id === task.project_id);
                        const td = (task.todo_ids ?? [])[0] ? todos.find(t => t.id === task.todo_ids[0]) : undefined;
                        const isDone    = task.status === "done";
                        const isOverdue = task.due_date && task.due_date < t0 && !isDone;
                        const isSel     = selectedTaskId === task.id;
                        const zebraBg   = isEven ? "var(--color-bg-primary)" : "var(--color-bg-secondary)";
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
                            {/* 優先度 */}
                            <td style={{ padding: "6px 10px" }}>
                              {task.priority && (
                                <span style={{
                                  fontSize: "9px", padding: "2px 5px", borderRadius: "3px",
                                  background: TASK_PRIORITY_STYLE[task.priority].bg, color: TASK_PRIORITY_STYLE[task.priority].color,
                                }}>{TASK_PRIORITY_LABEL[task.priority]}</span>
                              )}
                            </td>
                            {/* タスク名 */}
                            <td style={{ padding: "6px 10px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                <div style={{
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  maxWidth: "360px",
                                  color: isSel ? "var(--color-text-purple)" : "var(--color-text-primary)",
                                  textDecoration: isDone ? "line-through" : "none",
                                  fontWeight: isSel ? "500" : "400",
                                }}>{task.name}</div>
                                {task.comment && (
                                  <span title="メモあり" style={{ fontSize: "11px", opacity: 0.45, flexShrink: 0 }}>💬</span>
                                )}
                                {isSel && (
                                  <span style={{ fontSize: "10px", color: "var(--color-text-purple)", flexShrink: 0 }}>›</span>
                                )}
                              </div>
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
                            </td>
                            {/* 状態 */}
                            <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                              <span style={{
                                fontSize: "9px", padding: "2px 6px", borderRadius: "3px",
                                background: TASK_STATUS_STYLE[task.status].bg, color: TASK_STATUS_STYLE[task.status].color,
                              }}>{TASK_STATUS_LABEL[task.status]}</span>
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
                            {/* 工数 */}
                            <td style={{ padding: "6px 10px", color: "var(--color-text-tertiary)", textAlign: "right" }}>
                              {task.estimated_hours != null ? `${task.estimated_hours}h` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ));
                })()}
                {filteredTasks.length === 0 && (
                  <tr><td colSpan={cols.length} style={{ padding: "36px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>
                    条件に一致するタスクがありません
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ===== サイドパネル（PC・タブレット） ===== */}
      {selectedTask && sidebarForm && !isMobile && (() => {
        const pj = projects.find(p => p.id === selectedTask.project_id);
        const isOverdue = !!sidebarForm.due_date && sidebarForm.due_date < t0 && sidebarForm.status !== "done";
        const handleDelete = async () => {
          if (!await confirmDialog(`「${selectedTask.name}」を削除しますか？`)) return;
          await deleteTask(selectedTask.id, currentUser.id);
          setSelectedTaskId(null);
        };

        return (
          <div style={{
            width: "320px", flexShrink: 0,
            borderLeft: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-primary)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* ヘッダー：タスク名（インライン編集） */}
            <div style={{
              padding: "10px 12px", borderBottom: "1px solid var(--color-border-primary)",
              display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              {pj && (
                <div style={{
                  width: 4, height: 18, borderRadius: 2,
                  background: pj.color_tag, flexShrink: 0,
                }} />
              )}
              <input
                value={sidebarForm.name}
                onChange={e => setSidebarForm(f => f ? { ...f, name: e.target.value } : f)}
                maxLength={200}
                placeholder="タスク名"
                aria-label="タスク名"
                style={{
                  flex: 1, fontSize: "13px", fontWeight: "600",
                  border: "none", outline: "none", padding: "3px 4px",
                  borderBottom: "1px solid transparent",
                  color: "var(--color-text-primary)",
                  background: "transparent",
                  transition: "border-color 0.1s",
                }}
                onFocus={e => (e.currentTarget.style.borderBottomColor = "var(--color-brand)")}
                onBlur={e => (e.currentTarget.style.borderBottomColor = "transparent")}
              />
              <SideSaveIndicator status={sidebarSaveStatus} />
              <button onClick={() => setSelectedTaskId(null)} aria-label="閉じる" title="閉じる" style={{
                background: "none", border: "none", cursor: "pointer", fontSize: "14px",
                color: "var(--color-text-tertiary)", flexShrink: 0,
              }}>✕</button>
            </div>

            {sidebarSaveStatus === "error" && sidebarSaveError && (
              <div style={{
                padding: "6px 12px",
                background: "var(--color-bg-danger)",
                color: "var(--color-text-danger)",
                fontSize: "10px",
                borderBottom: "1px solid var(--color-border-danger)",
              }}>
                {sidebarSaveError}
              </div>
            )}

            <div style={{ flex: 1, overflow: "auto", padding: "12px 12px 0" }}>
              {/* ステータス */}
              <SideLabel>ステータス</SideLabel>
              <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
                {(["todo", "in_progress", "done"] as const).map(s => (
                  <button key={s}
                    onClick={() => setSidebarForm(f => f ? { ...f, status: s } : f)}
                    style={{
                      flex: 1, padding: "5px 2px", fontSize: "10px", borderRadius: "var(--radius-md)",
                      fontWeight: sidebarForm.status === s ? "600" : "400",
                      background: sidebarForm.status === s ? TASK_STATUS_STYLE[s].bg : "transparent",
                      color: sidebarForm.status === s ? TASK_STATUS_STYLE[s].color : "var(--color-text-tertiary)",
                      border: sidebarForm.status === s
                        ? `1.5px solid ${TASK_STATUS_STYLE[s].color}`
                        : "1px solid var(--color-border-primary)",
                      cursor: "pointer", transition: "all 0.1s",
                    }}>{TASK_STATUS_LABEL[s]}</button>
                ))}
              </div>

              {/* 優先度 */}
              <SideLabel>優先度</SideLabel>
              <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
                {(["", "high", "mid", "low"] as const).map(p => {
                  const isActive = sidebarForm.priority === p;
                  const cfg = p ? TASK_PRIORITY_STYLE[p] : null;
                  return (
                    <button key={p || "none"}
                      onClick={() => setSidebarForm(f => f ? { ...f, priority: p } : f)}
                      style={{
                        flex: 1, padding: "5px 2px", fontSize: "10px", borderRadius: "var(--radius-md)",
                        fontWeight: isActive ? "600" : "400",
                        background: isActive && cfg ? cfg.bg : isActive ? "var(--color-bg-secondary)" : "transparent",
                        color: isActive && cfg ? cfg.color : "var(--color-text-tertiary)",
                        border: isActive ? "1.5px solid currentColor" : "1px solid var(--color-border-primary)",
                        cursor: "pointer", transition: "all 0.1s",
                        opacity: isActive ? 1 : 0.7,
                      }}>{p ? TASK_PRIORITY_LABEL[p] : "なし"}</button>
                  );
                })}
              </div>

              {/* 担当者（複数選択） */}
              <SideLabel>担当者</SideLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px",
                marginBottom: sidebarForm.assignee_member_ids.length > 0 ? "5px" : 0 }}>
                {sidebarForm.assignee_member_ids.map(id => {
                  const m = members.find(x => x.id === id);
                  if (!m) return null;
                  return (
                    <span key={id} style={sideChipStyle}>
                      <Avatar member={m} size={14} />
                      {m.display_name}
                      <button
                        onClick={() => setSidebarForm(f => f
                          ? { ...f, assignee_member_ids: f.assignee_member_ids.filter(i => i !== id) }
                          : f)}
                        aria-label={`${m.display_name} を担当者から外す`}
                        style={sideChipRemoveBtn}>×</button>
                    </span>
                  );
                })}
                {sidebarForm.assignee_member_ids.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未担当</span>
                )}
              </div>
              <select
                defaultValue=""
                onChange={e => {
                  const id = e.target.value;
                  if (id && !sidebarForm.assignee_member_ids.includes(id)) {
                    setSidebarForm(f => f
                      ? { ...f, assignee_member_ids: [...f.assignee_member_ids, id] }
                      : f);
                  }
                  e.target.value = "";
                }}
                style={{ ...sideInput, marginBottom: "12px" }}>
                <option value="">＋ 担当者を追加...</option>
                {members.filter(m => !sidebarForm.assignee_member_ids.includes(m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>

              {/* プロジェクト */}
              <SideLabel>プロジェクト</SideLabel>
              <select
                value={sidebarForm.project_id ?? ""}
                onChange={e => setSidebarForm(f => f ? { ...f, project_id: e.target.value || null } : f)}
                style={{ ...sideInput, marginBottom: "12px" }}>
                <option value="">なし</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {/* 追加プロジェクト */}
              <SideLabel>追加プロジェクト</SideLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
                {sidebarLinkedExtraProjects.map(p => (
                  <span key={p.id} style={sideChipStyle}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color_tag, flexShrink: 0 }} />
                    {p.name}
                    <button
                      onClick={() => removeTaskProject(selectedTask.id, p.id)}
                      aria-label={`${p.name} を解除`}
                      style={sideChipRemoveBtn}>×</button>
                  </span>
                ))}
                {sidebarLinkedExtraProjects.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
                )}
              </div>
              <select
                defaultValue=""
                onChange={e => {
                  if (!e.target.value) return;
                  addTaskProject({ task_id: selectedTask.id, project_id: e.target.value });
                  e.target.value = "";
                }}
                style={{ ...sideInput, marginBottom: "12px" }}>
                <option value="">＋ プロジェクトを追加...</option>
                {projects
                  .filter(p => p.id !== sidebarForm.project_id
                    && !sidebarLinkedExtraProjects.find(ep => ep.id === p.id))
                  .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                }
              </select>

              {/* タスクフォース */}
              <SideLabel>タスクフォース</SideLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
                {sidebarLinkedTfs.map(tf => (
                  <span key={tf.id} style={sideChipStyle}>
                    <span style={{ fontWeight: "600", marginRight: 3 }}>
                      {tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}
                    </span>
                    {tf.name}
                    <button
                      onClick={() => removeTaskTaskForce(selectedTask.id, tf.id)}
                      aria-label={`${tf.name} を解除`}
                      style={sideChipRemoveBtn}>×</button>
                  </span>
                ))}
                {sidebarLinkedTfs.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未設定</span>
                )}
              </div>
              {taskForces.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={e => {
                    if (!e.target.value) return;
                    addTaskTaskForce({ task_id: selectedTask.id, tf_id: e.target.value });
                    e.target.value = "";
                  }}
                  style={{ ...sideInput, marginBottom: "12px" }}>
                  <option value="">＋ タスクフォースを追加...</option>
                  {taskForces
                    .filter(tf => !sidebarLinkedTfs.find(lt => lt.id === tf.id))
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
                <span style={{
                  display: "block", fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "12px",
                }}>
                  管理画面でTask Forceを先に登録してください
                </span>
              )}

              {/* 日程（開始日 / 終了日 2列） */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                <div>
                  <SideLabel>開始日</SideLabel>
                  <input type="date" value={sidebarForm.start_date}
                    onChange={e => setSidebarForm(f => f ? { ...f, start_date: e.target.value } : f)}
                    style={sideInput} />
                </div>
                <div>
                  <SideLabel>終了日</SideLabel>
                  <input type="date" value={sidebarForm.due_date}
                    onChange={e => setSidebarForm(f => f ? { ...f, due_date: e.target.value } : f)}
                    style={{
                      ...sideInput,
                      ...(isOverdue ? {
                        borderColor: "var(--color-border-danger)",
                        color: "var(--color-text-danger)",
                      } : {}),
                    }} />
                  {isOverdue && (
                    <span style={{
                      marginTop: 3, fontSize: "9px", display: "inline-block",
                      background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
                      padding: "1px 4px", borderRadius: "3px",
                    }}>期限超過</span>
                  )}
                </div>
              </div>

              {/* 工数 */}
              <SideLabel>工数（時間）</SideLabel>
              <input type="number" min="0" step="0.5"
                value={sidebarForm.estimated_hours}
                onChange={e => setSidebarForm(f => f ? { ...f, estimated_hours: e.target.value } : f)}
                placeholder="例：2.5"
                style={{ ...sideInput, marginBottom: "12px" }} />

              {/* メモ */}
              <SideLabel>メモ・コメント</SideLabel>
              <textarea value={sidebarForm.comment}
                onChange={e => setSidebarForm(f => f ? { ...f, comment: e.target.value } : f)}
                placeholder={"メモやURLを入力できます\n例：https://docs.example.com"}
                rows={5}
                style={{
                  ...sideInput,
                  resize: "vertical", lineHeight: 1.6, minHeight: "70px",
                  marginBottom: "14px",
                }}
              />

              {/* ToDo（最下部） */}
              <SideLabel>ToDo（OKR系）</SideLabel>
              <div style={{
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                padding: "6px 9px",
                maxHeight: "150px",
                overflowY: "auto",
                background: "var(--color-bg-primary)",
                marginBottom: "12px",
              }}>
                {sidebarTodosByTf.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>ToDoがありません</span>
                )}
                {sidebarTodosByTf.map(({ tf, items }) => (
                  <div key={tf.id}>
                    <div style={{
                      fontSize: "9px", color: "var(--color-text-tertiary)",
                      padding: "4px 0 2px", fontWeight: 600,
                    }}>
                      {tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}
                      {tf.name ? ` — ${tf.name}` : ""}
                    </div>
                    {items.map(todo => (
                      <label key={todo.id} style={{
                        display: "flex", alignItems: "flex-start", gap: "5px",
                        padding: "2px 0", cursor: "pointer",
                      }}>
                        <input
                          type="checkbox"
                          checked={sidebarForm.todo_ids.includes(todo.id)}
                          onChange={e => setSidebarForm(f => f ? {
                            ...f,
                            todo_ids: e.target.checked
                              ? [...f.todo_ids, todo.id]
                              : f.todo_ids.filter(id => id !== todo.id),
                          } : f)}
                          style={{
                            marginTop: "2px", flexShrink: 0,
                            accentColor: "var(--color-brand-primary)",
                          }}
                        />
                        <span style={{ fontSize: "11px", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                          {todo.title.slice(0, 50)}{todo.title.length > 50 ? "…" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              <div style={{ height: "10px" }} />
            </div>

            {/* フッター：削除 */}
            <div style={{
              padding: "8px 12px", borderTop: "1px solid var(--color-border-primary)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0, background: "var(--color-bg-secondary)",
            }}>
              <button onClick={handleDelete} style={{
                padding: "4px 10px", fontSize: "10px",
                color: "var(--color-text-danger)",
                border: "1px solid var(--color-border-danger)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
                background: "transparent",
              }}>🗑 削除</button>
              <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>
                自動保存
              </span>
            </div>
          </div>
        );
      })()}

      {/* タスク編集モーダル */}
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

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)",
      textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
    }}>{children}</div>
  );
}

function SideSaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const styles: Record<"saving" | "saved" | "error", { bg: string; color: string; label: string }> = {
    saving: { bg: "transparent", color: "var(--color-text-tertiary)", label: "保存中…" },
    saved:  { bg: "var(--color-bg-success)", color: "var(--color-text-success)", label: "✓" },
    error:  { bg: "var(--color-bg-danger)", color: "var(--color-text-danger)", label: "失敗" },
  };
  const s = styles[status];
  return (
    <span role="status" aria-live="polite" style={{
      fontSize: "9px", padding: "2px 6px",
      background: s.bg, color: s.color,
      borderRadius: "99px", flexShrink: 0,
      transition: "all 0.15s",
    }}>{s.label}</span>
  );
}

const sideInput: React.CSSProperties = {
  width: "100%", padding: "5px 8px", fontSize: "11px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  outline: "none", boxSizing: "border-box",
};

const sideChipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "4px",
  fontSize: "10px", padding: "2px 7px",
  background: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "99px", color: "var(--color-text-secondary)",
};

const sideChipRemoveBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "0", color: "var(--color-text-tertiary)",
  fontSize: "10px", lineHeight: 1, marginLeft: "2px",
};

// DR は現在未使用だが将来のために残す
// function DR(...)

const selStyle: React.CSSProperties = {
  padding: "3px 7px", fontSize: "10px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-secondary)",
  cursor: "pointer", outline: "none",
};

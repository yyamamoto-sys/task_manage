// src/components/task/TaskSidePanel.tsx
//
// タスククリックで右側に出る 320px サイドパネル。List/Gantt/Kanban で共通利用。
// モバイルは呼び出し側で TaskEditModal を出す（このコンポーネントは PC・タブレット向け）。

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import {
  TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE,
  getAssigneeIds, buildTfLabelMap,
} from "../../lib/taskMeta";
import { todayStr } from "../../lib/date";
import { getEligibleTfIds } from "../../lib/okr/eligibleTaskForces";
import { parentTaskCandidates, isParentTask, childrenOf, eligibleChildTasks } from "../../lib/taskHierarchy";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";

interface Props {
  taskId: string;
  currentUser: Member;
  onClose: () => void;
}

type SidebarForm = {
  name: string;
  status: Task["status"];
  priority: string;
  assignee_member_ids: string[];
  project_id: string | null;
  parent_task_id: string | null;
  start_date: string;
  due_date: string;
  estimated_hours: string;
  comment: string;
};

export function TaskSidePanel({ taskId, currentUser, onClose }: Props) {
  const allTasks            = useAppStore(selectScopedTasks);
  const allMembers          = useAppStore(s => s.members);
  const allProjects         = useAppStore(selectScopedProjects);
  const allTaskForces       = useAppStore(s => s.taskForces);
  const allKeyResults       = useAppStore(s => s.keyResults);
  const allTaskTaskForces   = useAppStore(s => s.taskTaskForces);
  const allTaskProjects     = useAppStore(s => s.taskProjects);
  const saveTask            = useAppStore(s => s.saveTask);
  const deleteTask          = useAppStore(s => s.deleteTask);
  const addTaskTaskForce    = useAppStore(s => s.addTaskTaskForce);
  const removeTaskTaskForce = useAppStore(s => s.removeTaskTaskForce);
  const addTaskProject      = useAppStore(s => s.addTaskProject);
  const removeTaskProject   = useAppStore(s => s.removeTaskProject);

  const members    = useMemo(() => active(allMembers), [allMembers]);
  const projects   = useMemo(() => active(allProjects), [allProjects]);
  const taskForces = useMemo(() => active(allTaskForces), [allTaskForces]);
  const keyResults = useMemo(() => active(allKeyResults), [allKeyResults]);

  const tfLabelById = useMemo(() => buildTfLabelMap(taskForces, keyResults), [taskForces, keyResults]);

  const selectedTask = useMemo(
    () => allTasks.find(t => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  const linkedTfs = useMemo(() => {
    const ids = allTaskTaskForces.filter(t => t.task_id === taskId).map(t => t.tf_id);
    return taskForces.filter(tf => ids.includes(tf.id));
  }, [allTaskTaskForces, taskForces, taskId]);

  const linkedExtraProjects = useMemo(() => {
    const ids = allTaskProjects.filter(t => t.task_id === taskId).map(t => t.project_id);
    return projects.filter(p => ids.includes(p.id));
  }, [allTaskProjects, projects, taskId]);

  // selectedTask 全体ではなく日付フィールドだけに依存させて、無関係フィールド更新で再走査しない
  const eligibleTfIds = useMemo(
    () => getEligibleTfIds(selectedTask, allTaskForces),
    [selectedTask?.due_date, selectedTask?.start_date, allTaskForces], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // このタスクが子を持つ親なら、親に設定できない（孫禁止）
  const isParent = useMemo(
    () => selectedTask ? isParentTask(selectedTask, allTasks) : false,
    [selectedTask, allTasks],
  );

  // 親タスク候補＝全PJの最上位タスク。選択中タスクのPJを先頭に、他PJはPJ名を併記。
  // （子を選ぶと子は親のPJに揃うため他PJ親も許容。同一PJを優先表示）
  // 親タスク候補。現PJのタスクと他PJのタスクを見出しで分け、PJカラーのドットで属性を可視化する
  // （どこまでが今のプロジェクトに属するか色で判別できるようにする）。
  const currentProjectId = selectedTask?.project_id ?? null;
  const parentOptions = useMemo<SelectOption[]>(() => {
    const pjOf = (id: string | null) => (id ? projects.find(p => p.id === id) : undefined);
    const currentPjColor = pjOf(currentProjectId)?.color_tag ?? "var(--color-border-secondary)";
    const cands = parentTaskCandidates(allTasks, currentProjectId, selectedTask?.id);
    const same  = cands.filter(t => (t.project_id ?? null) === currentProjectId);
    const other = cands.filter(t => (t.project_id ?? null) !== currentProjectId);
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
  }, [allTasks, currentProjectId, selectedTask?.id, projects]);

  const [sidebarForm, setSidebarForm] = useState<SidebarForm | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // 子タスク選択（親側から子を複数チェックして決定する）UI の状態
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childPickerChecked, setChildPickerChecked] = useState<Set<string>>(new Set());
  const [childSearch, setChildSearch] = useState("");
  const initialMount = useRef(true);

  // taskId 切替で sidebarForm を初期化
  useEffect(() => {
    if (!selectedTask) {
      setSidebarForm(null);
      return;
    }
    setSidebarForm({
      name:                selectedTask.name,
      status:              selectedTask.status,
      priority:            selectedTask.priority ?? "",
      assignee_member_ids: getAssigneeIds(selectedTask),
      project_id:          selectedTask.project_id ?? null,
      parent_task_id:      selectedTask.parent_task_id ?? null,
      start_date:          selectedTask.start_date ?? "",
      due_date:            selectedTask.due_date ?? "",
      estimated_hours:     selectedTask.estimated_hours?.toString() ?? "",
      comment:             selectedTask.comment,
    });
    setSaveStatus("idle");
    setSaveError(null);
    initialMount.current = true;
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自動保存：600ms デバウンス
  const saveRef = useRef<() => Promise<void>>(async () => {});
  saveRef.current = async () => {
    if (!selectedTask || !sidebarForm) return;
    const hours = parseFloat(sidebarForm.estimated_hours);
    // 親を設定したら project_id は親のPJに合わせる（不一致防止）。親を外したらフォームのPJ。
    const parent = sidebarForm.parent_task_id ? allTasks.find(t => t.id === sidebarForm.parent_task_id) : null;
    const effectiveProjectId = parent ? (parent.project_id ?? null) : (sidebarForm.project_id || null);
    const updated: Task = {
      ...selectedTask,
      name:                sidebarForm.name.trim() || selectedTask.name,
      status:              sidebarForm.status,
      priority:            (sidebarForm.priority as Task["priority"]) || null,
      assignee_member_ids: sidebarForm.assignee_member_ids,
      assignee_member_id:  sidebarForm.assignee_member_ids[0] ?? "",
      project_id:          effectiveProjectId,
      parent_task_id:      sidebarForm.parent_task_id || null,
      // display_order は既存値を保持（編集では並び順を変えない＝...selectedTask 由来）
      start_date:          sidebarForm.start_date || null,
      due_date:            sidebarForm.due_date || null,
      estimated_hours:     isNaN(hours) ? null : hours,
      comment:             sidebarForm.comment,
      updated_by:          currentUser.id,
    };
    try {
      await saveTask(updated);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(s => s === "saved" ? "idle" : s), 1500);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (!sidebarForm) return;
    setSaveStatus("saving");
    setSaveError(null);
    const timer = setTimeout(() => { void saveRef.current(); }, 600);
    return () => clearTimeout(timer);
  }, [sidebarForm]);

  // パネル幅（左端ハンドルをドラッグして調整。min 240px / max 680px）
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return Math.min(680, Math.max(240, parseInt(localStorage.getItem("task_side_panel_width") ?? "320", 10) || 320)); } catch { return 320; }
  });
  const panelWidthRef = useRef(panelWidth);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      const delta = dragStartX.current - e.clientX;
      const w = Math.min(680, Math.max(240, dragStartW.current + delta));
      panelWidthRef.current = w;
      setPanelWidth(w);
    };
    const onUp = () => {
      if (!isDraggingPanel.current) return;
      isDraggingPanel.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem("task_side_panel_width", String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  if (!selectedTask || !sidebarForm) return null;

  const pj = projects.find(p => p.id === selectedTask.project_id);
  const isOverdue = !!sidebarForm.due_date
    && sidebarForm.due_date < todayStr()
    && sidebarForm.status !== "done";

  // ===== 子タスク（このタスクを親として子を複数紐づける） =====
  // このタスク自身が子タスク（親を持つ）なら、2階層固定のため子は持てない。
  const isChild = selectedTask.parent_task_id != null;
  const children = childrenOf(allTasks, selectedTask.id);
  const childCandidates = isChild
    ? []
    : eligibleChildTasks(allTasks, selectedTask).filter(t => t.parent_task_id !== selectedTask.id);
  const childQ = childSearch.trim().toLowerCase();
  const visibleChildCandidates = childQ
    ? childCandidates.filter(t => t.name.toLowerCase().includes(childQ))
    : childCandidates;

  const toggleChild = (id: string) => setChildPickerChecked(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const applyChildren = async () => {
    const ids = [...childPickerChecked];
    if (ids.length === 0) return;
    // 兄弟の display_order 最大値から連番で付与し、選んだ順に親直下へ並べる
    let order = children.reduce((mx, c) => Math.max(mx, c.display_order ?? 0), 0);
    try {
      for (const id of ids) {
        const t = allTasks.find(x => x.id === id);
        if (!t) continue;
        order += 1;
        await saveTask({
          ...t,
          parent_task_id: selectedTask.id,
          project_id: selectedTask.project_id ?? null, // 子は親と同一PJに揃える
          display_order: order,
          updated_by: currentUser.id,
        });
      }
      showToast(`${ids.length}件を「${selectedTask.name}」の子タスクにしました`);
      setChildPickerChecked(new Set());
      setChildPickerOpen(false);
    } catch (e) {
      showToast(formatErrorForUser("子タスクの設定に失敗しました", e), "error");
    }
  };

  const detachChild = async (childId: string) => {
    const t = allTasks.find(x => x.id === childId);
    if (!t) return;
    try {
      await saveTask({ ...t, parent_task_id: null, updated_by: currentUser.id });
    } catch (e) {
      showToast(formatErrorForUser("子タスクの解除に失敗しました", e), "error");
    }
  };

  const handleDelete = async () => {
    if (!await confirmDialog(`「${selectedTask.name}」を削除しますか？`)) return;
    await deleteTask(selectedTask.id, currentUser.id);
    onClose();
  };

  return (
    <div style={{
      width: `${panelWidth}px`, flexShrink: 0,
      borderLeft: "1px solid var(--color-border-primary)",
      background: "var(--color-bg-primary)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      position: "relative",
    }}>
      {/* リサイズハンドル（左端をドラッグして幅を調整）。マウスのドラッグ操作専用でキーボード代替手段はない */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onMouseDown={handleResizeMouseDown}
        title="ドラッグで幅を変更"
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 6,
          cursor: "col-resize", zIndex: 30,
          background: "transparent",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-brand)"; (e.currentTarget as HTMLDivElement).style.opacity = "0.4"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
      />
      {/* ヘッダー：タスク名（インライン編集） */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
      }}>
        {pj && (
          <div style={{ width: 4, height: 18, borderRadius: 2, background: pj.color_tag, flexShrink: 0 }} />
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
        <SaveIndicator status={saveStatus} />
        <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{
          background: "none", border: "none", cursor: "pointer", fontSize: "14px",
          color: "var(--color-text-tertiary)", flexShrink: 0,
        }}>✕</button>
      </div>

      {saveStatus === "error" && saveError && (
        <div style={{
          padding: "6px 12px",
          background: "var(--color-bg-danger)",
          color: "var(--color-text-danger)",
          fontSize: "10px",
          borderBottom: "1px solid var(--color-border-danger)",
        }}>
          {saveError}
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
              <span key={id} style={chipStyle}>
                <Avatar member={m} size={14} />
                {m.display_name}
                <button
                  onClick={() => setSidebarForm(f => f
                    ? { ...f, assignee_member_ids: f.assignee_member_ids.filter(i => i !== id) }
                    : f)}
                  aria-label={`${m.display_name} を担当者から外す`}
                  style={chipRemoveBtn}>×</button>
              </span>
            );
          })}
          {sidebarForm.assignee_member_ids.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未担当</span>
          )}
        </div>
        <CustomSelect
          value=""
          onChange={id => {
            if (id && !sidebarForm.assignee_member_ids.includes(id)) {
              setSidebarForm(f => f
                ? { ...f, assignee_member_ids: [...f.assignee_member_ids, id] }
                : f);
            }
          }}
          options={[
            { value: "", label: "＋ 担当者を追加..." },
            ...[...members].sort((a, b) =>
              a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
            ).filter(m => !sidebarForm.assignee_member_ids.includes(m.id)).map(m => ({ value: m.id, label: m.display_name })),
          ]}
          searchable searchPlaceholder="メンバーで検索..."
          style={{ marginBottom: "12px" }} />

        {/* プロジェクト */}
        <SideLabel>プロジェクト</SideLabel>
        <CustomSelect
          value={sidebarForm.project_id ?? ""}
          onChange={value => setSidebarForm(f => f ? { ...f, project_id: value || null } : f)}
          options={[
            { value: "", label: "なし" },
            ...projects.map(p => ({ value: p.id, label: p.name })),
          ]}
          searchable searchPlaceholder="プロジェクトで検索..."
          style={{ marginBottom: "12px" }} />

        {/* 親タスク（2階層固定。子を持つタスクは親に設定不可） */}
        <SideLabel>親タスク</SideLabel>
        <CustomSelect
          value={sidebarForm.parent_task_id ?? ""}
          onChange={value => setSidebarForm(f => f ? { ...f, parent_task_id: value || null } : f)}
          options={parentOptions}
          disabled={isParent}
          searchable searchPlaceholder="親タスクを検索..."
          style={{ marginBottom: isParent ? "4px" : "12px" }} />
        {isParent && (
          <div style={{ marginBottom: "12px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
            子タスクがあるため親に設定できません
          </div>
        )}

        {/* 子タスク（このタスクを親として、子にしたいタスクを複数チェックして決定する） */}
        <SideLabel>子タスク</SideLabel>
        {isChild ? (
          <div style={{ marginBottom: "12px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
            このタスクは子タスクのため、さらに子を持てません（2階層）。
          </div>
        ) : (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {children.map(c => (
                <span key={c.id} style={chipStyle}>
                  <span style={{ color: "var(--color-text-tertiary)" }}>↳</span>{c.name}
                  <button onClick={() => detachChild(c.id)} aria-label={`${c.name} を子タスクから外す`} style={chipRemoveBtn}>×</button>
                </span>
              ))}
              {children.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
              )}
            </div>
            <button
              onClick={() => { setChildPickerChecked(new Set()); setChildSearch(""); setChildPickerOpen(v => !v); }}
              style={{
                width: "100%", padding: "6px 10px", fontSize: "11px",
                border: `1px solid ${childPickerOpen ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)", cursor: "pointer",
                background: childPickerOpen ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                color: childPickerOpen ? "var(--color-brand)" : "var(--color-text-secondary)",
              }}>
              {childPickerOpen ? "閉じる" : "＋ 子タスクを選ぶ"}
            </button>
            {childPickerOpen && (
              <div style={{
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                padding: "8px", marginTop: "6px", background: "var(--color-bg-secondary)",
              }}>
                <input value={childSearch} onChange={e => setChildSearch(e.target.value)}
                  placeholder="タスクを検索..." aria-label="子タスク候補を検索"
                  style={{ ...inputStyle, marginBottom: "6px" }} />
                <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
                  {visibleChildCandidates.length === 0 && (
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "4px 2px" }}>
                      候補がありません（同じプロジェクトで、子を持たないタスクが対象です）
                    </div>
                  )}
                  {visibleChildCandidates.map(t => {
                    const checked = childPickerChecked.has(t.id);
                    const curParent = t.parent_task_id ? allTasks.find(p => p.id === t.parent_task_id) : null;
                    return (
                      <label key={t.id} style={{
                        display: "flex", alignItems: "center", gap: "7px",
                        padding: "4px 6px", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "12px",
                        background: checked ? "var(--color-brand-light)" : "transparent",
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleChild(t.id)} style={{ cursor: "pointer", flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                        {curParent && (
                          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>現: {curParent.name}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <button onClick={applyChildren} disabled={childPickerChecked.size === 0}
                  style={{
                    width: "100%", marginTop: "8px", padding: "7px 10px", fontSize: "11px", fontWeight: 600,
                    border: "none", borderRadius: "var(--radius-md)",
                    background: childPickerChecked.size === 0 ? "var(--color-bg-tertiary)" : "var(--color-brand)",
                    color: childPickerChecked.size === 0 ? "var(--color-text-tertiary)" : "#fff",
                    cursor: childPickerChecked.size === 0 ? "not-allowed" : "pointer",
                  }}>
                  {childPickerChecked.size > 0 ? `${childPickerChecked.size}件を子タスクにする` : "子にするタスクを選択"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 追加プロジェクト */}
        <SideLabel>追加プロジェクト</SideLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
          {linkedExtraProjects.map(p => (
            <span key={p.id} style={chipStyle}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color_tag, flexShrink: 0 }} />
              {p.name}
              <button
                onClick={() => removeTaskProject(selectedTask.id, p.id)}
                aria-label={`${p.name} を解除`}
                style={chipRemoveBtn}>×</button>
            </span>
          ))}
          {linkedExtraProjects.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
          )}
        </div>
        <CustomSelect
          value=""
          onChange={value => {
            if (!value) return;
            addTaskProject({ task_id: selectedTask.id, project_id: value });
          }}
          options={[
            { value: "", label: "＋ プロジェクトを追加..." },
            ...projects
              .filter(p => p.id !== sidebarForm.project_id
                && !linkedExtraProjects.find(ep => ep.id === p.id))
              .map(p => ({ value: p.id, label: p.name })),
          ]}
          searchable searchPlaceholder="プロジェクトで検索..."
          style={{ marginBottom: "12px" }} />

        {/* タスクフォース */}
        <SideLabel>タスクフォース</SideLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
          {linkedTfs.map(tf => (
            <span key={tf.id} style={chipStyle}>
              <span style={{ fontWeight: "600", marginRight: 3 }}>
                {tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}
              </span>
              {tf.name}
              <button
                onClick={() => removeTaskTaskForce(selectedTask.id, tf.id)}
                aria-label={`${tf.name} を解除`}
                style={chipRemoveBtn}>×</button>
            </span>
          ))}
          {linkedTfs.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未設定</span>
          )}
        </div>
        {taskForces.length > 0 ? (
          <CustomSelect
            value=""
            onChange={value => {
              if (!value) return;
              addTaskTaskForce({ task_id: selectedTask.id, tf_id: value });
            }}
            options={[
              { value: "", label: "＋ タスクフォースを追加..." },
              ...taskForces
                .filter(tf => !linkedTfs.find(lt => lt.id === tf.id))
                .filter(tf => eligibleTfIds == null || eligibleTfIds.has(tf.id))
                .slice()
                .sort((a, b) => {
                  const ka = keyResults.findIndex(k => k.id === a.kr_id);
                  const kb = keyResults.findIndex(k => k.id === b.kr_id);
                  if (ka !== kb) return ka - kb;
                  return (a.tf_number ?? "").localeCompare(b.tf_number ?? "");
                })
                .map(tf => ({
                  value: tf.id,
                  label: `${tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}${tf.name ? ` ${tf.name}` : ""}`,
                })),
            ]}
            searchable searchPlaceholder="TF・KRで検索..."
            style={{ marginBottom: "12px" }} />
        ) : (
          <span style={{
            display: "block", fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "12px",
          }}>
            管理画面でTask Forceを先に登録してください
          </span>
        )}

        {/* 日程 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          <div>
            <SideLabel>開始日</SideLabel>
            <input type="date" value={sidebarForm.start_date}
              onChange={e => setSidebarForm(f => f ? { ...f, start_date: e.target.value } : f)}
              style={inputStyle} />
          </div>
          <div>
            <SideLabel>終了日</SideLabel>
            <input type="date" value={sidebarForm.due_date}
              onChange={e => setSidebarForm(f => f ? { ...f, due_date: e.target.value } : f)}
              style={{
                ...inputStyle,
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
          style={{ ...inputStyle, marginBottom: "12px" }} />

        {/* メモ */}
        <SideLabel>メモ・コメント</SideLabel>
        <textarea value={sidebarForm.comment}
          onChange={e => setSidebarForm(f => f ? { ...f, comment: e.target.value } : f)}
          placeholder={"メモやURLを入力できます\n例：https://docs.example.com"}
          rows={5}
          style={{
            ...inputStyle,
            resize: "vertical", lineHeight: 1.6, minHeight: "70px",
            marginBottom: "14px",
          }}
        />

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
        <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>自動保存</span>
      </div>
    </div>
  );
}

// ===== 内部部品 =====

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)",
      textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
    }}>{children}</div>
  );
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
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

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "5px 8px", fontSize: "11px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  outline: "none", boxSizing: "border-box",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "4px",
  fontSize: "10px", padding: "2px 7px",
  background: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "99px", color: "var(--color-text-secondary)",
};

const chipRemoveBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "0", color: "var(--color-text-tertiary)",
  fontSize: "10px", lineHeight: 1, marginLeft: "2px",
};

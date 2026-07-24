// src/components/task/TaskEditModal.tsx
//
// タスク詳細・編集モーダル（モバイル時のフォールバック・各ビューから共通利用）。
// 全フィールドを 600ms デバウンス自動保存。削除は確認ダイアログ付き論理削除。

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedTaskDependencies } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import {
  TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE,
  getAssigneeIds, buildTfLabelMap, suppressOverdue,
} from "../../lib/taskMeta";
import { todayStr } from "../../lib/date";
import { getEligibleTfIds } from "../../lib/okr/eligibleTaskForces";
import { taskForcesInGroup } from "../../lib/okr/deptScope";
import { parentTaskCandidates, isParentTask } from "../../lib/taskHierarchy";
import { wouldCreateCycle } from "../../lib/dependencies/cycleCheck";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { extractMentions, mentionsEqual } from "../../lib/mentions";
import { buildTaskUpdatePayload, type TaskEditFormState } from "../../lib/taskEditPayload";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { MentionTextarea } from "../common/MentionTextarea";
import { showToast } from "../common/Toast";

interface Props {
  taskId: string;
  currentUser: Member;
  onClose: () => void;
  onDeleted?: (taskId: string) => void;
}

export function TaskEditModal({ taskId, currentUser, onClose, onDeleted }: Props) {
  const allTasks            = useAppStore(selectScopedTasks);
  const allMembers          = useAppStore(s => s.members);
  const allProjects         = useAppStore(selectScopedProjects);
  const allTaskForces       = useAppStore(s => s.taskForces);
  const allKeyResults       = useAppStore(s => s.keyResults);
  const allObjectives       = useAppStore(s => s.objectives);
  const currentGroupId      = useAppStore(s => s.currentGroupId);
  const allTaskTaskForces   = useAppStore(s => s.taskTaskForces);
  const allTaskProjects     = useAppStore(s => s.taskProjects);
  const allTaskDependencies = useAppStore(selectScopedTaskDependencies);
  const saveTask            = useAppStore(s => s.saveTask);
  const deleteTask          = useAppStore(s => s.deleteTask);
  const restoreTask         = useAppStore(s => s.restoreTask);
  const addTaskTaskForce    = useAppStore(s => s.addTaskTaskForce);
  const removeTaskTaskForce = useAppStore(s => s.removeTaskTaskForce);
  const addTaskProject      = useAppStore(s => s.addTaskProject);
  const removeTaskProject   = useAppStore(s => s.removeTaskProject);
  const addTaskDependency    = useAppStore(s => s.addTaskDependency);
  const removeTaskDependency = useAppStore(s => s.removeTaskDependency);
  const isMobile = useIsMobile();

  const members    = useMemo(() => active(allMembers), [allMembers]);
  const projects   = useMemo(() => active(allProjects), [allProjects]);
  // 既に紐づいているTFのラベル表示（linkedTfs/tfLabelById）は部署絞り込み前の全件を使う
  // （他部署TFが誤って紐づいていた既存データでも表示を消さないため）。
  // 「追加で選べる選択肢」だけを部署絞り込みする＝taskForcesForPicker（v3.02）。
  const taskForces = useMemo(() => active(allTaskForces), [allTaskForces]);
  const keyResults = useMemo(() => active(allKeyResults), [allKeyResults]);
  const taskForcesForPicker = useMemo(
    () => taskForcesInGroup(taskForces, keyResults, allObjectives, currentGroupId),
    [taskForces, keyResults, allObjectives, currentGroupId],
  );

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

  // ===== 先行タスク（B1：依存ゲート。親子関係とは独立の別概念） =====
  // is_deleted除外済みの依存一覧（wouldCreateCycleはこの除外をしない契約のため、渡す前に必ず絞る。
  // 除外しないと、他クライアントが削除した依存がrealtime UPDATEで配列に残ったまま
  // 〈upsertByIdはDELETEイベントでしか行を除去しないため〉循環判定に亡霊として残ってしまう）
  const activeTaskDependencies = useMemo(
    () => allTaskDependencies.filter(d => !d.is_deleted),
    [allTaskDependencies],
  );
  // このタスクを待っている＝先行に設定した依存
  const predecessorDeps = useMemo(
    () => activeTaskDependencies.filter(d => d.successor_task_id === taskId),
    [activeTaskDependencies, taskId],
  );
  const predecessorTasks = useMemo(() => {
    const ids = new Set(predecessorDeps.map(d => d.predecessor_task_id));
    return allTasks.filter(t => ids.has(t.id));
  }, [predecessorDeps, allTasks]);
  // このタスクの完了を待っている後続タスク（読み取り専用表示）
  const successorDeps = useMemo(
    () => activeTaskDependencies.filter(d => d.predecessor_task_id === taskId),
    [activeTaskDependencies, taskId],
  );
  const successorTasks = useMemo(() => {
    const ids = new Set(successorDeps.map(d => d.successor_task_id));
    return allTasks.filter(t => ids.has(t.id));
  }, [successorDeps, allTasks]);
  // 先行タスク候補：自分自身・選択済み・循環を作る組み合わせを除外
  const predecessorCandidates = useMemo(() => {
    return allTasks.filter(t =>
      !t.is_deleted
      && t.id !== taskId
      && !predecessorDeps.some(d => d.predecessor_task_id === t.id)
      && !wouldCreateCycle(activeTaskDependencies, t.id, taskId),
    );
  }, [allTasks, taskId, predecessorDeps, activeTaskDependencies]);

  const originalTask = allTasks.find(t => t.id === taskId);

  const eligibleTfIds = useMemo(
    () => getEligibleTfIds(originalTask, allTaskForces),
    [originalTask?.due_date, originalTask?.start_date, allTaskForces], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // このタスクが子を持つ親なら、親に設定できない（孫禁止）
  const isParent = useMemo(
    () => originalTask ? isParentTask(originalTask, allTasks) : false,
    [originalTask, allTasks],
  );

  // 親タスク候補＝全PJの最上位タスク。元タスクのPJを先頭に、他PJはPJ名を併記。
  // （子を選ぶと子は親のPJに揃うため他PJ親も許容。同一PJを優先表示）
  const currentProjectId = originalTask?.project_id ?? null;
  const parentOptions = useMemo<SelectOption[]>(() => {
    const pjOf = (id: string | null) => (id ? projects.find(p => p.id === id) : undefined);
    const currentPjColor = pjOf(currentProjectId)?.color_tag ?? "var(--color-border-secondary)";
    const cands = parentTaskCandidates(allTasks, currentProjectId, originalTask?.id);
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
  }, [allTasks, currentProjectId, originalTask?.id, projects]);

  // このモーダルはタグ編集UIを持つため、tags は常に配列で保持する（TaskSidePanel と違い省略しない）
  const [form, setForm] = useState<TaskEditFormState & { tags: string[] }>({
    name:                 originalTask?.name ?? "",
    status:               originalTask?.status ?? "todo" as Task["status"],
    priority:             originalTask?.priority ?? "",
    assignee_member_ids:  originalTask ? getAssigneeIds(originalTask) : [] as string[],
    project_id:           originalTask?.project_id ?? null as string | null,
    parent_task_id:       originalTask?.parent_task_id ?? null as string | null,
    start_date:           originalTask?.start_date ?? "",
    due_date:             originalTask?.due_date ?? "",
    estimated_hours:      originalTask?.estimated_hours?.toString() ?? "",
    comment:              originalTask?.comment ?? "",
    tags:                 originalTask?.tags ?? [] as string[],
  });
  const [tagDraft, setTagDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const isInitialMount = useRef(true);
  // dirty: form が最後に成功した保存以降に変更されている（＝デバウンス未発火の保留編集がある）
  // inFlight: デバウンスは発火済みで saveTask の Promise がまだ解決していない
  // （閉じる操作でこの2つを見て「保留編集があれば1回だけフラッシュ」を判定する）
  const formDirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);

  // 自動保存ハンドラを ref に保持し、useEffect の依存配列を form のみに絞る
  // （originalTask の realtime 更新などで saveTask が再発火しないようにする）
  const handleAutoSaveRef = useRef<() => Promise<void>>(async () => {});
  handleAutoSaveRef.current = async () => {
    if (!originalTask) return;
    const parent = form.parent_task_id ? allTasks.find(t => t.id === form.parent_task_id) : null;
    const updated = buildTaskUpdatePayload(originalTask, form, parent, currentUser.id);
    try {
      await saveTask(updated);
      formDirtyRef.current = false;
      setSaveStatus("saved");
      // 自動保存ではモーダルを閉じない。親側は zustand 経由で自動的に
      // 再レンダーされるので、明示的な「保存後のフック」呼び出しは不要。
      setTimeout(() => {
        setSaveStatus(s => (s === "saved" ? "idle" : s));
      }, 1500);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(formatErrorForUser("保存に失敗しました", e));
      // dirty は落とさない（保存できていないため）。失敗は store 側の
      // handleSaveError が別途トースト＋load()で拾う（appStore.saveTask 参照）。
    } finally {
      saveInFlightRef.current = false;
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
    formDirtyRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);
    const timer = setTimeout(() => {
      saveInFlightRef.current = true;
      void handleAutoSaveRef.current();
    }, 600);
    return () => clearTimeout(timer);
  }, [form]);

  // モーダルを閉じるときの保存フラッシュ＋ finalized_mentions 確定保存。
  //
  // ①保留編集（デバウンス600ms待ち中でまだ saveTask が発火していない変更）がある場合、
  //   ✕を押した瞬間にその場でフォーム全項目を保存発火する（await はしない＝閉じる操作を
  //   ブロックしない。saveTask は store 層で直列化されバックグラウンドで完走する）。
  //   これにより「✕を押すと直前の編集が失われる」バグを防ぐ（デバウンス発火前にモーダルが
  //   アンマウントされ useEffect のクリーンアップが setTimeout を握り潰していたのが原因）。
  // ②既に保存発火済み（saveInFlightRef=true）の場合は二重発火しない
  //   （そのままバックグラウンドで完走するため何もしなくてよい）。
  // ③finalized_mentions（@メンション通知は「閉じた時だけ確定」の既存仕様）は①の保存に
  //   まとめて1回で送る。①を発火しない場合（フォームは保存済み・mentionsだけ変化）は
  //   finalized_mentions 単体の保存を1回だけ行う。
  //   → いずれの分岐でも close 時の saveTask 呼び出しは最大1回。
  const handleClose = useCallback(() => {
    if (originalTask) {
      const currentMentions = extractMentions(form.comment);
      const mentionsChanged = !mentionsEqual(currentMentions, originalTask.finalized_mentions ?? []);

      if (formDirtyRef.current && !saveInFlightRef.current) {
        const parent = form.parent_task_id ? allTasks.find(t => t.id === form.parent_task_id) : null;
        const payload = buildTaskUpdatePayload(originalTask, form, parent, currentUser.id);
        formDirtyRef.current = false;
        // fire-and-forget: 保存完了を待たずに閉じる（Supabase 呼び出しは非同期で継続）
        void saveTask(mentionsChanged ? { ...payload, finalized_mentions: currentMentions } : payload);
      } else if (mentionsChanged) {
        // フォームは既に保存済み／発火済み。finalized_mentions のみ確定保存する。
        void saveTask({
          ...originalTask,
          comment:             form.comment,
          finalized_mentions:  currentMentions,
          updated_by:          currentUser.id,
        });
      }
    }
    onClose();
  }, [originalTask, form, allTasks, currentUser.id, saveTask, onClose]);

  const handleDelete = useCallback(async () => {
    if (!originalTask) return;
    if (!await confirmDialog(`「${originalTask.name}」を削除しますか？`)) return;
    deleteTask(taskId, currentUser.id);
    showToast(`「${originalTask.name}」を削除しました`, "info", {
      label: "元に戻す",
      isUndo: true,
      onClick: () => { restoreTask(taskId); },
    });
    onDeleted?.(taskId);
    onClose();
  }, [originalTask, taskId, currentUser.id, deleteTask, restoreTask, onDeleted, onClose]);

  // 全 Hooks を呼び終えた後に early return（react-hooks/rules-of-hooks 遵守）
  if (!originalTask) return null;

  const project = projects.find(p => p.id === originalTask.project_id);
  const isOverdue = !!form.due_date && form.due_date < todayStr() && !suppressOverdue(form.status);

  const statusArr: Task["status"][] = ["todo", "in_progress", "done", "on_hold", "cancelled"];

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: isMobile ? "flex-end" : "flex-start",
        justifyContent: "center",
        paddingTop: isMobile ? 0 : "60px",
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
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

          <button onClick={handleClose} aria-label="閉じる" title="閉じる" style={{
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
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
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
            <CustomSelect
              multi
              value=""
              onChange={() => {}}
              selectedValues={form.assignee_member_ids}
              onToggle={id => setForm(f => ({
                ...f,
                assignee_member_ids: f.assignee_member_ids.includes(id)
                  ? f.assignee_member_ids.filter(i => i !== id)
                  : [...f.assignee_member_ids, id],
              }))}
              options={
                // 自分自身を先頭に、残りは元の順
                [...members].sort((a, b) =>
                  a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
                ).map(m => ({ value: m.id, label: m.display_name }))
              }
              placeholder="＋ 担当者を追加..."
              searchable searchPlaceholder="メンバーで検索..."
            />
          </FieldSection>

          {/* プロジェクト */}
          <FieldSection label="プロジェクト">
            <CustomSelect value={form.project_id ?? ""}
              onChange={value => setForm(f => ({ ...f, project_id: value || null }))}
              options={[
                { value: "", label: "なし" },
                ...projects.map(p => ({ value: p.id, label: p.name })),
              ]}
              searchable searchPlaceholder="プロジェクトで検索..."
            />
          </FieldSection>

          {/* 親タスク（2階層固定。子を持つタスクは親に設定不可） */}
          <FieldSection label="親タスク">
            <CustomSelect value={form.parent_task_id ?? ""}
              onChange={value => setForm(f => ({ ...f, parent_task_id: value || null }))}
              options={parentOptions}
              disabled={isParent}
              searchable searchPlaceholder="親タスクを検索..."
            />
            {isParent && (
              <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                子タスクがあるため親に設定できません
              </div>
            )}
          </FieldSection>

          {/* 先行タスク（B1：依存ゲート）。親子関係とは別概念のため、枠で囲んで視覚的に分離する。
              完了は先行が全部doneになるまでハードブロック・着手はソフト警告のみ（止めない） */}
          <div style={{
            marginBottom: "14px", padding: "10px 10px 9px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-secondary)",
          }}>
            <div style={{
              fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)",
              textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px",
            }}>
              ⏱ 先行タスク（このタスクの前に完了すべきタスク）
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {predecessorTasks.map(t => {
                const dep = predecessorDeps.find(d => d.predecessor_task_id === t.id);
                return (
                  <span key={t.id} style={chipStyle}>
                    <span aria-hidden>{t.status === "done" ? "✅" : t.status === "cancelled" ? "🚫" : t.status === "on_hold" ? "⏸" : "⏳"}</span>
                    {t.name}
                    <button
                      onClick={() => dep && removeTaskDependency(dep.id, currentUser.id)}
                      aria-label={`${t.name} を先行タスクから外す`}
                      style={chipRemoveBtn}>×</button>
                  </span>
                );
              })}
              {predecessorTasks.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>なし</span>
              )}
            </div>
            <CustomSelect
              value=""
              onChange={value => {
                if (!value) return;
                addTaskDependency(value, taskId, currentUser.id);
              }}
              options={[
                { value: "", label: "＋ 先行タスクを追加..." },
                ...predecessorCandidates.map(t => ({ value: t.id, label: t.name })),
              ]}
              searchable searchPlaceholder="タスクで検索..."
            />
            {successorTasks.length > 0 && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                  このタスクの完了を待っている後続タスク：
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {successorTasks.map(t => (
                    <span key={t.id} style={{ ...chipStyle, opacity: 0.75 }}>{t.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

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
            <CustomSelect
              value=""
              onChange={value => {
                if (!value) return;
                addTaskProject({ task_id: taskId, project_id: value });
              }}
              options={[
                { value: "", label: "＋ プロジェクトを追加..." },
                ...projects
                  .filter(p => p.id !== form.project_id && !linkedExtraProjects.find(ep => ep.id === p.id))
                  .map(p => ({ value: p.id, label: p.name })),
              ]}
              searchable searchPlaceholder="プロジェクトで検索..."
            />
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
            {taskForcesForPicker.length > 0 ? (
              <CustomSelect
                value=""
                onChange={value => {
                  if (!value) return;
                  addTaskTaskForce({ task_id: taskId, tf_id: value });
                }}
                options={[
                  { value: "", label: "＋ タスクフォースを追加..." },
                  ...taskForcesForPicker
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
                    .map(tf => ({
                      value: tf.id,
                      label: `${tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}${tf.name ? ` ${tf.name}` : ""}`,
                    })),
                ]}
                searchable searchPlaceholder="TF・KRで検索..."
              />
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

          {/* コメント（@ でメンバーをメンション可） */}
          <FieldSection label="コメント・メモ">
            <MentionTextarea
              value={form.comment}
              onChange={v => setForm(f => ({ ...f, comment: v }))}
              members={allMembers}
              rows={5}
              placeholder={"メモやURLを入力できます\n@名前 でメンション・通知できます"}
              style={{ ...inputSm, resize: "vertical", lineHeight: 1.6, minHeight: "80px" }}
            />
          </FieldSection>

          {/* タグ（自由入力・同一PJ内のグルーピング/ソート用） */}
          <FieldSection label="タグ">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
              {form.tags.map((tag, i) => (
                <span key={`${tag}-${i}`} style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  fontSize: "11px", padding: "2px 4px 2px 9px",
                  background: "var(--color-brand-light)", color: "var(--color-text-purple)",
                  border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-full)",
                }}>
                  {tag}
                  <button
                    onClick={() => setForm(f => ({ ...f, tags: f.tags.filter((_, j) => j !== i) }))}
                    aria-label={`タグ「${tag}」を削除`}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-purple)", fontSize: "12px", lineHeight: 1, padding: "0 3px" }}
                  >×</button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = tagDraft.trim();
                    if (v && !form.tags.includes(v)) setForm(f => ({ ...f, tags: [...f.tags, v] }));
                    setTagDraft("");
                  } else if (e.key === "Backspace" && !tagDraft && form.tags.length > 0) {
                    setForm(f => ({ ...f, tags: f.tags.slice(0, -1) }));
                  }
                }}
                onBlur={() => {
                  const v = tagDraft.trim();
                  if (v && !form.tags.includes(v)) setForm(f => ({ ...f, tags: [...f.tags, v] }));
                  setTagDraft("");
                }}
                placeholder={form.tags.length === 0 ? "例：懇親会（Enterで追加）" : "タグを追加…"}
                maxLength={20}
                style={{ ...inputSm, flex: 1, minWidth: "120px", width: "auto" }}
              />
            </div>
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


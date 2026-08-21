// src/components/task/TaskSidePanel.tsx
//
// タスククリックで右側に出る 320px サイドパネル。List/Gantt/Kanban で共通利用。
// モバイルは呼び出し側で TaskEditModal を出す（このコンポーネントは PC・タブレット向け）。
//
// 【v3.87：明示保存への変更】
// 以前は全フィールドを600msデバウンスで自動保存していたが、「自動保存されているか分からず
// 不安」というクレームを受け、保存ボタン／Enter／Ctrl(Cmd)+Enterで明示的に保存する方式へ
// 変更した（TaskEditModal.tsxと同じ設計。CLAUDE.md 新設グランドルール参照）。
// 対象は `sidebarForm`（このタスク自身のフィールド）のみ。タスクフォース・追加プロジェクト・
// 先行タスクの紐づけ・子タスクの付け外し（add/removeTaskTaskForce・add/removeTaskProject・
// add/removeTaskDependency・applyChildren・detachChild）は別テーブルへのjoin/unjoinや
// 他タスクのparent_task_id変更で、操作した瞬間に結果が見える別種の操作のため、従来どおり
// 即時実行のままにする。

import { useState, useEffect, useMemo, useRef, useCallback, useId } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedTaskDependencies } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import {
  TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE,
  getAssigneeIds, buildTfLabelMap, suppressOverdue,
} from "../../lib/taskMeta";
import { todayStr } from "../../lib/date";
import { getEligibleTfIds } from "../../lib/okr/eligibleTaskForces";
import { taskForcesInGroup } from "../../lib/okr/deptScope";
import { parentTaskCandidates, childrenOf, eligibleChildTasks } from "../../lib/taskHierarchy";
import { wouldCreateCycle } from "../../lib/dependencies/cycleCheck";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { buildTaskUpdatePayload, computeFormDirty, type TaskEditFormState } from "../../lib/taskEditPayload";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../lib/editing/unsavedEditorRegistry";
import { SIDE_PANEL_FOOTER_HEIGHT_PX } from "../../lib/layout/bottomStack";

interface Props {
  taskId: string;
  currentUser: Member;
  onClose: () => void;
  /** v3.88：タスク切替時、旧タスクの保存が失敗して切替を中止した場合に、呼び出し元の選択状態
   *  を旧タスクへ戻してもらうためのコールバック。呼び出し元がこれを実装しないと、
   *  「パネルは旧タスクを表示し続けるのに、呼び出し元の選択状態は新タスクのまま」という
   *  表示の食い違いが起きるため必須にしている。 */
  onSwitchFailed: (previousTaskId: string) => void;
}

// タグ編集UIが無いため tags を除いた TaskEditFormState のサブセット。
// buildTaskUpdatePayload は tags 省略時に originalTask.tags を維持する。
type SidebarForm = Omit<TaskEditFormState, "tags">;

/** selectedTask から sidebarForm の初期値（＝保存済みベースライン）を組み立てる。 */
function buildSidebarFormFromTask(task: Task): SidebarForm {
  return {
    name:                task.name,
    status:              task.status,
    priority:            task.priority ?? "",
    assignee_member_ids: getAssigneeIds(task),
    project_id:          task.project_id ?? null,
    parent_task_id:      task.parent_task_id ?? null,
    start_date:          task.start_date ?? "",
    due_date:            task.due_date ?? "",
    estimated_hours:     task.estimated_hours?.toString() ?? "",
    comment:             task.comment,
  };
}

export function TaskSidePanel({ taskId, currentUser, onClose, onSwitchFailed }: Props) {
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
  const addTaskTaskForce    = useAppStore(s => s.addTaskTaskForce);
  const removeTaskTaskForce = useAppStore(s => s.removeTaskTaskForce);
  const addTaskProject      = useAppStore(s => s.addTaskProject);
  const removeTaskProject   = useAppStore(s => s.removeTaskProject);
  const addTaskDependency    = useAppStore(s => s.addTaskDependency);
  const removeTaskDependency = useAppStore(s => s.removeTaskDependency);

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

  // ===== 先行タスク（B1：依存ゲート。親子関係（階層セグメント）とは独立の別概念） =====
  // is_deleted除外済みの依存一覧（wouldCreateCycleはこの除外をしない契約のため、渡す前に必ず絞る。
  // 除外しないと、他クライアントが削除した依存がrealtime UPDATEで配列に残ったまま
  // 〈upsertByIdはDELETEイベントでしか行を除去しないため〉循環判定に亡霊として残ってしまう）
  const activeTaskDependencies = useMemo(
    () => allTaskDependencies.filter(d => !d.is_deleted),
    [allTaskDependencies],
  );
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

  // selectedTask 全体ではなく日付フィールドだけに依存させて、無関係フィールド更新で再走査しない
  const eligibleTfIds = useMemo(
    () => getEligibleTfIds(selectedTask, allTaskForces),
    [selectedTask?.due_date, selectedTask?.start_date, allTaskForces], // eslint-disable-line react-hooks/exhaustive-deps
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
    const opts: SelectOption[] = [{ value: "", label: "（親タスクを選択...）" }];
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
  // 階層モード：単独（none）／子タスク（child＝親を選ぶ）／親タスク（parent＝子を選ぶ）。
  // 両方のUIを同時に出すと混乱するため、選んだモード専用のUIだけを表示する。
  const [hierarchyMode, setHierarchyMode] = useState<"none" | "child" | "parent">("none");
  // 子タスク選択（親側から子を複数チェックして決定する）UI の状態
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childPickerChecked, setChildPickerChecked] = useState<Set<string>>(new Set());
  const [childSearch, setChildSearch] = useState("");
  // ===== v3.87：明示保存のためのbaseline管理（TaskEditModal.tsxと同じ設計） =====
  // baselineFormRef：「最後に保存した内容（未保存なら開いた時点の内容）」。isDirty判定の基準。
  // baselineUpdatedAtRef：「最後に保存した時点（未保存なら開いた時点）のupdated_at」。
  // 2-5（競合防御）の基準値として使う。saveTask（choke point）自体には手を入れない。
  const baselineFormRef = useRef<SidebarForm | null>(null);
  const baselineUpdatedAtRef = useRef<string | undefined>(undefined);
  // sidebarForm が今どのタスクのものかを保持する（taskId 切替時、旧タスクの未保存の変更を
  // 正しい旧タスクに対して扱うために必要）
  const formTaskRef = useRef<Task | null>(null);

  // taskId 切替：旧タスクに未保存の変更があれば、切り替える前に確認する
  // （黙って破棄しない・黙って保存しない）。保存する場合はここで確定してから新タスクへ進む。
  //
  // 【v3.88：保存失敗時は切替を中止する】
  // 「保存して移動する」を選んだのにsaveTaskが失敗した場合、以前はtoastを出すだけで
  // そのまま新タスクへ切り替えてしまい、旧タスクの編集内容（sidebarForm/baseline）を
  // 失っていた。今回の改修の趣旨（編集が失われないと確信できること）と正面から矛盾するため、
  // 失敗時はここでreturnして新タスクへの切替（setSidebarForm等）を一切実行しない。
  // 旧タスクのsidebarForm/baseline/formTaskRefはそのまま保持され、エラーは
  // saveStatus/saveErrorを通じて永続的なエラー帯（下記JSX）に表示される。
  //
  // 【選択状態のずれ対策】呼び出し元（GanttView/KanbanView/ListView）は行クリック時に
  // 自分の選択state（editingTaskId/selectedTaskId）を即座に新タスクへ進めるため、
  // taskId propは既に新タスクを指している。このコンポーネント内部だけ旧タスクの
  // 表示を保持しても、selectedTask（taskId propから導出）は新タスクのままになり、
  // ヘッダーのプロジェクトカラーバー・タスクフォース欄・先行タスク欄など「sidebarFormを
  // 経由しない」表示だけが新タスクにズレる。これを避けるため、切替失敗時は
  // onSwitchFailed(prevTask.id) で呼び出し元に選択を旧タスクへ戻してもらう
  // （必須propとして全呼び出し元に実装を強制している）。
  useEffect(() => {
    // 直前の切替失敗でonSwitchFailedにより選択が旧タスクへ戻ったことで発火した再実行は、
    // 実質「切替なし」の自己ループのため何もしない（旧タスクのform/baselineはそのまま）
    if (taskId === formTaskRef.current?.id) return;

    let cancelled = false;

    async function run() {
      const prevTask = formTaskRef.current;
      const prevForm = sidebarForm;
      const prevBaseline = baselineFormRef.current;
      if (prevTask && prevForm && prevBaseline && computeFormDirty(prevForm, prevBaseline)) {
        // 【v3.88：背景クリックの安全側デフォルトをsaveにする】ConfirmModalはEscapeでは
        // 閉じないが、背景クリックは必ずcancel（false）扱いで閉じる。2択の意味を
        // 「confirm=破棄」「cancel=保存」に割り当てることで、うっかり背景をクリックしても
        // 編集内容が破棄されず保存される側に倒れるようにする（tone="danger"で「破棄」の
        // ボタンだけを赤く・押しにくく見せる。ConfirmModal 19箇所の削除確認と同じ配色規約）。
        const discardWithoutSaving = await confirmDialog(
          `「${prevTask.name}」に保存していない変更があります。破棄して次のタスクへ移動しますか？`,
          { tone: "danger", confirmLabel: "破棄して移動する", cancelLabel: "保存してから移動する" },
        );
        if (cancelled) return;
        if (!discardWithoutSaving) {
          const parent = prevForm.parent_task_id ? allTasks.find(t => t.id === prevForm.parent_task_id) : null;
          try {
            await saveTask(buildTaskUpdatePayload(prevTask, prevForm, parent, currentUser.id));
          } catch (e) {
            if (cancelled) return;
            // 切替を中止する。旧タスクのsidebarForm/baseline/formTaskRefは一切変更しない
            // （保持したまま。dirtyな内容は消えない）。
            setSaveStatus("error");
            setSaveError(formatErrorForUser("保存に失敗しました。移動を中止しました", e));
            onSwitchFailed(prevTask.id);
            return;
          }
        }
      }
      if (cancelled) return;

      if (!selectedTask) {
        setSidebarForm(null);
        formTaskRef.current = null;
        baselineFormRef.current = null;
        baselineUpdatedAtRef.current = undefined;
        return;
      }
      const nextForm = buildSidebarFormFromTask(selectedTask);
      setSidebarForm(nextForm);
      baselineFormRef.current = nextForm;
      baselineUpdatedAtRef.current = selectedTask.updated_at;
      formTaskRef.current = selectedTask;
      // 現在の親子状態から階層モードを導出
      setHierarchyMode(
        selectedTask.parent_task_id ? "child"
        : childrenOf(allTasks, selectedTask.id).length > 0 ? "parent"
        : "none"
      );
      setChildPickerOpen(false);
      setChildPickerChecked(new Set());
      setChildSearch("");
      setSaveStatus("idle");
      setSaveError(null);
    }

    void run();
    return () => { cancelled = true; };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 【v3.89：未保存の編集を「予告なくアンマウントされる経路」から守るレジストリ登録】
  // MainLayoutのviewMode/appMode切替・部署切替・ログアウト等、このパネルを含む画面が
  // 丸ごとアンマウントされうる操作の前に、呼び出し元が「今dirtyな編集画面があるか」を
  // 同期的に問い合わせられるようにする（CLAUDE.md Section 46参照）。
  // sidebarForm/baselineFormRefがまだ無い（初期化前・タスク切替中）場合はdirtyではない
  // として扱う。isDirtyForRegistryRefは毎レンダー最新値に更新し、登録するgetterは常に
  // このrefを読む（このファイル既存のref更新パターンを踏襲。early returnより前でHooksを
  // 呼び終える必要があるため、ここでは早期returnせずnull安全な式で計算する）。
  const isDirtyForRegistry = sidebarForm && baselineFormRef.current
    ? computeFormDirty(sidebarForm, baselineFormRef.current)
    : false;
  const registryId = useId();
  const isDirtyForRegistryRef = useRef(isDirtyForRegistry);
  isDirtyForRegistryRef.current = isDirtyForRegistry;
  useEffect(() => {
    registerUnsavedEditor(registryId, () => isDirtyForRegistryRef.current);
    return () => unregisterUnsavedEditor(registryId);
  }, [registryId]);

  if (!selectedTask || !sidebarForm) return null;

  const isDirty = baselineFormRef.current ? computeFormDirty(sidebarForm, baselineFormRef.current) : false;
  // 2-5：他の人がこのタスクを更新したことの控えめな通知（保存時にあらためて確認する）
  const remoteUpdateNotice = !!selectedTask.updated_at
    && !!baselineUpdatedAtRef.current
    && selectedTask.updated_at !== baselineUpdatedAtRef.current;

  const handleSave = async () => {
    if (saveStatus === "saving") return; // 二重送信防止
    if (!baselineFormRef.current || !computeFormDirty(sidebarForm, baselineFormRef.current)) return;

    // 2-5：競合防御（saveTask自体の楽観ロックには手を入れない。画面内だけで検知する）
    if (
      selectedTask.updated_at
      && baselineUpdatedAtRef.current
      && selectedTask.updated_at !== baselineUpdatedAtRef.current
    ) {
      const overwrite = await confirmDialog(
        "このタスクは他の人が更新しました。あなたの内容で上書きしますか？",
        { tone: "neutral", confirmLabel: "上書きして保存する", cancelLabel: "保存しない" },
      );
      if (!overwrite) return;
    }

    const formAtSaveTime = sidebarForm;
    // 親を設定したら project_id は親のPJに合わせる（不一致防止）。親を外したらフォームのPJ。
    const parent = sidebarForm.parent_task_id ? allTasks.find(t => t.id === sidebarForm.parent_task_id) : null;
    const updated = buildTaskUpdatePayload(selectedTask, sidebarForm, parent, currentUser.id);
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveTask(updated);
      baselineFormRef.current = formAtSaveTime;
      baselineUpdatedAtRef.current = useAppStore.getState().tasks.find(t => t.id === taskId)?.updated_at;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(s => s === "saved" ? "idle" : s), 1500);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  // ===== v3.93：即時保存（join系）操作にヘッダーの保存インジケータを反映する =====
  // タスクフォース・追加プロジェクト・先行タスク・子タスクの付け外しはform（sidebarForm）を
  // 経由しない即時保存のため、保存ボタンのdirty状態には一切反映されない（v3.87の設計どおり）。
  // しかし成功しても画面上は「チップが増減した」以外に一切フィードバックが無く、利用者からは
  // 「何か変更したのに保存ボタンが反応しない＝壊れている」としか見えなかった（クレーム対応・
  // v3.93）。既存のSaveIndicator（✓）をそのまま流用し、即時保存が成功した合図として一瞬表示する。
  // メイン保存（handleSave）が進行中（"saving"）ならそちらを優先し、上書きしない。
  const flashImmediateSaved = () => {
    setSaveStatus(s => (s === "saving" ? s : "saved"));
    setTimeout(() => setSaveStatus(s => (s === "saved" ? "idle" : s)), 1500);
  };

  const runImmediateSave = async (action: () => Promise<void>) => {
    try {
      await action();
      flashImmediateSaved();
    } catch {
      // エラーは呼び出し先（store）が既にshowToastで通知済み（appStore.ts参照）。ここでは何もしない
    }
  };

  const pj = projects.find(p => p.id === selectedTask.project_id);
  const isOverdue = !!sidebarForm.due_date
    && sidebarForm.due_date < todayStr()
    && !suppressOverdue(sidebarForm.status);

  // ===== 階層（親子関係） =====
  const children = childrenOf(allTasks, selectedTask.id);
  const hasChildren = children.length > 0;

  // モード切替。子が付いている間は「親タスク」以外に切り替えられない（先に子を外す）。
  // 「子タスク」以外に切り替えたら親設定はクリアする（sidebarFormの一部のため、保存ボタン／
  // Enter／Ctrl+Enterで明示保存されるまでDBには反映されない＝v3.87）。
  const switchHierarchyMode = (mode: "none" | "child" | "parent") => {
    if (mode === hierarchyMode) return;
    if (hasChildren && mode !== "parent") return;
    setHierarchyMode(mode);
    if (mode !== "child" && sidebarForm.parent_task_id) {
      setSidebarForm(f => f ? { ...f, parent_task_id: null } : f);
    }
    if (mode !== "parent") {
      setChildPickerOpen(false);
      setChildPickerChecked(new Set());
    }
  };

  const childCandidates = hierarchyMode === "parent"
    ? eligibleChildTasks(allTasks, selectedTask).filter(t => t.parent_task_id !== selectedTask.id)
    : [];
  const childQ = childSearch.trim().toLowerCase();
  const visibleChildCandidates = childQ
    ? childCandidates.filter(t => t.name.toLowerCase().includes(childQ))
    : childCandidates;

  const toggleChild = (id: string) => setChildPickerChecked(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // v3.87：applyChildren/detachChildは「別のタスク（子）」のparent_task_idを変更する操作で、
  // 選択中タスク自身のsidebarFormではない。従来どおり即時保存のままにする（保存ボタンの対象外）。
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
      flashImmediateSaved();
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
      flashImmediateSaved();
    } catch (e) {
      showToast(formatErrorForUser("子タスクの解除に失敗しました", e), "error");
    }
  };

  const handleDelete = async () => {
    if (!await confirmDialog(`「${selectedTask.name}」を削除しますか？`)) return;
    await deleteTask(selectedTask.id, currentUser.id);
    onClose();
  };

  // 未保存のまま閉じようとしたときの警告（v3.87・TaskEditModal.tsx の handleClose と同じ設計）。
  // 2択（「破棄して閉じる」／「編集に戻る」）で足りると判断した：保存したいだけなら常時表示の
  // 保存ボタンがあるため、この確認に「保存して閉じる」選択肢まで持たせる必要は薄い。
  const handleClose = async () => {
    if (isDirty) {
      const discard = await confirmDialog(
        "保存していない変更があります。破棄して閉じますか？",
        { tone: "neutral", confirmLabel: "破棄して閉じる", cancelLabel: "編集に戻る" },
      );
      if (!discard) return; // 編集に戻る：パネルを開いたまま何もしない
    }
    onClose();
  };

  return (
    // v3.87：Enter・Ctrl(Cmd)+Enterでの明示保存（TaskEditModal.tsxと同じ二段構え）。
    // Ctrl/Cmd+Enterはcaptureフェーズ（子要素より先）で拾い「どこからでも保存」を保証する。
    // 単純Enterはbubbleフェーズで拾い、タグ入力欄・CustomSelectの検索input等が既に
    // e.preventDefault()した場合はそちらを優先して何もしない。日本語入力の変換確定時の
    // Enter（e.nativeEvent.isComposing）は両方とも必ず無視する。キーボード操作自体は
    // パネル内の各フォーム要素が担うため、この箱自身をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="animate-side-panel-in"
      onKeyDownCapture={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void handleSave();
        }
      }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return; // Ctrl/Cmd+Enterは上のcaptureで処理済み
        if (e.defaultPrevented) return; // 子要素（CustomSelectの検索input等）が既に処理済み
        // 単一行のinputのみ対象。textarea（メモ・コメント）はEnterで改行のままにする
        if ((e.target as HTMLElement).tagName !== "INPUT") return;
        e.preventDefault();
        void handleSave();
      }}
      style={{
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
        <button onClick={() => void handleClose()} aria-label="閉じる" title="閉じる" style={{
          background: "none", border: "none", cursor: "pointer", fontSize: "14px",
          color: "var(--color-text-tertiary)", flexShrink: 0,
        }}>✕</button>
      </div>

      {/* 2-5：他の人がこのタスクを更新したことの控えめな通知（保存時にあらためて確認する） */}
      {remoteUpdateNotice && (
        <div style={{
          padding: "5px 12px",
          background: "var(--color-bg-warning)",
          color: "var(--color-text-warning)",
          fontSize: "10px",
          borderBottom: "1px solid var(--color-border-warning)",
        }}>
          ⚠ 他のメンバーがこのタスクを更新しました。保存すると上書きの確認が表示されます。
        </div>
      )}

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
        <div style={{ display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap" }}>
          {(["todo", "in_progress", "done", "on_hold", "cancelled"] as const).map(s => (
            <button key={s}
              onClick={() => setSidebarForm(f => f ? { ...f, status: s } : f)}
              style={{
                flex: "1 1 30%", padding: "5px 2px", fontSize: "10px", borderRadius: "var(--radius-md)",
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
          multi
          value=""
          onChange={() => {}}
          selectedValues={sidebarForm.assignee_member_ids}
          onToggle={id => setSidebarForm(f => f
            ? {
                ...f,
                assignee_member_ids: f.assignee_member_ids.includes(id)
                  ? f.assignee_member_ids.filter(i => i !== id)
                  : [...f.assignee_member_ids, id],
              }
            : f)}
          options={[...members].sort((a, b) =>
            a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : 0
          ).map(m => ({ value: m.id, label: m.display_name }))}
          placeholder="＋ 担当者を追加..."
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

        {/* 階層（親子関係）。単独／子タスク／親タスクのどれかを選び、選んだモード専用のUIだけを出す
            （親セレクタと子ピッカーの同時表示は「どちらも変更できて違和感」というフィードバックを受け廃止） */}
        <SideLabel>階層</SideLabel>
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
          {([
            { mode: "none"   as const, label: "単独",     hint: "親も子も持たない通常のタスク" },
            { mode: "child"  as const, label: "子タスク", hint: "親タスクの下にぶら下げる" },
            { mode: "parent" as const, label: "親タスク", hint: "子タスクを複数まとめる" },
          ]).map(seg => {
            const isActive = hierarchyMode === seg.mode;
            const isDisabled = hasChildren && seg.mode !== "parent";
            return (
              <button
                key={seg.mode}
                onClick={() => switchHierarchyMode(seg.mode)}
                disabled={isDisabled}
                title={isDisabled ? "子タスクをすべて外すと変更できます" : seg.hint}
                style={{
                  flex: 1, padding: "6px 4px", fontSize: "11px", fontWeight: isActive ? 600 : 400,
                  border: `1px solid ${isActive ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-md)",
                  background: isActive ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                  color: isDisabled ? "var(--color-text-tertiary)"
                    : isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.55 : 1,
                }}
              >
                {seg.label}
              </button>
            );
          })}
        </div>

        {/* 子タスクモード：親を1つ選ぶ専用UI */}
        {hierarchyMode === "child" && (
          <div style={{ marginBottom: "12px" }}>
            <CustomSelect
              value={sidebarForm.parent_task_id ?? ""}
              onChange={value => setSidebarForm(f => f ? { ...f, parent_task_id: value || null } : f)}
              options={parentOptions}
              searchable searchPlaceholder="親タスクを検索..."
            />
            {!sidebarForm.parent_task_id && (
              <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                親タスクを選ぶと、そのタスクの下にぶら下がります（親のPJに揃います）
              </div>
            )}
          </div>
        )}

        {/* 親タスクモード：子を複数選ぶ専用UI */}
        {hierarchyMode === "parent" && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
              {children.map(c => (
                <span key={c.id} style={chipStyle}>
                  <span style={{ color: "var(--color-text-tertiary)" }}>↳</span>{c.name}
                  <button onClick={() => detachChild(c.id)} aria-label={`${c.name} を子タスクから外す`} style={chipRemoveBtn}>×</button>
                </span>
              ))}
              {children.length === 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>まだ子タスクがありません</span>
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

        {/* 先行タスク（B1：依存ゲート）。階層（親子関係）とは別概念のため、枠で囲んで視覚的に分離する。
            完了は先行が全部doneになるまでハードブロック・着手はソフト警告のみ（止めない）。
            v3.87：追加・解除はここも即時反映（保存ボタンの対象外。join系の線引きは冒頭コメント参照） */}
        <div style={{
          marginBottom: "12px", padding: "8px 8px 7px",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-secondary)",
        }}>
          <div style={{
            fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)",
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
          }}>
            ⏱ 先行タスク（前に完了すべきタスク）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
            {predecessorTasks.map(t => {
              const dep = predecessorDeps.find(d => d.predecessor_task_id === t.id);
              return (
                <span key={t.id} style={chipStyle}>
                  <span aria-hidden>{t.status === "done" ? "✅" : t.status === "cancelled" ? "🚫" : t.status === "on_hold" ? "⏸" : "⏳"}</span>
                  {t.name}
                  <button
                    onClick={() => dep && void runImmediateSave(() => removeTaskDependency(dep.id, currentUser.id))}
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
              void runImmediateSave(() => addTaskDependency(value, selectedTask.id, currentUser.id));
            }}
            options={[
              { value: "", label: "＋ 先行タスクを追加..." },
              ...predecessorCandidates.map(t => ({ value: t.id, label: t.name })),
            ]}
            searchable searchPlaceholder="タスクで検索..."
          />
          {successorTasks.length > 0 && (
            <div style={{ marginTop: "7px" }}>
              <div style={{ fontSize: "9px", color: "var(--color-text-tertiary)", marginBottom: "3px" }}>
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

        {/* 追加プロジェクト。v3.87：追加・解除は即時反映（保存ボタンの対象外） */}
        <SideLabel>追加プロジェクト</SideLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
          {linkedExtraProjects.map(p => (
            <span key={p.id} style={chipStyle}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color_tag, flexShrink: 0 }} />
              {p.name}
              <button
                onClick={() => void runImmediateSave(() => removeTaskProject(selectedTask.id, p.id))}
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
            void runImmediateSave(() => addTaskProject({ task_id: selectedTask.id, project_id: value }));
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

        {/* タスクフォース。v3.87：追加・解除は即時反映（保存ボタンの対象外） */}
        <SideLabel>タスクフォース</SideLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "5px" }}>
          {linkedTfs.map(tf => (
            <span key={tf.id} style={chipStyle}>
              <span style={{ fontWeight: "600", marginRight: 3 }}>
                {tfLabelById.get(tf.id) ?? `TF ${tf.tf_number ?? "?"}`}
              </span>
              {tf.name}
              <button
                onClick={() => void runImmediateSave(() => removeTaskTaskForce(selectedTask.id, tf.id))}
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
              void runImmediateSave(() => addTaskTaskForce({ task_id: selectedTask.id, tf_id: value }));
            }}
            options={[
              { value: "", label: "＋ タスクフォースを追加..." },
              ...taskForcesForPicker
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

      {/* フッター：削除
          【v3.91】高さを明示heightで固定する（src/lib/layout/bottomStack.tsのSIDE_PANEL_FOOTER_HEIGHT_PX）。
          FABの通常位置（同モジュールのFAB_BOTTOM_PC_PX）はこの高さを避けるように算出されているため、
          padding・ボタンサイズを変える場合はこの定数も一緒に見直すこと。 */}
      <div style={{
        height: `${SIDE_PANEL_FOOTER_HEIGHT_PX}px`,
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
        {/* 保存ボタン：常時表示。役割の整理＝このボタンは「押せるか（dirty）」「保存中か」の
            状態のみを担い、「保存しました／失敗しました」の結果表示はヘッダーのSaveIndicator
            に任せる。
            【v3.93：未変更時の見せ方を「押せない禁止ボタン」から「保存済み」に変更】
            以前は cursor:"not-allowed" ＋ title「変更はありません」で表現していたが、これが
            クレーム「内容を変更したのに保存ボタンに🚫が出て押せない」＝壊れている、という
            誤解の一因だった（実際は「変更が無いので押す必要が無い」だけの正常な状態）。
            禁止の意味を持つ🚫カーソルをやめ、「今は保存済みです」という現在状態の表示に変える。 */}
        <button
          onClick={() => void handleSave()}
          disabled={!isDirty || saveStatus === "saving"}
          title={
            saveStatus === "saving" ? undefined
            : !isDirty ? "保存済みです。変更するとこのボタンが押せるようになります。"
            : undefined
          }
          style={{
            padding: "4px 14px", fontSize: "10px", fontWeight: "600",
            border: "none", borderRadius: "var(--radius-md)",
            background: (!isDirty || saveStatus === "saving") ? "var(--color-bg-tertiary)" : "var(--color-brand)",
            color: (!isDirty || saveStatus === "saving") ? "var(--color-text-tertiary)" : "#fff",
            cursor: saveStatus === "saving" ? "wait" : !isDirty ? "default" : "pointer",
            opacity: (!isDirty || saveStatus === "saving") ? 0.55 : 1,
          }}
        >
          {saveStatus === "saving" ? "保存中…" : !isDirty ? "✓ 保存済み" : "保存"}
        </button>
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

// v3.87：役割の整理。「保存中」はフッターの保存ボタン自身のラベル（「保存中…」）＋disabledが
// 担うため、ここでは重複表示しない（idle・savingは何も出さない）。このインジケータは
// 「保存しました」「保存に失敗しました」という“結果”の伝達だけに専念する。
function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle" || status === "saving") return null;
  const styles: Record<"saved" | "error", { bg: string; color: string; label: string }> = {
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

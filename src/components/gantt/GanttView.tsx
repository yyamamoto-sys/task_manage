// src/components/gantt/GanttView.tsx
//
// 【設計意図】
// ガントビュー。PJバー＋タスクバーの2層構造。
// - 横軸：日付（週単位で表示、日単位でスクロール）
// - 縦軸：PJ → タスク（PJをトグルで開閉可能）
// - 今日線：赤い縦線を常時表示
// - マイルストーン：◆で表示
// - ドラッグによる日程変更は将来実装（現時点はクリックで編集ダイアログ）

import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useAppStore, selectScopedTasks, selectScopedTaskDependencies } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo, Milestone } from "../../lib/localData/types";
import { toDate, toDateStr, addDays, diffDays, formatYM, getDaysInRange, formatDateRangeWithWeekday, formatMDWithWeekday } from "../../lib/date";
import { isHoliday } from "../../lib/date/holidays";
import { v4 as uuidv4 } from "uuid";
import { KEYS, active } from "../../lib/localData/localStore";
import { TaskEditModal } from "../task/TaskEditModal";
import { MilestoneEditModal } from "../milestone/MilestoneEditModal";
import { TaskSidePanel } from "../task/TaskSidePanel";
import { isAssignedTo, suppressOverdue, isCompletedForProgress } from "../../lib/taskMeta";
import { EmptyState } from "../common/EmptyState";
import { showToast } from "../common/Toast";
import {
  DAY_WIDTH_DEFAULT, ZOOM_LEVELS, STAGNANT_THRESHOLD_DAYS,
  TODO_COLOR, MS_COLOR, MS_BORDER, CRITICAL_COLOR, OVERLOAD_COLOR,
  GANTT_LABEL_HEADER_HEIGHT, GANTT_HEADER_MONTH_HEIGHT, GANTT_HEADER_WEEK_HEIGHT, GANTT_HEADER_DAY_TICK_HEIGHT,
  QUICK_ADD_ROW_HEIGHT,
  type GanttSortOrder, isTaskStagnant, calcTaskBar,
  calcGhostBar, computeDelayDays, formatDelayLabel,
  computeWeekBlocks, applyResizePreview, clampStartDate, computeMoveShift, type ResizePreview,
  computeWeekGridLines, computeMilestoneBands, overloadRangesToBands,
  computeDayTicks, dayTickColor,
  clampZoom, computeVisibleOrderedTaskIds, computeRangeSelection,
  xToDate, computeDragCreateRange,
} from "./ganttUtils";
import { TaskBarRow, GanttPjLabelRow, GanttTodoLabelRow, GanttPersonLabelRow, GanttQuickAddTaskRow, ZoomIcon, type TaskBarLinkUi } from "./GanttParts";
import { GanttMobileView } from "./GanttMobileView";
import { ShortcutsPanel } from "../common/ShortcutsPanel";
import {
  computeDependencyRenders, pointsToPathD,
  type TaskRect, type DependencyArrowGeometry, type DependencyBadgeInfo,
} from "./ganttDependencyArrows";
import { resolveLinkDirection, type LinkSide } from "../../lib/dependencies/linkDirection";
import { canAddDependency } from "../../lib/dependencies/cycleCheck";
import { orderSiblingsWithDependencies, applyDependencyOrderWithinSiblings, filterHideCompletedTasks, buildProgressFractionMap } from "../../lib/taskHierarchy";
import { computeCriticalTaskIds } from "../../lib/gantt/criticalPath";
import { computeOverloadRanges } from "../../lib/gantt/overload";
import { getMemberActiveTasks } from "../../lib/workload/computeWorkload";
import { useTaskDragReorder } from "../../hooks/useTaskDragReorder";
import { computeDropZoneFromRatio, computeInsertAfterOrder } from "../../lib/dragReorder";

const headerBtnStyle: React.CSSProperties = {
  padding: "4px 10px", fontSize: "11px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  selectedKrId?: string | null;
  krTaskIds?: Set<string> | null;
  /** プレビューモード：指定された場合はAppDataContextのtasksの代わりにこれを使う */
  previewTasks?: Task[];
  /** プレビューモード：trueの場合はヘッダーにラベルを表示し、タスク編集モーダルを無効化する */
  isPreview?: boolean;
  /** プレビューモード：変更されたタスクIDのセット（ハイライト表示） */
  previewChangedTaskIds?: Set<string>;
  /** サイドバーの「自分」トグル ON のとき true。自分が担当のタスクのみ表示 */
  mineOnly?: boolean;
  /**
   * キーボードショートカット（T/+-/Ctrl+A/Enter）を有効にするか。既定 true。
   * AI相談のガントプレビュー（GanttPreviewPanel）は1画面に2つの GanttView を同時に
   * オーバーレイ表示するため、明示的に false を渡してどちらのキー操作も奪わないようにする。
   */
  enableKeyboardShortcuts?: boolean;
  /**
   * ショートカット一覧パネル（全ビュー共通・MainLayoutが1つだけ管理）の開閉を親から制御する場合に渡す。
   * 渡された場合、凡例バーの「⌨ショートカット」リンクはこの2つを使い、パネル自体は自前で描画しない
   * （MainLayout側の共通パネルが表示を担う）。渡されない場合（GanttPreviewPanelでの2画面同時表示など）
   * は従来どおり内部stateで完結し、このコンポーネント自身がパネルを描画する。
   */
  shortcutsOpen?: boolean;
  onToggleShortcuts?: () => void;
}

// ===== メインコンポーネント =====

export function GanttView({
  currentUser,
  selectedProject,
  projects,
  selectedKrId: _selectedKrId,
  krTaskIds,
  previewTasks,
  isPreview = false,
  previewChangedTaskIds,
  mineOnly = false,
  enableKeyboardShortcuts = true,
  shortcutsOpen: shortcutsOpenProp,
  onToggleShortcuts,
}: Props) {
  // 【Phase 3 移行済み】個別 selector で必要な state のみを購読する。
  const rawTasks      = useAppStore(selectScopedTasks);
  const rawMembers    = useAppStore(s => s.members);
  const rawTodos      = useAppStore(s => s.todos);
  const rawMilestones = useAppStore(s => s.milestones);
  const saveTask      = useAppStore(s => s.saveTask);
  const bulkShiftTasks = useAppStore(s => s.bulkShiftTasks);
  const saveProject   = useAppStore(s => s.saveProject);
  // 兄弟タスクの依存関係順ソート（orderTasksHierarchically 等）に使う。B2の矢印描画（下記 logicalDeps）
  // より前で必要なため、purposely ここで先に取得する
  const scopedTaskDependencies = useAppStore(selectScopedTaskDependencies);
  const milestones = useMemo(
    () => (rawMilestones ?? []).filter((ms: Milestone) => !ms.is_deleted),
    [rawMilestones],
  );
  const isMobile = useIsMobile();
  // ===== ショートカット一覧ポップアップ（凡例バー右端「⌨ ショートカット」） =====
  // 【設計意図】非モーダル・✕のみで閉じる・自動表示なしの3点が要件。セッション内state
  // のみで良く（既定=閉じ）、localStorage永続化は不要（「開いたままにしない」を優先）。
  // Escapeは既存の選択解除／結線キャンセルとバインドが競合するため絶対に使わない。
  // shortcutsOpen/onToggleShortcuts が親（MainLayout）から渡されたら、開閉状態は全ビュー共通の
  // 親側stateに委譲し、このコンポーネント自身はパネルを描画しない（MainLayoutが1つだけ描画する）。
  // 渡されない場合（GanttPreviewPanelでの2画面同時表示）は従来どおり内部で完結する。
  const isShortcutsControlled = onToggleShortcuts !== undefined;
  const [internalShortcutsOpen, setInternalShortcutsOpen] = useState(false);
  const showShortcutsPanel = isShortcutsControlled ? !!shortcutsOpenProp : internalShortcutsOpen;
  const toggleShortcutsPanel = useCallback(() => {
    if (onToggleShortcuts) onToggleShortcuts();
    else setInternalShortcutsOpen(prev => !prev);
  }, [onToggleShortcuts]);
  const closeShortcutsPanel = useCallback(() => setInternalShortcutsOpen(false), []);
  // ===== 完了タスクを隠す（🙈トグル） =====
  // B2「🔗依存」・B4「▤ベースライン」と同じ流儀（localStorage で状態保持）。
  const [hideCompletedTasks, setHideCompletedTasks] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.GANTT_HIDE_DONE) === "1"; } catch { return false; }
  });
  const toggleHideCompletedTasks = useCallback(() => {
    setHideCompletedTasks(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.GANTT_HIDE_DONE, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ===== 複数選択（Ctrl/Cmd+クリック）＋一括シフト =====
  //
  // 【設計意図】選択はタスクidベース（人別ビュー等で同一タスクが複数行に出ても id 単位で扱う）。
  // Ctrl/Cmd+クリックでトグル、修飾キー無しの通常クリックは詳細を開く＋選択クリア、空白クリック・
  // Escapeでも選択クリア。選択中のバーの中央をドラッグすると選択中の全タスクが一緒にシフトする
  // （バー中央ドラッグ単体移動 = handleMoveDragStart の bulkTargets 拡張。詳細は下記）。
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  // Shift+クリック範囲選択のアンカー（直近に単一クリック／Ctrl+クリックしたタスク）。
  // レンダーを介す必要が無いため ref で持つ。選択が丸ごとクリアされる操作（背景クリック・Escape・
  // 通常クリックでの選択クリア）では必ずアンカーも一緒にリセットする（clearTaskSelection に集約）。
  const selectionAnchorRef = useRef<string | null>(null);
  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const n = new Set(prev);
      if (n.has(taskId)) n.delete(taskId); else n.add(taskId);
      return n;
    });
  }, []);
  const clearTaskSelection = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectedTaskIds(prev => (prev.size === 0 ? prev : new Set()));
  }, []);
  // Escapeで選択クリア。選択が空のときはリスナーを貼らない（他機能のEscape処理と競合しないよう最小限に）
  useEffect(() => {
    if (selectedTaskIds.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") clearTaskSelection(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTaskIds.size, clearTaskSelection]);
  // 空白（バー以外）クリックで選択クリア。data-task-id を持つ要素上でのクリックは対象外
  // （そちらは guardedHandleRowEdit 側で選択トグル or 選択クリア+詳細表示を担う）
  const handleGanttBodyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-task-id]")) return;
    clearTaskSelection();
  }, [clearTaskSelection]);

  // previewTasksが指定されている場合はそちらを優先する。KRフィルタが有効な場合はさらに絞り込む
  // mineOnly が true なら担当者=自分のタスクだけにする（サイドバーの「自分」トグル由来）
  // 完了を隠すフィルタ（hideCompletedTasks）は mineOnly と併用でき、必ず並べ替え・グルーピング
  // （orderTasksHierarchically・personGroups・todoGroups 等、すべて allTasks から派生）より前段
  // で効かせる。単純な status==="done" 除外ではなく filterHideCompletedTasks（親子ロールアップ
  // 考慮）を使うことで、未完了の子を持つ親タスクは残る（CLAUDE.md参照）。
  const allTasks = useMemo(() => {
    const base = previewTasks
      ? active(previewTasks)
      : active(rawTasks);
    let list = krTaskIds ? base.filter(t => krTaskIds.has(t.id)) : base;
    if (mineOnly) list = list.filter(t => isAssignedTo(t, currentUser.id));
    if (hideCompletedTasks) list = filterHideCompletedTasks(list);
    return list;
  }, [previewTasks, rawTasks, krTaskIds, mineOnly, currentUser.id, hideCompletedTasks]);
  const members  = useMemo(() => active(rawMembers), [rawMembers]);
  const todos    = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  // ホットループ用：タスク行ごとの find を回避するため id→entity の Map を一度だけ作る
  const memberById  = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const taskById    = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);

  // 表示するPJを絞り込む（毎レンダーで新配列を作らないよう useMemo 化）
  const visibleProjects = useMemo(
    () => selectedProject ? [selectedProject] : projects,
    [selectedProject, projects]
  );

  // project_id=null のToDo系タスクをToDo単位でグループ化（selectedProject未選択時のみ表示）
  const todoGroups = useMemo(() => {
    if (selectedProject) return [];
    const noPjTasks = allTasks.filter(t => t.project_id == null && (t.todo_ids ?? []).length > 0);
    const map = new Map<string, Task[]>();
    noPjTasks.forEach(t => {
      const primaryId = t.todo_ids[0];
      if (!map.has(primaryId)) map.set(primaryId, []);
      map.get(primaryId)!.push(t);
    });
    return [...map.entries()].map(([todoId, tasks]) => ({
      todo: todos.find(td => td.id === todoId),
      todoId,
      tasks,
    })).filter((g): g is { todo: NonNullable<typeof g.todo>; todoId: string; tasks: Task[] } => g.todo != null);
  }, [selectedProject, allTasks, todos]);

  // 全体の日付範囲を計算（PJとタスクの最も早い開始〜最も遅い終了）
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let minD = addDays(today, -14);
    let maxD = addDays(today, 90);

    for (const pj of visibleProjects) {
      const s = toDate(pj.start_date);
      const e = toDate(pj.end_date);
      if (s && s < minD) minD = new Date(s);
      if (e && e > maxD) maxD = new Date(e);
    }
    for (const task of allTasks) {
      const s = toDate(task.start_date ?? null);
      const e = toDate(task.due_date);
      if (s && s < minD) minD = new Date(s);
      if (e && e < minD) minD = new Date(e);
      if (e && e > maxD) maxD = new Date(e);
    }
    for (const ms of milestones) {
      const s = toDate(ms.date);
      if (s && s < minD) minD = new Date(s);
      if (s && s > maxD) maxD = new Date(s);
    }
    // 前後に余白
    return { rangeStart: addDays(minD, -7), rangeEnd: addDays(maxD, 14) };
  }, [visibleProjects, allTasks, milestones]);

  const days = useMemo(
    () => getDaysInRange(rangeStart, rangeEnd),
    [rangeStart, rangeEnd]
  );

  // ズームレベル（dayWidth）— totalWidth/todayX より前に宣言が必要
  const [dayWidth, setDayWidth] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem(KEYS.GANTT_ZOOM) ?? "", 10);
      return (ZOOM_LEVELS as readonly number[]).includes(saved) ? saved : DAY_WIDTH_DEFAULT;
    } catch { return DAY_WIDTH_DEFAULT; }
  });

  const totalWidth = days.length * dayWidth;

  // 今日のx座標（マウント時に固定。毎レンダーで new Date() しない）
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ===== グリッド描画の最適化 =====
  // 土日背景色を CSS repeating-linear-gradient で描画する（days.map の全日 div を廃止）。
  // 1週間（7日）を1周期として、日曜=赤/土曜=青/平日=透明 のパターンを繰り返す。
  // bgOffsetX で rangeStart の曜日に合わせてパターンをシフトする。
  const weekPeriod = 7 * dayWidth;
  const bgOffsetX  = (7 - rangeStart.getDay()) % 7 * dayWidth;
  const weekendGradient = [
    `linear-gradient(to right,`,
    `  rgba(239,68,68,0.05) 0px, rgba(239,68,68,0.05) ${dayWidth}px,`,
    `  transparent ${dayWidth}px, transparent ${6 * dayWidth}px,`,
    `  rgba(59,130,246,0.05) ${6 * dayWidth}px, rgba(59,130,246,0.05) ${7 * dayWidth}px`,
    `)`,
  ].join(" ");

  // 境界線が必要な日（月初・月曜）のみ div を残す（365 → 約65/年）
  const borderDays = useMemo(
    () => days.filter(d => d.getDate() === 1 || d.getDay() === 1),
    [days]
  );

  const todayX = diffDays(rangeStart, today) * dayWidth;

  // 週ラベル（月内日数ブロック方式：8月W1〜W5）。日単位の日付数字行を置き換える。
  // ズームレベルに関わらずブロック数は月あたり4〜5個で一定のため、旧labelDaysのような
  // ズーム閾値によるDOM間引きは不要
  const weekBlocks = useMemo(() => computeWeekBlocks(days, dayWidth), [days, dayWidth]);
  // 週コラムの淡いグリッド線のx座標（月初＝W1はborderDays側の太い境界線と重複するため対象外）
  const weekGridLines = useMemo(() => computeWeekGridLines(weekBlocks), [weekBlocks]);
  // ものさし目盛り行（週ラベルの直下・1日ごと）。days/dayWidthが変わらない限り再計算しない
  const dayTicks = useMemo(() => computeDayTicks(days, dayWidth, isHoliday), [days, dayWidth]);

  // タスク編集モーダル
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // PJ名インライン編集
  const [editingPjNameId, setEditingPjNameId] = useState<string | null>(null);
  const [editingPjNameValue, setEditingPjNameValue] = useState("");
  const handleSavePjName = useCallback(async (pj: Project) => {
    const newName = editingPjNameValue.trim();
    if (newName && newName !== pj.name) {
      await saveProject({ ...pj, name: newName, updated_by: currentUser.id });
    }
    setEditingPjNameId(null);
  }, [editingPjNameValue, saveProject, currentUser.id]);

  // マイルストーンホバーツールチップ
  const [hoveredMs, setHoveredMs] = useState<{ ms: Milestone; rect: DOMRect } | null>(null);
  // ◆クリックで開くマイルストーン編集モーダル（プレビュー時は無効）
  const [editingMs, setEditingMs] = useState<Milestone | null>(null);

  // タスクの並び順
  const [sortOrder, setSortOrder] = useState<GanttSortOrder>(
    () => (localStorage.getItem(KEYS.GANTT_SORT) as GanttSortOrder | null) ?? "date"
  );
  const changeSortOrder = useCallback((s: GanttSortOrder) => {
    localStorage.setItem(KEYS.GANTT_SORT, s);
    setSortOrder(s);
  }, []);
  const sortTasks = useCallback((tasks: Task[]): Task[] => {
    if (sortOrder === "name") {
      return [...tasks].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }
    // 期日順：start_date → due_date の早い方を基準。日付なしは末尾
    return [...tasks].sort((a, b) => {
      const da = toDate(a.start_date ?? null) ?? toDate(a.due_date);
      const db = toDate(b.start_date ?? null) ?? toDate(b.due_date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  }, [sortOrder]);

  // 親子（PJ>大>小）を「親→その子」の順に並べ、各行の depth と子件数を付与する。
  // ラベル列とバー列の両方でこれを使うことで、子タスクを親の直下にインデント表示しつつ
  // 2つのループの行順・行数を完全一致させる（ずれ防止）。親がこの集合に居ない子は最上位扱い。
  // 子（同じ親を共有する兄弟）の並びは、依存関係が張られていれば依存順（先行→後続）が
  // 日付/名前ソートより優先される（orderSiblingsWithDependencies。表示のみの非破壊処理・
  // 依存が無いペアは sortTasks の並びをそのまま保つ）。トップレベルの並びは変えない。
  const orderTasksHierarchically = useCallback((tasks: Task[]): { task: Task; depth: number; childCount: number }[] => {
    const ids = new Set(tasks.map(t => t.id));
    const childrenByParent = new Map<string, Task[]>();
    const tops: Task[] = [];
    for (const t of tasks) {
      if (t.parent_task_id && ids.has(t.parent_task_id)) {
        const arr = childrenByParent.get(t.parent_task_id) ?? [];
        arr.push(t);
        childrenByParent.set(t.parent_task_id, arr);
      } else {
        tops.push(t);
      }
    }
    const result: { task: Task; depth: number; childCount: number }[] = [];
    for (const top of sortTasks(tops)) {
      const kids = childrenByParent.get(top.id) ?? [];
      result.push({ task: top, depth: 0, childCount: kids.length });
      for (const c of orderSiblingsWithDependencies(sortTasks(kids), scopedTaskDependencies)) {
        result.push({ task: c, depth: 1, childCount: 0 });
      }
    }
    return result;
  }, [sortTasks, scopedTaskDependencies]);

  // 各親タスクの実効期間：子タスクの最早 start_date〜最遅 due_date を計算する。
  // ガントのバー描画でこれを使い、親バーが常に子の範囲を包むように表示する（DB は変更しない）。
  // 旧実装は親ごとに allTasks.filter を呼ぶ O(n²)。
  // ここでは 1パス目で子を親ID別 Map に集め、2パス目で min/max を算出する O(n) に改善。
  const parentEffectiveDates = useMemo(() => {
    // 1パス目：子タスクを親ID別にグループ化
    const childrenByParent = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parent_task_id) continue;
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      childrenByParent.set(t.parent_task_id, arr);
    }
    // 2パス目：親ごとに最早 start / 最遅 due を算出
    const map = new Map<string, { start_date: string | undefined; due_date: string | undefined }>();
    for (const [parentId, children] of childrenByParent) {
      const starts = children.map(c => c.start_date).filter((s): s is string => !!s);
      const dues   = children.map(c => c.due_date).filter((d): d is string => !!d);
      map.set(parentId, {
        start_date: starts.length > 0 ? [...starts].sort()[0] : undefined,
        due_date:   dues.length   > 0 ? [...dues].sort()[dues.length - 1] : undefined,
      });
    }
    return map;
  }, [allTasks]);

  // タスクごとの進捗率（0〜1）：親=子からのロールアップ・葉=ステータス由来（taskHierarchy.ts参照）。
  // バー内の進捗フィルは常時表示（トグルなし）。O(n)の一括版を使う（行ごとに個別関数を呼ぶとO(n²)）
  const progressFractionMap = useMemo(() => buildProgressFractionMap(allTasks), [allTasks]);

  // PJごとの階層順タスクリスト（ラベル列・バー列の両方で共有）
  // 以前はラベル列・バー列それぞれで orderTasksHierarchically を呼んでいたが、
  // ここで一度計算して Map に持つことで二重計算を解消する。
  const pjOrderedTasksMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof orderTasksHierarchically>>();
    for (const pj of visibleProjects) {
      map.set(pj.id, orderTasksHierarchically(allTasks.filter(t => t.project_id === pj.id)));
    }
    return map;
  }, [visibleProjects, allTasks, orderTasksHierarchically]);

  // taskId → そのタスクが属するPJの「今表示されている順」のタスク配列（D&D並べ替えの基準。
  // useTaskDragReorder に渡す visibleTasks を、ドロップ先のtaskIdからO(1)で引けるようにする）
  const taskIdToPjVisibleTasks = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const pj of visibleProjects) {
      const list = (pjOrderedTasksMap.get(pj.id) ?? []).map(r => r.task);
      for (const t of list) map.set(t.id, list);
    }
    return map;
  }, [visibleProjects, pjOrderedTasksMap]);

  // ToDoグループごとのソート済みタスク（ラベル列・バー列の両方で共有。pjOrderedTasksMapと同じ理由で
  // 二重計算を避ける）。同じ親を共有するタスク同士は依存関係順を優先する
  // （applyDependencyOrderWithinSiblings＝親を持たないタスクの位置は変えない）
  const todoGroupSortedMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const g of todoGroups) {
      map.set(g.todoId, applyDependencyOrderWithinSiblings(sortTasks(g.tasks), scopedTaskDependencies));
    }
    return map;
  }, [todoGroups, sortTasks, scopedTaskDependencies]);

  // 子を持つ親タスクIDの一覧（全折りたたみ/全展開の対象）
  const parentTaskIds = useMemo(() => {
    const childParentIds = new Set(
      allTasks.filter(t => t.parent_task_id).map(t => t.parent_task_id!)
    );
    return allTasks.filter(t => childParentIds.has(t.id)).map(t => t.id);
  }, [allTasks]);

  // PJの開閉状態（キー：PJ ID / ToDo ID / 担当者 ID / 親タスク ID）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // useCallback で参照を固定する（行コンポーネントの React.memo を効かせるため）
  const togglePJ = useCallback((id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] })), []);

  // ビューモード（PJ別 / 人別）
  const [viewMode, setViewMode] = useState<"pj" | "person">("pj");

  // 人別ビュー用データ：担当者ごとにタスクをグループ化。
  // 同じ親を共有するタスク同士が同じ担当者一覧に並ぶ場合は、依存関係順を優先する
  // （applyDependencyOrderWithinSiblings＝親を持たないタスクの位置は変えない）。
  const personGroups = useMemo(() => {
    return members
      .map(m => {
        const tasks = applyDependencyOrderWithinSiblings(
          sortTasks(allTasks.filter(t => isAssignedTo(t, m.id))),
          scopedTaskDependencies,
        );
        return { member: m, tasks };
      })
      .filter(g => g.tasks.length > 0);
  }, [members, allTasks, sortTasks, scopedTaskDependencies]);

  // 現在の表示順（折りたたみ・ビューモード反映後）に並んだタスクidの配列。Ctrl/Cmd+A（表示中の
  // 全選択）とShift+クリック（範囲選択）が共有する（computeVisibleOrderedTaskIds＝純粋関数、
  // 上のJSXレンダー順と対応させるためここで組み立てる）。
  const visibleOrderedTaskIds = useMemo(() => computeVisibleOrderedTaskIds({
    viewMode, collapsed,
    personGroups: personGroups.map(g => ({ memberId: g.member.id, taskIds: g.tasks.map(t => t.id) })),
    pjGroups: visibleProjects.map(pj => ({
      pjId: pj.id,
      rows: (pjOrderedTasksMap.get(pj.id) ?? []).map(r => ({
        taskId: r.task.id, depth: r.depth, parentTaskId: r.task.parent_task_id ?? null,
      })),
    })),
    todoGroups: todoGroups.map(g => ({
      todoId: g.todoId,
      taskIds: (todoGroupSortedMap.get(g.todoId) ?? sortTasks(g.tasks)).map(t => t.id),
    })),
  }), [viewMode, collapsed, personGroups, visibleProjects, pjOrderedTasksMap, todoGroups, todoGroupSortedMap, sortTasks]);

  // 全開・全閉（PJ / ToDo グループ / 人別グループすべて対象）
  const expandAll  = () => setCollapsed({});
  const collapseAll = () => {
    const m: Record<string, boolean> = {};
    visibleProjects.forEach(p => { m[p.id] = true; });
    todoGroups.forEach(g => { m[`todo_${g.todoId}`] = true; });
    members.forEach(mem => { m[`person_${mem.id}`] = true; });
    setCollapsed(m);
  };

  // 親タスクレベルの全折りたたみ/全展開
  const allParentsCollapsed = parentTaskIds.length > 0 && parentTaskIds.every(id => collapsed[id]);
  const toggleAllParents = () => {
    setCollapsed(prev => {
      const next = { ...prev };
      if (allParentsCollapsed) {
        parentTaskIds.forEach(id => delete next[id]);
      } else {
        parentTaskIds.forEach(id => { next[id] = true; });
      }
      return next;
    });
  };

  // スクロール位置の永続化（中心日付をlocalStorageに保存）
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollInitialized = useRef(false);
  const labelBodyRef    = useRef<HTMLDivElement>(null);
  const syncingRef      = useRef(false);

  // 初回マウント時のみ実行：いつ開いても今日を画面中央に表示する（前回のスクロール位置は復元しない）
  useEffect(() => {
    if (!scrollRef.current || scrollInitialized.current || days.length === 0) return;
    scrollInitialized.current = true;
    scrollRef.current.scrollLeft = Math.max(0, todayX - scrollRef.current.clientWidth / 2);
  }, [days, todayX]);

  // プロジェクト切替時：表示を「今日中心」にリセットする。
  // （切替前のスクロール位置が残って遠い期間が見えてしまうのを防ぐ。
  //   一番見たいのは今日周辺なので、切り替えたら今日を画面中央に戻す）
  const prevPjKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const pjKey = selectedProject?.id ?? null;
    // 初回はマウント時のスクロール初期化に任せてスキップ
    if (prevPjKeyRef.current === undefined) { prevPjKeyRef.current = pjKey; return; }
    if (prevPjKeyRef.current === pjKey) return;
    prevPjKeyRef.current = pjKey;
    if (scrollRef.current && days.length > 0) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - scrollRef.current.clientWidth / 2);
    }
  }, [selectedProject?.id, days.length, todayX]);

  const handleGanttScroll = useCallback(() => {
    // 縦スクロールをラベル列と同期（横スクロール位置は保存しない＝毎回今日中心で開く）
    if (!syncingRef.current && labelBodyRef.current && scrollRef.current) {
      syncingRef.current = true;
      labelBodyRef.current.scrollTop = scrollRef.current.scrollTop;
      syncingRef.current = false;
    }
  }, []);

  const handleLabelScroll = useCallback(() => {
    if (!syncingRef.current && scrollRef.current && labelBodyRef.current) {
      syncingRef.current = true;
      scrollRef.current.scrollTop = labelBodyRef.current.scrollTop;
      syncingRef.current = false;
    }
  }, []);

  // 月ラベルの生成（日付配列から月の境界を取得）
  const monthGroups = useMemo(() => {
    const groups: { label: string; startX: number; width: number }[] = [];
    let curMonth = "";
    let startIdx = 0;
    days.forEach((d, i) => {
      const m = `${d.getFullYear()}-${d.getMonth()}`;
      if (m !== curMonth) {
        if (curMonth !== "") {
          groups.push({
            label: formatYM(days[startIdx]),
            startX: startIdx * dayWidth,
            width: (i - startIdx) * dayWidth,
          });
        }
        curMonth = m;
        startIdx = i;
      }
    });
    groups.push({
      label: formatYM(days[startIdx]),
      startX: startIdx * dayWidth,
      width: (days.length - startIdx) * dayWidth,
    });
    return groups;
  }, [days, dayWidth]);

  const prevDayWidthRef = useRef(dayWidth);

  const zoomIn = useCallback(() => {
    setDayWidth(cur => {
      const next = clampZoom(cur, "in");
      if (next !== cur) localStorage.setItem(KEYS.GANTT_ZOOM, String(next));
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setDayWidth(cur => {
      const next = clampZoom(cur, "out");
      if (next !== cur) localStorage.setItem(KEYS.GANTT_ZOOM, String(next));
      return next;
    });
  }, []);

  // ズーム変更時：画面中央の日付を維持してスクロール位置を補正
  useEffect(() => {
    if (!scrollRef.current || !scrollInitialized.current) return;
    if (prevDayWidthRef.current === dayWidth) return;
    const el = scrollRef.current;
    const centerIdx = Math.floor((el.scrollLeft + el.clientWidth / 2) / prevDayWidthRef.current);
    el.scrollLeft = Math.max(0, centerIdx * dayWidth - el.clientWidth / 2);
    prevDayWidthRef.current = dayWidth;
  }, [dayWidth]);

  const [labelWidth, setLabelWidth] = useState(() => {
    if (isMobile) return 110;
    try { return parseInt(localStorage.getItem(KEYS.GANTT_LABEL_WIDTH) ?? "200", 10) || 200; } catch { return 200; }
  });
  const labelWidthRef     = useRef(labelWidth);
  const isDraggingW       = useRef(false);
  const dragStartX        = useRef(0);
  const dragStartW        = useRef(0);
  const [isResizing,        setIsResizing       ] = useState(false);
  const [isDividerHovered,  setIsDividerHovered ] = useState(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingW.current = true;
    dragStartX.current  = e.clientX;
    dragStartW.current  = labelWidthRef.current;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingW.current) return;
      const w = Math.max(100, Math.min(500, dragStartW.current + e.clientX - dragStartX.current));
      labelWidthRef.current = w;
      setLabelWidth(w);
    };
    const onUp = () => {
      if (!isDraggingW.current) return;
      isDraggingW.current = false;
      setIsResizing(false);
      try { localStorage.setItem(KEYS.GANTT_LABEL_WIDTH, String(labelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  // 行コンポーネント（TaskBarRow/GanttXxxLabelRow）に渡すコールバックは
  // useCallback で参照を固定する。無関係な hover の変化で全行が再レンダリングされるのを防ぐため。
  const handleRowEdit = useCallback((taskId: string) => setEditingTaskId(taskId), []);
  const handleRowHoverEnter = useCallback((taskId: string) => setHoveredTaskId(taskId), []);
  const handleRowHoverLeave = useCallback(() => setHoveredTaskId(null), []);
  const handleSaveRowAssignees = useCallback((task: Task, ids: string[]) => {
    saveTask({ ...task, assignee_member_ids: ids });
  }, [saveTask]);
  // ラベル列のインライン編集（タスク名）。保存は必ず saveTask 経由
  // （B1依存ゲート・B3自動リスケ連鎖・B4ベースライン凍結がこの1箇所で自動的に効く）。
  // 【v3.04】開始日・期日のラベル列インライン入力（v3.01）は撤去した（タスク名がホバーのたびに
  // 隠れて読めなくなるとの指摘）。日付編集はバーのドラッグ（リサイズ／移動／新規期間作成）と
  // タスク詳細パネルに一本化する（CLAUDE.md v3.04 changelog参照）
  const handleSaveRowName = useCallback((task: Task, name: string) => {
    saveTask({ ...task, name });
  }, [saveTask]);

  // ===== PJ別ビュー・ラベル列末尾の簡易タスク追加（名前のみ。CLAUDE.md v3.04） =====
  // 日付・担当者等はここでは設定しない（追ってドラッグでの期間設定・詳細パネルで追加する想定）。
  // group_id は saveTask 側が現在の部署から自動注入するため、ここでは渡さない。
  const handleQuickAddTask = useCallback(async (projectId: string, name: string) => {
    const now = new Date().toISOString();
    const siblings = allTasks.filter(t => (t.project_id ?? null) === projectId && !t.parent_task_id);
    const nextOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(t => t.display_order ?? 0)) + 1;
    const task: Task = {
      id: uuidv4(),
      name,
      project_id: projectId,
      parent_task_id: null,
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
    await saveTask(task);
  }, [allTasks, saveTask, currentUser.id]);

  // ===== タスク行間への挿入（＋オーバーレイ。CLAUDE.md v3.06。PJ別ビューのみ） =====
  // ホバー中タスク（アンカー）と同じ階層（同じparent_task_id・同じproject_id）に新タスクを
  // 作成し、display_orderをアンカーの直後に配置する。既存の兄弟はcomputeInsertAfterOrder
  // （src/lib/dragReorder.ts。ドラッグ並べ替えのcomputeSiblingReorderIdsと対になる純粋関数）で
  // 0..nに振り直し、変わった分だけsaveTaskする。名前は空だとInlineEditTextの仕様上
  // 保存できず行が空白のまま可視性が消えるリスクがあるため「新しいタスク」で作成し、直後に
  // autoEditTaskIdをセットしてInlineEditTextをautoEdit（マウント時に全選択）状態で開く
  // ＝そのまま上書き入力できるようにする。
  const [autoEditTaskId, setAutoEditTaskId] = useState<string | null>(null);
  const handleInsertTaskAfter = useCallback(async (anchor: Task) => {
    const now = new Date().toISOString();
    const newTask: Task = {
      id: uuidv4(),
      name: "新しいタスク",
      project_id: anchor.project_id ?? null,
      parent_task_id: anchor.parent_task_id ?? null,
      display_order: 0,
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
    const ids = computeInsertAfterOrder(allTasks, anchor.id, newTask.id);
    if (!ids) {
      await saveTask(newTask);
    } else {
      await Promise.all(ids.map((id, idx) => {
        if (id === newTask.id) return saveTask({ ...newTask, display_order: idx });
        const t = allTasks.find(x => x.id === id);
        if (!t || (t.display_order ?? 0) === idx) return Promise.resolve();
        return saveTask({ ...t, display_order: idx, updated_by: currentUser.id });
      }));
    }
    setAutoEditTaskId(newTask.id);
  }, [allTasks, saveTask, currentUser.id]);

  // ===== D&D並べ替え（PJ別ビューのラベル列。依存の無い兄弟同士のみ display_order を書き換える。
  // 依存で縛られたペアは常に依存順が勝つ＝v2.39の仕様どおり、ここでは触らない） =====
  // ListViewと同じ useTaskDragReorder を共有（CLAUDE.md v3.01）。GanttViewには「手動ソート
  // モード」という概念が無いため onReordered は渡さない（並べ替え自体はorderSiblingsWithDependencies
  // が再描画のたびに効くため、切り替えるモードが存在しない）。
  // 【スコープ判断】ListViewにある「PJ見出しへドロップして親を解除する」（handleUnparentDrop）は
  // ガントでは提供しない：ラベル列の幅が狭くPJ名の表示すら14文字で省略している状態のため、
  // ドロップ可能であることを示すヒント文言を置く余白が無い。今回の要望（兄弟の並べ替え）の
  // スコープ外でもあるため、意図的に見送る（親子付け替えが必要な場合はListViewを使う）。
  const {
    draggingId: ganttDraggingId, setDraggingId: setGanttDraggingId,
    dropZone: ganttDropZone, setDropZone: setGanttDropZone,
    handleTaskDrop: ganttHandleTaskDrop,
  } = useTaskDragReorder(allTasks, currentUser.id);
  const handleDragHandleStart = useCallback((taskId: string) => setGanttDraggingId(taskId), [setGanttDraggingId]);
  const handleDragHandleEnd = useCallback(() => { setGanttDraggingId(null); setGanttDropZone(null); }, [setGanttDraggingId, setGanttDropZone]);
  const handleRowDragOver = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    // GanttViewのラベル列は常に allowNest=false（before/afterのみ）。ドロップ先の子にする
    // 操作はGanttでは提供しない（2階層の親子付け替えはListViewに限定するスコープ判断。CLAUDE.md v3.01）
    const zone = computeDropZoneFromRatio(ratio, false) as "before" | "after";
    setGanttDropZone(z => (z && z.id === taskId && z.zone === zone) ? z : { id: taskId, zone });
  }, [setGanttDropZone]);
  const handleRowDragLeave = useCallback((taskId: string) => {
    setGanttDropZone(z => (z?.id === taskId ? null : z));
  }, [setGanttDropZone]);
  const handleRowDrop = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    const zone = ganttDropZone?.id === taskId ? ganttDropZone.zone : null;
    // ドロップ先タスクが属するPJの「今表示されている順」を並べ替えの基準にする
    // （taskIdToPjVisibleTasksはpjOrderedTasksMapから1回だけ構築するO(1)ルックアップ）
    const visibleTasks = taskIdToPjVisibleTasks.get(taskId) ?? allTasks;
    if (ganttDraggingId && zone) ganttHandleTaskDrop(ganttDraggingId, taskId, zone, visibleTasks);
    setGanttDraggingId(null); setGanttDropZone(null);
  }, [ganttDraggingId, ganttDropZone, ganttHandleTaskDrop, setGanttDraggingId, setGanttDropZone, taskIdToPjVisibleTasks, allTasks]);

  // バー端ドラッグによる日付変更（右端＝期日／左端＝開始日）。既存の右端リサイズと対称に実装。
  // 確定は必ず saveTask 経由（B3自動リスケ連鎖・B4ベースライン凍結がこの1箇所で自動的に効く）
  const [draggingResizeTask, setDraggingResizeTask] = useState<{
    taskId: string; edge: "start" | "due"; startX: number; originalDate: string;
    /** edge==="start" のときのみ使用。開始日が期日を超えないようにするためのクランプ対象日 */
    clampAgainst?: string;
  } | null>(null);
  const [resizePreviewDates, setResizePreviewDates] = useState<Record<string, ResizePreview>>({});

  const clearPreviewEdge = useCallback((taskId: string, edge: "start" | "due") => {
    setResizePreviewDates(prev => {
      if (!prev[taskId]) return prev;
      const entry = { ...prev[taskId] };
      delete entry[edge];
      const n = { ...prev };
      if (Object.keys(entry).length === 0) delete n[taskId]; else n[taskId] = entry;
      return n;
    });
  }, []);

  const clearPreviewAll = useCallback((taskId: string) => {
    setResizePreviewDates(prev => {
      if (!prev[taskId]) return prev;
      const n = { ...prev };
      delete n[taskId];
      return n;
    });
  }, []);

  // ===== ドラッグ中の日付ツールチップ（CLAUDE.md v3.04） =====
  // 【設計意図】新規期間作成ドラッグ（②）を最優先に、既存のリサイズ／移動ドラッグにも同じ
  // ツールチップを一貫して出す（狙った日付で的確に操作できるようにする要望）。カーソル位置
  // （clientX/clientY）＋今指している日付ラベルの1状態に集約し、各ドラッグのonMove/onUpで
  // 更新・クリアするだけにする（表示自体は1箇所のfixed要素で担う）。
  const [dragDateTooltip, setDragDateTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const scrollToToday = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, todayX - scrollRef.current.clientWidth / 2);
  }, [todayX]);

  // ===== キーボードショートカット（T=今日／+-=ズーム／Ctrl(Cmd)+A=表示中の全選択／Enter=1件選択時に詳細を開く） =====
  //
  // 【設計意図】ガントビューがマウントされている間だけ（＝MainLayoutでviewMode==="gantt"の間
  // だけGanttViewが条件レンダーされる既存構造）有効にする。加えて以下は明示的にガードする：
  // ①入力中（input/textarea/select/contenteditable にフォーカス）は一切ハイジャックしない
  // （タイピング・ブラウザのテキスト全選択を壊さないため）。②GanttView自身が開いているモーダル
  // 相当（TaskEditModal・TaskSidePanel＝editingTaskId、MilestoneEditModal＝editingMs）が
  // 開いている間は発火しない。③isPreview、またはAI相談のガントプレビュー（GanttPreviewPanelが
  // 1画面に2つのGanttViewを同時オーバーレイ表示する）に埋め込まれた場合は
  // enableKeyboardShortcuts=false で無効化する。④スコープ外の GanttMobileView（isMobile）でも
  // 無効化する（ウィンドウを狭めてisMobile判定になった通常のデスクトップブラウザでも同様）。
  // ⑤Ctrl/Cmd+と組んだ他のブラウザ・アプリのショートカット（ブラウザの拡大縮小=Ctrl++/Ctrl+-等）
  // と衝突しないよう、T・+-・Enterは ctrlKey/metaKey/altKey押下時は反応しない。
  useEffect(() => {
    if (isPreview || !enableKeyboardShortcuts || isMobile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingTaskId || editingMs) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
      if (isTyping) return;
      const hasOtherModifier = e.ctrlKey || e.metaKey || e.altKey;
      if (!hasOtherModifier && (e.key === "t" || e.key === "T")) {
        scrollToToday();
        return;
      }
      if (!hasOtherModifier && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (!hasOtherModifier && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        zoomOut();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelectedTaskIds(new Set(visibleOrderedTaskIds));
        return;
      }
      if (!hasOtherModifier && e.key === "Enter") {
        if (selectedTaskIds.size === 1) {
          const [onlyTaskId] = selectedTaskIds;
          handleRowEdit(onlyTaskId);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isPreview, enableKeyboardShortcuts, isMobile, editingTaskId, editingMs,
    scrollToToday, zoomIn, zoomOut, visibleOrderedTaskIds, selectedTaskIds, handleRowEdit,
  ]);

  // 右端ドラッグ：期日変更
  const handleResizeDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const task = taskById.get(taskId);
    if (!task?.due_date || isPreview) return;
    setDraggingResizeTask({ taskId: task.id, edge: "due", startX: e.clientX, originalDate: task.due_date });
  }, [isPreview, taskById]);

  // 左端ドラッグ：開始日変更。開始日が未設定なら期日を起点にドラッグできる（開始日を新規に作る操作を許容）
  const handleStartResizeDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const task = taskById.get(taskId);
    if (!task?.due_date || isPreview) return;
    setDraggingResizeTask({
      taskId: task.id, edge: "start", startX: e.clientX,
      originalDate: task.start_date ?? task.due_date, clampAgainst: task.due_date,
    });
  }, [isPreview, taskById]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingResizeTask) return;
      const { taskId, edge, startX, originalDate, clampAgainst } = draggingResizeTask;
      const deltaDays = Math.round((e.clientX - startX) / dayWidth);
      const orig = toDate(originalDate);
      if (!orig) return;
      let newDate = toDateStr(addDays(orig, deltaDays));
      if (edge === "start" && clampAgainst) newDate = clampStartDate(newDate, clampAgainst);
      setDragDateTooltip({ x: e.clientX, y: e.clientY, label: formatMDWithWeekday(toDate(newDate)!) });
      if (deltaDays === 0) {
        clearPreviewEdge(taskId, edge);
        return;
      }
      setResizePreviewDates(prev => ({ ...prev, [taskId]: { ...prev[taskId], [edge]: newDate } }));
    };
    const onUp = async (e: MouseEvent) => {
      if (!draggingResizeTask) return;
      const { taskId, edge, startX, originalDate, clampAgainst } = draggingResizeTask;
      const deltaDays = Math.round((e.clientX - startX) / dayWidth);
      setDraggingResizeTask(null);
      setDragDateTooltip(null);
      clearPreviewEdge(taskId, edge);
      if (deltaDays !== 0) {
        const task = allTasks.find(t => t.id === taskId);
        const orig = toDate(originalDate);
        if (task && orig) {
          let newDate = toDateStr(addDays(orig, deltaDays));
          if (edge === "start") {
            if (clampAgainst) newDate = clampStartDate(newDate, clampAgainst);
            await saveTask({ ...task, start_date: newDate });
          } else {
            await saveTask({ ...task, due_date: newDate });
          }
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingResizeTask, dayWidth, allTasks, saveTask, clearPreviewEdge]);

  // バー中央ドラッグ：タスク全体の移動（start_date/due_date を同じ日数だけシフト・duration保持）。
  // 確定は必ず saveTask 経由（右端/左端リサイズと同じ choke point。B3自動リスケ連鎖・B4ベースライン
  // 凍結がここでも自動的に効く）。プレビューは既存の resizePreviewDates をそのまま流用する
  // （move が両端を同時にシフトした {start, due} を書き込むだけで、リサイズと排他利用のため衝突しない）。
  //
  // 複数選択の一括ドラッグ：ドラッグ元のバーが選択中（selectedTaskIds）かつ選択が2件以上のときだけ
  // bulkTargets を持たせる（1件以下・非選択なら単体移動と同じ経路のまま）。プレビューは
  // bulkTargets の全件についてそれぞれ computeMoveShift を計算して resizePreviewDates に書き込む
  // （単体移動の1件版を targets ループに一般化しただけ）。確定は appStore.bulkShiftTasks
  // （直接シフト全件→B3カスケード1回→1トースト＋Undo、をひとつの論理操作として担う）。
  const [draggingMoveTask, setDraggingMoveTask] = useState<{
    taskId: string; startX: number; origStart: string | null; origDue: string;
    bulkTargets?: { taskId: string; origStart: string | null; origDue: string }[];
  } | null>(null);
  // クリックとドラッグ移動の区別：水平4pxの移動閾値を超えた時点で true にする（レンダーを介さない ref。
  // window mouseup ハンドラ内で suppressNextClickRef に引き継ぎ、直後に発火する React の onClick 側で
  // 消費・リセットする。同期的な mousedown→mouseup→click の順序に依存した標準的な click-vs-drag 判定）
  const moveHasShiftedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const MOVE_THRESHOLD_PX = 4;

  // ドラッグ中／完了直後のバーがどれか（bulkTargets込み）を判定するための Set。
  // TaskBarRow の isMoving プロップに使う（単体移動時は自身のみ、一括移動時は選択中の全対象）
  const movingTaskIds = useMemo(() => {
    if (!draggingMoveTask) return null;
    if (draggingMoveTask.bulkTargets) return new Set(draggingMoveTask.bulkTargets.map(t => t.taskId));
    return new Set([draggingMoveTask.taskId]);
  }, [draggingMoveTask]);

  const handleMoveDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    const task = taskById.get(taskId);
    if (!task?.due_date || isPreview) return;
    e.preventDefault();
    moveHasShiftedRef.current = false;
    const isBulk = selectedTaskIds.has(taskId) && selectedTaskIds.size > 1;
    const bulkTargets = isBulk
      ? [...selectedTaskIds]
          .map(id => taskById.get(id))
          // done・cancelled は「終わった」タスクとして個別ドラッグ（TaskBarRowのisDone）と
          // 同じくシフト対象外にする（v2.74でcancelled追加後、ここが旧3値のまま
          // "done"のみ除外していた漏れを修正。on_holdは引き続き対象＝個別ドラッグ可能なため）
          .filter((t): t is Task => !!t && t.status !== "done" && t.status !== "cancelled" && !!t.due_date)
          .map(t => ({ taskId: t.id, origStart: t.start_date ?? null, origDue: t.due_date! }))
      : undefined;
    setDraggingMoveTask({
      taskId: task.id, startX: e.clientX,
      origStart: task.start_date ?? null, origDue: task.due_date,
      bulkTargets: bulkTargets && bulkTargets.length > 1 ? bulkTargets : undefined,
    });
  }, [isPreview, taskById, selectedTaskIds]);

  useEffect(() => {
    if (!draggingMoveTask) return;
    const { taskId, startX, origStart, origDue, bulkTargets } = draggingMoveTask;
    const targets = bulkTargets ?? [{ taskId, origStart, origDue }];
    const clearPreview = () => {
      setResizePreviewDates(prev => {
        let changed = false;
        const n = { ...prev };
        for (const t of targets) {
          if (n[t.taskId]) { delete n[t.taskId]; changed = true; }
        }
        return changed ? n : prev;
      });
    };
    const onMove = (e: MouseEvent) => {
      const deltaPixels = e.clientX - startX;
      if (!moveHasShiftedRef.current) {
        if (Math.abs(deltaPixels) <= MOVE_THRESHOLD_PX) return;
        moveHasShiftedRef.current = true;
      }
      const deltaDays = Math.round(deltaPixels / dayWidth);
      setResizePreviewDates(prev => {
        const n = { ...prev };
        for (const t of targets) {
          const shift = computeMoveShift(t.origStart, t.origDue, deltaDays);
          if (Object.keys(shift).length === 0) { delete n[t.taskId]; continue; }
          n[t.taskId] = shift;
        }
        return n;
      });
      // ドラッグ中の日付ツールチップ（ドラッグ元＝taskId のシフト後日付を表示。複数選択の一括移動でも
      // 代表としてドラッグ元1件だけ表示する＝要望の「狙った日付」はドラッグ操作している当人の基準で十分）
      const primaryShift = computeMoveShift(origStart, origDue, deltaDays);
      if (Object.keys(primaryShift).length > 0) {
        const label = primaryShift.start
          ? `${formatMDWithWeekday(toDate(primaryShift.start)!)} 〜 ${formatMDWithWeekday(toDate(primaryShift.due!)!)}`
          : formatMDWithWeekday(toDate(primaryShift.due!)!);
        setDragDateTooltip({ x: e.clientX, y: e.clientY, label });
      }
    };
    const onUp = async (e: MouseEvent) => {
      const wasMoved = moveHasShiftedRef.current;
      setDraggingMoveTask(null);
      setDragDateTooltip(null);
      clearPreview();
      if (!wasMoved) return;
      // クリックとして解釈されないよう、直後に発火する onClick 側（guardedHandleRowEdit）で消費させる
      suppressNextClickRef.current = true;
      const deltaDays = Math.round((e.clientX - startX) / dayWidth);
      if (deltaDays === 0) return;
      if (targets.length > 1) {
        await bulkShiftTasks(targets.map(t => t.taskId), deltaDays, currentUser.id);
        return;
      }
      const shift = computeMoveShift(origStart, origDue, deltaDays);
      if (Object.keys(shift).length === 0) return;
      const task = allTasks.find(t => t.id === taskId);
      if (!task) return;
      await saveTask({
        ...task,
        ...(shift.start !== undefined ? { start_date: shift.start } : {}),
        ...(shift.due !== undefined ? { due_date: shift.due } : {}),
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingMoveTask, dayWidth, allTasks, saveTask, bulkShiftTasks, currentUser.id]);

  // ===== タスク依存関係の矢印（B2） =====
  //
  // 【設計意図】行のY座標を数式で再計算せず、描画済みバー（data-task-id 付き要素）の
  // getBoundingClientRect() をボディコンテナ基準で実測する。3グルーピング×折りたたみ×
  // フィルタの全組合せをレイアウトロジックの二重化なしで堅牢に扱うため。
  const ganttBodyRef = useRef<HTMLDivElement>(null);
  const [showDepArrows, setShowDepArrows] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.GANTT_SHOW_DEPS) !== "0"; } catch { return true; }
  });
  const toggleShowDepArrows = useCallback(() => {
    setShowDepArrows(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.GANTT_SHOW_DEPS, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ===== ベースライン（当初計画）差分表示（B4） =====
  const [showBaseline, setShowBaseline] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.GANTT_SHOW_BASELINE) !== "0"; } catch { return true; }
  });
  const toggleShowBaseline = useCallback(() => {
    setShowBaseline(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.GANTT_SHOW_BASELINE, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // タスクのゴーストバー座標＋遅延ラベルをまとめて算出する。実バーと座標が完全一致するときは
  // ゴーストバーを描かない（重なって見えないだけの要素を増やさない）
  const getBaselineRender = useCallback((task: Task, bar: { barX: number; barWidth: number } | null) => {
    if (isPreview || !showBaseline) return { ghostBar: null, delayLabel: null, isDelayed: false };
    const rawGhost = calcGhostBar(task, rangeStart, dayWidth);
    const ghostBar = rawGhost && bar && rawGhost.barX === bar.barX && rawGhost.barWidth === bar.barWidth ? null : rawGhost;
    const delayDays = computeDelayDays(task);
    return { ghostBar, delayLabel: formatDelayLabel(delayDays), isDelayed: (delayDays ?? 0) > 0 };
  }, [isPreview, showBaseline, rangeStart, dayWidth]);

  // 「相手が画面外か」の判定は mineOnly/krTaskIds 等の表示フィルタより広いスコープで行う必要がある
  // （フィルタで除外されたタスクも「存在はする＝画面外バッジ対象」であり、「削除済み＝対象外」とは区別する）
  const activeTaskById = useMemo(() => new Map(active(rawTasks).map(t => [t.id, t])), [rawTasks]);
  const logicalDeps = useMemo(
    () => scopedTaskDependencies.filter(d => !d.is_deleted
      && activeTaskById.has(d.predecessor_task_id)
      && activeTaskById.has(d.successor_task_id)),
    [scopedTaskDependencies, activeTaskById],
  );

  // ===== クリティカルパス表示（B6） =====
  //
  // 【設計意図】mineOnly/hideCompletedTasks 等の表示フィルタで隠れているタスクがあっても、
  // プロジェクトの「本当の」クリティカルパスは変わらないため、activeTaskById（部署スコープ済み・
  // 論理削除のみ除外、表示フィルタは未適用の広いスコープ）を入力に使う。表示フィルタで隠れている
  // タスクはそもそもバー自体が描画されないため、isCritical を渡しても自然に何も起きない
  // （B2の画面外バッジと同じ考え方）。トグルOFF・プレビュー中は計算自体を省略する。
  const [showCriticalPath, setShowCriticalPath] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.GANTT_SHOW_CRITICAL) === "1"; } catch { return false; }
  });
  const toggleShowCriticalPath = useCallback(() => {
    setShowCriticalPath(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.GANTT_SHOW_CRITICAL, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const criticalTaskIds = useMemo(() => {
    if (isPreview || !showCriticalPath) return new Set<string>();
    return computeCriticalTaskIds([...activeTaskById.values()], scopedTaskDependencies);
  }, [isPreview, showCriticalPath, activeTaskById, scopedTaskDependencies]);

  // ===== 過負荷（オーバーアロケーション）表示（人別ビュー専用） =====
  //
  // 【設計意図】人別グルーピングでのみ意味を持つ（PJ別/ToDo別はメンバーが飛び飛びで並ぶため
  // 帯が成立しない）。対象は personGroups が既に持つ絞り込み済み allTasks（krTaskIds/mineOnly/
  // hideCompletedTasks 反映後）を入力に、メンバーごとに getMemberActiveTasks（ワークロードビューと
  // 同じ「アクティブ＝done以外」判定基準の単一の真実源）で絞り込んでから computeOverloadRanges に渡す。
  const [showOverload, setShowOverload] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.GANTT_SHOW_OVERLOAD) === "1"; } catch { return false; }
  });
  const toggleShowOverload = useCallback(() => {
    setShowOverload(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.GANTT_SHOW_OVERLOAD, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const overloadRangesByMember = useMemo(() => {
    const map = new Map<string, { start: string; end: string }[]>();
    if (isPreview || !showOverload || viewMode !== "person") return map;
    for (const { member } of personGroups) {
      const memberActiveTasks = getMemberActiveTasks(member.id, allTasks);
      map.set(member.id, computeOverloadRanges(memberActiveTasks, rangeStart, rangeEnd));
    }
    return map;
  }, [isPreview, showOverload, viewMode, personGroups, allTasks, rangeStart, rangeEnd]);

  const [depRender, setDepRender] = useState<{
    arrows: DependencyArrowGeometry[];
    badgesByTaskId: Map<string, DependencyBadgeInfo[]>;
    svgHeight: number;
  }>({ arrows: [], badgesByTaskId: new Map(), svgHeight: 0 });

  const remeasureDeps = useCallback(() => {
    const bodyEl = ganttBodyRef.current;
    if (isPreview || !showDepArrows || logicalDeps.length === 0 || !bodyEl) {
      setDepRender(prev => (prev.arrows.length === 0 && prev.badgesByTaskId.size === 0)
        ? prev
        : { arrows: [], badgesByTaskId: new Map(), svgHeight: prev.svgHeight });
      return;
    }
    const bodyRect = bodyEl.getBoundingClientRect();
    const rectMap = new Map<string, TaskRect>();
    bodyEl.querySelectorAll<HTMLElement>("[data-task-id]").forEach(el => {
      const id = el.dataset.taskId;
      // 人別ビューでは複数担当者の行に同じタスクが重複して出ることがあるため、最初の1件のみ使う
      if (!id || rectMap.has(id)) return;
      const r = el.getBoundingClientRect();
      rectMap.set(id, { x: r.left - bodyRect.left, y: r.top - bodyRect.top, width: r.width, height: r.height });
    });
    const result = computeDependencyRenders(logicalDeps, rectMap);
    setDepRender({ ...result, svgHeight: bodyEl.scrollHeight });
  }, [isPreview, showDepArrows, logicalDeps]);

  // 再計算タイミング：ズーム・折りたたみ開閉・並び順・ビュー切替・データ変更・ドラッグリサイズ中のプレビュー
  useLayoutEffect(() => {
    remeasureDeps();
  }, [remeasureDeps, collapsed, sortOrder, viewMode, dayWidth, allTasks, resizePreviewDates]);

  // 再計算タイミング：ウィンドウ／コンテナのリサイズ
  useEffect(() => {
    const el = ganttBodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasureDeps());
    ro.observe(el);
    return () => ro.disconnect();
  }, [remeasureDeps]);

  // タスクバーに渡す「相手が画面外」バッジのツールチップ文言を組み立てる
  const getDepBadgeTitles = useCallback((taskId: string): { left?: string; right?: string } => {
    const badges = depRender.badgesByTaskId.get(taskId);
    if (!badges || badges.length === 0) return {};
    const leftNames = badges.filter(b => b.hiddenSide === "predecessor").map(b => activeTaskById.get(b.otherTaskId)?.name ?? "?");
    const rightNames = badges.filter(b => b.hiddenSide === "successor").map(b => activeTaskById.get(b.otherTaskId)?.name ?? "?");
    return {
      left: leftNames.length ? `先行タスク（画面外）：${leftNames.join("、")}` : undefined,
      right: rightNames.length ? `後続タスク（画面外）：${rightNames.join("、")}` : undefined,
    };
  }, [depRender.badgesByTaskId, activeTaskById]);

  // ===== タスク依存関係のドラッグ結線（B5） =====
  //
  // 【設計意図】ハンドルの mousedown 位置（画面座標）を ganttBodyRef 基準に変換して始点とし、
  // window の mousemove/mouseup で追従する（B4のリサイズドラッグと同じ流儀）。ドロップ先の判定は
  // document.elementFromPoint で「今カーソル直下にある要素」を都度調べ、data-link-handle-task-id
  // （具体的なハンドル）→ data-task-id（バー本体）の優先順で候補を決める。頻繁に変化する
  // 現在位置／ドロップ候補は ref に逐次書き込みつつ state にも反映し（onUp では ref を正として読む＝
  // useEffect の古いクロージャに惑わされないため）、drag の開始・終了だけを effect の依存にして
  // mousemove のたびに listener を貼り直さないようにしている。
  const addTaskDependency = useAppStore(s => s.addTaskDependency);
  const taskDependenciesRaw = useAppStore(s => s.taskDependencies);
  const [linkDrag, setLinkDrag] = useState<{
    sourceTaskId: string; sourceSide: LinkSide; sourcePoint: { x: number; y: number };
  } | null>(null);
  const [linkDragPreviewPoint, setLinkDragPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [linkDragTarget, setLinkDragTarget] = useState<{ taskId: string; side: LinkSide | null } | null>(null);
  const linkDragTargetRef = useRef<{ taskId: string; side: LinkSide | null } | null>(null);

  const handleLinkHandleDown = useCallback((e: React.MouseEvent, taskId: string, side: LinkSide) => {
    if (isPreview || draggingResizeTask || draggingMoveTask) return;
    e.stopPropagation();
    e.preventDefault();
    const bodyEl = ganttBodyRef.current;
    if (!bodyEl) return;
    const handleRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const bodyRect = bodyEl.getBoundingClientRect();
    const sourcePoint = {
      x: handleRect.left + handleRect.width / 2 - bodyRect.left,
      y: handleRect.top + handleRect.height / 2 - bodyRect.top,
    };
    linkDragTargetRef.current = null;
    setLinkDragTarget(null);
    setLinkDragPreviewPoint(sourcePoint);
    setLinkDrag({ sourceTaskId: taskId, sourceSide: side, sourcePoint });
  }, [isPreview, draggingResizeTask, draggingMoveTask]);

  useEffect(() => {
    if (!linkDrag) return;
    const cancel = () => {
      linkDragTargetRef.current = null;
      setLinkDrag(null);
      setLinkDragTarget(null);
      setLinkDragPreviewPoint(null);
    };
    const onMove = (e: MouseEvent) => {
      const bodyEl = ganttBodyRef.current;
      if (bodyEl) {
        const bodyRect = bodyEl.getBoundingClientRect();
        setLinkDragPreviewPoint({ x: e.clientX - bodyRect.left, y: e.clientY - bodyRect.top });
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const handleEl = el?.closest("[data-link-handle-task-id]") as HTMLElement | null;
      let next: { taskId: string; side: LinkSide | null } | null = null;
      if (handleEl?.dataset.linkHandleTaskId) {
        next = { taskId: handleEl.dataset.linkHandleTaskId, side: (handleEl.dataset.linkHandleSide as LinkSide) ?? null };
      } else {
        const barEl = el?.closest("[data-task-id]") as HTMLElement | null;
        if (barEl?.dataset.taskId) next = { taskId: barEl.dataset.taskId, side: null };
      }
      linkDragTargetRef.current = next;
      setLinkDragTarget(next);
    };
    const onUp = async () => {
      const source = linkDrag;
      const target = linkDragTargetRef.current;
      cancel();
      if (!target || target.taskId === source.sourceTaskId) return;
      const resolved = resolveLinkDirection(
        { taskId: source.sourceTaskId, side: source.sourceSide },
        { taskId: target.taskId, side: target.side },
      );
      if (!resolved) {
        showToast("開始どうし・期日どうしは接続できません（開始↔期日のみ結線できます）", "error");
        return;
      }
      try {
        await addTaskDependency(resolved.predecessorTaskId, resolved.successorTaskId, currentUser.id);
      } catch {
        // 失敗理由（自己依存・重複・循環）は addTaskDependency 内で既にトースト表示済み
      }
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [linkDrag, addTaskDependency, currentUser.id]);

  // ===== 期日未登録タスクの空行ドラッグで期間を新規作成（②。CLAUDE.md v3.04） =====
  //
  // 【設計意図】バーが存在しない（due_date未設定）タスク行の空エリアをドラッグして開始日〜期日を
  // 作る。座標→日付の変換はB2矢印描画と同じ基準（ganttBodyRef.getBoundingClientRect() 起点）を使う。
  // creatingRangeTask 自体は taskId/anchorDate のみを持つ「ドラッグセッションの識別子」として不変に保ち
  // （バー移動ドラッグの draggingMoveTask と同じ設計）、フレームごとに変化する現在日はプレビュー
  // （resizePreviewDates を流用。既存の calcTaskBar/applyResizePreview がそのまま効くため、ドラッグ中の
  // プレビューバーは追加コード無しでリアルタイム描画される）とツールチップ側のstateにだけ書き込む。
  // これにより mousemove のたびに useEffect の listener を貼り直さずに済む（resize/move ドラッグと
  // 同じ設計判断）。1日も動かさなかった（同日クリック）場合も start=due の単日タスクとして許容する。
  const [creatingRangeTask, setCreatingRangeTask] = useState<{ taskId: string; anchorDate: string } | null>(null);

  const handleEmptyRowDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    if (isPreview || linkDrag || draggingResizeTask || draggingMoveTask) return;
    const bodyEl = ganttBodyRef.current;
    if (!bodyEl) return;
    e.preventDefault();
    e.stopPropagation();
    const bodyRect = bodyEl.getBoundingClientRect();
    const anchorDate = toDateStr(xToDate(e.clientX - bodyRect.left, rangeStart, dayWidth));
    setCreatingRangeTask({ taskId, anchorDate });
  }, [isPreview, linkDrag, draggingResizeTask, draggingMoveTask, rangeStart, dayWidth]);

  useEffect(() => {
    if (!creatingRangeTask) return;
    const { taskId, anchorDate } = creatingRangeTask;
    const dateAtClientX = (clientX: number): string => {
      const bodyRect = ganttBodyRef.current?.getBoundingClientRect();
      const x = bodyRect ? clientX - bodyRect.left : 0;
      return toDateStr(xToDate(x, rangeStart, dayWidth));
    };
    const onMove = (e: MouseEvent) => {
      const currentDate = dateAtClientX(e.clientX);
      const range = computeDragCreateRange(anchorDate, currentDate);
      setResizePreviewDates(prev => ({ ...prev, [taskId]: { start: range.start, due: range.due } }));
      const label = range.start === range.due
        ? formatMDWithWeekday(toDate(range.start)!)
        : `${formatMDWithWeekday(toDate(range.start)!)} 〜 ${formatMDWithWeekday(toDate(range.due)!)}`;
      setDragDateTooltip({ x: e.clientX, y: e.clientY, label });
    };
    const onUp = async (e: MouseEvent) => {
      const currentDate = dateAtClientX(e.clientX);
      setCreatingRangeTask(null);
      setDragDateTooltip(null);
      clearPreviewAll(taskId);
      const range = computeDragCreateRange(anchorDate, currentDate);
      const task = allTasks.find(t => t.id === taskId);
      if (!task) return;
      await saveTask({ ...task, start_date: range.start, due_date: range.due });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [creatingRangeTask, rangeStart, dayWidth, allTasks, saveTask, clearPreviewAll]);

  useEffect(() => {
    const resizeActive = isResizing || !!draggingResizeTask;
    const active = resizeActive || !!draggingMoveTask || !!linkDrag || !!creatingRangeTask;
    document.body.style.cursor = linkDrag
      ? "crosshair"
      : draggingMoveTask ? "grabbing"
      : creatingRangeTask ? "crosshair"
      : resizeActive ? "col-resize" : "";
    document.body.style.userSelect = active ? "none" : "";
    return () => { document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [isResizing, draggingResizeTask, draggingMoveTask, linkDrag, creatingRangeTask]);

  // ドラッグ中のドロップ候補の可否をリアルタイム判定する（store の addTaskDependency が実際に見るのと
  // 同じ taskDependencies（is_deleted除外も含めて同一のフィルタ）を使い、プレビューと実際の結果を
  // 一致させる。is_deleted を除外しないと、他クライアントが削除した依存が realtime UPDATE で
  // 配列内に残ったまま（upsertByIdはDELETEイベントでしか行を除去しないため）重複・循環判定に
  // 亡霊として残り続けてしまう）。
  const activeTaskDependenciesRaw = useMemo(
    () => taskDependenciesRaw.filter(d => !d.is_deleted),
    [taskDependenciesRaw],
  );
  const linkDropValidity = useMemo((): boolean | null => {
    if (!linkDrag || !linkDragTarget || linkDragTarget.taskId === linkDrag.sourceTaskId) return null;
    const resolved = resolveLinkDirection(
      { taskId: linkDrag.sourceTaskId, side: linkDrag.sourceSide },
      { taskId: linkDragTarget.taskId, side: linkDragTarget.side },
    );
    if (!resolved) return false;
    return canAddDependency(activeTaskDependenciesRaw, resolved.predecessorTaskId, resolved.successorTaskId).ok;
  }, [linkDrag, linkDragTarget, activeTaskDependenciesRaw]);

  // 各タスク行に渡す linkUi を組み立てる（TaskBarRow は memo 化されているため、対象外の行は
  // sourceSide/isTarget が全て変化しないオブジェクトを都度作っても comparator で弾かれ再レンダリングされない）
  const getLinkUi = useCallback((taskId: string): TaskBarLinkUi => ({
    enabled: !isPreview && showDepArrows,
    sourceSide: linkDrag?.sourceTaskId === taskId ? linkDrag.sourceSide : null,
    isTarget: linkDragTarget?.taskId === taskId,
    targetSide: linkDragTarget?.taskId === taskId ? linkDragTarget.side : null,
    isValid: linkDragTarget?.taskId === taskId ? linkDropValidity : null,
    onHandleDown: handleLinkHandleDown,
  }), [isPreview, showDepArrows, linkDrag, linkDragTarget, linkDropValidity, handleLinkHandleDown]);

  // ドラッグ中は他のバー操作（編集モーダル・リサイズ開始・結線開始）を抑制する。
  // guardedHandleRowEdit は「クリックと移動ドラッグの区別」も兼ねる：中央ドラッグが移動閾値を
  // 超えて発火した直後の onClick は suppressNextClickRef で1回だけ消費し、詳細パネルを開かせない
  const guardedHandleRowEdit = useCallback((taskId: string) => {
    if (linkDrag) return;
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    handleRowEdit(taskId);
  }, [linkDrag, handleRowEdit]);
  // タスクバー専用のクリックハンドラ（複数選択：Ctrl/Cmd+クリック対応）。ラベル列の行クリック
  // （guardedHandleRowEdit）とは別に持つ。Ctrl/Cmd+クリックは選択トグルのみ（詳細は開かず、
  // 既存の選択も保持する）。修飾キー無しの通常クリックは選択をクリアしてから詳細を開く
  // 【Shift+クリック＝範囲選択】アンカー（selectionAnchorRef）〜クリックしたタスクの間を、
  // 現在の表示順（visibleOrderedTaskIds）で選択に追加する（既存選択はクリアしない）。
  // アンカーが無い場合は単一選択として扱い、そのタスクを新しいアンカーにする。詳細は開かない
  // （Ctrl/Cmd+クリックと同じ「選択のみ」の扱い）。
  const guardedHandleBarEdit = useCallback((e: React.MouseEvent | React.KeyboardEvent, taskId: string) => {
    if (linkDrag) return;
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    if (e.shiftKey) {
      const anchorId = selectionAnchorRef.current;
      const rangeIds = computeRangeSelection(visibleOrderedTaskIds, anchorId, taskId);
      setSelectedTaskIds(prev => {
        const n = new Set(prev);
        rangeIds.forEach(id => n.add(id));
        return n;
      });
      selectionAnchorRef.current = anchorId ?? taskId;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleTaskSelection(taskId);
      selectionAnchorRef.current = taskId;
      return;
    }
    clearTaskSelection();
    selectionAnchorRef.current = taskId;
    handleRowEdit(taskId);
  }, [linkDrag, toggleTaskSelection, clearTaskSelection, handleRowEdit, visibleOrderedTaskIds]);
  const guardedHandleResizeDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    if (linkDrag || draggingMoveTask) return;
    handleResizeDragStart(e, taskId);
  }, [linkDrag, draggingMoveTask, handleResizeDragStart]);
  const guardedHandleStartResizeDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    if (linkDrag || draggingMoveTask) return;
    handleStartResizeDragStart(e, taskId);
  }, [linkDrag, draggingMoveTask, handleStartResizeDragStart]);
  const guardedHandleMoveDragStart = useCallback((e: React.MouseEvent, taskId: string) => {
    if (linkDrag || draggingResizeTask) return;
    handleMoveDragStart(e, taskId);
  }, [linkDrag, draggingResizeTask, handleMoveDragStart]);

  // ===== モバイル：タイムラインリスト表示 =====
  // 全フック宣言後の早期 return なので hooks 順序は崩れない。
  if (isMobile) {
    return (
      <GanttMobileView
        today={today}
        viewMode={viewMode}
        setViewMode={setViewMode}
        visibleProjects={visibleProjects}
        allTasks={allTasks}
        todoGroups={todoGroups}
        personGroups={personGroups}
        milestones={milestones}
        projectById={projectById}
        sortTasks={sortTasks}
        taskDependencies={scopedTaskDependencies}
        previewChangedTaskIds={previewChangedTaskIds}
        isPreview={isPreview}
        editingTaskId={editingTaskId}
        setEditingTaskId={setEditingTaskId}
        mineOnly={mineOnly}
        selectedProject={selectedProject}
        krTaskIds={krTaskIds}
        currentUser={currentUser}
        members={members}
        saveTask={saveTask}
        hideCompletedTasks={hideCompletedTasks}
        onToggleHideCompletedTasks={toggleHideCompletedTasks}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: isPreview ? "var(--color-bg-info)" : "var(--color-bg-primary)", flexShrink: 0,
      }}>
        {isPreview && (
          <span style={{
            fontSize: "10px",
            padding: "2px 8px",
            background: "var(--color-text-info)",
            color: "#fff",
            borderRadius: "var(--radius-full)",
            fontWeight: "500",
            flexShrink: 0,
          }}>
            変更後（仮）
          </span>
        )}
        <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
          {selectedProject ? selectedProject.name : krTaskIds ? "OKRタスク" : "全プロジェクト"}
        </div>
        {!isPreview && (
          <div style={{ display: "flex", gap: "3px", padding: "2px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)" }}>
            {(["pj", "person"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  ...headerBtnStyle,
                  padding: "3px 10px",
                  background: viewMode === mode ? "var(--color-bg-primary)" : "transparent",
                  color: viewMode === mode ? "var(--color-brand)" : "var(--color-text-secondary)",
                  border: viewMode === mode ? "1px solid var(--color-brand-border)" : "1px solid transparent",
                  fontWeight: viewMode === mode ? "600" : "400",
                  boxShadow: viewMode === mode ? "var(--shadow-sm)" : "none",
                }}
              >
                {mode === "pj" ? "PJ別" : "人別"}
              </button>
            ))}
          </div>
        )}
        {!isPreview && viewMode === "pj" && <button onClick={expandAll}  title="PJをすべて展開" aria-label="PJをすべて展開" style={headerBtnStyle}>⊞</button>}
        {!isPreview && viewMode === "pj" && <button onClick={collapseAll} title="PJをすべて折りたたむ" aria-label="PJをすべて折りたたむ" style={headerBtnStyle}>⊟</button>}
        {/* タスク並び順トグル */}
        {!isPreview && (
          <div style={{ display: "flex", gap: "2px", padding: "2px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)" }}>
            {(["date", "name"] as const).map(s => (
              <button
                key={s}
                onClick={() => changeSortOrder(s)}
                title={s === "date" ? "期日順に並べる" : "名前順に並べる"}
                aria-label={s === "date" ? "期日順" : "名前順"}
                style={{
                  ...headerBtnStyle,
                  padding: "3px 8px",
                  background: sortOrder === s ? "var(--color-bg-primary)" : "transparent",
                  color: sortOrder === s ? "var(--color-brand)" : "var(--color-text-secondary)",
                  border: sortOrder === s ? "1px solid var(--color-brand-border)" : "1px solid transparent",
                  fontWeight: sortOrder === s ? "600" : "400",
                  boxShadow: sortOrder === s ? "var(--shadow-sm)" : "none",
                }}
              >
                {s === "date" ? "📅" : "🔠"}
              </button>
            ))}
          </div>
        )}
        {/* 依存矢印トグル（B2） */}
        {!isPreview && (
          <button
            onClick={toggleShowDepArrows}
            title={showDepArrows ? "依存関係の矢印を隠す" : "依存関係の矢印を表示する"}
            aria-pressed={showDepArrows}
            style={{
              ...headerBtnStyle,
              color: showDepArrows ? "var(--color-brand)" : "var(--color-text-secondary)",
              borderColor: showDepArrows ? "var(--color-brand-border)" : "var(--color-border-primary)",
              fontWeight: showDepArrows ? "600" : "400",
            }}
          >🔗依存</button>
        )}
        {/* ベースライン表示トグル（B4） */}
        {!isPreview && (
          <button
            onClick={toggleShowBaseline}
            title={showBaseline ? "当初計画（ベースライン）を隠す" : "当初計画（ベースライン）を表示する"}
            aria-pressed={showBaseline}
            style={{
              ...headerBtnStyle,
              color: showBaseline ? "var(--color-brand)" : "var(--color-text-secondary)",
              borderColor: showBaseline ? "var(--color-brand-border)" : "var(--color-border-primary)",
              fontWeight: showBaseline ? "600" : "400",
            }}
          >▤ベースライン</button>
        )}
        {/* 完了を隠すトグル（未完了の子を持つ親タスクは残す） */}
        {!isPreview && (
          <button
            onClick={toggleHideCompletedTasks}
            title={hideCompletedTasks ? "完了タスクも表示する" : "完了タスクを非表示にする（未完了のみ表示）"}
            aria-pressed={hideCompletedTasks}
            style={{
              ...headerBtnStyle,
              color: hideCompletedTasks ? "var(--color-brand)" : "var(--color-text-secondary)",
              borderColor: hideCompletedTasks ? "var(--color-brand-border)" : "var(--color-border-primary)",
              fontWeight: hideCompletedTasks ? "600" : "400",
            }}
          >🙈完了を隠す</button>
        )}
        {/* クリティカルパス表示トグル（B6）。既定OFF。ONの間はクリティカルなタスクのバー・
            クリティカルなタスク間の矢印を専用アクセント（太い赤枠）で強調する */}
        {!isPreview && (
          <button
            onClick={toggleShowCriticalPath}
            title={showCriticalPath ? "クリティカルパスの強調を隠す" : "クリティカルパス（プロジェクトの所要期間を決める最長の依存連鎖）を強調表示する"}
            aria-pressed={showCriticalPath}
            style={{
              ...headerBtnStyle,
              color: showCriticalPath ? CRITICAL_COLOR : "var(--color-text-secondary)",
              borderColor: showCriticalPath ? CRITICAL_COLOR : "var(--color-border-primary)",
              fontWeight: showCriticalPath ? "600" : "400",
            }}
          >🎯クリティカルパス</button>
        )}
        {/* 過負荷（オーバーアロケーション）表示トグル。人別ビューでのみ帯が出る（PJ別/ToDo別では
            何も描かれない＝崩さない）。既定OFF。 */}
        {!isPreview && (
          <button
            onClick={toggleShowOverload}
            title={showOverload ? "メンバーの過負荷（同時アクティブタスクの重なり）表示を隠す" : "メンバーの過負荷（同時アクティブタスクの重なり）を人別ビューで強調表示する"}
            aria-pressed={showOverload}
            style={{
              ...headerBtnStyle,
              color: showOverload ? OVERLOAD_COLOR : "var(--color-text-secondary)",
              borderColor: showOverload ? OVERLOAD_COLOR : "var(--color-border-primary)",
              fontWeight: showOverload ? "600" : "400",
            }}
          >⚠過負荷</button>
        )}
        {/* 複数選択インジケータ：Ctrl/Cmd+クリックで選択したタスクの件数。選択中のバーの中央を
            ドラッグすると選択中の全タスクが一括でシフトする */}
        {!isPreview && selectedTaskIds.size > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "4px",
            padding: "3px 4px 3px 10px",
            border: "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-brand)", fontSize: "11px", fontWeight: "600",
            background: "var(--color-brand-light)",
          }}>
            {selectedTaskIds.size}件選択中
            <button
              onClick={clearTaskSelection}
              title="選択を解除"
              aria-label="選択を解除"
              style={{
                ...headerBtnStyle,
                border: "none", padding: "2px 6px",
                color: "var(--color-brand)", fontWeight: "600",
              }}
            >✕</button>
          </div>
        )}
        {!isPreview && (
          <button onClick={scrollToToday} style={{
            ...headerBtnStyle,
            color: "var(--color-text-danger)",
            borderColor: "var(--color-border-danger)",
            fontWeight: "600",
          }}>今日</button>
        )}
        {/* ズームボタン */}
        {!isPreview && (
          <div style={{ display: "flex", alignItems: "center", gap: "2px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <button
              onClick={zoomOut}
              disabled={(ZOOM_LEVELS as readonly number[]).indexOf(dayWidth) <= 0}
              title="縮小"
              style={{
                ...headerBtnStyle,
                border: "none", borderRadius: 0,
                padding: "4px 8px",
                opacity: (ZOOM_LEVELS as readonly number[]).indexOf(dayWidth) <= 0 ? 0.3 : 1,
              }}
            >
              <ZoomIcon minus />
            </button>
            <div style={{ width: 1, height: 16, background: "var(--color-border-primary)" }} />
            <button
              onClick={zoomIn}
              disabled={(ZOOM_LEVELS as readonly number[]).indexOf(dayWidth) >= ZOOM_LEVELS.length - 1}
              title="拡大"
              style={{
                ...headerBtnStyle,
                border: "none", borderRadius: 0,
                padding: "4px 8px",
                opacity: (ZOOM_LEVELS as readonly number[]).indexOf(dayWidth) >= ZOOM_LEVELS.length - 1 ? 0.3 : 1,
              }}
            >
              <ZoomIcon />
            </button>
          </div>
        )}
      </div>

      {/* ガント本体 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* 左ラベル列（固定） */}
        <div style={{
          width: labelWidth, flexShrink: 0,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          minHeight: 0,
        }}>
          {/* ラベルヘッダー（右バー列ヘッダーと高さを一致させる。月24+週28+ものさし目盛り16=68。
              CLAUDE.md v3.06：v3.05でものさし目盛り16pxを右列だけに足したため52のまま据え置かれ
              定常16pxズレが生じていたリグレッションを修正） */}
          <div style={{
            height: GANTT_LABEL_HEADER_HEIGHT, flexShrink: 0,
            borderBottom: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-secondary)",
            display: "flex", alignItems: "flex-end", padding: "0 10px 6px",
            fontSize: "11px", color: "var(--color-text-tertiary)",
          }}>
            タスク
            {!isPreview && viewMode === "pj" && parentTaskIds.length > 0 && (
              <button
                onClick={toggleAllParents}
                title={allParentsCollapsed ? "子タスクをすべて展開" : "子タスクをすべて折りたたむ"}
                style={{
                  marginLeft: "auto", padding: "2px 6px", fontSize: "9px",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-sm)", background: "transparent",
                  color: "var(--color-text-tertiary)", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {allParentsCollapsed ? "⊞ 子タスクを展開" : "⊟ 子タスクを畳む"}
              </button>
            )}
          </div>

          {/* ラベル行（ガント本体と同期スクロール。flex:1 で親の余白を取らないとスクロール領域が機能しない） */}
          <div
            ref={labelBodyRef}
            onScroll={handleLabelScroll}
            style={{
              flex: 1, minHeight: 0,
              overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none",
            }}
          >
            {visibleProjects.length === 0 && allTasks.length === 0 ? (
              <EmptyState
                icon="📅"
                title="表示するタスクがありません"
                hint={mineOnly
                  ? "「自分」モードで担当タスクが無いか、まだ登録されていません。サイドバー上部で「全件」に切り替えるか、＋ボタンで追加してください。"
                  : "PJ やタスクを登録すると、ここに横長のバーで表示されます。"}
              />
            ) : viewMode === "pj" ? (
              <>
                {visibleProjects.map(pj => {
                  const orderedTasks = pjOrderedTasksMap.get(pj.id) ?? [];
                  const isCollapsed = collapsed[pj.id];
                  return (
                    <div key={pj.id}>
                      {/* PJ行ラベル */}
                      {/* onClick 指定時のみ role/tabIndex/onKeyDown を付与する条件付きインタラクティブ要素 */}
                      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: editingPjNameId === pj.id ? "default" : "pointer",
                      }}
                        onClick={() => { if (editingPjNameId !== pj.id) togglePJ(pj.id); }}
                        role={editingPjNameId === pj.id ? undefined : "button"}
                        tabIndex={editingPjNameId === pj.id ? undefined : 0}
                        onKeyDown={editingPjNameId === pj.id ? undefined : (e => { if (e.key === "Enter" || e.key === " ") togglePJ(pj.id); })}
                      >
                        <span style={{
                          fontSize: "11px", color: "var(--color-text-secondary)",
                          transition: "transform 0.15s",
                          display: "inline-block",
                          flexShrink: 0,
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        }}>▾</span>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: pj.color_tag, flexShrink: 0,
                        }} />
                        {editingPjNameId === pj.id ? (
                          <input
                            autoFocus
                            value={editingPjNameValue}
                            onChange={e => setEditingPjNameValue(e.target.value)}
                            onBlur={() => handleSavePjName(pj)}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === "Enter") handleSavePjName(pj);
                              if (e.key === "Escape") setEditingPjNameId(null);
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              flex: 1, minWidth: 0, fontSize: "11px", fontWeight: "500",
                              padding: "2px 4px", border: "1px solid var(--color-brand)",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--color-bg-primary)",
                              color: "var(--color-text-primary)",
                              outline: "none",
                            }}
                          />
                        ) : (
                          <>
                            <span style={{
                              fontSize: "11px", fontWeight: "500",
                              color: "var(--color-text-primary)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              flex: 1,
                            }}>
                              {pj.name.length > 14 ? pj.name.slice(0, 14) + "…" : pj.name}
                            </span>
                            {!isPreview && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingPjNameId(pj.id);
                                  setEditingPjNameValue(pj.name);
                                }}
                                title="プロジェクト名を変更"
                                style={{
                                  background: "transparent", border: "none", cursor: "pointer",
                                  fontSize: "10px", color: "var(--color-text-tertiary)",
                                  padding: "2px 3px", lineHeight: 1, flexShrink: 0,
                                }}
                              >✏️</button>
                            )}
                          </>
                        )}
                      </div>

                      {/* タスク行ラベル（子タスクはインデント＋↳で明示。親は▾トグルで個別折りたたみ可） */}
                      {!isCollapsed && orderedTasks.map(({ task, depth, childCount }) => {
                        // 親タスクが折りたたまれている子はスキップ
                        if (depth > 0 && collapsed[task.parent_task_id!]) return null;
                        return (
                          <GanttPjLabelRow
                            key={task.id}
                            task={task}
                            isChild={depth > 0}
                            childCount={childCount}
                            isHovered={hoveredTaskId === task.id}
                            isCollapsed={!!collapsed[task.id]}
                            members={members}
                            onEdit={guardedHandleRowEdit}
                            onHoverEnter={handleRowHoverEnter}
                            onHoverLeave={handleRowHoverLeave}
                            onToggleCollapse={togglePJ}
                            onSaveAssignees={handleSaveRowAssignees}
                            onSaveName={handleSaveRowName}
                            autoEditName={autoEditTaskId === task.id}
                            onInsertAfter={handleInsertTaskAfter}
                            draggingId={ganttDraggingId}
                            dropZone={ganttDropZone?.id === task.id ? (ganttDropZone.zone as "before" | "after") : null}
                            onDragHandleStart={handleDragHandleStart}
                            onDragHandleEnd={handleDragHandleEnd}
                            onRowDragOver={handleRowDragOver}
                            onRowDragLeave={handleRowDragLeave}
                            onRowDrop={handleRowDrop}
                          />
                        );
                      })}
                      {/* 簡易タスク追加（名前のみ。CLAUDE.md v3.04・PJ別ビューのみ） */}
                      {!isCollapsed && !isPreview && (
                        <GanttQuickAddTaskRow onAdd={name => handleQuickAddTask(pj.id, name)} />
                      )}
                    </div>
                  );
                })}

                {/* ToDo系タスクグループ（ラベル） */}
                {todoGroups.map(({ todo, todoId, tasks }) => {
                  const isCollapsed = collapsed[`todo_${todoId}`];
                  const sortedTasks = todoGroupSortedMap.get(todoId) ?? sortTasks(tasks);
                  return (
                    <div key={todoId}>
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: "pointer",
                      }}
                        onClick={() => togglePJ(`todo_${todoId}`)}
                        role="button" tabIndex={0}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") togglePJ(`todo_${todoId}`); }}
                      >
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", transition: "transform 0.15s", display: "inline-block", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: TODO_COLOR, flexShrink: 0 }} />
                        <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {`[ToDo] ${(todo.title.split("\n")[0]).slice(0, 14)}${todo.title.length > 14 ? "…" : ""}`}
                        </span>
                      </div>
                      {!isCollapsed && sortedTasks.map(task => (
                        <GanttTodoLabelRow
                          key={task.id}
                          task={task}
                          isHovered={hoveredTaskId === task.id}
                          members={members}
                          onEdit={guardedHandleRowEdit}
                          onHoverEnter={handleRowHoverEnter}
                          onHoverLeave={handleRowHoverLeave}
                          onSaveAssignees={handleSaveRowAssignees}
                          onSaveName={handleSaveRowName}
                        />
                      ))}
                    </div>
                  );
                })}
              </>
            ) : (
              /* ===== 人別ビュー ラベル ===== */
              <>
                {personGroups.map(({ member: m, tasks }) => {
                  const isCollapsed = collapsed[`person_${m.id}`];
                  const doneCount = tasks.filter(t => t.status === "done").length;
                  const inProgressCount = tasks.filter(t => t.status === "in_progress").length;
                  const overloadDayCount = (overloadRangesByMember.get(m.id) ?? [])
                    .reduce((sum, r) => sum + (diffDays(r.start, r.end) + 1), 0);
                  return (
                    <div key={m.id}>
                      {/* メンバーヘッダー行 */}
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: "pointer",
                      }}
                        onClick={() => togglePJ(`person_${m.id}`)}
                        role="button" tabIndex={0}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") togglePJ(`person_${m.id}`); }}
                      >
                        <span style={{
                          fontSize: "11px", color: "var(--color-text-secondary)",
                          transition: "transform 0.15s", display: "inline-block",
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        }}>▾</span>
                        {/* アバター */}
                        <div style={{
                          width: 20, height: 20, borderRadius: "50%",
                          background: m.color_bg, color: m.color_text,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "9px", fontWeight: "700", flexShrink: 0,
                        }}>
                          {m.initials.slice(0, 2)}
                        </div>
                        <span style={{
                          fontSize: "11px", fontWeight: "600",
                          color: "var(--color-text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          flex: 1,
                        }}>
                          {m.short_name}
                        </span>
                        {/* タスク数バッジ */}
                        <span style={{
                          fontSize: "9px", color: "var(--color-text-tertiary)",
                          flexShrink: 0,
                        }}>
                          {doneCount}/{tasks.length}
                        </span>
                        {inProgressCount > 0 && (
                          <div style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: "var(--color-text-info)", flexShrink: 0,
                          }} />
                        )}
                        {showOverload && overloadDayCount > 0 && (
                          <span style={{
                            fontSize: "9px", fontWeight: "600", color: OVERLOAD_COLOR,
                            flexShrink: 0, whiteSpace: "nowrap",
                          }} title="過負荷（同時アクティブタスクの重なり）の日数">
                            ⚠過負荷{overloadDayCount}日
                          </span>
                        )}
                      </div>

                      {/* タスク行 */}
                      {!isCollapsed && tasks.map(task => {
                        const pj = task.project_id ? projectById.get(task.project_id) : undefined;
                        const due = toDate(task.due_date);
                        const isOverdue = !!(due && due < today && !suppressOverdue(task.status));
                        return (
                          <GanttPersonLabelRow
                            key={task.id}
                            task={task}
                            isHovered={hoveredTaskId === task.id}
                            isOverdue={isOverdue}
                            pj={pj}
                            onEdit={guardedHandleRowEdit}
                            onHoverEnter={handleRowHoverEnter}
                            onHoverLeave={handleRowHoverLeave}
                            onSaveName={handleSaveRowName}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* リサイズハンドル（ラベル列幅の調整）。マウスのドラッグ操作専用でキーボード代替手段はない */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          onMouseDown={!isMobile ? handleDividerMouseDown : undefined}
          onMouseEnter={() => setIsDividerHovered(true)}
          onMouseLeave={() => setIsDividerHovered(false)}
          style={{
            width: isMobile ? 1 : 5, flexShrink: 0,
            cursor: isMobile ? "default" : "col-resize",
            background: !isMobile && (isDividerHovered || isResizing)
              ? "var(--color-brand)"
              : "var(--color-border-primary)",
            transition: "background 0.15s",
            zIndex: 10,
          }}
        />

        {/* 右スクロールエリア */}
        <div
          ref={scrollRef}
          onScroll={handleGanttScroll}
          style={{ flex: 1, overflow: "auto", position: "relative", WebkitOverflowScrolling: "touch" }}
        >
          <div style={{ width: totalWidth, minHeight: "100%" }}>

            {/* ヘッダー：月 + 日 */}
            <div style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "var(--color-bg-secondary)",
              borderBottom: "1px solid var(--color-border-primary)",
            }}>
              {/* 月ラベル行 */}
              <div style={{ height: GANTT_HEADER_MONTH_HEIGHT, position: "relative", borderBottom: "1px solid var(--color-border-primary)" }}>
                {monthGroups.map((mg, i) => (
                  <div key={i} style={{
                    position: "absolute", left: mg.startX, width: mg.width,
                    height: "100%", display: "flex", alignItems: "center",
                    paddingLeft: "6px", fontSize: "10px", fontWeight: "500",
                    color: "var(--color-text-secondary)",
                    borderLeft: i > 0 ? "1px solid var(--color-border-primary)" : "none",
                  }}>
                    {mg.label}
                  </div>
                ))}
              </div>
              {/* 週ラベル行（月内日数ブロック：W1=1-7/W2=8-14/W3=15-21/W4=22-28/W5=29〜月末。
                  各週は必ずその月に属す＝月をまたいだ瞬間に翌月のW1から数え直す） */}
              <div style={{ height: GANTT_HEADER_WEEK_HEIGHT, position: "relative" }}>
                {weekBlocks.map((wb, i) => (
                  <div key={i} title={formatDateRangeWithWeekday(wb.startDate, wb.endDate)} style={{
                    position: "absolute",
                    left: wb.startX, width: wb.width,
                    height: "100%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", fontWeight: "500",
                    color: "var(--color-text-tertiary)",
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "clip",
                    boxSizing: "border-box",
                    // 月の最初の週（W1）＝月境界。区切り線を少し強めて月の大局を掴めるようにする
                    borderLeft: wb.isMonthStart ? "1px solid var(--color-border-primary)" : "1px solid var(--color-border-secondary)",
                  }}>
                    {wb.label}
                  </div>
                ))}
              </div>
              {/* ものさし目盛り行（1日ごと。週ラベルのすぐ下に表示。土=青／日・祝=赤／平日=控えめ色。
                  祝日はホバーで祝日名を表示。dayTicksはuseMemo済みのためズームや折りたたみでの
                  再レンダーでは再計算されない） */}
              <div style={{ height: GANTT_HEADER_DAY_TICK_HEIGHT, position: "relative", borderTop: "1px solid var(--color-border-secondary)" }}>
                {dayTicks.map(tick => {
                  const color = dayTickColor(tick.colorKind);
                  return (
                    <div
                      key={tick.x}
                      title={tick.holidayName ?? undefined}
                      style={{
                        position: "absolute",
                        left: tick.x, width: dayWidth,
                        height: "100%",
                        boxSizing: "border-box",
                        borderLeft: `1px solid ${color}`,
                        display: "flex", alignItems: "flex-end", justifyContent: "center",
                        paddingBottom: 1,
                        fontSize: "8px", lineHeight: 1,
                        color,
                        overflow: "hidden",
                      }}
                    >
                      {tick.day}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ボディ：土日背景は CSS gradient、月初・月曜境界線のみ個別 div。onClick は
                空白（バー以外）クリックで複数選択をクリアするためだけの背景クリック検知
                （キーボード操作の対象ではない背景領域のため、モーダル背景クリックと同じ扱い） */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
            <div ref={ganttBodyRef} onClick={handleGanttBodyClick} style={{
              position: "relative",
              backgroundImage: weekendGradient,
              backgroundSize: `${weekPeriod}px 100%`,
              backgroundRepeat: "repeat-x",
              backgroundPosition: `${bgOffsetX}px 0`,
            }}>
              {/* 月初（2px）・月曜（1px）境界線（約65本/年 ≪ 旧来の365本） */}
              {borderDays.map(d => {
                const i = diffDays(rangeStart, d);
                const isMonthStart = d.getDate() === 1;
                return (
                  <div key={d.toISOString()} style={{
                    position: "absolute", left: i * dayWidth,
                    top: 0, bottom: 0, width: 0,
                    borderLeft: isMonthStart
                      ? "2px solid var(--color-border-primary)"
                      : "1px solid var(--color-border-secondary)",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                  }} />
                );
              })}

              {/* 週コラムの淡いグリッド線（週境界＝W2〜W5開始日。月初=W1は上のborderDaysで太めに描画済み） */}
              {weekGridLines.map(x => (
                <div key={`wgl-${x}`} style={{
                  position: "absolute", left: x,
                  top: 0, bottom: 0, width: 0,
                  borderLeft: "1px solid var(--color-border-secondary)",
                  opacity: 0.35,
                  pointerEvents: "none",
                  zIndex: 1,
                  boxSizing: "border-box",
                }} />
              ))}

              {/* 今日線 */}
              <div style={{
                position: "absolute",
                left: todayX + dayWidth / 2,
                top: 0, bottom: 0, width: 2,
                background: "var(--color-text-danger)",
                opacity: 0.7,
                pointerEvents: "none",
                zIndex: 5,
              }} />

              {/* 依存関係の矢印（B2）。バーより下の層（zIndex 1）に描き、クリックを邪魔しない */}
              {!isPreview && showDepArrows && depRender.arrows.length > 0 && (
                <svg
                  aria-hidden="true"
                  style={{
                    position: "absolute", left: 0, top: 0,
                    width: totalWidth, height: depRender.svgHeight || undefined,
                    overflow: "visible", pointerEvents: "none", zIndex: 1,
                  }}
                >
                  <defs>
                    <marker id="gantt-dep-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-border-secondary)" />
                    </marker>
                    <marker id="gantt-dep-arrowhead-hover" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-brand)" />
                    </marker>
                    {/* B6：クリティカルパス専用の矢印（濃い赤・太め）。既存の通常/ホバーとは独立した3つ目の見た目 */}
                    <marker id="gantt-dep-arrowhead-critical" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L7,3.5 L0,7 Z" fill={CRITICAL_COLOR} />
                    </marker>
                  </defs>
                  {depRender.arrows.map(({ dep, points }) => {
                    const isHoveredArrow = hoveredTaskId != null
                      && (dep.predecessor_task_id === hoveredTaskId || dep.successor_task_id === hoveredTaskId);
                    const predTask = activeTaskById.get(dep.predecessor_task_id);
                    // 「未完了」の定義は lib/dependencies/gate.ts の getIncompletePredecessors と揃える：
                    // done・cancelled は完了扱い（cancelledは後続をブロックしない）。on_holdのみ未完了扱い。
                    // v2.74でcancelled追加後、ここが旧2値のまま"done以外は未完了"だったため
                    // cancelled先行の依存線が誤って点線（未完了）表示になっていたのを修正。
                    const isPredIncomplete = predTask?.status !== "done" && predTask?.status !== "cancelled";
                    // B6：両端がクリティカルなタスクの矢印だけ専用アクセントで強調する
                    // （既存の期限超過赤・ホバー強調とは別の濃さ・太さ・矢印マーカーで判別可能にする）
                    const isCriticalArrow = showCriticalPath
                      && criticalTaskIds.has(dep.predecessor_task_id) && criticalTaskIds.has(dep.successor_task_id);
                    return (
                      <path
                        key={dep.id}
                        d={pointsToPathD(points)}
                        fill="none"
                        stroke={isCriticalArrow ? CRITICAL_COLOR : isHoveredArrow ? "var(--color-brand)" : "var(--color-border-secondary)"}
                        strokeWidth={isCriticalArrow ? (isHoveredArrow ? 3 : 2.2) : isHoveredArrow ? 2 : 1}
                        strokeOpacity={isCriticalArrow ? 0.95 : isHoveredArrow ? 0.9 : 0.5}
                        strokeDasharray={isPredIncomplete ? "4 3" : undefined}
                        markerEnd={isCriticalArrow ? "url(#gantt-dep-arrowhead-critical)" : isHoveredArrow ? "url(#gantt-dep-arrowhead-hover)" : "url(#gantt-dep-arrowhead)"}
                      />
                    );
                  })}
                </svg>
              )}

              {/* B5：結線ドラッグ中のカーソル追従プレビュー線。バー・矢印より上（zIndex 8）に描く */}
              {linkDrag && linkDragPreviewPoint && (
                <svg
                  aria-hidden="true"
                  style={{
                    position: "absolute", left: 0, top: 0,
                    width: totalWidth, height: depRender.svgHeight || undefined,
                    overflow: "visible", pointerEvents: "none", zIndex: 8,
                  }}
                >
                  <line
                    x1={linkDrag.sourcePoint.x} y1={linkDrag.sourcePoint.y}
                    x2={linkDragPreviewPoint.x} y2={linkDragPreviewPoint.y}
                    stroke={linkDragTarget && linkDropValidity === false ? "var(--color-text-danger)" : "var(--color-brand)"}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                  <circle
                    cx={linkDragPreviewPoint.x} cy={linkDragPreviewPoint.y} r={4}
                    fill={linkDragTarget && linkDropValidity === false ? "var(--color-text-danger)" : "var(--color-brand)"}
                  />
                </svg>
              )}

              {/* PJ・タスクバー / 人別バー */}
              {viewMode === "person" ? (
                /* ===== 人別ビュー バー ===== */
                <>
                  {personGroups.map(({ member: m, tasks }) => {
                    const isCollapsed = collapsed[`person_${m.id}`];
                    // メンバーの稼働中タスクの最早期日〜最遅期日をバー表示
                    const dueDates = tasks.map(t => toDate(t.due_date)).filter(Boolean) as Date[];
                    const earliest = dueDates.length > 0 ? dueDates.reduce((a, b) => a < b ? a : b) : null;
                    const latest   = dueDates.length > 0 ? dueDates.reduce((a, b) => a > b ? a : b) : null;
                    const spanX = earliest ? diffDays(rangeStart, earliest) * dayWidth : null;
                    const spanW = (earliest && latest) ? (diffDays(earliest, latest) + 1) * dayWidth : null;
                    // 過負荷帯（このメンバーの行ブロック内だけを高さいっぱいに塗る。マイルストーン帯と同じ
                    // 「position:relativeコンテナへの絶対配置」手法。バー（zIndex 2）より背面（zIndex 1）。
                    const overloadBands = overloadRangesToBands(overloadRangesByMember.get(m.id) ?? [], rangeStart, dayWidth);
                    return (
                      <div key={m.id} style={{ position: "relative" }}>
                        {overloadBands.map(band => (
                          <div key={`ovl-${m.id}-${band.x}`} style={{
                            position: "absolute", left: band.x, width: band.width,
                            top: 0, bottom: 0,
                            background: OVERLOAD_COLOR, opacity: 0.14,
                            zIndex: 1, pointerEvents: "none",
                          }} />
                        ))}
                        {/* メンバーヘッダー行バー */}
                        <div style={{
                          height: 36, position: "relative",
                          borderBottom: "1px solid var(--color-border-primary)",
                          background: "var(--color-bg-secondary)",
                        }}>
                          {spanX !== null && spanW !== null && (
                            <div style={{
                              position: "absolute",
                              left: spanX + 2, width: Math.max(spanW - 4, 8),
                              top: "50%", transform: "translateY(-50%)",
                              height: 6, borderRadius: 3,
                              background: `${m.color_bg}`,
                              border: `1.5px solid ${m.color_text}`,
                              opacity: 0.6,
                            }} />
                          )}
                        </div>

                        {/* タスク行バー */}
                        {!isCollapsed && tasks.map(task => {
                          const preview = resizePreviewDates[task.id];
                          const effectiveTask = applyResizePreview(task, preview);
                          const due = toDate(effectiveTask.due_date);
                          const bar = calcTaskBar(effectiveTask, rangeStart, dayWidth);
                          const isDone = task.status === "done" || task.status === "cancelled";
                          const isOverdue = due && due < today && !suppressOverdue(task.status);
                          const isStagnant = isTaskStagnant(task);
                          const pj = task.project_id ? projectById.get(task.project_id) : undefined;
                          const barColor = isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : pj?.color_tag ?? m.color_text;
                          const hasRange = !!(effectiveTask.start_date && due && toDate(effectiveTask.start_date)! <= due);
                          const isHovered = hoveredTaskId === task.id;
                          const dateLabel = due ? (hasRange
                            ? `${toDate(effectiveTask.start_date!)!.getMonth()+1}/${toDate(effectiveTask.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                            : `${due.getMonth()+1}/${due.getDate()}`) : "";
                          const tooltip = `${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}${pj ? `\nPJ：${pj.name}` : ""}${isStagnant ? `\n⚠ ${STAGNANT_THRESHOLD_DAYS}日以上滞留` : ""}${criticalTaskIds.has(task.id) ? "\n🎯 クリティカルパス" : ""}`;
                          const { left: depBadgeLeft, right: depBadgeRight } = getDepBadgeTitles(task.id);
                          const { ghostBar, delayLabel, isDelayed } = getBaselineRender(task, bar);
                          return (
                            <TaskBarRow
                              key={task.id}
                              taskId={task.id}
                              bar={bar}
                              barColor={barColor}
                              borderRadius={hasRange ? "4px" : "9px"}
                              isDone={isDone}
                              isStagnant={isStagnant}
                              isHovered={isHovered}
                              isPreview={isPreview}
                              dateLabel={dateLabel}
                              tooltip={tooltip}
                              ghostBar={ghostBar}
                              delayLabel={delayLabel}
                              isDelayed={isDelayed}
                              depBadgeLeftTitle={depBadgeLeft}
                              depBadgeRightTitle={depBadgeRight}
                              linkUi={getLinkUi(task.id)}
                              isMoving={movingTaskIds?.has(task.id) ?? false}
                              isSelected={selectedTaskIds.has(task.id)}
                              isCritical={criticalTaskIds.has(task.id)}
                              progressFraction={progressFractionMap.get(task.id)}
                              onEdit={guardedHandleBarEdit}
                              onResize={guardedHandleResizeDragStart}
                              onResizeStart={guardedHandleStartResizeDragStart}
                              onMoveStart={guardedHandleMoveDragStart}
                              onMouseEnter={handleRowHoverEnter}
                              onMouseLeave={handleRowHoverLeave}
                              onEmptyDragStart={handleEmptyRowDragStart}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              ) : null}

              {viewMode === "pj" && visibleProjects.map(pj => {
                const orderedTasks = pjOrderedTasksMap.get(pj.id) ?? [];
                const pjTaskList   = orderedTasks.map(r => r.task);
                const isCollapsed  = collapsed[pj.id];

                // PJバーの範囲
                const pjStart = toDate(pj.start_date);
                const pjEnd   = toDate(pj.end_date);
                const pjBarX  = pjStart ? diffDays(rangeStart, pjStart) * dayWidth : null;
                const pjBarW  = (pjStart && pjEnd)
                  ? (diffDays(pjStart, pjEnd) + 1) * dayWidth : null;

                // PJの完了率（タスクから計算。完了数カウントにソートは不要）
                // cancelledはdoneと同じ「完了扱い」で分子に含める（M33解消・CLAUDE.md 2026-07-22）
                const done = pjTaskList.filter(t => isCompletedForProgress(t.status)).length;
                const pct  = pjTaskList.length > 0 ? done / pjTaskList.length : 0;

                // このPJのマイルストーン
                const pjMilestones = milestones.filter(ms => ms.project_id === pj.id);
                // マイルストーンのある列を、このPJの行ブロック内だけ淡く塗る（下にスクロールしても
                // 埋もれないようにする視認補助）。position:relativeのこのコンテナ自身の高さは
                // 通常フローの子（PJ行＋タスク行）で自然に決まるため、top:0/bottom:0で高さいっぱいに広がる
                const msBands = computeMilestoneBands(pjMilestones, rangeStart, dayWidth);

                return (
                  <div key={pj.id} style={{ position: "relative" }}>
                    {/* zIndex:1＝行の背景（position:relativeだがz-index:auto）より確実に前面、
                        タスクバー本体（zIndex:2）より確実に背面、という関係を明示的に固定する */}
                    {msBands.map(band => (
                      <div key={`msband-${band.x}`} style={{
                        position: "absolute", left: band.x, width: dayWidth,
                        top: 0, bottom: 0,
                        background: band.color, opacity: 0.12,
                        zIndex: 1, pointerEvents: "none",
                      }} />
                    ))}
                    {/* PJ行 */}
                    <div style={{
                      height: 36, position: "relative",
                      borderBottom: "1px solid var(--color-border-primary)",
                      background: "var(--color-bg-secondary)",
                    }}>
                      {pjBarX !== null && pjBarW !== null && (
                        <div style={{
                          position: "absolute",
                          left: pjBarX + 2, width: Math.max(pjBarW - 4, 8),
                          top: "50%", transform: "translateY(-50%)",
                          height: 14, borderRadius: 7,
                          background: `${pj.color_tag}33`,
                          border: `1.5px solid ${pj.color_tag}`,
                          overflow: "hidden",
                        }}>
                          {/* 進捗 */}
                          <div style={{
                            height: "100%", width: `${pct * 100}%`,
                            background: pj.color_tag, opacity: 0.5,
                            borderRadius: 7,
                          }} />
                        </div>
                      )}
                      {/* マイルストーン ◆ */}
                      {pjMilestones.map(ms => {
                        const msDate = toDate(ms.date);
                        if (!msDate) return null;
                        const msX = diffDays(rangeStart, msDate) * dayWidth + dayWidth / 2;
                        return (
                          <div
                            key={ms.id}
                            onMouseEnter={e => setHoveredMs({ ms, rect: e.currentTarget.getBoundingClientRect() })}
                            onMouseLeave={() => setHoveredMs(null)}
                            onClick={() => { if (!isPreview) { setHoveredMs(null); setEditingMs(ms); } }}
                            role="button" tabIndex={isPreview ? -1 : 0}
                            onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !isPreview) { setHoveredMs(null); setEditingMs(ms); } }}
                            title={isPreview ? undefined : "クリックして編集"}
                            style={{
                              position: "absolute",
                              left: msX - 7,
                              top: "50%", transform: "translateY(-50%) rotate(45deg)",
                              width: 12, height: 12,
                              background: MS_COLOR,
                              border: `2px solid ${MS_BORDER}`,
                              zIndex: 4,
                              pointerEvents: "auto",
                              cursor: isPreview ? "default" : "pointer",
                              flexShrink: 0,
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* タスク行（子タスクはバーを細く＝親と区別） */}
                    {!isCollapsed && orderedTasks.map(({ task, depth }) => {
                      // 親タスクが折りたたまれている子はスキップ
                      if (depth > 0 && collapsed[task.parent_task_id!]) return null;
                      const preview = resizePreviewDates[task.id];
                      // 親タスク（depth===0）のバーは子の最早開始〜最遅期日に合わせる
                      let effectiveTask = applyResizePreview(task, preview);
                      if (depth === 0 && !preview) {
                        const eff = parentEffectiveDates.get(task.id);
                        if (eff && (eff.start_date || eff.due_date)) {
                          effectiveTask = {
                            ...effectiveTask,
                            start_date: eff.start_date ?? effectiveTask.start_date,
                            due_date:   eff.due_date   ?? effectiveTask.due_date,
                          };
                        }
                      }
                      const due = toDate(effectiveTask.due_date);
                      const bar = calcTaskBar(effectiveTask, rangeStart, dayWidth);
                      const isDone = task.status === "done" || task.status === "cancelled";
                      const isOverdue = due && due < today && !suppressOverdue(task.status);
                      const isChanged = isPreview && previewChangedTaskIds?.has(task.id);
                      const isStagnant = isTaskStagnant(task);
                      // effectiveTask はバーの実描画範囲（親は子の最早〜最遅に上書き済み）なので
                      // hasRange・dateLabel も task ではなく effectiveTask から算出する
                      const hasRange = !!(effectiveTask.start_date && due && toDate(effectiveTask.start_date)! <= due);
                      const isHovered = hoveredTaskId === task.id;
                      const barColor = isChanged ? "var(--color-brand)" : isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : pj.color_tag;
                      const dateLabel = due ? (hasRange
                        ? `${toDate(effectiveTask.start_date!)!.getMonth()+1}/${toDate(effectiveTask.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                        : `${due.getMonth()+1}/${due.getDate()}`) : "";

                      const tooltip = `${depth > 0 ? "↳ 子タスク\n" : ""}${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}\n担当：${memberById.get(task.assignee_member_id)?.short_name}${isStagnant ? `\n⚠ ${STAGNANT_THRESHOLD_DAYS}日以上滞留` : ""}${criticalTaskIds.has(task.id) ? "\n🎯 クリティカルパス" : ""}`;
                      const { left: depBadgeLeft, right: depBadgeRight } = getDepBadgeTitles(task.id);
                      const { ghostBar, delayLabel, isDelayed } = getBaselineRender(task, bar);
                      return (
                        <TaskBarRow
                          key={task.id}
                          taskId={task.id}
                          bar={bar}
                          barColor={barColor}
                          barHeight={depth > 0 ? 12 : 18}
                          borderRadius={depth > 0 ? "6px" : hasRange ? "4px" : "9px"}
                          isDone={isDone}
                          isStagnant={isStagnant}
                          isChanged={isChanged}
                          isHovered={isHovered}
                          isPreview={isPreview}
                          dateLabel={dateLabel}
                          tooltip={tooltip}
                          ghostBar={ghostBar}
                          delayLabel={delayLabel}
                          isDelayed={isDelayed}
                          depBadgeLeftTitle={depBadgeLeft}
                          depBadgeRightTitle={depBadgeRight}
                          linkUi={getLinkUi(task.id)}
                          isMoving={movingTaskIds?.has(task.id) ?? false}
                          isSelected={selectedTaskIds.has(task.id)}
                          isCritical={criticalTaskIds.has(task.id)}
                          progressFraction={progressFractionMap.get(task.id)}
                          onEdit={guardedHandleBarEdit}
                          onResize={guardedHandleResizeDragStart}
                          onResizeStart={guardedHandleStartResizeDragStart}
                          onMoveStart={guardedHandleMoveDragStart}
                          onMouseEnter={handleRowHoverEnter}
                          onMouseLeave={handleRowHoverLeave}
                          onEmptyDragStart={handleEmptyRowDragStart}
                        />
                      );
                    })}
                    {/* 簡易タスク追加行スペーサー（CLAUDE.md v3.06）。左ラベル列は
                        GanttQuickAddTaskRow（高さ26px＋borderBottom 1px）をPJブロック末尾に
                        描画するが、右バー列には対応するタスク行が無い（バーを持たない見出し専用行の
                        ため）。styleを完全一致させることでbox-sizingに関係なく左右のPJブロック高さを
                        揃える（左右スクロールコンテナのscrollTop同期がズレる根本原因を断つ） */}
                    {!isCollapsed && !isPreview && (
                      <div style={{ height: QUICK_ADD_ROW_HEIGHT, borderBottom: "1px solid var(--color-border-primary)" }} />
                    )}
                  </div>
                );
              })}

              {/* ToDo系タスクグループ（バー）— PJ別ビューのみ */}
              {viewMode === "pj" && todoGroups.map(({ todoId, tasks }) => {
                const isCollapsed = collapsed[`todo_${todoId}`];
                const sortedTasks = todoGroupSortedMap.get(todoId) ?? sortTasks(tasks);
                // cancelledはdoneと同じ「完了扱い」で分子に含める（M33解消・CLAUDE.md 2026-07-22）
                const done = tasks.filter(t => isCompletedForProgress(t.status)).length;
                const pct  = tasks.length > 0 ? done / tasks.length : 0;
                return (
                  <div key={todoId}>
                    {/* ToDo行（進捗バーなし） */}
                    <div style={{
                      height: 36, position: "relative",
                      borderBottom: "1px solid var(--color-border-primary)",
                      background: "var(--color-bg-secondary)",
                      display: "flex", alignItems: "center", padding: "0 8px",
                    }}>
                      <div style={{
                        height: 8, borderRadius: 4,
                        background: `rgba(110,231,183,${0.2 + pct * 0.5})`,
                        border: `1.5px solid ${TODO_COLOR}`,
                        width: `${Math.max(pct * 100, 4)}%`,
                        minWidth: 4,
                      }} />
                    </div>
                    {!isCollapsed && sortedTasks.map(task => {
                      const preview = resizePreviewDates[task.id];
                      const effectiveTask = applyResizePreview(task, preview);
                      const due = toDate(effectiveTask.due_date);
                      const bar = calcTaskBar(effectiveTask, rangeStart, dayWidth);
                      const isDone = task.status === "done" || task.status === "cancelled";
                      const isOverdue = due && due < today && !suppressOverdue(task.status);
                      const isStagnant = isTaskStagnant(task);
                      const hasRange = !!(effectiveTask.start_date && due && toDate(effectiveTask.start_date)! <= due);
                      const isHovered = hoveredTaskId === task.id;
                      const dateLabel = due ? (hasRange
                        ? `${toDate(effectiveTask.start_date!)!.getMonth()+1}/${toDate(effectiveTask.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                        : `${due.getMonth()+1}/${due.getDate()}`) : "";
                      const tooltip = `${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}${isStagnant ? `\n⚠ ${STAGNANT_THRESHOLD_DAYS}日以上滞留` : ""}${criticalTaskIds.has(task.id) ? "\n🎯 クリティカルパス" : ""}`;
                      const { left: depBadgeLeft, right: depBadgeRight } = getDepBadgeTitles(task.id);
                      const { ghostBar, delayLabel, isDelayed } = getBaselineRender(task, bar);
                      return (
                        <TaskBarRow
                          key={task.id}
                          taskId={task.id}
                          bar={bar}
                          barColor={isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : TODO_COLOR}
                          borderRadius={hasRange ? "4px" : "9px"}
                          isDone={isDone}
                          isStagnant={isStagnant}
                          isHovered={isHovered}
                          isPreview={isPreview}
                          dateLabel={dateLabel}
                          tooltip={tooltip}
                          ghostBar={ghostBar}
                          delayLabel={delayLabel}
                          isDelayed={isDelayed}
                          depBadgeLeftTitle={depBadgeLeft}
                          depBadgeRightTitle={depBadgeRight}
                          linkUi={getLinkUi(task.id)}
                          isMoving={movingTaskIds?.has(task.id) ?? false}
                          isSelected={selectedTaskIds.has(task.id)}
                          isCritical={criticalTaskIds.has(task.id)}
                          progressFraction={progressFractionMap.get(task.id)}
                          onEdit={guardedHandleBarEdit}
                          onResize={guardedHandleResizeDragStart}
                          onResizeStart={guardedHandleStartResizeDragStart}
                          onMoveStart={guardedHandleMoveDragStart}
                          onMouseEnter={handleRowHoverEnter}
                          onMouseLeave={handleRowHoverLeave}
                          onEmptyDragStart={handleEmptyRowDragStart}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* タスクサイドパネル（PC・タブレット）— ガント本体の右側に追加。プレビューモードでは表示しない */}
        {!isPreview && !isMobile && editingTaskId && (
          <TaskSidePanel
            taskId={editingTaskId}
            currentUser={currentUser}
            onClose={() => setEditingTaskId(null)}
          />
        )}
      </div>

      {/* モバイル時のみ TaskEditModal でフルスクリーン表示 */}
      {!isPreview && isMobile && editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onDeleted={() => setEditingTaskId(null)}
        />
      )}

      {/* マイルストーン編集（◆クリック） */}
      {!isPreview && editingMs && (
        <MilestoneEditModal
          milestone={editingMs}
          currentUser={currentUser}
          project={projectById.get(editingMs.project_id) ?? null}
          onClose={() => setEditingMs(null)}
        />
      )}

      {/* マイルストーンツールチップ */}
      {hoveredMs && (() => {
        const { ms, rect } = hoveredMs;
        // ◆要素の BoundingRect を基準にツールチップを配置し、viewport からはみ出さないよう補正する
        const tipW = 200;
        const MARGIN = 8;
        const estimatedTipH = ms.description ? 90 : 56;
        // 横：◆の中心に合わせ、右端を超えたら左にずらす
        let left = rect.left + rect.width / 2 - tipW / 2;
        if (left + tipW > window.innerWidth - MARGIN) left = window.innerWidth - tipW - MARGIN;
        if (left < MARGIN) left = MARGIN;
        // 縦：◆の直下、はみ出すなら◆の直上
        let top = rect.bottom + MARGIN;
        if (top + estimatedTipH > window.innerHeight - MARGIN) top = rect.top - estimatedTipH - MARGIN;
        return (
          <div
            style={{
              position: "fixed",
              left,
              top,
              zIndex: 9999,
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              padding: "8px 10px",
              width: tipW,
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: ms.description ? "4px" : 0 }}>
              <div style={{
                width: 8, height: 8, background: MS_COLOR, border: `1.5px solid ${MS_BORDER}`,
                transform: "rotate(45deg)", flexShrink: 0,
              }} />
              <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", lineHeight: 1.3 }}>
                {ms.name}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", paddingLeft: "14px" }}>
              {ms.date}
            </div>
            {ms.description && (
              <div style={{
                fontSize: "11px", color: "var(--color-text-secondary)",
                marginTop: "4px", paddingLeft: "14px",
                whiteSpace: "pre-wrap", lineHeight: 1.4,
              }}>
                {ms.description}
              </div>
            )}
          </div>
        );
      })()}

      {/* ドラッグ中の日付ツールチップ（新規期間作成／リサイズ／移動の3ドラッグ共通。CLAUDE.md v3.04） */}
      {dragDateTooltip && (
        <div style={{
          position: "fixed", left: dragDateTooltip.x + 14, top: dragDateTooltip.y + 14,
          zIndex: 10000, pointerEvents: "none",
          background: "var(--color-text-primary)", color: "var(--color-bg-primary)",
          fontSize: "11px", fontWeight: 600, padding: "3px 8px",
          borderRadius: "var(--radius-md)", boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
        }}>
          {dragDateTooltip.label}
        </div>
      )}

      {/* 凡例 */}
      <div style={{
        padding: "6px 16px",
        borderTop: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-primary)",
        display: "flex", gap: "16px", flexShrink: 0,
      }}>
        {[
          { color: "var(--color-border-success)", label: "完了" },
          { color: "var(--color-border-danger)",  label: "期限超過" },
          { color: "var(--color-text-danger)",    label: "今日", isLine: true },
        ].map(({ color, label, isLine }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{
              width: isLine ? 2 : 12, height: isLine ? 12 : 8,
              background: color, borderRadius: isLine ? 1 : 4,
            }} />
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{
            width: 12, height: 8, borderRadius: 4,
            background: `linear-gradient(90deg, #818cf8 0%, #34d399 50%, ${MS_COLOR} 100%)`,
          }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>通常（PJカラー）</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{
            width: 10, height: 10,
            background: MS_COLOR, border: `2px solid ${MS_BORDER}`,
            transform: "rotate(45deg)", flexShrink: 0,
          }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>マイルストーン</span>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={toggleShortcutsPanel}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleShortcutsPanel(); } }}
          title="ガントの操作方法（Ctrl+クリックでの複数選択・ドラッグ操作等）一覧を表示"
          aria-pressed={showShortcutsPanel}
          style={{
            marginLeft: "auto",
            fontSize: "10px",
            color: "var(--color-text-tertiary)",
            cursor: "pointer",
          }}
        >⌨ ショートカット</span>
      </div>

      {!isShortcutsControlled && showShortcutsPanel && <ShortcutsPanel currentView="gantt" onClose={closeShortcutsPanel} />}
    </div>
  );
}


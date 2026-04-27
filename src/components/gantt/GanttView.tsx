// src/components/gantt/GanttView.tsx
//
// 【設計意図】
// ガントビュー。PJバー＋タスクバーの2層構造。
// - 横軸：日付（週単位で表示、日単位でスクロール）
// - 縦軸：PJ → タスク（PJをトグルで開閉可能）
// - 今日線：赤い縦線を常時表示
// - マイルストーン：◆で表示
// - ドラッグによる日程変更は将来実装（現時点はクリックで編集ダイアログ）

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo, Milestone } from "../../lib/localData/types";
import { toDate, toDateStr, addDays, diffDays, formatYM, getDaysInRange } from "../../lib/date";
import { KEYS } from "../../lib/localData/localStore";
import { TaskEditModal } from "../task/TaskEditModal";

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
}

// ===== 定数 =====

const DAY_WIDTH_DEFAULT = 28; // 1日あたりのデフォルトpx幅
const ZOOM_LEVELS = [14, 20, 28, 36, 48] as const;
const GANTT_ZOOM_KEY = "gantt_zoom";

function calcTaskBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  const due = toDate(task.due_date);
  if (!due) return null;
  const start = toDate(task.start_date ?? null);
  if (start && start <= due) {
    const barX = diffDays(rangeStart, start) * dayWidth;
    const barWidth = Math.max((diffDays(start, due) + 1) * dayWidth - 4, dayWidth - 4);
    return { barX, barWidth };
  }
  return { barX: diffDays(rangeStart, due) * dayWidth, barWidth: dayWidth - 4 };
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
}: Props) {
  const { tasks: rawTasks, members: rawMembers, todos: rawTodos, milestones: rawMilestones } = useAppData();
  const milestones = useMemo(
    () => (rawMilestones ?? []).filter((ms: Milestone) => !ms.is_deleted),
    [rawMilestones],
  );
  const isMobile = useIsMobile();
  // previewTasksが指定されている場合はそちらを優先する。KRフィルタが有効な場合はさらに絞り込む
  const allTasks = useMemo(() => {
    const base = previewTasks
      ? previewTasks.filter(t => !t.is_deleted)
      : rawTasks.filter(t => !t.is_deleted);
    return krTaskIds ? base.filter(t => krTaskIds.has(t.id)) : base;
  }, [previewTasks, rawTasks, krTaskIds]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);
  const todos    = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);

  // 表示するPJを絞り込む
  const visibleProjects = selectedProject ? [selectedProject] : projects;

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
    })).filter(g => g.todo != null);
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
      const saved = parseInt(localStorage.getItem(GANTT_ZOOM_KEY) ?? "", 10);
      return (ZOOM_LEVELS as readonly number[]).includes(saved) ? saved : DAY_WIDTH_DEFAULT;
    } catch { return DAY_WIDTH_DEFAULT; }
  });

  const totalWidth = days.length * dayWidth;

  // 今日のx座標
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayX = diffDays(rangeStart, today) * dayWidth;

  // タスク編集モーダル
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // マイルストーンホバーツールチップ
  const [hoveredMs, setHoveredMs] = useState<{ ms: Milestone; x: number; y: number } | null>(null);

  // PJの開閉状態
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const togglePJ = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  // ビューモード（PJ別 / 人別）
  const [viewMode, setViewMode] = useState<"pj" | "person">("pj");

  // 人別ビュー用データ：担当者ごとにタスクをグループ化
  const personGroups = useMemo(() => {
    return members
      .map(m => {
        const tasks = allTasks
          .filter(t => t.assignee_member_id === m.id)
          .sort((a, b) => {
            const da = toDate(a.due_date);
            const db = toDate(b.due_date);
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.getTime() - db.getTime();
          });
        return { member: m, tasks };
      })
      .filter(g => g.tasks.length > 0);
  }, [members, allTasks]);

  // 全開・全閉
  const expandAll  = () => setCollapsed({});
  const collapseAll = () => {
    const m: Record<string, boolean> = {};
    visibleProjects.forEach(p => { m[p.id] = true; });
    setCollapsed(m);
  };

  // スクロール位置の永続化（中心日付をlocalStorageに保存）
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollInitialized = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const labelBodyRef    = useRef<HTMLDivElement>(null);
  const syncingRef      = useRef(false);

  // 初回マウント時のみ実行：保存済み日付があればそこへ、なければ今日へ
  useEffect(() => {
    if (!scrollRef.current || scrollInitialized.current || days.length === 0) return;
    scrollInitialized.current = true;
    const saved = localStorage.getItem(KEYS.GANTT_CENTER_DATE);
    const targetDate = saved ? toDate(saved) : null;
    const targetX = targetDate
      ? diffDays(rangeStart, targetDate) * dayWidth
      : todayX;
    scrollRef.current.scrollLeft = Math.max(0, targetX - scrollRef.current.clientWidth / 2);
  }, [days, rangeStart, todayX, dayWidth]);

  const handleGanttScroll = useCallback(() => {
    clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const centerX = el.scrollLeft + el.clientWidth / 2;
      const idx = Math.floor(centerX / dayWidth);
      if (days[idx]) localStorage.setItem(KEYS.GANTT_CENTER_DATE, toDateStr(days[idx]));
    }, 300);
    // 縦スクロールをラベル列と同期
    if (!syncingRef.current && labelBodyRef.current && scrollRef.current) {
      syncingRef.current = true;
      labelBodyRef.current.scrollTop = scrollRef.current.scrollTop;
      syncingRef.current = false;
    }
  }, [days]);

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
      const idx = (ZOOM_LEVELS as readonly number[]).indexOf(cur);
      if (idx < 0 || idx >= ZOOM_LEVELS.length - 1) return cur;
      const next = ZOOM_LEVELS[idx + 1];
      localStorage.setItem(GANTT_ZOOM_KEY, String(next));
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setDayWidth(cur => {
      const idx = (ZOOM_LEVELS as readonly number[]).indexOf(cur);
      if (idx <= 0) return cur;
      const next = ZOOM_LEVELS[idx - 1];
      localStorage.setItem(GANTT_ZOOM_KEY, String(next));
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

  const GANTT_LABEL_KEY = "gantt_label_width";
  const [labelWidth, setLabelWidth] = useState(() => {
    if (isMobile) return 110;
    try { return parseInt(localStorage.getItem(GANTT_LABEL_KEY) ?? "200", 10) || 200; } catch { return 200; }
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
      try { localStorage.setItem(GANTT_LABEL_KEY, String(labelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  useEffect(() => {
    document.body.style.cursor     = isResizing ? "col-resize" : "";
    document.body.style.userSelect = isResizing ? "none" : "";
    return () => { document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [isResizing]);

  const scrollToToday = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, todayX - scrollRef.current.clientWidth / 2);
  }, [todayX]);

  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

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
        {!isPreview && viewMode === "pj" && <button onClick={expandAll}  style={headerBtnStyle}>すべて開く</button>}
        {!isPreview && viewMode === "pj" && <button onClick={collapseAll} style={headerBtnStyle}>すべて閉じる</button>}
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
        }}>
          {/* ラベルヘッダー */}
          <div style={{
            height: 52, borderBottom: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-secondary)",
            display: "flex", alignItems: "flex-end", padding: "0 10px 6px",
            fontSize: "11px", color: "var(--color-text-tertiary)",
          }}>
            タスク
          </div>

          {/* ラベル行 */}
          <div
            ref={labelBodyRef}
            onScroll={handleLabelScroll}
            style={{ overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none" }}
          >
            {viewMode === "pj" ? (
              <>
                {visibleProjects.map(pj => {
                  const pjTasks = allTasks.filter(t => t.project_id === pj.id);
                  const isCollapsed = collapsed[pj.id];
                  return (
                    <div key={pj.id}>
                      {/* PJ行ラベル */}
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: "pointer",
                      }} onClick={() => togglePJ(pj.id)}>
                        <span style={{
                          fontSize: "11px", color: "var(--color-text-secondary)",
                          transition: "transform 0.15s",
                          display: "inline-block",
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        }}>▾</span>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: pj.color_tag, flexShrink: 0,
                        }} />
                        <span style={{
                          fontSize: "11px", fontWeight: "500",
                          color: "var(--color-text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          flex: 1,
                        }}>
                          {pj.name.length > 14 ? pj.name.slice(0, 14) + "…" : pj.name}
                        </span>
                      </div>

                      {/* タスク行ラベル */}
                      {!isCollapsed && pjTasks.map(task => {
                        const m = members.find(mb => mb.id === task.assignee_member_id);
                        return (
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)}
                            onMouseEnter={() => setHoveredTaskId(task.id)}
                            onMouseLeave={() => setHoveredTaskId(null)}
                            style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "6px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: hoveredTaskId === task.id ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                            cursor: "pointer", transition: "background 0.1s",
                          }}>
                            <StatusDot status={task.status} />
                            <span style={{
                              fontSize: "11px", color: "var(--color-text-secondary)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              flex: 1,
                            }}>
                              {task.name}
                            </span>
                            {m && (
                              <div style={{
                                width: 16, height: 16, borderRadius: "50%",
                                background: m.color_bg, color: m.color_text,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "8px", fontWeight: "600", flexShrink: 0,
                              }}>
                                {m.initials.slice(0, 1)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* ToDo系タスクグループ（ラベル） */}
                {todoGroups.map(({ todo, todoId, tasks }) => {
                  const isCollapsed = collapsed[`todo_${todoId}`];
                  return (
                    <div key={todoId}>
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: "pointer",
                      }} onClick={() => togglePJ(`todo_${todoId}`)}>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", transition: "transform 0.15s", display: "inline-block", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6ee7b7", flexShrink: 0 }} />
                        <span style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {`[ToDo] ${(todo!.title.split("\n")[0]).slice(0, 14)}${todo!.title.length > 14 ? "…" : ""}`}
                        </span>
                      </div>
                      {!isCollapsed && tasks.map(task => {
                        const m = members.find(mb => mb.id === task.assignee_member_id);
                        return (
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)}
                            onMouseEnter={() => setHoveredTaskId(task.id)}
                            onMouseLeave={() => setHoveredTaskId(null)}
                            style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "6px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: hoveredTaskId === task.id ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                            cursor: "pointer", transition: "background 0.1s",
                          }}>
                            <StatusDot status={task.status} />
                            <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                              {task.name}
                            </span>
                            {m && (
                              <div style={{ width: 16, height: 16, borderRadius: "50%", background: m.color_bg, color: m.color_text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", fontWeight: "600", flexShrink: 0 }}>
                                {m.initials.slice(0, 1)}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                  return (
                    <div key={m.id}>
                      {/* メンバーヘッダー行 */}
                      <div style={{
                        height: 36, display: "flex", alignItems: "center",
                        gap: "6px", padding: "0 8px 0 10px",
                        background: "var(--color-bg-secondary)",
                        borderBottom: "1px solid var(--color-border-primary)",
                        cursor: "pointer",
                      }} onClick={() => togglePJ(`person_${m.id}`)}>
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
                      </div>

                      {/* タスク行 */}
                      {!isCollapsed && tasks.map(task => {
                        const pj = projects.find(p => p.id === task.project_id);
                        const isOverdue = (() => {
                          const due = toDate(task.due_date);
                          return due && due < today && task.status !== "done";
                        })();
                        return (
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)}
                            onMouseEnter={() => setHoveredTaskId(task.id)}
                            onMouseLeave={() => setHoveredTaskId(null)}
                            style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "5px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: hoveredTaskId === task.id ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                            cursor: "pointer", transition: "background 0.1s",
                          }}>
                            <StatusDot status={task.status} />
                            {/* PJカラードット */}
                            {pj && (
                              <div style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: pj.color_tag, flexShrink: 0,
                              }} />
                            )}
                            <span style={{
                              fontSize: "11px",
                              color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              flex: 1,
                            }}>
                              {task.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* リサイズハンドル */}
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
              <div style={{ height: 24, position: "relative", borderBottom: "1px solid var(--color-border-primary)" }}>
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
              {/* 日ラベル行 */}
              <div style={{ height: 28, position: "relative" }}>
                {days.map((d, i) => {
                  const isSun = d.getDay() === 0;
                  const isSat = d.getDay() === 6;
                  const isToday = toDateStr(d) === toDateStr(today);
                  const isFirst = d.getDate() === 1 || i === 0;
                  return (
                    <div key={i} style={{
                      position: "absolute",
                      left: i * dayWidth, width: dayWidth,
                      height: "100%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "9px",
                      fontWeight: isToday ? "700" : "400",
                      color: isToday
                        ? "#fff"
                        : isSun ? "var(--color-text-danger)"
                        : isSat ? "var(--color-text-info)"
                        : "var(--color-text-tertiary)",
                      background: isToday ? "var(--color-brand)" : "transparent",
                      borderRadius: isToday ? "3px" : "0",
                      borderLeft: isFirst ? "1px solid var(--color-border-primary)" : "none",
                    }}>
                      {isFirst && i > 0
                        ? `${d.getMonth() + 1}/${d.getDate()}`
                        : d.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ボディ */}
            <div style={{ position: "relative" }}>
              {/* 縦罫線 + 土日背景色 */}
              {days.map((d, i) => {
                const isSun = d.getDay() === 0;
                const isSat = d.getDay() === 6;
                const isMon = d.getDay() === 1;
                const isMonthStart = d.getDate() === 1;
                return (
                  <div key={i} style={{
                    position: "absolute", left: i * dayWidth, width: dayWidth,
                    top: 0, bottom: 0,
                    background: isSun
                      ? "rgba(239,68,68,0.05)"
                      : isSat
                      ? "rgba(59,130,246,0.05)"
                      : "transparent",
                    borderLeft: isMonthStart
                      ? "2px solid var(--color-border-primary)"
                      : isMon
                      ? "1px solid var(--color-border-secondary)"
                      : "none",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                  }} />
                );
              })}

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
                    return (
                      <div key={m.id}>
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
                          const due = toDate(task.due_date);
                          const bar = calcTaskBar(task, rangeStart, dayWidth);
                          const isDone = task.status === "done";
                          const isOverdue = due && due < today && !isDone;
                          const pj = projects.find(p => p.id === task.project_id);
                          const barColor = isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : pj?.color_tag ?? m.color_text;
                          const hasRange = !!(task.start_date && due && toDate(task.start_date)! <= due);
                          const isHovered = hoveredTaskId === task.id;
                          const dateLabel = due ? (hasRange
                            ? `${toDate(task.start_date!)!.getMonth()+1}/${toDate(task.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                            : `${due.getMonth()+1}/${due.getDate()}`) : "";
                          return (
                            <div key={task.id}
                              onMouseEnter={() => setHoveredTaskId(task.id)}
                              onMouseLeave={() => setHoveredTaskId(null)}
                              style={{
                                height: 30, position: "relative",
                                borderBottom: "1px solid var(--color-border-primary)",
                                background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                                transition: "background 0.1s",
                              }}>
                              {bar && due && (
                                <div
                                  title={`${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}${pj ? `\nPJ：${pj.name}` : ""}`}
                                  onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
                                  style={{
                                    position: "absolute",
                                    left: bar.barX, top: "50%", transform: "translateY(-50%)",
                                    width: bar.barWidth, height: 18,
                                    borderRadius: hasRange ? "4px" : "9px",
                                    background: barColor,
                                    opacity: isDone ? 0.5 : 1,
                                    cursor: isPreview ? "default" : "pointer",
                                    zIndex: 2,
                                    overflow: "hidden",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    filter: isHovered && !isPreview ? "brightness(1.15)" : "none",
                                    transition: "filter 0.1s",
                                  }}
                                >
                                  {bar.barWidth > 52 && (
                                    <span style={{
                                      fontSize: "8px", color: "rgba(255,255,255,0.9)", fontWeight: "500",
                                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                      padding: "0 4px", pointerEvents: "none",
                                    }}>{dateLabel}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              ) : null}

              {viewMode === "pj" && visibleProjects.map(pj => {
                const pjTasks = allTasks.filter(t => t.project_id === pj.id);
                const isCollapsed = collapsed[pj.id];

                // PJバーの範囲
                const pjStart = toDate(pj.start_date);
                const pjEnd   = toDate(pj.end_date);
                const pjBarX  = pjStart ? diffDays(rangeStart, pjStart) * dayWidth : null;
                const pjBarW  = (pjStart && pjEnd)
                  ? (diffDays(pjStart, pjEnd) + 1) * dayWidth : null;

                // PJの完了率（タスクから計算）
                const done = pjTasks.filter(t => t.status === "done").length;
                const pct  = pjTasks.length > 0 ? done / pjTasks.length : 0;

                // このPJのマイルストーン
                const pjMilestones = milestones.filter(ms => ms.project_id === pj.id);

                return (
                  <div key={pj.id}>
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
                            onMouseEnter={e => setHoveredMs({ ms, x: e.clientX, y: e.clientY })}
                            onMouseMove={e => setHoveredMs(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={() => setHoveredMs(null)}
                            style={{
                              position: "absolute",
                              left: msX - 7,
                              top: "50%", transform: "translateY(-50%) rotate(45deg)",
                              width: 12, height: 12,
                              background: "#f59e0b",
                              border: "2px solid #d97706",
                              zIndex: 4,
                              pointerEvents: "auto",
                              cursor: "default",
                              flexShrink: 0,
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* タスク行 */}
                    {!isCollapsed && pjTasks.map(task => {
                      const due = toDate(task.due_date);
                      const bar = calcTaskBar(task, rangeStart, dayWidth);
                      const isDone = task.status === "done";
                      const isOverdue = due && due < today && !isDone;
                      const isChanged = isPreview && previewChangedTaskIds?.has(task.id);
                      const hasRange = !!(task.start_date && due && toDate(task.start_date)! <= due);
                      const isHovered = hoveredTaskId === task.id;
                      const barColor = isChanged ? "var(--color-brand)" : isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : pj.color_tag;
                      const dateLabel = due ? (hasRange
                        ? `${toDate(task.start_date!)!.getMonth()+1}/${toDate(task.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                        : `${due.getMonth()+1}/${due.getDate()}`) : "";

                      return (
                        <div key={task.id}
                          onMouseEnter={() => setHoveredTaskId(task.id)}
                          onMouseLeave={() => setHoveredTaskId(null)}
                          style={{
                            height: 30, position: "relative",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: isChanged ? "rgba(127,119,221,0.06)" : isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                            transition: "background 0.1s",
                          }}>
                          {bar && due && (
                            <div
                              title={`${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}\n担当：${members.find(m => m.id === task.assignee_member_id)?.short_name}`}
                              onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
                              style={{
                                position: "absolute",
                                left: bar.barX, top: "50%", transform: "translateY(-50%)",
                                width: bar.barWidth, height: 18,
                                borderRadius: hasRange ? "4px" : "9px",
                                background: barColor,
                                opacity: isDone ? 0.5 : 1,
                                cursor: isPreview ? "default" : "pointer",
                                zIndex: 2,
                                outline: isChanged ? "2px solid var(--color-brand)" : "none",
                                outlineOffset: "1px",
                                overflow: "hidden",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                filter: isHovered && !isPreview ? "brightness(1.15)" : "none",
                                transition: "filter 0.1s",
                              }}
                            >
                              {bar.barWidth > 52 && (
                                <span style={{
                                  fontSize: "8px", color: "rgba(255,255,255,0.9)", fontWeight: "500",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  padding: "0 4px", pointerEvents: "none",
                                }}>{dateLabel}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* ToDo系タスクグループ（バー）— PJ別ビューのみ */}
              {viewMode === "pj" && todoGroups.map(({ todoId, tasks }) => {
                const isCollapsed = collapsed[`todo_${todoId}`];
                const done = tasks.filter(t => t.status === "done").length;
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
                        border: "1.5px solid #6ee7b7",
                        width: `${Math.max(pct * 100, 4)}%`,
                        minWidth: 4,
                      }} />
                    </div>
                    {!isCollapsed && tasks.map(task => {
                      const due = toDate(task.due_date);
                      const bar = calcTaskBar(task, rangeStart, dayWidth);
                      const isDone = task.status === "done";
                      const isOverdue = due && due < today && !isDone;
                      const hasRange = !!(task.start_date && due && toDate(task.start_date)! <= due);
                      const isHovered = hoveredTaskId === task.id;
                      const dateLabel = due ? (hasRange
                        ? `${toDate(task.start_date!)!.getMonth()+1}/${toDate(task.start_date!)!.getDate()}〜${due.getMonth()+1}/${due.getDate()}`
                        : `${due.getMonth()+1}/${due.getDate()}`) : "";
                      return (
                        <div key={task.id}
                          onMouseEnter={() => setHoveredTaskId(task.id)}
                          onMouseLeave={() => setHoveredTaskId(null)}
                          style={{
                            height: 30, position: "relative",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
                            transition: "background 0.1s",
                          }}>
                          {bar && due && (
                            <div
                              title={`${task.name}${task.start_date ? `\n開始：${task.start_date}` : ""}\n期日：${task.due_date}`}
                              onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
                              style={{
                                position: "absolute", left: bar.barX, top: "50%", transform: "translateY(-50%)",
                                width: bar.barWidth, height: 18,
                                borderRadius: hasRange ? "4px" : "9px",
                                background: isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : "#6ee7b7",
                                opacity: isDone ? 0.5 : 1,
                                cursor: isPreview ? "default" : "pointer",
                                zIndex: 2,
                                overflow: "hidden",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                filter: isHovered && !isPreview ? "brightness(1.15)" : "none",
                                transition: "filter 0.1s",
                              }}
                            >
                              {bar.barWidth > 52 && (
                                <span style={{
                                  fontSize: "8px", color: "rgba(255,255,255,0.9)", fontWeight: "500",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  padding: "0 4px", pointerEvents: "none",
                                }}>{dateLabel}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* タスク編集モーダル（プレビューモードでは表示しない） */}
      {!isPreview && editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onUpdated={() => setEditingTaskId(null)}
          onDeleted={() => setEditingTaskId(null)}
        />
      )}

      {/* マイルストーンツールチップ */}
      {hoveredMs && (() => {
        const { ms, x, y } = hoveredMs;
        // 画面右端・下端からはみ出さないように位置を調整
        const tipW = 200;
        const left = x + 14 + tipW > window.innerWidth ? x - tipW - 6 : x + 14;
        const top  = y + 10;
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
                width: 8, height: 8, background: "#f59e0b", border: "1.5px solid #d97706",
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
            background: "linear-gradient(90deg, #818cf8 0%, #34d399 50%, #f59e0b 100%)",
          }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>通常（PJカラー）</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{
            width: 10, height: 10,
            background: "#f59e0b", border: "2px solid #d97706",
            transform: "rotate(45deg)", flexShrink: 0,
          }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>マイルストーン</span>
        </div>
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function StatusDot({ status }: { status: Task["status"] }) {
  const colors = {
    todo: "var(--color-border-secondary)",
    in_progress: "var(--color-text-info)",
    done: "var(--color-text-success)",
  };
  return (
    <div style={{
      width: 6, height: 6, borderRadius: "50%",
      background: colors[status], flexShrink: 0,
    }} />
  );
}

const headerBtnStyle: React.CSSProperties = {
  padding: "4px 10px", fontSize: "11px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};

function ZoomIcon({ minus = false }: { minus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: "block" }}>
      {/* 虫眼鏡の円 */}
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      {/* ハンドル */}
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* 横棒（共通） */}
      <line x1="3.8" y1="6" x2="8.2" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* 縦棒（＋のみ） */}
      {!minus && <line x1="6" y1="3.8" x2="6" y2="8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

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
import { TaskEditModal } from "../task/TaskEditModal";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
  /** プレビューモード：指定された場合はAppDataContextのtasksの代わりにこれを使う */
  previewTasks?: Task[];
  /** プレビューモード：trueの場合はヘッダーにラベルを表示し、タスク編集モーダルを無効化する */
  isPreview?: boolean;
  /** プレビューモード：変更されたタスクIDのセット（ハイライト表示） */
  previewChangedTaskIds?: Set<string>;
}

// ===== 日付ユーティリティ =====

const DAY_WIDTH = 28; // 1日あたりのpx幅

function toDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatMonth(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function getDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endN = new Date(end);
  endN.setHours(0, 0, 0, 0);
  while (cur <= endN) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  return days;
}

// ===== メインコンポーネント =====

export function GanttView({
  currentUser,
  selectedProject,
  projects,
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
  // previewTasksが指定されている場合はそちらを優先する
  const allTasks = useMemo(
    () => previewTasks
      ? previewTasks.filter(t => !t.is_deleted)
      : rawTasks.filter(t => !t.is_deleted),
    [previewTasks, rawTasks],
  );
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
      const s = toDate(task.due_date);
      if (s && s < minD) minD = new Date(s);
      if (s && s > maxD) maxD = new Date(s);
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

  const totalWidth = days.length * DAY_WIDTH;

  // 今日のx座標
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayX = diffDays(rangeStart, today) * DAY_WIDTH;

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
  const GANTT_SCROLL_KEY = "gantt_center_date";
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollInitialized = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout>>();

  // 初回マウント時のみ実行：保存済み日付があればそこへ、なければ今日へ
  useEffect(() => {
    if (!scrollRef.current || scrollInitialized.current || days.length === 0) return;
    scrollInitialized.current = true;
    const saved = localStorage.getItem(GANTT_SCROLL_KEY);
    const targetDate = saved ? toDate(saved) : null;
    const targetX = targetDate
      ? diffDays(rangeStart, targetDate) * DAY_WIDTH
      : todayX;
    scrollRef.current.scrollLeft = Math.max(0, targetX - scrollRef.current.clientWidth / 2);
  }, [days, rangeStart, todayX]);

  // スクロール時に中心日付をlocalStorageへ保存（300ms debounce）
  const handleGanttScroll = useCallback(() => {
    clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const centerX = el.scrollLeft + el.clientWidth / 2;
      const idx = Math.floor(centerX / DAY_WIDTH);
      if (days[idx]) localStorage.setItem(GANTT_SCROLL_KEY, dateStr(days[idx]));
    }, 300);
  }, [days]);

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
            label: formatMonth(days[startIdx]),
            startX: startIdx * DAY_WIDTH,
            width: (i - startIdx) * DAY_WIDTH,
          });
        }
        curMonth = m;
        startIdx = i;
      }
    });
    groups.push({
      label: formatMonth(days[startIdx]),
      startX: startIdx * DAY_WIDTH,
      width: (days.length - startIdx) * DAY_WIDTH,
    });
    return groups;
  }, [days]);

  const LABEL_WIDTH = isMobile ? 110 : 200; // 左の行ラベル幅

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
          {selectedProject ? selectedProject.name : "全プロジェクト"}
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
      </div>

      {/* ガント本体 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* 左ラベル列（固定） */}
        <div style={{
          width: LABEL_WIDTH, flexShrink: 0,
          borderRight: "1px solid var(--color-border-primary)",
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
          <div style={{ overflow: "hidden" }}>
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
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)} style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "6px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: "var(--color-bg-primary)",
                            cursor: "pointer",
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
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)} style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "6px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: "var(--color-bg-primary)",
                            cursor: "pointer",
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
                          <div key={task.id} onClick={() => setEditingTaskId(task.id)} style={{
                            height: 30, display: "flex", alignItems: "center",
                            gap: "5px", padding: "0 8px 0 26px",
                            borderBottom: "1px solid var(--color-border-primary)",
                            background: "var(--color-bg-primary)",
                            cursor: "pointer",
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
                  const isToday = dateStr(d) === dateStr(today);
                  const isFirst = d.getDate() === 1 || i === 0;
                  return (
                    <div key={i} style={{
                      position: "absolute",
                      left: i * DAY_WIDTH, width: DAY_WIDTH,
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
                    position: "absolute", left: i * DAY_WIDTH, width: DAY_WIDTH,
                    top: 0, bottom: 0,
                    background: isSun
                      ? "rgba(239,68,68,0.05)"
                      : isSat
                      ? "rgba(59,130,246,0.05)"
                      : "transparent",
                    borderLeft: isMonthStart
                      ? "1px solid var(--color-border-primary)"
                      : isMon
                      ? "1px solid var(--color-border-secondary)"
                      : "1px solid var(--color-border-primary)",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                  }} />
                );
              })}

              {/* 今日線 */}
              <div style={{
                position: "absolute",
                left: todayX + DAY_WIDTH / 2,
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
                    const spanX = earliest ? diffDays(rangeStart, earliest) * DAY_WIDTH : null;
                    const spanW = (earliest && latest) ? (diffDays(earliest, latest) + 1) * DAY_WIDTH : null;
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
                          const barX = due ? diffDays(rangeStart, due) * DAY_WIDTH : null;
                          const isDone = task.status === "done";
                          const isOverdue = due && due < today && !isDone;
                          const pj = projects.find(p => p.id === task.project_id);
                          const barColor = isDone
                            ? "var(--color-border-success)"
                            : isOverdue
                            ? "var(--color-border-danger)"
                            : pj?.color_tag ?? m.color_text;
                          return (
                            <div key={task.id} style={{
                              height: 30, position: "relative",
                              borderBottom: "1px solid var(--color-border-primary)",
                              background: "var(--color-bg-primary)",
                            }}>
                              {barX !== null && due && (
                                <>
                                  <div
                                    title={`${task.name}\n期日：${task.due_date}${pj ? `\nPJ：${pj.name}` : ""}`}
                                    onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
                                    style={{
                                      position: "absolute",
                                      left: barX, top: "50%", transform: "translateY(-50%)",
                                      width: DAY_WIDTH - 4, height: 10, borderRadius: 5,
                                      background: barColor,
                                      opacity: isDone ? 0.6 : 1,
                                      cursor: isPreview ? "default" : "pointer",
                                      zIndex: 2,
                                    }}
                                  />
                                  <div style={{
                                    position: "absolute",
                                    left: barX + DAY_WIDTH / 2, top: 2,
                                    fontSize: "8px",
                                    color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
                                    transform: "translateX(-50%)", whiteSpace: "nowrap", pointerEvents: "none",
                                  }}>
                                    {due.getMonth() + 1}/{due.getDate()}
                                  </div>
                                </>
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
                const pjBarX  = pjStart ? diffDays(rangeStart, pjStart) * DAY_WIDTH : null;
                const pjBarW  = (pjStart && pjEnd)
                  ? (diffDays(pjStart, pjEnd) + 1) * DAY_WIDTH : null;

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
                        const msX = diffDays(rangeStart, msDate) * DAY_WIDTH + DAY_WIDTH / 2;
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
                      const barX = due ? diffDays(rangeStart, due) * DAY_WIDTH : null;
                      const isDone = task.status === "done";
                      const isOverdue = due && due < today && !isDone;
                      const isChanged = isPreview && previewChangedTaskIds?.has(task.id);

                      return (
                        <div key={task.id} style={{
                          height: 30, position: "relative",
                          borderBottom: "1px solid var(--color-border-primary)",
                          background: isChanged ? "rgba(127,119,221,0.06)" : "var(--color-bg-primary)",
                        }}>
                          {barX !== null && due && (
                            <>
                              {/* タスクバー（期日が1点なので幅固定） */}
                              <div
                                title={`${task.name}\n期日：${task.due_date}\n担当：${members.find(m => m.id === task.assignee_member_id)?.short_name}`}
                                onClick={() => {
                                  if (!isPreview) setEditingTaskId(task.id);
                                }}
                                style={{
                                  position: "absolute",
                                  left: barX,
                                  top: "50%", transform: "translateY(-50%)",
                                  width: DAY_WIDTH - 4, height: 10,
                                  borderRadius: 5,
                                  background: isChanged
                                    ? "var(--color-brand)"
                                    : isDone
                                    ? "var(--color-border-success)"
                                    : isOverdue
                                    ? "var(--color-border-danger)"
                                    : pj.color_tag,
                                  opacity: isDone ? 0.6 : 1,
                                  cursor: isPreview ? "default" : "pointer",
                                  zIndex: 2,
                                  // 変更されたタスクはリング表示で強調
                                  outline: isChanged ? "2px solid var(--color-brand)" : "none",
                                  outlineOffset: "1px",
                                }}
                              />
                              {/* 期日ラベル（due_dateの上） */}
                              <div style={{
                                position: "absolute",
                                left: barX + DAY_WIDTH / 2,
                                top: 2,
                                fontSize: "8px",
                                color: isChanged
                                  ? "var(--color-brand)"
                                  : isOverdue
                                  ? "var(--color-text-danger)"
                                  : "var(--color-text-tertiary)",
                                transform: "translateX(-50%)",
                                whiteSpace: "nowrap",
                                pointerEvents: "none",
                                fontWeight: isChanged ? "700" : "400",
                              }}>
                                {due.getMonth() + 1}/{due.getDate()}
                              </div>
                            </>
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
                      const barX = due ? diffDays(rangeStart, due) * DAY_WIDTH : null;
                      const isDone = task.status === "done";
                      const isOverdue = due && due < today && !isDone;
                      return (
                        <div key={task.id} style={{
                          height: 30, position: "relative",
                          borderBottom: "1px solid var(--color-border-primary)",
                          background: "var(--color-bg-primary)",
                        }}>
                          {barX !== null && due && (
                            <>
                              <div
                                title={`${task.name}\n期日：${task.due_date}`}
                                onClick={() => { if (!isPreview) setEditingTaskId(task.id); }}
                                style={{
                                  position: "absolute", left: barX, top: "50%", transform: "translateY(-50%)",
                                  width: DAY_WIDTH - 4, height: 10, borderRadius: 5,
                                  background: isDone ? "var(--color-border-success)" : isOverdue ? "var(--color-border-danger)" : "#6ee7b7",
                                  opacity: isDone ? 0.6 : 1,
                                  cursor: isPreview ? "default" : "pointer",
                                  zIndex: 2,
                                }}
                              />
                              <div style={{
                                position: "absolute", left: barX + DAY_WIDTH / 2, top: 2,
                                fontSize: "8px", color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
                                transform: "translateX(-50%)", whiteSpace: "nowrap", pointerEvents: "none",
                              }}>
                                {due.getMonth() + 1}/{due.getDate()}
                              </div>
                            </>
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
          { color: "var(--color-border-danger)", label: "期限超過" },
          { color: "var(--color-border-secondary)", label: "進行中/未着手" },
          { color: "var(--color-text-danger)", label: "今日" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{
              width: label === "今日" ? 2 : 12, height: label === "今日" ? 12 : 8,
              background: color, borderRadius: label === "今日" ? 1 : 4,
            }} />
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{label}</span>
          </div>
        ))}
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

// src/components/dashboard/DashboardView.tsx
//
// 【設計意図】
// ダッシュボード。4つのセクションで構成。
// 1. OKRサマリー：KRごとのタスク完了率バー（KR進捗率の暫定実装）
// 2. 今週のタスク：今日〜7日以内に期限のタスク一覧
// 3. 期限アラート：期限超過・本日期限のタスク（赤バッジ）
// 4. PJ進捗一覧：全PJのタスク完了率
//
// フィルター：「自分のみ/全員」トグル＋PJチップ（複数選択）
//
// KR進捗率の計算方針（未決定論点Aの暫定解）：
// 「そのKRに紐づくTF→PJ→タスクの完了率の平均」で計算する。
// 手動入力方式はPhase 5以降で検討。

import { useState, useMemo, useCallback } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  Member, Project, Task, KeyResult, TaskForce, ProjectTaskForce, ToDo,
} from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";

interface Props {
  currentUser: Member;
  projects: Project[];
}

// ===== 日付ユーティリティ =====

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function formatDateShort(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function diffDaysFromToday(s: string): number {
  const t = new Date(today());
  const d = new Date(s);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

// ===== メインコンポーネント =====

export function DashboardView({ currentUser, projects }: Props) {
  const {
    tasks: rawTasks, members: rawMembers, keyResults: rawKrs,
    taskForces: rawTfs, projectTaskForces: rawPtfs, todos: rawTodos,
  } = useAppData();
  const isMobile = useIsMobile();

  const [myOnly, setMyOnly] = useState(false);
  const [selectedPjIds, setSelectedPjIds] = useState<string[]>([]);
  const [activeKrId, setActiveKrId] = useState<string | null>(null);

  // リマインダー設定（localStorage で永続化）
  const REMINDER_KEY = "reminder_days";
  const [reminderDays, setReminderDaysState] = useState<number>(() => {
    const saved = localStorage.getItem(REMINDER_KEY);
    return saved ? Math.max(1, parseInt(saved, 10) || 7) : 7;
  });
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderInput, setReminderInput] = useState(String(reminderDays));

  const applyReminderDays = useCallback(() => {
    const n = Math.max(1, parseInt(reminderInput, 10) || 7);
    setReminderDaysState(n);
    setReminderInput(String(n));
    localStorage.setItem(REMINDER_KEY, String(n));
    setEditingReminder(false);
  }, [reminderInput]);

  const allTasks = useMemo(() => rawTasks.filter(t => !t.is_deleted), [rawTasks]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);
  const krs      = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);
  const tfs      = useMemo(() => rawTfs.filter(t => !t.is_deleted), [rawTfs]);
  const todos    = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const projectTaskForces = rawPtfs;

  // フィルター適用後のタスク
  const filteredTasks = useMemo(() => {
    let tasks = allTasks;
    if (myOnly) tasks = tasks.filter(t => t.assignee_member_id === currentUser.id);
    // PJフィルター選択時は、選択PJに紐づくタスク OR project_id=nullのタスク（ToDo系）を含める
    if (selectedPjIds.length > 0) tasks = tasks.filter(t =>
      (t.project_id && selectedPjIds.includes(t.project_id)) || t.project_id == null
    );
    return tasks;
  }, [allTasks, myOnly, selectedPjIds, currentUser.id]);

  const todayStr = today();
  const weekLater = addDays(7);
  const reminderDeadline = addDays(reminderDays);

  // 自分のリマインダータスク（期限切れ + N日以内）
  const reminderTasks = useMemo(
    () => allTasks.filter(t =>
      t.assignee_member_id === currentUser.id &&
      t.status !== "done" &&
      t.due_date != null &&
      t.due_date <= reminderDeadline
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [allTasks, currentUser.id, reminderDeadline]
  );

  // 今週のタスク
  const thisWeekTasks = useMemo(
    () => filteredTasks.filter(t =>
      t.due_date &&
      t.due_date >= todayStr &&
      t.due_date <= weekLater &&
      t.status !== "done"
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [filteredTasks, todayStr, weekLater]
  );

  // 期限超過・本日期限
  const alertTasks = useMemo(
    () => filteredTasks.filter(t =>
      t.due_date &&
      t.due_date <= todayStr &&
      t.status !== "done"
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [filteredTasks, todayStr]
  );

  // PJ進捗
  const pjProgress = useMemo(() =>
    projects.map(pj => {
      const pjTasks = allTasks.filter(t => t.project_id === pj.id);
      const done = pjTasks.filter(t => t.status === "done").length;
      const total = pjTasks.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { pj, done, total, pct };
    }),
    [projects, allTasks]
  );

  // KR進捗（タスク完了率ベース）
  // 経路A: KR → TF → ToDo → Task (Task.todo_id)
  // 経路B: KR → TF → ProjectTaskForce → PJ → Task (Task.project_id)
  // 両経路のタスクをSetで重複排除して完了率を計算する
  const krProgress = useMemo(() =>
    krs.map(kr => {
      const krTfIds = new Set(tfs.filter(tf => tf.kr_id === kr.id).map(tf => tf.id));

      const relatedTaskIds = new Set<string>();

      // 経路A: TF → ToDo → Task
      const krTodoIds = new Set(todos.filter(td => krTfIds.has(td.tf_id)).map(td => td.id));
      allTasks.filter(t => (t.todo_ids ?? []).some(id => krTodoIds.has(id)))
        .forEach(t => relatedTaskIds.add(t.id));

      // 経路B: TF → ProjectTaskForce → Task
      const krPjIds = new Set(
        projectTaskForces.filter(ptf => krTfIds.has(ptf.tf_id)).map(ptf => ptf.project_id)
      );
      allTasks.filter(t => t.project_id !== null && krPjIds.has(t.project_id!))
        .forEach(t => relatedTaskIds.add(t.id));

      const relatedTasks = allTasks.filter(t => relatedTaskIds.has(t.id));
      const done = relatedTasks.filter(t => t.status === "done").length;
      const total = relatedTasks.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return { kr, pct, tfCount: krTfIds.size };
    }),
    [krs, tfs, todos, allTasks, projectTaskForces]
  );

  // ToDo進捗（TF > ToDo > Task の完了状況）
  const todoProgress = useMemo(() =>
    tfs.map(tf => {
      const tfTodos = todos.filter(td => td.tf_id === tf.id);
      const todoItems = tfTodos.map(td => {
        const tdTasks = allTasks.filter(t => (t.todo_ids ?? []).includes(td.id));
        const done = tdTasks.filter(t => t.status === "done").length;
        const total = tdTasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return { todo: td, done, total, pct };
      });
      return { tf, todoItems: todoItems.filter(t => t.total > 0) };
    }).filter(item => item.todoItems.length > 0),
    [tfs, todos, allTasks]
  );

  const togglePj = (id: string) => {
    setActiveKrId(null);
    setSelectedPjIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  // KRバークリック：そのKRに紐づくPJでフィルター
  const handleKrClick = (krId: string) => {
    if (activeKrId === krId) {
      // 同じKRを再クリック → 解除
      setActiveKrId(null);
      setSelectedPjIds([]);
      return;
    }
    const krTfIds = tfs.filter(tf => tf.kr_id === krId).map(tf => tf.id);
    const pjIds = projectTaskForces
      .filter(ptf => krTfIds.includes(ptf.tf_id))
      .map(ptf => ptf.project_id);
    setActiveKrId(krId);
    setSelectedPjIds(pjIds.length > 0 ? [...new Set(pjIds)] : []);
  };

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div style={{ padding: "16px 20px", maxWidth: "1000px" }}>

        {/* ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          marginBottom: "16px", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
            ダッシュボード
          </div>

          {/* 自分のみ/全員トグル */}
          <div style={{
            display: "flex", background: "var(--color-bg-tertiary)",
            borderRadius: "var(--radius-md)", padding: "2px", gap: "2px",
          }}>
            {[
              { val: false, label: "全員" },
              { val: true,  label: "自分のみ" },
            ].map(({ val, label }) => (
              <button
                key={label}
                onClick={() => setMyOnly(val)}
                style={{
                  padding: "4px 12px", fontSize: "11px",
                  borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                  fontWeight: myOnly === val ? "500" : "400",
                  background: myOnly === val ? "var(--color-bg-primary)" : "transparent",
                  color: myOnly === val ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  boxShadow: myOnly === val ? "var(--shadow-sm)" : "none",
                  transition: "background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* PJフィルターチップ */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {projects.map(pj => (
              <button
                key={pj.id}
                onClick={() => togglePj(pj.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  padding: "3px 10px", fontSize: "10px", borderRadius: "var(--radius-full)",
                  border: selectedPjIds.includes(pj.id)
                    ? `1px solid ${pj.color_tag}`
                    : "1px solid var(--color-border-primary)",
                  background: selectedPjIds.includes(pj.id)
                    ? `${pj.color_tag}22`
                    : "var(--color-bg-primary)",
                  color: selectedPjIds.includes(pj.id)
                    ? pj.color_tag
                    : "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: selectedPjIds.includes(pj.id) ? "500" : "400",
                  transition: "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
                }}
              >
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: pj.color_tag, display: "inline-block",
                }} />
                {pj.name.slice(0, 10)}
              </button>
            ))}
          </div>
        </div>

        {/* リマインダー */}
        <div style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          marginBottom: "14px",
        }}>
          {/* カードヘッダー */}
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "10px 14px 8px",
            borderBottom: "1px solid var(--color-border-primary)",
          }}>
            <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
              🔔 自分のリマインダー
            </span>
            {reminderTasks.length > 0 && (
              <span style={{
                fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
                background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
                border: "1px solid var(--color-border-warning)", fontWeight: "500",
              }}>
                {reminderTasks.length}件
              </span>
            )}
            {/* 設定 */}
            {editingReminder ? (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={reminderInput}
                  onChange={e => setReminderInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") applyReminderDays(); if (e.key === "Escape") setEditingReminder(false); }}
                  autoFocus
                  style={{
                    width: "48px", padding: "2px 6px", fontSize: "11px",
                    border: "1px solid var(--color-border-secondary)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  }}
                />
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>日前</span>
                <button onClick={applyReminderDays} style={{
                  fontSize: "10px", padding: "2px 8px",
                  background: "var(--color-bg-info)", color: "var(--color-text-info)",
                  border: "1px solid var(--color-border-info)",
                  borderRadius: "var(--radius-sm)", cursor: "pointer",
                }}>適用</button>
                <button onClick={() => setEditingReminder(false)} style={{
                  fontSize: "10px", padding: "2px 6px", background: "transparent",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-sm)", cursor: "pointer",
                  color: "var(--color-text-tertiary)",
                }}>✕</button>
              </div>
            ) : (
              <button onClick={() => { setEditingReminder(true); setReminderInput(String(reminderDays)); }} style={{
                fontSize: "10px", padding: "2px 8px", background: "transparent",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                color: "var(--color-text-tertiary)",
              }}>
                {reminderDays}日前〜 ⚙
              </button>
            )}
          </div>
          {/* タスク一覧 */}
          <div style={{ padding: "10px 14px" }}>
            {reminderTasks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "12px 0", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {reminderDays}日以内に期限のタスクはありません ✓
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: "4px" }}>
                {reminderTasks.map(task => {
                  const pj = projects.find(p => p.id === task.project_id);
                  const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
                  const isOverdue = diff < 0;
                  const isToday = diff === 0;
                  return (
                    <div key={task.id} style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "5px 10px",
                      background: isOverdue ? "var(--color-bg-danger)" : isToday ? "var(--color-bg-warning)" : "var(--color-bg-secondary)",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${isOverdue ? "var(--color-border-danger)" : isToday ? "var(--color-border-warning)" : "var(--color-border-primary)"}`,
                      flex: isMobile ? "1" : "0 0 auto",
                      minWidth: 0,
                    }}>
                      {pj && <span style={{ width: 5, height: 5, borderRadius: "50%", background: pj.color_tag, flexShrink: 0 }} />}
                      <span style={{
                        fontSize: "11px", color: "var(--color-text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        maxWidth: isMobile ? "none" : "160px",
                      }}>
                        {task.name}
                      </span>
                      <span style={{
                        fontSize: "10px", flexShrink: 0, fontWeight: "500",
                        color: isOverdue ? "var(--color-text-danger)" : isToday ? "var(--color-text-warning)" : "var(--color-text-secondary)",
                      }}>
                        {isOverdue ? `${Math.abs(diff)}日超過` : isToday ? "今日" : diff === 1 ? "明日" : `${diff}日後`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* グリッド — key でフィルター変更時にアニメーションを再発火 */}
        <div
          key={`${myOnly ? "1" : "0"}-${selectedPjIds.join(",")}-${activeKrId ?? ""}`}
          className="animate-fadeIn"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gridTemplateRows: "auto",
            gap: "14px",
          }}>

          {/* ① OKRサマリー */}
          <Card title="KR 進捗サマリー" badge={`${krs.length}件`}>
            {krs.length === 0 && (
              <EmptyState>管理画面でKRを登録してください</EmptyState>
            )}
            {krProgress.map(({ kr, pct }, i) => {
              const isActive = activeKrId === kr.id;
              return (
                <div
                  key={kr.id}
                  onClick={() => handleKrClick(kr.id)}
                  style={{
                    marginBottom: i < krs.length - 1 ? "12px" : 0,
                    padding: "6px 8px", borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    background: isActive ? "var(--color-bg-info)" : "transparent",
                    border: isActive ? "1px solid var(--color-border-info)" : "1px solid transparent",
                    transition: "all 0.1s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{
                      fontSize: "11px", color: "var(--color-text-secondary)",
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      paddingRight: "8px",
                    }}>
                      <span style={{
                        display: "inline-block", fontSize: "9px", fontWeight: "600",
                        padding: "1px 5px", borderRadius: "3px", marginRight: "5px",
                        background: "var(--color-bg-info)", color: "var(--color-text-info)",
                      }}>KR{i + 1}</span>
                      {kr.title}
                    </span>
                    <span style={{
                      fontSize: "11px", fontWeight: "500",
                      color: pct >= 80 ? "var(--color-text-success)"
                        : pct >= 40 ? "var(--color-text-warning)"
                        : "var(--color-text-tertiary)",
                      flexShrink: 0,
                    }}>
                      {pct}%
                    </span>
                  </div>
                  <ProgressBar pct={pct} color={
                    pct >= 80 ? "var(--color-text-success)" : pct >= 40 ? "var(--color-text-warning)" : "var(--color-text-tertiary)"
                  } />
                </div>
              );
            })}
          </Card>

          {/* ② 期限アラート */}
          <Card
            title="期限アラート"
            badge={alertTasks.length > 0 ? `${alertTasks.length}件` : undefined}
            badgeColor="danger"
          >
            {alertTasks.length === 0 && (
              <EmptyState>期限超過・本日期限のタスクはありません ✓</EmptyState>
            )}
            {alertTasks.map(task => {
              const m = members.find(mb => mb.id === task.assignee_member_id);
              const pj = projects.find(p => p.id === task.project_id);
              const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
              const isToday = diff === 0;
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  member={m}
                  project={pj}
                  badge={
                    <span style={{
                      fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                      background: isToday ? "var(--color-bg-warning)" : "var(--color-bg-danger)",
                      color: isToday ? "var(--color-text-warning)" : "var(--color-text-danger)",
                      fontWeight: "500",
                    }}>
                      {isToday ? "今日" : `${Math.abs(diff)}日超過`}
                    </span>
                  }
                />
              );
            })}
          </Card>

          {/* ③ 今週のタスク */}
          <Card title="今週のタスク" badge={`${thisWeekTasks.length}件`}>
            {thisWeekTasks.length === 0 && (
              <EmptyState>今週期限のタスクはありません</EmptyState>
            )}
            {thisWeekTasks.map(task => {
              const m = members.find(mb => mb.id === task.assignee_member_id);
              const pj = projects.find(p => p.id === task.project_id);
              const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  member={m}
                  project={pj}
                  badge={
                    <span style={{
                      fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                      background: diff === 0
                        ? "var(--color-bg-warning)"
                        : "var(--color-bg-secondary)",
                      color: diff === 0
                        ? "var(--color-text-warning)"
                        : "var(--color-text-tertiary)",
                    }}>
                      {diff === 0 ? "今日" : diff === 1 ? "明日" : `${diff}日後`}
                    </span>
                  }
                />
              );
            })}
          </Card>

          {/* ④ PJ進捗一覧 */}
          <Card title="PJ 進捗一覧">
            {pjProgress.length === 0 && (
              <EmptyState>プロジェクトを作成してください</EmptyState>
            )}
            {pjProgress.map(({ pj, done, total, pct }) => (
              <div key={pj.id} style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: pj.color_tag, display: "inline-block", flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: "11px", color: "var(--color-text-secondary)",
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {pj.name}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                    {done}/{total}件
                  </span>
                  <span style={{
                    fontSize: "11px", fontWeight: "500", flexShrink: 0,
                    color: pct >= 80 ? "var(--color-text-success)"
                      : pct >= 40 ? "var(--color-text-warning)"
                      : "var(--color-text-tertiary)",
                  }}>
                    {pct}%
                  </span>
                </div>
                <ProgressBar pct={pct} color={pj.color_tag} />
              </div>
            ))}
          </Card>

        </div>

        {/* ⑤ ToDo進捗一覧（フルwidth） */}
        {todoProgress.length > 0 && (
          <div style={{ marginTop: "14px" }}>
            <Card title="ToDo 進捗一覧">
              {todoProgress.map(({ tf, todoItems }) => (
                <div key={tf.id} style={{ marginBottom: "14px" }}>
                  {/* TFラベル */}
                  <div style={{
                    fontSize: "10px", fontWeight: "600",
                    color: "var(--color-text-tertiary)",
                    marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {tf.tf_number} {tf.name}
                  </div>
                  {/* ToDoアイテム */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "8px",
                  }}>
                    {todoItems.map(({ todo, done, total, pct }) => (
                      <div key={todo.id} style={{
                        padding: "8px 10px",
                        background: "var(--color-bg-secondary)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border-primary)",
                      }}>
                        <div style={{
                          fontSize: "11px", color: "var(--color-text-primary)",
                          marginBottom: "4px",
                          overflow: "hidden", textOverflow: "ellipsis",
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: "1.4",
                        }}>
                          {todo.title}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ flex: 1 }}>
                            <ProgressBar pct={pct} color={
                              pct >= 80 ? "var(--color-text-success)"
                                : pct >= 40 ? "var(--color-text-warning)"
                                : "var(--color-text-tertiary)"
                            } />
                          </div>
                          <span style={{
                            fontSize: "10px", flexShrink: 0, fontWeight: "500",
                            color: pct >= 80 ? "var(--color-text-success)"
                              : pct >= 40 ? "var(--color-text-warning)"
                              : "var(--color-text-tertiary)",
                          }}>
                            {done}/{total}
                          </span>
                          {todo.due_date && (
                            <span style={{
                              fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0,
                            }}>
                              {formatDateShort(todo.due_date)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function Card({
  title, badge, badgeColor = "info", children,
}: {
  title: string;
  badge?: string;
  badgeColor?: "info" | "danger";
  children: React.ReactNode;
}) {
  const badgeStyles = {
    info: { bg: "var(--color-bg-info)", color: "var(--color-text-info)", border: "var(--color-border-info)" },
    danger: { bg: "var(--color-bg-danger)", color: "var(--color-text-danger)", border: "var(--color-border-danger)" },
  };
  const bs = badgeStyles[badgeColor];

  return (
    <div style={{
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "10px 14px 8px",
        borderBottom: "1px solid var(--color-border-primary)",
      }}>
        <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
            background: bs.bg, color: bs.color, border: `1px solid ${bs.border}`,
            fontWeight: "500",
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: "10px 14px", minHeight: "80px" }}>
        {children}
      </div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      height: 5, background: "var(--color-bg-tertiary)",
      borderRadius: "var(--radius-full)", overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${pct}%`,
        background: color, borderRadius: "var(--radius-full)",
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function TaskRow({
  task, member, project, badge,
}: {
  task: Task;
  member?: Member;
  project?: Project;
  badge: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "7px",
      padding: "5px 0",
      borderBottom: "1px solid var(--color-bg-tertiary)",
    }}>
      {member && <Avatar member={member} size={18} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "11px", color: "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {task.name}
        </div>
        {project && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
            <span style={{
              width: 4, height: 4, borderRadius: "50%",
              background: project.color_tag, display: "inline-block",
            }} />
            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>
              {project.name.slice(0, 16)}
            </span>
          </div>
        )}
      </div>
      {badge}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      textAlign: "center", padding: "16px 0",
      fontSize: "11px", color: "var(--color-text-tertiary)",
    }}>
      {children}
    </div>
  );
}

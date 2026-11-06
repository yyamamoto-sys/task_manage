// src/components/workload/WorkloadWeekGrid.tsx
//
// ワークロードの「週グリッド」表示（v3.205）。行＝担当者（＋未割り当て）、列＝今週から N 週。
// マス＝その週に期日が入るアクティブなタスクの件数／工数。マスを開くとタスクのチップが並び、
// チップを別のマスへドラッグできる：行が変わる＝担当者の入れ替え／列が変わる＝期日（と開始日）を週の差×7日ずらす。
// 保存は saveTask（updated_by・変更履歴・依存の自動ずらしと矛盾警告はこの経路に任せる）。
// 集計と更新内容の計算は lib/workload/weekGrid.ts（純粋関数）。

import { Fragment, useCallback, useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { todayStr, formatMD } from "../../lib/date";
import { UNASSIGNED_KEY } from "../../lib/task/assigneeMove";
import { formatHours, type WorkloadUnit } from "../../lib/workload/workloadMetric";
import {
  buildWeekGrid, cellValue, computeWeekGridDrop, mondayOf, weekGridOverloadThreshold, type WeekCount,
} from "../../lib/workload/weekGrid";
import { showToast } from "../common/Toast";
import { settleUndoSaves } from "../../lib/task/settleSaves";
import { Avatar } from "../auth/UserSelectScreen";

interface Props {
  members: Member[];
  /** プロジェクトの絞り込み後のタスク（部署スコープ済み） */
  tasks: Task[];
  unit: WorkloadUnit;
  weekCount: WeekCount;
  currentUserId: string;
  onOpenTask: (taskId: string) => void;
}

interface DragState { taskId: string; rowKey: string; week: number }

const NAME_COL_W = 140;
const CELL_MIN_W = 104;

export function WorkloadWeekGrid({ members, tasks, unit, weekCount, currentUserId, onOpenTask }: Props) {
  const saveTask = useAppStore(s => s.saveTask);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);

  const startMonday = useMemo(() => mondayOf(todayStr()), []);
  const memberIds = useMemo(() => members.map(m => m.id), [members]);
  const grid = useMemo(() => buildWeekGrid(tasks, memberIds, startMonday, weekCount), [tasks, memberIds, startMonday, weekCount]);
  const threshold = useMemo(() => weekGridOverloadThreshold(grid, unit), [grid, unit]);
  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleDrop = (toRowKey: string, toWeek: number) => {
    const d = drag;
    setDrag(null);
    setOverCell(null);
    if (!d) return;
    const task = useAppStore.getState().tasks.find(t => t.id === d.taskId);
    if (!task) return;
    const patch = computeWeekGridDrop(task, d.rowKey, toRowKey, d.week, toWeek);
    if (!patch) return;
    // 「元に戻す」用に、変える項目の元の値だけを控える（Undo 時点の最新タスクへ当て直す）
    const prev: Partial<Task> = {
      assignee_member_id: task.assignee_member_id,
      assignee_member_ids: task.assignee_member_ids,
      start_date: task.start_date,
      due_date: task.due_date,
    };
    const parts: string[] = [];
    if (patch.assignee_member_ids) parts.push("担当者");
    if (patch.due_date) parts.push("期日");
    saveTask({ ...task, ...patch, updated_by: currentUserId })
      .then(() => {
        showToast(`「${task.name}」の${parts.join("と")}を変更しました`, "success", {
          label: "元に戻す",
          isUndo: true,
          onClick: () => {
            const now = useAppStore.getState().tasks.find(t => t.id === task.id);
            if (!now) return;
            void settleUndoSaves([saveTask({ ...now, ...prev, updated_by: currentUserId }, { skipCascade: true })]);
          },
        });
      })
      .catch(() => { /* 失敗の表示は saveTask 側（トースト・再読込）が済ませている */ });
  };

  const headerCell = (w: string, i: number) => (
    <th key={w} style={{
      minWidth: CELL_MIN_W, padding: "6px 8px", fontSize: "11px", fontWeight: i === 0 ? 700 : 500, textAlign: "center",
      color: i === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
      background: "var(--color-bg-secondary)", borderBottom: "1px solid var(--color-border-primary)", whiteSpace: "nowrap",
    }}>
      {formatMD(w)}〜{i === 0 ? "（今週）" : ""}
    </th>
  );
  const extraHeader = (label: string, title: string) => (
    <th title={title} style={{
      minWidth: 72, padding: "6px 8px", fontSize: "11px", fontWeight: 500, textAlign: "center", whiteSpace: "nowrap",
      color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)", borderBottom: "1px solid var(--color-border-primary)",
    }}>{label}</th>
  );

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: 8 }}>
        マスの数字を押すとタスクが開きます。タスクを別のマスへドラッグすると、行が変われば担当者が入れ替わり、列が変われば期日（開始日があれば開始日も）が週の差だけずれます。
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)", background: "var(--color-bg-primary)" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
          <thead>
            <tr>
              <th style={{
                position: "sticky", left: 0, zIndex: 1, minWidth: NAME_COL_W, padding: "6px 10px", textAlign: "left",
                fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)",
                background: "var(--color-bg-secondary)", borderBottom: "1px solid var(--color-border-primary)",
              }}>担当者</th>
              {grid.weeks.map(headerCell)}
              {extraHeader("期間外", "表示している週より前（期限超過）か、さらに先に期日があるタスクの件数")}
              {extraHeader("期日なし", "期日が未設定のタスクの件数")}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map(row => {
              const member = memberById.get(row.key);
              const isUnassigned = row.key === UNASSIGNED_KEY;
              return (
                <tr key={row.key}>
                  <th scope="row" style={{
                    position: "sticky", left: 0, zIndex: 1, padding: "8px 10px", textAlign: "left", verticalAlign: "top",
                    background: "var(--color-bg-primary)", borderBottom: "1px solid var(--color-border-primary)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: NAME_COL_W }}>
                      {member ? <Avatar member={member} size={22} /> : (
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--color-bg-tertiary)", flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isUnassigned ? "未割り当て" : (member?.display_name ?? row.key)}
                      </span>
                    </div>
                  </th>
                  {row.cells.map((cell, w) => {
                    const key = `${row.key}|${w}`;
                    const value = cellValue(cell, unit);
                    const isOver = !isUnassigned && value > 0 && value >= threshold;
                    const isOpen = expanded.has(key);
                    const isDropTarget = overCell === key && drag !== null;
                    return (
                      // ドラッグ&ドロップ専用のマス（マウス操作専用。担当者・期日はタスクの編集画面でも変えられる）
                      <td
                        key={key}
                        onDragOver={e => { if (drag) e.preventDefault(); }}
                        onDragEnter={() => { if (drag) setOverCell(key); }}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCell(prev => (prev === key ? null : prev)); }}
                        onDrop={() => handleDrop(row.key, w)}
                        style={{
                          padding: 4, verticalAlign: "top", minWidth: CELL_MIN_W,
                          borderBottom: "1px solid var(--color-border-primary)", borderLeft: "1px solid var(--color-border-primary)",
                          background: isDropTarget ? "var(--color-brand-light)" : isOver ? "var(--color-bg-danger)" : "transparent",
                          outline: isDropTarget ? "2px dashed var(--color-brand-border)" : "none", outlineOffset: -2,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={isOpen}
                          disabled={cell.count === 0}
                          title={cell.count === 0 ? "この週に期日のタスクはありません" : `${cell.count}件${cell.withoutEstimate > 0 ? `（工数未入力${cell.withoutEstimate}件）` : ""}`}
                          style={{
                            width: "100%", padding: "4px 6px", border: "none", borderRadius: "var(--radius-md)", background: "transparent",
                            cursor: cell.count === 0 ? "default" : "pointer", fontSize: "13px",
                            fontWeight: value > 0 ? 700 : 400,
                            color: value === 0 ? "var(--color-text-tertiary)" : isOver ? "var(--color-text-danger)" : "var(--color-text-primary)",
                          }}
                        >
                          {value === 0 ? "–" : (unit === "hours" ? formatHours(value) : `${value}件`)}
                          {unit === "hours" && cell.withoutEstimate > 0 && (
                            <span style={{ fontSize: "9px", fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 4 }}>＋未入力{cell.withoutEstimate}</span>
                          )}
                          {cell.count > 0 && <span aria-hidden style={{ fontSize: "9px", marginLeft: 4, color: "var(--color-text-tertiary)" }}>{isOpen ? "▲" : "▼"}</span>}
                        </button>
                        {isOpen && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
                            {cell.tasks.map(t => (
                              <Fragment key={t.id}>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={() => setDrag({ taskId: t.id, rowKey: row.key, week: w })}
                                  onDragEnd={() => { setDrag(null); setOverCell(null); }}
                                  onClick={() => onOpenTask(t.id)}
                                  title={`${t.name}（期日 ${t.due_date ?? "なし"}${t.estimated_hours != null ? `・${t.estimated_hours}h` : ""}）。ドラッグで別のマスへ`}
                                  style={{
                                    textAlign: "left", cursor: "grab", padding: "2px 6px", fontSize: "10px", lineHeight: 1.4,
                                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160,
                                    opacity: drag?.taskId === t.id ? 0.4 : 1,
                                  }}
                                >
                                  {t.name}
                                  {unit === "hours" && t.estimated_hours != null ? ` (${t.estimated_hours}h)` : ""}
                                </button>
                              </Fragment>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: "8px", textAlign: "center", fontSize: "12px", verticalAlign: "top", borderBottom: "1px solid var(--color-border-primary)", borderLeft: "1px solid var(--color-border-primary)", color: row.outOfRange.length > 0 ? "var(--color-text-secondary)" : "var(--color-text-tertiary)" }}>
                    {row.outOfRange.length > 0 ? `${row.outOfRange.length}件` : "–"}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center", fontSize: "12px", verticalAlign: "top", borderBottom: "1px solid var(--color-border-primary)", borderLeft: "1px solid var(--color-border-primary)", color: row.noDue.length > 0 ? "var(--color-text-secondary)" : "var(--color-text-tertiary)" }}>
                    {row.noDue.length > 0 ? `${row.noDue.length}件` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

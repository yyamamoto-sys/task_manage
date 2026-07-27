// src/components/lab/widgets/AlertTasksWidget.tsx
//
// 【設計意図】
// 期限超過タスク＋滞留タスク。DashboardView の alertTasks/stagnantTasks と同じ条件
// （中止・保留・完了は対象外、子タスクを持つ親タスク自体は一覧から除外）。
// 滞留判定は ganttUtils の isTaskStagnant をそのまま流用する（判定ロジックの二重化を避ける）。
// 新しい集計ロジックは作らない。行クリックは actions.openTask を呼ぶだけ。

import { useMemo } from "react";
import type { WidgetContext } from "../../../lib/widgets/types";
import { suppressOverdue } from "../../../lib/taskMeta";
import { isParentTask } from "../../../lib/taskHierarchy";
import { isTaskStagnant, STAGNANT_THRESHOLD_DAYS } from "../../gantt/ganttUtils";
import { todayStr, formatMD } from "../../../lib/date";

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "8px", width: "100%",
  padding: "5px 8px", borderRadius: "var(--radius-md)",
  border: "none", background: "var(--color-bg-secondary)",
  cursor: "pointer", textAlign: "left",
};

const nameStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: "12px", color: "var(--color-text-primary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

export function AlertTasksWidget({ data, actions }: WidgetContext) {
  const todayS = todayStr();
  // isParentTask は Task[]（ミュータブル配列）を要求するため、readonly な data.tasks を
  // 1回だけコピーして使い回す（.filter() 内で毎要素スプレッドし直すO(n²)を避ける）
  const allTasks = useMemo(() => [...data.tasks], [data.tasks]);

  const overdueTasks = useMemo(() => {
    return allTasks
      .filter(t =>
        !!t.due_date &&
        t.due_date <= todayS &&
        !suppressOverdue(t.status) &&
        !isParentTask(t, allTasks)
      )
      .slice()
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  }, [allTasks, todayS]);

  const stagnantTasks = useMemo(() => {
    return allTasks
      .filter(t => isTaskStagnant(t) && !isParentTask(t, allTasks))
      .slice()
      .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  }, [allTasks]);

  if (overdueTasks.length === 0 && stagnantTasks.length === 0) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        期限超過・滞留のタスクはありません
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {overdueTasks.map(t => (
        <button key={t.id} onClick={() => actions.openTask(t.id)} style={rowStyle}>
          <span style={nameStyle}>{t.name}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-danger)", flexShrink: 0 }}>
            {t.due_date ? formatMD(t.due_date) : ""}
          </span>
        </button>
      ))}
      {stagnantTasks.map(t => (
        <button key={t.id} onClick={() => actions.openTask(t.id)} style={rowStyle}>
          <span style={nameStyle}>{t.name}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-warning)", flexShrink: 0 }}>
            🕒{STAGNANT_THRESHOLD_DAYS}日+
          </span>
        </button>
      ))}
    </div>
  );
}

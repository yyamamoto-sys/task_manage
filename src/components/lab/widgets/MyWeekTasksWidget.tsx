// src/components/lab/widgets/MyWeekTasksWidget.tsx
//
// 【設計意図】
// 自分が担当する、今週締切のタスク一覧。DashboardView の thisWeekTasks と同じ条件
// （今日〜7日以内・中止/保留/完了は対象外）に「自分担当」の絞り込みを足しただけ。新しい
// 集計ロジックは作らない（真実の源を二重化しない）。行クリックは actions.openTask を呼ぶだけ。

import { useMemo } from "react";
import type { WidgetContext } from "../../../lib/widgets/types";
import { isAssignedTo, suppressOverdue } from "../../../lib/taskMeta";
import { todayStr, addDaysFromToday, formatMD } from "../../../lib/date";

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

export function MyWeekTasksWidget({ currentUser, data, actions }: WidgetContext) {
  const todayS = todayStr();
  const weekLater = addDaysFromToday(7);

  const tasks = useMemo(() => {
    return data.tasks
      .filter(t =>
        isAssignedTo(t, currentUser.id) &&
        !!t.due_date &&
        t.due_date >= todayS &&
        t.due_date <= weekLater &&
        !suppressOverdue(t.status)
      )
      .slice()
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  }, [data.tasks, currentUser.id, todayS, weekLater]);

  if (tasks.length === 0) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        今週締切の担当タスクはありません
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {tasks.map(t => (
        <button key={t.id} onClick={() => actions.openTask(t.id)} style={rowStyle}>
          <span style={nameStyle}>{t.name}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {formatMD(t.due_date as string)}
          </span>
        </button>
      ))}
    </div>
  );
}

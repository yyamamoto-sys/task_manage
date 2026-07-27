// src/components/lab/widgets/BlockedTasksWidget.tsx
//
// 【設計意図】
// 自分が担当していて、未完了の先行タスクがあるために完了できないタスクの一覧
// （B1依存ゲート。CLAUDE.md Section 3-6）。判定は既存の getIncompletePredecessors
// （src/lib/dependencies/gate.ts）をそのまま使う（自前で依存を辿らない・判定ロジックの
// 二重化を避ける）。ブロック元のタスク名は formatBlockerNames をそのまま流用する。
// configSchema は持たない（設定不要のためレジストリ側でも未指定）。行クリックは
// actions.openTask を呼ぶだけ。

import { useMemo } from "react";
import type { WidgetContext } from "../../../lib/widgets/types";
import { getIncompletePredecessors, formatBlockerNames } from "../../../lib/dependencies/gate";
import { isAssignedTo, suppressOverdue } from "../../../lib/taskMeta";

const rowStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "2px", width: "100%",
  padding: "5px 8px", borderRadius: "var(--radius-md)",
  border: "none", background: "var(--color-bg-secondary)",
  cursor: "pointer", textAlign: "left",
};

const nameStyle: React.CSSProperties = {
  fontSize: "12px", color: "var(--color-text-primary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const blockerStyle: React.CSSProperties = {
  fontSize: "10px", color: "var(--color-text-warning)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

export function BlockedTasksWidget({ currentUser, data, actions }: WidgetContext) {
  // getIncompletePredecessors は Task[]/TaskDependency[]（ミュータブル配列）を要求するため、
  // readonly な data.tasks/data.taskDependencies を1回だけコピーして使い回す
  const allTasks = useMemo(() => [...data.tasks], [data.tasks]);
  const deps = useMemo(() => [...data.taskDependencies], [data.taskDependencies]);

  const blocked = useMemo(() => {
    return allTasks
      .filter(t => isAssignedTo(t, currentUser.id) && !suppressOverdue(t.status))
      .map(t => ({ task: t, blockers: getIncompletePredecessors(t.id, allTasks, deps) }))
      .filter(x => x.blockers.length > 0);
  }, [allTasks, deps, currentUser.id]);

  if (blocked.length === 0) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        先行待ちのタスクはありません
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {blocked.map(({ task, blockers }) => (
        <button key={task.id} onClick={() => actions.openTask(task.id)} style={rowStyle}>
          <span style={nameStyle}>{task.name}</span>
          <span style={blockerStyle}>⏳ 待ち：{formatBlockerNames(blockers)}</span>
        </button>
      ))}
    </div>
  );
}

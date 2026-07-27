// src/components/lab/widgets/MyWorkloadWidget.tsx
//
// 【設計意図】
// computeMemberWorkloadRows（lib/workload/computeWorkload.ts＝ワークロードビューと共有する
// 単一の真実源）から、自分（currentUser）の行だけを取り出して表示する。新しい集計ロジックは
// 作らない。data.tasks/data.members は readonly のため、素の配列としてそのまま渡せるよう
// スプレッドしてコピーする（computeMemberWorkloadRows の型はミュータブル配列を期待するため）。

import { useMemo } from "react";
import type { WidgetContext } from "../../../lib/widgets/types";
import { computeMemberWorkloadRows } from "../../../lib/workload/computeWorkload";

export function MyWorkloadWidget({ currentUser, data }: WidgetContext) {
  const myRow = useMemo(() => {
    const rows = computeMemberWorkloadRows([...data.members], [...data.tasks]);
    return rows.find(r => r.member_id === currentUser.id) ?? null;
  }, [data.members, data.tasks, currentUser.id]);

  if (!myRow) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        自分の負荷データがありません
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
        <span style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {myRow.active_count}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>件 アクティブ</span>
      </div>
      <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
        <span>未着手 {myRow.todo_count}</span>
        <span>進行中 {myRow.in_progress_count}</span>
        {myRow.overdue_count > 0 && (
          <span style={{ color: "var(--color-text-danger)", fontWeight: 600 }}>期限超過 {myRow.overdue_count}</span>
        )}
      </div>
      {myRow.total_estimated_hours != null && (
        <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
          工数合計 約{myRow.total_estimated_hours}h（{myRow.tasks_with_estimate}件に入力あり）
        </div>
      )}
    </div>
  );
}

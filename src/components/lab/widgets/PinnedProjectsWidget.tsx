// src/components/lab/widgets/PinnedProjectsWidget.tsx
//
// 【設計意図】
// 選んだプロジェクトの進捗バー。進捗計算は isCompletedForProgress（done/cancelledを完了扱い、
// M33解消済みの基準。CLAUDE.md v2.76）経由・子タスクを持つ親タスクは二重計上を避けるため除外
// （isParentTask）。DashboardView の pjProgress と同じ考え方だが、新しい共有関数は作らず
// このウィジェット内に閉じたローカル計算にとどめる（対象PJが数件だけの軽い集計のため）。
//
// Phase 1 は簡易実装：⚙アイコンでの設定パネルは持たず、ピン留め0件のときにウィジェット内へ
// 直接チェックリストを表示する（設計書§5の「簡易実装で可」に従う）。

import { useMemo } from "react";
import type { WidgetContext } from "../../../lib/widgets/types";
import { isParentTask } from "../../../lib/taskHierarchy";
import { isCompletedForProgress } from "../../../lib/taskMeta";
import { calcProgressPct } from "../../../lib/stats";

const emptyText: React.CSSProperties = {
  fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.6,
};

const checklistRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "6px",
  padding: "3px 2px", cursor: "pointer",
};

export function PinnedProjectsWidget({ data, config, setConfig }: WidgetContext) {
  // isParentTask は Task[]（ミュータブル配列）を要求するため、readonly な data.tasks を
  // 1回だけコピーして使い回す
  const allTasks = useMemo(() => [...data.tasks], [data.tasks]);
  const projectIds: string[] = Array.isArray(config.projectIds)
    ? (config.projectIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const pinned = data.projects.filter(p => projectIds.includes(p.id));

  const toggle = (id: string) => {
    const next = projectIds.includes(id) ? projectIds.filter(x => x !== id) : [...projectIds, id];
    setConfig({ ...config, projectIds: next });
  };

  const progressFor = (pjId: string) => {
    const pjTasks = allTasks.filter(t => t.project_id === pjId && !isParentTask(t, allTasks));
    const done = pjTasks.filter(t => isCompletedForProgress(t.status)).length;
    const total = pjTasks.length;
    return { done, total, pct: calcProgressPct(done, total) };
  };

  if (pinned.length === 0) {
    return (
      <div>
        <div style={emptyText}>ピン留めされたプロジェクトはありません。下から選んでください（編集モードの⚙は使わず、ここで直接選べます）。</div>
        {data.projects.length === 0 ? (
          <div style={{ ...emptyText, marginTop: "8px" }}>選べるプロジェクトがありません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "8px", maxHeight: "160px", overflowY: "auto" }}>
            {data.projects.map(p => (
              <label key={p.id} style={checklistRow}>
                <input type="checkbox" checked={projectIds.includes(p.id)} onChange={() => toggle(p.id)} />
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color_tag ?? "var(--color-text-tertiary)", flexShrink: 0 }} />
                <span style={{
                  fontSize: "12px", color: "var(--color-text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {pinned.map(p => {
        const { done, total, pct } = progressFor(p.id);
        return (
          <div key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontSize: "11px", color: "var(--color-text-primary)", marginBottom: "3px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>{done}/{total}（{pct}%）</span>
            </div>
            <div style={{ height: "6px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: p.color_tag ?? "var(--color-brand)" }} />
            </div>
          </div>
        );
      })}
      <button
        onClick={() => setConfig({ ...config, projectIds: [] })}
        style={{
          fontSize: "10px", color: "var(--color-text-tertiary)", background: "none",
          border: "none", cursor: "pointer", textAlign: "left", padding: 0, textDecoration: "underline",
        }}
      >
        選び直す
      </button>
    </div>
  );
}

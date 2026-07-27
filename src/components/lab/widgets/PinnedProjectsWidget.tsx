// src/components/lab/widgets/PinnedProjectsWidget.tsx
//
// 【設計意図】
// 選んだプロジェクトの進捗バー。進捗計算は isCompletedForProgress（done/cancelledを完了扱い、
// M33解消済みの基準。CLAUDE.md v2.76）経由・子タスクを持つ親タスクは二重計上を避けるため除外
// （isParentTask）。DashboardView の pjProgress と同じ考え方だが、新しい共有関数は作らず
// このウィジェット内に閉じたローカル計算にとどめる（対象PJが数件だけの軽い集計のため）。
//
// 【Phase 2】configSchema駆動の最初の実例。表示するプロジェクトの選択はウィジェット内の独自UIを
// 持たず、レジストリの configSchema（type: "projectMultiSelect"）＋編集モードの⚙から開く
// WidgetConfigModal に一本化した（旧Phase1は未選択時にウィジェット内へ直接チェックリストを
// 表示する簡易実装だったが、configSchema駆動フォームが実装された今は独自UIを残さない）。
// config は resolveConfig 経由で読む（保存済みの値が壊れていても安全な既定値に矯正されるため）。

import { useMemo } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig } from "../../../lib/widgets/config";
import { isParentTask } from "../../../lib/taskHierarchy";
import { isCompletedForProgress } from "../../../lib/taskMeta";
import { calcProgressPct } from "../../../lib/stats";

/** レジストリ（registry.ts）が WidgetDefinition.configSchema としてそのまま使う */
export const PINNED_PROJECTS_CONFIG_SCHEMA: WidgetConfigField[] = [
  {
    key: "projectIds",
    label: "表示するプロジェクト",
    type: "projectMultiSelect",
    description: "進捗バーを表示するプロジェクトを選んでください（複数可）",
  },
];

const emptyText: React.CSSProperties = {
  fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.6, textAlign: "center", padding: "10px 0",
};

export function PinnedProjectsWidget({ data, config }: WidgetContext) {
  // isParentTask は Task[]（ミュータブル配列）を要求するため、readonly な data.tasks を
  // 1回だけコピーして使い回す
  const allTasks = useMemo(() => [...data.tasks], [data.tasks]);
  const resolved = resolveConfig(PINNED_PROJECTS_CONFIG_SCHEMA, config);
  const projectIds = Array.isArray(resolved.projectIds) ? resolved.projectIds as string[] : [];
  const pinned = data.projects.filter(p => projectIds.includes(p.id));

  const progressFor = (pjId: string) => {
    const pjTasks = allTasks.filter(t => t.project_id === pjId && !isParentTask(t, allTasks));
    const done = pjTasks.filter(t => isCompletedForProgress(t.status)).length;
    const total = pjTasks.length;
    return { done, total, pct: calcProgressPct(done, total) };
  };

  if (pinned.length === 0) {
    return (
      <div style={emptyText}>
        表示するプロジェクトがありません。編集モードの⚙から選んでください。
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
    </div>
  );
}

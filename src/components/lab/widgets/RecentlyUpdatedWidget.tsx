// src/components/lab/widgets/RecentlyUpdatedWidget.tsx
//
// 【設計意図】
// 最近更新されたタスク（updated_at の新しい順）。既に部署スコープ・論理削除除外済みの
// data.tasks をそのまま並べ替えるだけで、新しい集計ロジックは作らない。
// configSchema で「件数（limit）」「自分の担当のみ（mineOnly）」を調整できる
// （Phase 2 configSchema 駆動の実例）。行クリックは actions.openTask を呼ぶだけ。

import { useMemo } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig } from "../../../lib/widgets/config";
import { isAssignedTo } from "../../../lib/taskMeta";
import { formatMD } from "../../../lib/date";

/** レジストリ（registry.ts）が WidgetDefinition.configSchema としてそのまま使う */
export const RECENTLY_UPDATED_CONFIG_SCHEMA: WidgetConfigField[] = [
  { key: "limit", label: "表示件数", type: "number", defaultValue: 10, min: 1, max: 30 },
  { key: "mineOnly", label: "自分の担当のみ", type: "boolean", defaultValue: true },
];

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

export function RecentlyUpdatedWidget({ currentUser, data, config, actions }: WidgetContext) {
  const resolved = resolveConfig(RECENTLY_UPDATED_CONFIG_SCHEMA, config);
  const limit = resolved.limit as number;
  const mineOnly = resolved.mineOnly as boolean;

  const tasks = useMemo(() => {
    return data.tasks
      .filter(t => !mineOnly || isAssignedTo(t, currentUser.id))
      .slice()
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, limit);
  }, [data.tasks, mineOnly, currentUser.id, limit]);

  if (tasks.length === 0) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        {mineOnly ? "自分の担当タスクの更新履歴はありません" : "タスクの更新履歴はありません"}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {tasks.map(t => (
        <button key={t.id} onClick={() => actions.openTask(t.id)} style={rowStyle}>
          <span style={nameStyle}>{t.name}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {t.updated_at ? formatMD(t.updated_at.slice(0, 10)) : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

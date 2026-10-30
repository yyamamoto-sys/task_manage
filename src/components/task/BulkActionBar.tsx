// src/components/task/BulkActionBar.tsx
//
// 一括操作バー（ListView／KanbanView／GanttView 共有・v3.160）。
// 元は ListView と KanbanView にほぼ同じ JSX が二重にあったものを1つにまとめた（ガントにも同じバーを出すため）。
// 実処理は useBulkTaskActions の戻り値。ここは見た目と配線だけを持つ。

import type { CSSProperties } from "react";
import type { Member, Project, Task } from "../../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE } from "../../lib/taskMeta";
import { CustomSelect } from "../common/CustomSelect";
import { BulkMoveShiftControls } from "./BulkMoveShiftControls";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useUiLayoutStore } from "../../stores/uiLayoutStore";
import { STACK_CLEARANCE_PX, FAB_SIZE_PX, FAB_RIGHT_PC_PX, computeFabBottomMobile } from "../../lib/layout/bottomStack";

/** バーが出ている間、スクロール領域の末尾に足す余白[px]。最下行がバーの裏に隠れないようにする（下側への追加なので行位置は動かない） */
export const BULK_BAR_SCROLL_PAD_PX = 120;

// 【設計意図】バーはレイアウトに入れず画面下部に固定表示する（表示・非表示でリスト／ガントの行が動かない）。
// PC：下端中央。右下のFAB・ショートカットボタンの幅（右端からFAB分）を左右対称に空けるため、幅を
// 100vw - 2*(FAB右余白+FAB幅+隙間) までに制限して重ならないようにする。
// モバイル：ボトムナビとFABの上に全幅で出す。
export const BULK_BAR_Z_INDEX = 40;
const PC_SIDE_RESERVE_PX = FAB_RIGHT_PC_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX;

type Actions = {
  bulkUpdateStatus: (s: Task["status"]) => unknown;
  bulkUpdatePriority: (p: Task["priority"]) => unknown;
  bulkUpdateAssignee: (memberId: string) => unknown;
  bulkDelete: () => unknown;
  bulkMoveToProject: (projectId: string, name: string, orderedTaskIds: string[]) => unknown;
  bulkShift: (days: number) => unknown;
};

interface Props {
  selectedCount: number;
  statuses: readonly Task["status"][];
  actions: Actions;
  assigneeCandidates: Member[];
  currentUserId: string;
  projects: Project[];
  orderedTaskIds: string[];
  onDuplicate: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount, statuses, actions, assigneeCandidates, currentUserId, projects, orderedTaskIds, onDuplicate, onClear,
}: Props) {
  const isMobile = useIsMobile();
  const navHeight = useUiLayoutStore(s => s.mobileBottomNavHeightPx);
  const placement: CSSProperties = isMobile
    ? { left: 8, right: 8, bottom: computeFabBottomMobile(navHeight) + FAB_SIZE_PX + STACK_CLEARANCE_PX }
    : { left: "50%", transform: "translateX(-50%)", bottom: STACK_CLEARANCE_PX, width: "max-content", maxWidth: `calc(100vw - ${PC_SIDE_RESERVE_PX * 2}px)` };
  return (
    <div role="toolbar" aria-label="一括操作" data-bulk-action-bar style={{
      position: "fixed", zIndex: BULK_BAR_Z_INDEX, ...placement,
      boxSizing: "border-box",
      padding: "8px 12px",
      background: "var(--color-brand-light)",
      border: "1px solid var(--color-brand-border)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-md)",
      display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
    }}>
      <span style={{
        fontSize: "12px", fontWeight: 600,
        color: "var(--color-brand)",
        padding: "4px 10px",
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-brand-border)",
        borderRadius: "var(--radius-full)",
        whiteSpace: "nowrap",
      }}>
        {selectedCount} 件選択中
      </span>

      <div style={{ display: "flex", gap: "4px" }}>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => actions.bulkUpdateStatus(s)}
            title={`選択中タスクを「${TASK_STATUS_LABEL[s]}」に変更`}
            style={{
              padding: "4px 10px", fontSize: "11px", fontWeight: 500,
              background: TASK_STATUS_STYLE[s].bg,
              color: TASK_STATUS_STYLE[s].color,
              border: `1px solid ${TASK_STATUS_STYLE[s].color}`,
              borderRadius: "var(--radius-md)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            → {TASK_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "4px" }}>
        {(["", "high", "mid", "low"] as const).map(p => {
          const cfg = p ? TASK_PRIORITY_STYLE[p] : null;
          return (
            <button
              key={p || "none"}
              onClick={() => actions.bulkUpdatePriority(p || null)}
              title={`選択中タスクの優先度を「${p ? TASK_PRIORITY_LABEL[p] : "なし"}」に変更`}
              style={{
                padding: "4px 10px", fontSize: "11px", fontWeight: 500,
                background: cfg ? cfg.bg : "var(--color-bg-tertiary)",
                color: cfg ? cfg.color : "var(--color-text-secondary)",
                border: `1px solid ${cfg ? cfg.color : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)",
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              → {p ? TASK_PRIORITY_LABEL[p] : "なし"}
            </button>
          );
        })}
      </div>

      <CustomSelect
        value=""
        onChange={value => { if (value) actions.bulkUpdateAssignee(value); }}
        options={[
          { value: "", label: "担当者を変更…" },
          ...[...assigneeCandidates].sort((a, b) =>
            a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0
          ).map(m => ({ value: m.id, label: m.display_name })),
        ]}
        searchable searchPlaceholder="メンバーで検索..."
        style={{ width: "160px" }} />

      <BulkMoveShiftControls
        projects={projects}
        onMoveToProject={(pid, name) => { void actions.bulkMoveToProject(pid, name, orderedTaskIds); }}
        onShift={days => { void actions.bulkShift(days); }}
      />

      <span style={{ flex: 1 }} />

      <button
        onClick={onDuplicate}
        style={{
          padding: "4px 12px", fontSize: "11px", fontWeight: 500,
          color: "var(--color-text-secondary)",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        📋 複製
      </button>

      <button
        onClick={() => actions.bulkDelete()}
        style={{
          padding: "4px 12px", fontSize: "11px", fontWeight: 500,
          color: "var(--btn-danger-text)",
          background: "var(--btn-danger-bg)",
          border: "1px solid var(--btn-danger-border)",
          borderRadius: "var(--radius-md)",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        🗑 削除
      </button>

      <button
        onClick={onClear}
        style={{
          padding: "4px 10px", fontSize: "11px",
          color: "var(--color-text-tertiary)",
          background: "transparent",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        ✕ 選択解除
      </button>
    </div>
  );
}

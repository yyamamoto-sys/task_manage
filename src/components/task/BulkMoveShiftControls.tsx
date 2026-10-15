// src/components/task/BulkMoveShiftControls.tsx
//
// 一括操作バー（ListView／KanbanView 共有）の「📁 プロジェクトを移す」「📅 日程をずらす」（v3.156）。
// 実処理は useBulkTaskActions の bulkMoveToProject／bulkShift。ここは入力部品だけを持つ。
// ポップオーバーは CustomSelect（Portal・pointerEvents は CustomSelect 側が担保＝Section 51）を使い、
// 日数の入力はバーの中でその場に広げる（Portal を増やさない）。

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../lib/localData/types";
import { CustomSelect } from "../common/CustomSelect";
import {
  ALL_PJ_VALUE,
  PROJECT_TARGET_SEARCH_THRESHOLD,
  buildProjectTargetOptions,
} from "../../lib/project/projectTargetOptions";
import { parseShiftDays } from "../../lib/task/shiftDays";

interface Props {
  /** 移動先の候補（表示部署のPJ。アーカイブは buildProjectTargetOptions が除く） */
  projects: Project[];
  onMoveToProject: (projectId: string, projectName: string) => void;
  onShift: (deltaDays: number) => void;
}

const BTN: React.CSSProperties = {
  padding: "4px 12px", fontSize: "11px", fontWeight: 500,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
};

export function BulkMoveShiftControls({ projects, onMoveToProject, onShift }: Props) {
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftRaw, setShiftRaw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (shiftOpen) inputRef.current?.focus(); }, [shiftOpen]);

  const moveOptions = useMemo(() => {
    const opts = buildProjectTargetOptions(projects).filter(o => o.value !== ALL_PJ_VALUE);
    return [{ value: "", label: "📁 プロジェクトを移す…" }, ...opts];
  }, [projects]);

  const days = parseShiftDays(shiftRaw);
  const runShift = () => {
    if (days === null) return;
    onShift(days);
    setShiftOpen(false);
    setShiftRaw("");
  };

  return (
    <>
      <CustomSelect
        value=""
        onChange={value => {
          if (!value) return;
          onMoveToProject(value, projects.find(p => p.id === value)?.name ?? value);
        }}
        options={moveOptions}
        searchable={moveOptions.length > PROJECT_TARGET_SEARCH_THRESHOLD + 1}
        searchPlaceholder="PJ名で検索"
        style={{ width: "180px" }}
      />
      {!shiftOpen ? (
        <button type="button" onClick={() => setShiftOpen(true)} style={BTN}
          title="選んだタスクの開始日・期日を、暦日でまとめてずらします（営業日ではありません）">
          📅 日程をずらす
        </button>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          <input
            type="number"
            step={1}
            value={shiftRaw}
            ref={inputRef}
            aria-label="ずらす日数（マイナスで前へ）"
            placeholder="例 7 / -3"
            onChange={e => setShiftRaw(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") { e.preventDefault(); runShift(); }
              else if (e.key === "Escape") { e.preventDefault(); setShiftOpen(false); setShiftRaw(""); }
            }}
            style={{
              width: "76px", padding: "3px 6px", fontSize: "11px",
              border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
            }}
          />
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>日</span>
          <button type="button" onClick={runShift} disabled={days === null}
            title="プラスで後ろへ・マイナスで前へ（暦日）" style={{ ...BTN, opacity: days === null ? 0.5 : 1, cursor: days === null ? "default" : "pointer" }}>
            ずらす
          </button>
          <button type="button" onClick={() => { setShiftOpen(false); setShiftRaw(""); }}
            style={{ ...BTN, color: "var(--color-text-tertiary)" }}>
            ×
          </button>
        </span>
      )}
    </>
  );
}

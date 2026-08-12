// src/components/okr/personal/WeekCard.tsx
//
// 【設計意図】
// ★週の目標状態（Kintoneに存在しない層）の1週分のカード。自己評価（◯△✕）を押すと
// カードの色が変わる（docs/dev/okr-redesign-plan.md §10）。色は既存トークン
// （--color-signal-green/yellow/red・--color-bg-success/warning/danger）を使い、
// 新しい色は発明しない。
//
// 紐づけたタスクの遅延・先行待ちは既存ロジック（B4：computeDelayDays/formatDelayLabel・
// B1：getIncompletePredecessors/formatBlockerNames）をそのまま再利用する
// （CLAUDE.md Section 3-6。再実装しない）。

import { useMemo, useState } from "react";
import type { Task, TaskDependency, WeekSelfRating } from "../../../lib/localData/types";
import { computeDelayDays, formatDelayLabel } from "../../gantt/ganttUtils";
import { getIncompletePredecessors, formatBlockerNames } from "../../../lib/dependencies/gate";

const RATING_BG: Record<"o" | "t" | "x", string> = {
  o: "var(--color-bg-success)",
  t: "var(--color-bg-warning)",
  x: "var(--color-bg-danger)",
};
const RATING_BORDER: Record<"o" | "t" | "x", string> = {
  o: "var(--color-signal-green)",
  t: "var(--color-signal-yellow)",
  x: "var(--color-signal-red)",
};
const RATING_SYMBOL: Record<"o" | "t" | "x", string> = { o: "◯", t: "△", x: "✕" };
const RATING_LABEL: Record<"o" | "t" | "x", string> = { o: "達成", t: "一部", x: "未達" };
// 選択中ボタンの文字色。yellowは白文字だとコントラスト不足になるため濃色にする（モックと同じ配色）
const RATING_TEXT_ON: Record<"o" | "t" | "x", string> = { o: "#fff", t: "#3a2c05", x: "#fff" };

interface Props {
  label: string;                // "W1" など
  weekStartStr: string;
  weekEndStr: string;
  goalState: string | null;
  selfRating: WeekSelfRating;
  editable: boolean;
  isCurrentWeek: boolean;
  linkedTasks: Task[];
  allTasks: Task[];
  taskDependencies: TaskDependency[];
  onSaveGoal: (text: string) => void | Promise<void>;
  onSetRating: (rating: WeekSelfRating) => void | Promise<void>;
  onOpenLinker: () => void;
}

export function WeekCard({
  label, weekStartStr, weekEndStr, goalState, selfRating, editable, isCurrentWeek,
  linkedTasks, allTasks, taskDependencies, onSaveGoal, onSetRating, onOpenLinker,
}: Props) {
  const [draftGoal, setDraftGoal] = useState(goalState ?? "");
  const [editingGoal, setEditingGoal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  const bg = selfRating ? RATING_BG[selfRating] : "var(--color-bg-primary)";
  const borderTop = selfRating ? RATING_BORDER[selfRating] : "var(--color-border-primary)";

  // 🔴 getIncompletePredecessors（allTasks×taskDependenciesのフルスキャン）は月次計画の
  // 欄への1文字入力ごとに週カード全件×紐づけタスク全件ぶん再実行されていた（親
  // PersonalKrPanelの再レンダーで毎回計算し直していたため）。allTasks・taskDependenciesは
  // 部署全体の全タスク・全依存関係（数百〜数千件になり得る）で、linkedTasksが参照安定化
  // された今も、この計算自体はメモ化しないと親の再レンダーのたびに走る（CLAUDE.md課題B調査
  // 2026-08-12・カクつきの実測原因）。
  const taskAnnotations = useMemo(
    () => linkedTasks.map(t => ({
      task: t,
      delay: formatDelayLabel(computeDelayDays(t)),
      blockers: getIncompletePredecessors(t.id, allTasks, taskDependencies),
    })),
    [linkedTasks, allTasks, taskDependencies],
  );

  const handleRate = async (v: "o" | "t" | "x") => {
    await onSetRating(selfRating === v ? null : v);
  };

  const handleSaveGoal = async () => {
    setSavingGoal(true);
    try {
      await onSaveGoal(draftGoal.trim());
      setEditingGoal(false);
    } finally {
      setSavingGoal(false);
    }
  };

  return (
    <div style={{
      background: bg,
      border: `1px solid ${selfRating ? RATING_BORDER[selfRating] : "var(--color-border-primary)"}`,
      borderTop: `3px solid ${borderTop}`,
      borderRadius: "var(--radius-md)", padding: "11px 12px",
      display: "flex", flexDirection: "column", gap: "7px", minHeight: "140px",
      boxShadow: isCurrentWeek ? "0 0 0 2px var(--color-brand-light)" : "none",
      transition: "background 0.15s ease, border-color 0.15s ease",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "6px" }}>
        <span style={{ fontFamily: "var(--font-serif, inherit)", fontSize: "12px", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: "9.5px", color: "var(--color-text-tertiary)" }}>{weekStartStr.slice(5).replace("-", "/")}–{weekEndStr.slice(5).replace("-", "/")}</span>
      </div>

      {/* 目標状態 */}
      {editable && editingGoal ? (
        <div>
          <textarea
            value={draftGoal}
            onChange={e => setDraftGoal(e.target.value)}
            placeholder="この週末にこうなっている"
            style={{
              width: "100%", fontSize: "11.5px", lineHeight: 1.5, padding: "6px 8px",
              border: "1px solid var(--color-border-secondary)", borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
              resize: "vertical", minHeight: "48px", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
            <button onClick={handleSaveGoal} disabled={savingGoal} style={{ fontSize: "10px", padding: "3px 9px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
              {savingGoal ? "保存中…" : "保存"}
            </button>
            <button onClick={() => { setEditingGoal(false); setDraftGoal(goalState ?? ""); }} style={{ fontSize: "10px", padding: "3px 9px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-tertiary)", cursor: "pointer" }}>
              キャンセル
            </button>
          </div>
        </div>
      ) : goalState ? (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          onClick={() => editable && setEditingGoal(true)}
          style={{ fontSize: "11.5px", lineHeight: 1.5, cursor: editable ? "pointer" : "default" }}
        >
          {goalState}
        </div>
      ) : editable ? (
        <button
          onClick={() => setEditingGoal(true)}
          style={{ fontFamily: "inherit", fontSize: "10px", cursor: "pointer", background: "transparent", border: "1px dashed var(--color-border-secondary)", color: "var(--color-text-tertiary)", borderRadius: "var(--radius-sm)", padding: "3px 8px", alignSelf: "flex-start" }}
        >目標状態を書く</button>
      ) : (
        <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>未設定</div>
      )}

      {/* 紐づけタスク */}
      {taskAnnotations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {taskAnnotations.map(({ task: t, delay, blockers }) => (
            <div key={t.id} title={blockers.length > 0 ? `先行待ち：${formatBlockerNames(blockers)}` : undefined} style={{ fontSize: "10px", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ flexShrink: 0 }}>{t.status === "done" ? "✅" : "・"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              {delay && <span style={{ color: "var(--color-text-danger)", flexShrink: 0 }}>{delay}</span>}
              {blockers.length > 0 && <span style={{ color: "var(--color-text-warning)", flexShrink: 0 }}>⏱待ち</span>}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <button
          onClick={onOpenLinker}
          style={{ fontFamily: "inherit", fontSize: "10px", cursor: "pointer", background: "transparent", border: "none", color: "var(--color-brand)", padding: 0, textAlign: "left" }}
        >
          {linkedTasks.length > 0 ? "＋ タスクを追加・変更" : "＋ タスクを紐づける"}
        </button>
      )}

      {/* 自己評価 */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
        {(["o", "t", "x"] as const).map(v => (
          <button
            key={v}
            onClick={() => editable && handleRate(v)}
            disabled={!editable}
            aria-pressed={selfRating === v}
            title={RATING_LABEL[v]}
            style={{
              fontFamily: "var(--font-serif, inherit)", fontSize: "13px", lineHeight: 1,
              cursor: editable ? "pointer" : "default", width: "26px", height: "24px",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${selfRating === v ? RATING_BORDER[v] : "var(--color-border-primary)"}`,
              background: selfRating === v ? RATING_BORDER[v] : "var(--color-bg-primary)",
              color: selfRating === v ? RATING_TEXT_ON[v] : "var(--color-text-tertiary)",
              opacity: editable ? 1 : 0.7,
            }}
          >{RATING_SYMBOL[v]}</button>
        ))}
      </div>
    </div>
  );
}

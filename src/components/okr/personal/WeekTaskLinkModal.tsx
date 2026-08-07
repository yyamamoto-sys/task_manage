// src/components/okr/personal/WeekTaskLinkModal.tsx
//
// 【設計意図】
// 週に紐づけるタスクの選定モーダル。「自動候補＋明示リンク」（候補を提示して人が選ぶ。
// docs/dev/okr-redesign-plan.md §3-4・§10）。候補抽出は純粋関数
// computeWeekTaskCandidates に一元化し、ここではUIのみを持つ。
// CLAUDE.md Section 21の契約（modalStyles.ts）に従う。

import { useMemo, useState } from "react";
import type { Task, ToDo } from "../../../lib/localData/types";
import { computeWeekTaskCandidates } from "../../../lib/personalOkr/weekTaskCandidates";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../../common/modalStyles";

interface Props {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  tasks: Task[];
  todos: ToDo[];
  currentMemberId: string;
  taskForceId?: string | null;
  linkedTaskIds: string[];
  onLink: (taskId: string) => void;
  onUnlink: (taskId: string) => void;
  onClose: () => void;
}

export function WeekTaskLinkModal({
  weekLabel, weekStart, weekEnd, tasks, todos, currentMemberId, taskForceId,
  linkedTaskIds, onLink, onUnlink, onClose,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const candidates = useMemo(
    () => computeWeekTaskCandidates({
      tasks, todos, weekStart, weekEnd, currentMemberId, taskForceId,
      excludeTaskIds: linkedTaskIds,
    }),
    [tasks, todos, weekStart, weekEnd, currentMemberId, taskForceId, linkedTaskIds],
  );
  const linkedTasks = useMemo(
    () => linkedTaskIds.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t),
    [linkedTaskIds, tasks],
  );

  const handleToggle = async (taskId: string, linked: boolean) => {
    setBusyId(taskId);
    try {
      if (linked) await onUnlink(taskId); else await onLink(taskId);
    } finally {
      setBusyId(null);
    }
  };

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px",
    background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-md)", marginBottom: "6px",
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={modalOverlayStyle(330)} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        style={{ ...modalBoxStyle("min(480px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>タスクを紐づける</div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{weekLabel}（{weekStart}〜{weekEnd}）</div>
          </div>
          <button onClick={onClose} aria-label="閉じる" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 18px" }}>
          {linkedTasks.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>紐づけ済み</div>
              {linkedTasks.map(t => (
                <div key={t.id} style={rowStyle}>
                  <span style={{ flex: 1, fontSize: "12.5px" }}>{t.name}</span>
                  <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>{t.due_date ?? "期日なし"}</span>
                  <button
                    onClick={() => handleToggle(t.id, true)}
                    disabled={busyId === t.id}
                    style={{ fontSize: "10.5px", padding: "4px 9px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-tertiary)", cursor: "pointer" }}
                  >外す</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
            候補（本人担当・期日がこの週の範囲内）
          </div>
          {candidates.length === 0 && (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "16px 0", textAlign: "center" }}>
              この週に期日があり、あなたが担当のタスクは見つかりませんでした。
            </div>
          )}
          {candidates.map(t => (
            <div key={t.id} style={rowStyle}>
              <span style={{ flex: 1, fontSize: "12.5px" }}>{t.name}</span>
              <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>{t.due_date}</span>
              <button
                onClick={() => handleToggle(t.id, false)}
                disabled={busyId === t.id}
                style={{ fontSize: "10.5px", padding: "4px 9px", background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-sm)", color: "var(--color-brand)", cursor: "pointer", fontWeight: 700 }}
              >紐づける</button>
            </div>
          ))}
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", fontSize: "12px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

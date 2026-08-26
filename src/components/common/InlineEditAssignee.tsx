// src/components/common/InlineEditAssignee.tsx
//
// 一覧・カンバンの担当者アイコンから担当者を付け外しするインライン編集。
//
// 【2026-08-26・不具合修正】リストモードでこのドロップダウンが「スクロールできない・
// 選びたい人を選べない」状態になっていた。原因は v3.85（commit aedb241）でパネルを
// `position:absolute`（#root の子孫）から `createPortal(document.body)` へ移したとき、
// 同時に移した CustomSelect / ProjectRowMenu / MentionTextarea には付いていた
// `pointerEvents:"auto"` を**このファイルだけ付け忘れた**こと。
// `globals.css` の `body { pointer-events: none }` は継承プロパティなので、body 直下に
// 生えた Portal 要素は打ち消さない限りヒットテストの対象外になる。結果、ホイールが
// パネルを素通りして下のリストが動き、capture の scroll リスナが「パネル外のスクロール」
// と判定してドロップダウンを閉じていた。
// 位置決め・スクロール追従・スクロール連鎖の遮断は共通フック useFloatingPanel に集約した
// （4箇所のコピペが再発の温床だったため）。

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { useT } from "../../hooks/useT";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";

/** パネル幅は中身（メンバー名・アバター）なり。実測が入るまでの1フレームだけ使う見積もり値 */
const PANEL_FALLBACK_WIDTH = 220;
/** 余白が許すなら出したい高さ。旧実装は200px固定で、部署メンバーが7人以上いると必ずスクロールが要った */
const PANEL_PREFERRED_HEIGHT = 340;
const PANEL_MIN_HEIGHT = 140;

interface Props {
  assigneeIds: string[];
  members: Member[];
  onSave: (ids: string[]) => void;
}

export function InlineEditAssignee({ assigneeIds, members, onSave }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open,
    onRequestClose: () => setOpen(false),
    triggerRef,
    panelRef,
    width: "auto",
    fallbackWidth: PANEL_FALLBACK_WIDTH,
    preferredMaxHeight: PANEL_PREFERRED_HEIGHT,
    minMaxHeight: PANEL_MIN_HEIGHT,
  });

  const handleToggleOpen = () => setOpen(v => !v);

  // 外側クリックで閉じる（トリガー・パネル両方は除外。パネルはPortalでbody直下に描画される
  // ため、containerRef.contains()ではなくtriggerRef/panelRefの両方を個別に見る）
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escapeで閉じる（ProjectRowMenu.tsxと同じ）
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const toggle = (id: string) => {
    const next = assigneeIds.includes(id)
      ? assigneeIds.filter(x => x !== id)
      : [...assigneeIds, id];
    onSave(next);
  };

  const assignees = members.filter(m => assigneeIds.includes(m.id));

  return (
    <div ref={triggerRef} style={{ position: "relative", display: "inline-block" }}>
      <div
        onClick={e => { e.stopPropagation(); handleToggleOpen(); }}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); handleToggleOpen(); } }}
        title={t("common.assignee.editTitle")}
        style={{
          display: "inline-flex", alignItems: "center", gap: "2px",
          cursor: "pointer",
          padding: "1px 3px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid transparent",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-primary)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
      >
        {assignees.length > 0 ? (
          <>
            {assignees.slice(0, 3).map(m => <Avatar key={m.id} member={m} size={16} />)}
            {assignees.length > 3 && (
              <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>+{assignees.length - 3}</span>
            )}
          </>
        ) : (
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{t("common.assignee.unassigned")}</span>
        )}
      </div>

      {open && createPortal(
        // パネル自身がスクロール要素なので panelStyle と scrollAreaStyle の両方を当てる
        <div ref={panelRef} style={{
          ...panelStyle,
          ...scrollAreaStyle,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          minWidth: "150px",
          pointerEvents: "auto",
        }}>
          {members.map(m => {
            const selected = assigneeIds.includes(m.id);
            return (
              <div
                key={m.id}
                onMouseDown={e => { e.preventDefault(); toggle(m.id); }}
                role="option" aria-selected={selected} tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(m.id); } }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "6px 10px", cursor: "pointer",
                  background: selected ? "var(--color-brand-light)" : "transparent",
                  fontSize: "11px",
                  color: selected ? "var(--color-text-purple)" : "var(--color-text-primary)",
                }}
                onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-secondary)"; }}
                onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <Avatar member={m} size={16} />
                <span>{m.display_name}</span>
                {selected && <span style={{ marginLeft: "auto", fontSize: "10px" }}>✓</span>}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

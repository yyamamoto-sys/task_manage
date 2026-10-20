// src/components/section/SectionMenu.tsx
//
// PJ内「グループ」の見出しの「⋮」メニュー（名前を変更／一番上へ／上へ／下へ／一番下へ／削除。ガントは並べ替えの4つだけ）。
// トリガー追従のポップオーバーなので、座標・スクロール追従・スクロール連鎖の遮断は
// 共通フック useFloatingPanel に任せる（CLAUDE.md Section 51。個別にコピペしない）。
// document.body へ Portal する要素は pointerEvents:"auto" を必ず明示する（同 Section 51）。

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";

export type SectionMenuAction = "rename" | "top" | "up" | "down" | "bottom" | "delete";

export const ALL_SECTION_MENU_ACTIONS: SectionMenuAction[] = ["rename", "top", "up", "down", "bottom", "delete"];
export const MOVE_ONLY_SECTION_MENU_ACTIONS: SectionMenuAction[] = ["top", "up", "down", "bottom"];

interface Props {
  sectionName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (action: SectionMenuAction) => void;
  /** 出す項目（既定は全部。ガントは並べ替えの4つだけ） */
  actions?: SectionMenuAction[];
}

const PANEL_WIDTH = 170;
const ITEM_HEIGHT = 34;
const PANEL_PADDING = 8;
const ITEMS: { id: SectionMenuAction; icon: string; label: string }[] = [
  { id: "rename", icon: "✏️", label: "名前を変更" },
  { id: "top",    icon: "⤒",  label: "一番上へ移動" },
  { id: "up",     icon: "↑",  label: "上へ移動" },
  { id: "down",   icon: "↓",  label: "下へ移動" },
  { id: "bottom", icon: "⤓",  label: "一番下へ移動" },
  { id: "delete", icon: "🗑", label: "グループを削除" },
];

export function SectionMenu({ sectionName, canMoveUp, canMoveDown, onSelect, actions = ALL_SECTION_MENU_ACTIONS }: Props) {
  const items = ITEMS.filter(i => actions.includes(i.id));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open,
    onRequestClose: () => setOpen(false),
    triggerRef,
    panelRef,
    align: "right",
    width: PANEL_WIDTH,
    margin: 8,
    preferredMaxHeight: items.length * ITEM_HEIGHT + PANEL_PADDING,
    minMaxHeight: 76,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`グループ「${sectionName}」の操作`}
        title="グループの操作"
        style={{
          flexShrink: 0, width: 22, height: 22, padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer",
          borderRadius: "var(--radius-md)", color: "var(--color-text-tertiary)",
          fontSize: "13px", lineHeight: 1,
        }}
      >⋮</button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="animate-dropdown"
          style={{
            ...panelStyle,
            ...scrollAreaStyle,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "4px",
            pointerEvents: "auto",
          }}
        >
          {items.map(item => {
            const disabled = ((item.id === "up" || item.id === "top") && !canMoveUp) || ((item.id === "down" || item.id === "bottom") && !canMoveDown);
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => { setOpen(false); onSelect(item.id); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "8px",
                  padding: "7px 10px", fontSize: "12px", textAlign: "left",
                  border: "none", borderRadius: "var(--radius-sm)", background: "transparent",
                  color: item.id === "delete" ? "var(--color-text-danger)" : "var(--color-text-primary)",
                  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
                }}
              >
                <span style={{ fontSize: "12px", flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { useT } from "../../hooks/useT";
import { computeFloatingPanelPosition } from "../../lib/layout/floatingPanelPosition";

interface Props {
  assigneeIds: string[];
  members: Member[];
  onSave: (ids: string[]) => void;
}

// パネル幅は内容（メンバー名・アバター）に応じて可変（旧実装のminWidth:150pxを維持）。
// クランプ計算のための見積もり値。実際の描画幅がこれより大きい場合、水平方向のクランプ
// 精度は幾分下がるが（CustomSelect/ProjectRowMenuのように固定幅を持たない設計上の割り切
// り）、位置計算自体が無かった旧実装からの改善であることに変わりはない。
const PANEL_WIDTH_ESTIMATE = 220;
// パネルのmaxHeight（下記style参照）と一致させる高さの見積もり値
const PANEL_MAX_HEIGHT = 200;

export function InlineEditAssignee({ assigneeIds, members, onSave }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // トリガー位置からパネルの fixed 座標を計算（画面外へのはみ出しをクランプ・反転する。
  // 2026-08-20追記。src/lib/layout/floatingPanelPosition.ts 参照。ProjectRowMenu.tsx/
  // CustomSelect.tsx/MentionTextarea.tsxと同じ共通関数を使う）
  const calcPanelStyle = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const { top, left } = computeFloatingPanelPosition({
      triggerRect: rect,
      panelWidth: PANEL_WIDTH_ESTIMATE,
      estimatedPanelHeight: PANEL_MAX_HEIGHT,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPanelStyle({ position: "fixed", top, left, zIndex: 9999 });
  }, []);

  const handleToggleOpen = () => {
    if (!open) calcPanelStyle();
    setOpen(v => !v);
  };

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

  // スクロール・リサイズで閉じる（fixedパネルがトリガーから離れるのを防ぐ。
  // ProjectRowMenu.tsx/CustomSelect.tsxと同じ）
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
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
        <div ref={panelRef} style={{
          ...panelStyle,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          minWidth: "150px",
          maxHeight: `${PANEL_MAX_HEIGHT}px`,
          overflowY: "auto",
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

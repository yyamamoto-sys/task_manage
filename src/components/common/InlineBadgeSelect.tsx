import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isImeComposing } from "../../lib/shortcuts/keys";

export interface BadgeOption<V extends string> {
  value: V;
  label: string;
  bg: string;
  color: string;
}

interface Props<V extends string> {
  /** 現在値。null＝未設定（emptyLabel を灰色バッジで出す） */
  value: V | null;
  options: readonly BadgeOption<V>[];
  onSelect: (v: V) => void;
  /** 未設定のときに選べる項目を追加する場合に渡す（例：優先度「なし」） */
  noneOption?: { label: string; onSelect: () => void };
  emptyLabel?: string;
  title?: string;
}

/** 一覧の状態・優先度バッジ。クリックでその場にメニューを開いて変更する（行クリックへは伝播させない）。 */
export function InlineBadgeSelect<V extends string>({ value, options, onSelect, noneOption, emptyLabel = "—", title }: Props<V>) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value) ?? null;

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (menuRef.current?.contains(n) || btnRef.current?.contains(n)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeComposing(e)) { e.stopPropagation(); close(); btnRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: r.left, y: r.bottom + 2 });
  };

  const itemStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "4px 8px",
    border: "none", background: "transparent", cursor: "pointer", fontSize: 11, textAlign: "left",
    color: "var(--color-text-primary)",
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        onClick={e => { e.stopPropagation(); if (pos) setPos(null); else open(); }}
        style={{
          fontSize: "9px", padding: "2px 6px", borderRadius: "3px", border: "none", cursor: "pointer",
          background: current ? current.bg : "var(--color-bg-tertiary)",
          color: current ? current.color : "var(--color-text-tertiary)",
        }}
      >{current ? current.label : emptyLabel}</button>
      {pos && createPortal(
        // ポータルのクリックが React 上は行（tr）へ伝播して詳細が開くのを止める
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
        <div
          ref={menuRef}
          role="menu"
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed", left: pos.x, top: pos.y, zIndex: 1000, pointerEvents: "auto", minWidth: 84, padding: 3,
            background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", boxShadow: "0 4px 14px rgba(0,0,0,.15)",
          }}
        >
          {options.map(o => (
            <button key={o.value} type="button" role="menuitem" style={itemStyle}
              onClick={() => { setPos(null); if (o.value !== value) onSelect(o.value); }}>
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: o.bg, color: o.color }}>{o.label}</span>
              {o.value === value && <span aria-hidden>✓</span>}
            </button>
          ))}
          {noneOption && (
            <button type="button" role="menuitem" style={itemStyle}
              onClick={() => { setPos(null); if (value !== null) noneOption.onSelect(); }}>
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{noneOption.label}</span>
              {value === null && <span aria-hidden>✓</span>}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

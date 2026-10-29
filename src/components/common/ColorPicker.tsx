// src/components/common/ColorPicker.tsx
//
// 【設計意図・v3.190】
// 色を選ぶ共通部品（最初の利用先はマイルストーン）。
//  - 「既定」（value=null）＋よく使う色の見本＋最近使ったカスタム色を横に並べる
//  - 「その他の色」でポップオーバー（useFloatingPanel・Portal）を開き、カラーグリッド・
//    <input type="color">・HEX入力から選べる
// 色の値は "#rrggbb"（正規化済み）か null（既定）。生成・正規化は lib/milestoneColor.ts の純粋関数。
// 最近使った色は localStorage（KEYS.RECENT_CUSTOM_COLORS・上限6件）。読み書きは try/catch（プライベートモード等で例外になりうる）。

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";
import { closeOnEscapeAndStop } from "../../lib/overlayEscape";
import { KEYS } from "../../lib/localData/localStore";
import {
  COLOR_GRID_HUES, DEFAULT_MILESTONE_FILL, MILESTONE_SWATCHES,
  generateColorGrid, isLightColor, normalizeHexColor, parseRecentColors, pushRecentColor,
} from "../../lib/milestoneColor";

interface Props {
  /** "#rrggbb" か null（既定） */
  value: string | null;
  onChange: (value: string | null) => void;
  /** 「既定」ボタンに出す色（既定の◆の色）。省略時はアンバー */
  defaultColor?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

const GRID = generateColorGrid();
const CELL = 20;

function loadRecent(): string[] {
  try { return parseRecentColors(localStorage.getItem(KEYS.RECENT_CUSTOM_COLORS)); } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(KEYS.RECENT_CUSTOM_COLORS, JSON.stringify(list)); } catch { /* ignore */ }
}

/** 選択中が分かる印（外側のリング＋✓）。ダークテーマでも見えるようテキスト色トークンのリングを使う */
function chipStyle(color: string, selected: boolean): React.CSSProperties {
  return {
    width: CELL, height: CELL, padding: 0, flexShrink: 0, cursor: "pointer",
    background: color,
    border: "1px solid rgba(128,128,128,0.55)",
    borderRadius: "var(--radius-sm)",
    boxShadow: selected ? "0 0 0 2px var(--color-bg-primary), 0 0 0 4px var(--color-text-primary)" : "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "12px", fontWeight: 700, lineHeight: 1,
    color: isLightColor(color) ? "#111" : "#fff",
  };
}

export function ColorPicker({ value, onChange, defaultColor = DEFAULT_MILESTONE_FILL, disabled, ariaLabel = "色" }: Props) {
  const selected = normalizeHexColor(value);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [hexDraft, setHexDraft] = useState(selected ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);

  const { panelStyle } = useFloatingPanel({
    open,
    onRequestClose: () => setOpen(false),
    triggerRef, panelRef,
    width: "auto",
    fallbackWidth: COLOR_GRID_HUES * (CELL + 4) + 24,
    preferredMaxHeight: 420,
    minMaxHeight: 200,
  });

  useEffect(() => { setHexDraft(selected ?? ""); }, [selected]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { closeOnEscapeAndStop(e, () => { setOpen(false); triggerRef.current?.focus(); }); };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open]);

  // 開いたら、選択中のセル（無ければ先頭）にフォーカス
  useEffect(() => {
    if (!open) return;
    let idx = 0;
    if (selected) {
      const flat = GRID.flat();
      const i = flat.indexOf(selected);
      if (i >= 0) idx = i;
    }
    setFocusIdx(idx);
    const id = requestAnimationFrame(() => cellRefs.current[idx]?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた瞬間だけ
  }, [open]);

  const remember = (c: string) => {
    setRecent(prev => { const next = pushRecentColor(prev, c); saveRecent(next); return next; });
  };

  const pickFromGrid = (c: string) => { onChange(c); remember(c); setOpen(false); triggerRef.current?.focus(); };

  const commitHex = () => {
    const n = normalizeHexColor(hexDraft);
    if (n) { onChange(n); remember(n); } else setHexDraft(selected ?? "");
  };

  const onGridKey = (e: ReactKeyboardEvent, idx: number) => {
    const cols = COLOR_GRID_HUES;
    const total = GRID.length * cols;
    let next = idx;
    if (e.key === "ArrowRight") next = Math.min(total - 1, idx + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (e.key === "ArrowDown") next = Math.min(total - 1, idx + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, idx - cols);
    else if (e.key === "Home") next = idx - (idx % cols);
    else if (e.key === "End") next = idx - (idx % cols) + cols - 1;
    else return;
    e.preventDefault();
    setFocusIdx(next);
    cellRefs.current[next]?.focus();
  };

  const swatchList = [...MILESTONE_SWATCHES, ...recent.filter(c => !MILESTONE_SWATCHES.includes(c))];
  const isCustomSelected = !!selected && !MILESTONE_SWATCHES.includes(selected) && !recent.includes(selected);

  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
      <button
        type="button" disabled={disabled} onClick={() => onChange(null)}
        aria-pressed={selected === null} aria-label="既定の色" title="既定の色"
        style={{
          ...chipStyle(defaultColor, selected === null),
          width: "auto", padding: "0 8px", gap: "4px", fontSize: "11px", fontWeight: 500,
        }}
      >
        {selected === null ? "✓ " : ""}既定
      </button>
      {swatchList.map(c => (
        <button
          key={c} type="button" disabled={disabled} onClick={() => onChange(c)}
          aria-pressed={selected === c} aria-label={`色 ${c}`} title={c}
          style={chipStyle(c, selected === c)}
        >{selected === c ? "✓" : ""}</button>
      ))}
      {isCustomSelected && selected && (
        <button type="button" disabled aria-label={`選択中のカスタム色 ${selected}`} title={selected} style={{ ...chipStyle(selected, true), cursor: "default" }}>✓</button>
      )}
      <button
        ref={triggerRef} type="button" disabled={disabled}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog" aria-expanded={open}
        style={{
          fontSize: "11px", padding: "2px 8px", height: CELL + 2,
          background: "transparent", color: "var(--color-text-secondary)",
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
          cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
        }}
      >その他の色…</button>

      {open && createPortal(
        <div
          ref={panelRef} role="dialog" aria-label="色を選ぶ"
          className="animate-dropdown"
          style={{
            ...panelStyle,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "10px",
            overflow: "auto",
            pointerEvents: "auto",  // body { pointer-events:none } の影響を Portal 要素で打ち消す（Section 51）
          }}
        >
          <div role="grid" aria-label="カラーグリッド" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {GRID.map((row, r) => (
              <div role="row" key={r} style={{ display: "flex", gap: "4px" }}>
                {row.map((c, i) => {
                  const idx = r * COLOR_GRID_HUES + i;
                  return (
                    <button
                      key={c + i} role="gridcell" type="button"
                      ref={el => { cellRefs.current[idx] = el; }}
                      tabIndex={idx === focusIdx ? 0 : -1}
                      onClick={() => pickFromGrid(c)}
                      onKeyDown={e => onGridKey(e, idx)}
                      aria-selected={selected === c} aria-label={`色 ${c}`} title={c}
                      style={chipStyle(c, selected === c)}
                    >{selected === c ? "✓" : ""}</button>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
            <input
              type="color" value={selected ?? defaultColor}
              onChange={e => onChange(normalizeHexColor(e.target.value))}
              onBlur={e => { const n = normalizeHexColor(e.target.value); if (n && n === selected) remember(n); }}
              aria-label="色を自由に決める"
              style={{ width: 32, height: 26, padding: 0, border: "1px solid var(--color-border-primary)", background: "transparent", cursor: "pointer" }}
            />
            <input
              value={hexDraft} placeholder="#RRGGBB" maxLength={7} spellCheck={false}
              onChange={e => setHexDraft(e.target.value)}
              onBlur={commitHex}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitHex(); } }}
              aria-label="HEXで色を入力"
              style={{
                width: 90, padding: "4px 6px", fontSize: "12px", fontFamily: "monospace",
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
                background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
              }}
            />
            <button
              type="button" onClick={() => setOpen(false)}
              style={{ marginLeft: "auto", fontSize: "11px", padding: "3px 10px", background: "transparent",
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
                color: "var(--color-text-secondary)", cursor: "pointer" }}
            >閉じる</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

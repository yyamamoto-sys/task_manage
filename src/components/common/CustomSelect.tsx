// src/components/common/CustomSelect.tsx
//
// ネイティブ <select> をアプリのデザイントークンに合わせたカスタムドロップダウンに置き換えるコンポーネント。
// - globals.css の CSS 変数を使用（ライト/ダークモード自動対応）
// - 開閉アニメーション（.animate-dropdown）
// - chevron アイコンが回転
// - 選択中項目はブランドカラーでハイライト
//
// 【設計メモ】
// ドロップダウンパネルは ReactDOM.createPortal で document.body 直下に描画する。
// モーダルの transform がスタッキングコンテキストを作るため、absolute 配置だと
// 後続要素に隠れてしまう問題を根本解決するため。
// パネル位置はトリガーの getBoundingClientRect() を使って fixed で算出する。

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function CustomSelect({
  value, onChange, options, placeholder = "選択...", disabled, style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // トリガー位置からパネルの fixed 座標を計算
  const calcPanelStyle = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    if (!open) calcPanelStyle();
    setOpen(v => !v);
  };

  // クリック外で閉じる（トリガーとパネル両方を除外）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape キーで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // スクロール・リサイズ時に閉じる（位置ズレ防止）
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div style={{ position: "relative", ...style }}>
      {/* トリガーボタン */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "7px 10px",
          fontSize: "12px",
          border: `1px solid ${open ? "var(--color-brand)" : "var(--color-border-primary)"}`,
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-primary)",
          color: selected ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: open ? "0 0 0 2px var(--color-brand-light)" : "none",
          transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
        }}
      >
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          fontSize: "12px",
        }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronIcon open={open} />
      </button>

      {/* ドロップダウンパネル — Portal で body 直下に描画してスタッキングコンテキスト問題を回避 */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="animate-dropdown"
          style={{
            ...panelStyle,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            maxHeight: "220px",
            overflowY: "auto",
            padding: "4px",
          }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%",
                  display: "block",
                  padding: "7px 10px",
                  fontSize: "12px",
                  textAlign: "left",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "var(--color-brand-light)" : "transparent",
                  color: isSelected ? "var(--color-brand)" : "var(--color-text-primary)",
                  fontWeight: isSelected ? 600 : 400,
                  cursor: "pointer",
                  transition: "background var(--transition-fast)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="6" viewBox="0 0 10 6" fill="none"
      style={{
        flexShrink: 0,
        color: "var(--color-text-tertiary)",
        transition: "transform 0.2s cubic-bezier(0.16,1,0.3,1)",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <path
        d="M1 1l4 4 4-4"
        stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

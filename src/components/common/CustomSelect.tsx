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
  /** 左に表示する色ドット（PJカラー等で属性を視覚化する） */
  color?: string;
  /** 右側に薄く表示する補助テキスト（他PJ名など） */
  meta?: string;
  /** 文字を控えめに表示（現PJ外などの弱表示） */
  dim?: boolean;
  /** 見出し行（選択不可・グループ分け用） */
  header?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** true で開いた時に検索ボックスを表示し、入力でラベルを絞り込めるようにする */
  searchable?: boolean;
  /** 検索ボックスのプレースホルダ（searchable 時） */
  searchPlaceholder?: string;
}

export function CustomSelect({
  value, onChange, options, placeholder = "選択...", disabled, style,
  searchable = false, searchPlaceholder = "名前で検索...",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  // スクロール・リサイズ時に閉じる（fixed パネルがトリガーから離れるのを防ぐ）。
  // ただし「パネル内部のスクロール」では閉じない（下の項目までスクロールして選べるように）。
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      // ドロップダウン内のスクロールは無視（リスト内スクロールで閉じない）
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

  // 開いたら検索クエリをリセットし、検索ボックスにフォーカス
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    if (!searchable) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, searchable]);

  const selected = options.find(o => o.value === value);

  // 検索フィルタ（searchable 時のみ。ラベルの部分一致・大小無視）
  const q = query.trim().toLowerCase();
  const filteredOptions = searchable && q
    ? options.filter(o => !o.header && o.label.toLowerCase().includes(q))
    : options;

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
          display: "flex", alignItems: "center", gap: "7px",
          overflow: "hidden", flex: 1, fontSize: "12px",
        }}>
          {selected?.color && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: selected.color, flexShrink: 0, boxShadow: "0 0 0 1px rgba(0,0,0,.06)" }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected ? selected.label : placeholder}
          </span>
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
            maxHeight: "260px",
            display: "flex",
            flexDirection: "column",
            padding: "4px",
            pointerEvents: "auto",  // body { pointer-events:none } の影響を Portal 要素で打ち消す
          }}
        >
          {searchable && (
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const first = filteredOptions.find(o => !o.header);
                  if (first) { e.preventDefault(); onChange(first.value); setOpen(false); }
                }
              }}
              placeholder={searchPlaceholder}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "7px 10px", marginBottom: "4px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                outline: "none", flexShrink: 0,
              }}
            />
          )}
          <div style={{ overflowY: "auto", minHeight: 0 }}>
          {filteredOptions.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              該当する候補がありません
            </div>
          )}
          {filteredOptions.map((opt, i) => {
            if (opt.header) {
              return (
                <div key={`__h${i}`} style={{
                  padding: "8px 10px 3px", fontSize: "10px", fontWeight: 700,
                  letterSpacing: "0.04em", color: "var(--color-text-tertiary)",
                }}>{opt.label}</div>
              );
            }
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%",
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "7px 10px",
                  fontSize: "12px",
                  textAlign: "left",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "var(--color-brand-light)" : "transparent",
                  color: isSelected ? "var(--color-brand)" : opt.dim ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
                  fontWeight: isSelected ? 600 : 400,
                  cursor: "pointer",
                  transition: "background var(--transition-fast)",
                }}
              >
                {opt.color && (
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: opt.color, flexShrink: 0, boxShadow: "0 0 0 1px rgba(0,0,0,.06)" }} />
                )}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                {opt.meta && (
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, maxWidth: "48%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.meta}</span>
                )}
              </button>
            );
          })}
          </div>
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

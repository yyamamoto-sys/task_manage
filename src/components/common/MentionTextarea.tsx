// src/components/common/MentionTextarea.tsx
//
// コメント・メモ欄の @ メンション対応 textarea。
// "@" を入力するとメンバーサジェストが Portal で表示され、選択すると @short_name を挿入する。
// createPortal で body 直下に描画するため、モーダル内でも z-index 問題が起きない。
//
// 注意: onChange / value を useCallback の依存に入れると TaskEditModal 側でインライン関数が
// 毎レンダー再生成され handleChange が常に古い onChange を参照する stale closure が発生する。
// そのため onChange は ref で保持し、select は ta.value (DOM値) を直接参照する。

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../../lib/localData/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  rows?: number;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function MentionTextarea({ value, onChange, members, rows = 4, placeholder, style }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos]     = useState({ top: 0, left: 0, width: 0 });

  // onChange は毎レンダーで参照が変わりうるので ref で保持する
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const activeMembers = members.filter(m => !m.is_deleted);
  const filtered = activeMembers.filter(m =>
    query === "" ||
    m.display_name.toLowerCase().includes(query.toLowerCase()) ||
    m.short_name.toLowerCase().includes(query.toLowerCase())
  );

  // "@" から始まる入力中の単語を検出してサジェストを開閉する
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChangeRef.current(v);

    const cursor = e.target.selectionStart ?? 0;
    const before = v.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      setQuery(match[1]);
      const rect = e.target.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) { setOpen(false); e.stopPropagation(); }
  };

  // メンバーを選択して @short_name を挿入
  // ta.value（DOM値）を使うことで stale な value prop を参照しない
  const select = (member: Member) => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? 0;
    const currentVal = ta.value;
    const before = currentVal.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) { setOpen(false); return; }
    const start  = cursor - match[0].length;
    const newVal = currentVal.slice(0, start) + `@${member.short_name} ` + currentVal.slice(cursor);
    onChangeRef.current(newVal);
    setOpen(false);
    const newCursor = start + member.short_name.length + 2;
    setTimeout(() => { ta.focus(); ta.setSelectionRange(newCursor, newCursor); }, 0);
  };

  // ポップアップ外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (taRef.current && !taRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        style={style}
      />

      {open && filtered.length > 0 && createPortal(
        <div style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: Math.max(pos.width, 200),
          zIndex: 9999,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-md)",
          maxHeight: "220px",
          overflowY: "auto",
          padding: "4px",
          pointerEvents: "auto",
        }}>
          <div style={{
            fontSize: "10px", color: "var(--color-text-secondary)",
            padding: "4px 10px 2px", userSelect: "none",
          }}>
            @ メンション
          </div>
          {filtered.map(m => (
            <button
              key={m.id}
              onMouseDown={e => { e.preventDefault(); select(m); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "6px 10px",
                border: "none", background: "none",
                cursor: "pointer", borderRadius: "var(--radius-sm)",
                textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, borderRadius: "50%",
                fontSize: "10px", fontWeight: 700,
                background: m.color_bg || "var(--color-brand-primary)",
                color: m.color_text || "#fff",
                flexShrink: 0,
              }}>
                {m.initials}
              </span>
              <span style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 600 }}>
                {m.short_name}
              </span>
              {m.short_name !== m.display_name && (
                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {m.display_name}
                </span>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

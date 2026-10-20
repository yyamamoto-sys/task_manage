// src/components/section/SectionHeader.tsx
//
// PJ内「グループ」の見出しの中身（開閉の矢印・名前・件数・名前変更・⋮メニュー）と、
// 「＋ グループを追加」の入力。リスト（<tr>）とガント（<div>）の両方で使う共通部品で、
// 外側の要素（行・ドロップ先の設定）は呼び出し側が持つ。
//
// 名前の変更は見出しの中でその場入力する（Enter で確定・Esc でやめる・日本語変換中の Enter は無視・
// 欄を離れたら確定）。空にしたら変更しない。確定の実処理は呼び出し側（appStore.saveProjectSection）。

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SectionMenu, type SectionMenuAction } from "./SectionMenu";
import { SECTION_NAME_MAX, normalizeSectionName, type SectionMoveDir } from "../../lib/section/sections";

interface HeaderProps {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** 名前・並べ替え・削除ができる（ゲストの編集可否・「未分類」は false にして⋮を出さない） */
  canEdit: boolean;
  /** 「未分類」の見出し（名前変更・⋮メニューなし。控えめな色） */
  unsectioned?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onRename?: (name: string) => void;
  onMove?: (dir: SectionMoveDir) => void;
  onDelete?: () => void;
  /** 件数の横に出す補足（完了率バッジなど） */
  stats?: ReactNode;
  /** ドラッグ中だけ見せるヒント（例：「ここに落とすとこのグループへ移ります」） */
  dropHint?: string;
  dropHintVisible?: boolean;
  /** 見出しのつかみ（⠿）からのドラッグ＆ドロップによる並べ替え（リストのみ・v3.156）。キーボードでは⋮の「上へ・下へ」で代替 */
  sectionDrag?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
}

export function SectionHeaderContent({
  name, count, collapsed, onToggle, canEdit, unsectioned, canMoveUp = true, canMoveDown = true,
  onRename, onMove, onDelete, stats, dropHint, dropHintVisible, sectionDrag,
}: HeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const commit = () => {
    const n = normalizeSectionName(draft);
    setEditing(false);
    if (n && n !== name) onRename?.(n);
  };

  const handleMenu = (a: SectionMenuAction) => {
    if (a === "rename") { setDraft(name); setEditing(true); }
    else if (a === "top" || a === "up" || a === "down" || a === "bottom") onMove?.(a);
    else if (a === "delete") onDelete?.();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%", padding: "3px 10px 2px 22px", minWidth: 0 }}>
      {sectionDrag && canEdit && !unsectioned && (
        // マウスのドラッグ専用のつかみ。キーボード代替は⋮メニューの「上へ・下へ」
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <span
          draggable
          onDragStart={sectionDrag.onDragStart}
          onDragEnd={sectionDrag.onDragEnd}
          title="ドラッグしてグループの順番を入れ替え"
          style={{ width: 12, textAlign: "center", flexShrink: 0, cursor: "grab", color: "var(--color-text-tertiary)", fontSize: "12px", lineHeight: 1, userSelect: "none", marginLeft: -4 }}
        >⠿</span>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${name}を${collapsed ? "展開" : "折りたたむ"}`}
        style={{
          flexShrink: 0, width: 14, padding: 0, border: "none", background: "transparent", cursor: "pointer",
          fontSize: "9px", color: "var(--color-text-tertiary)",
        }}
      >{collapsed ? "▶" : "▼"}</button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={SECTION_NAME_MAX}
          aria-label="グループ名"
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          style={{
            flex: "0 1 260px", minWidth: 80, padding: "1px 6px", fontSize: "11px", fontWeight: 600,
            border: "1px solid var(--color-brand)", borderRadius: "var(--radius-sm)",
            background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
          }}
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          title={name}
          style={{
            fontSize: "11px", fontWeight: 600, cursor: "pointer", minWidth: 0,
            color: unsectioned ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >{name}</span>
      )}
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, whiteSpace: "nowrap" }}>{count}件</span>
      {stats}
      {dropHint && (
        <span style={{
          fontSize: "10px", color: "var(--color-brand)", whiteSpace: "nowrap",
          visibility: dropHintVisible ? "visible" : "hidden",
        }}>{dropHint}</span>
      )}
      <span style={{ flex: 1 }} />
      {canEdit && !unsectioned && (
        <SectionMenu sectionName={name} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onSelect={handleMenu} />
      )}
    </div>
  );
}

interface AddProps {
  /** 作成する（名前は正規化済み）。失敗は呼び出し側が通知する */
  onCreate: (name: string) => void;
  /** 左の余白（リストは表の中・ガントはラベル列に合わせて調整する） */
  indent?: number;
}

/** 「＋ グループを追加」：押すと名前の入力欄になる。Enter で作成（続けて入力できる）・Esc でやめる */
export function SectionAddInput({ onCreate, indent = 12 }: AddProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "block", width: "100%", textAlign: "left", padding: `3px 12px 3px ${indent}px`,
          border: "none", background: "transparent", cursor: "pointer", font: "inherit",
          fontSize: "11px", color: "var(--color-text-tertiary)",
        }}
      >＋ グループを追加</button>
    );
  }

  const create = () => {
    const n = normalizeSectionName(draft);
    if (!n) return;
    onCreate(n);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: `3px 12px 3px ${indent}px` }}>
      <input
        ref={inputRef}
        value={draft}
        maxLength={SECTION_NAME_MAX}
        aria-label="新しいグループの名前"
        placeholder="グループ名（例：第1回・準備）"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") { e.preventDefault(); create(); }
          else if (e.key === "Escape") { e.preventDefault(); setDraft(""); setOpen(false); }
        }}
        style={{
          flex: "0 1 280px", minWidth: 100, padding: "2px 8px", fontSize: "11px",
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
        }}
      />
      <button type="button" onClick={create} disabled={!normalizeSectionName(draft)}
        style={{ fontSize: "11px", padding: "2px 8px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", background: "var(--color-bg-secondary)", cursor: "pointer", color: "var(--color-text-secondary)" }}>
        追加
      </button>
      <button type="button" onClick={() => { setDraft(""); setOpen(false); }}
        style={{ fontSize: "11px", padding: "2px 6px", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-tertiary)" }}>
        閉じる
      </button>
    </div>
  );
}

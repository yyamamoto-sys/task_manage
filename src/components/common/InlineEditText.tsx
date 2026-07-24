import { useState, useRef, useEffect, type CSSProperties } from "react";

interface Props {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  /**
   * マウント時から編集状態で開始する（既存の「クリックして編集」に加えた後方互換の追加プロップ。
   * CLAUDE.md v3.06：ガントの行間挿入UIで新規タスク作成直後に名前をすぐ入力させるために追加。
   * 呼び出し側は新規タスクごとに key=task.id で新規マウントさせる想定＝この state は
   * マウント時の初期値としてのみ効き、後から autoEdit の値を変えても再オープンはしない）。
   */
  autoEdit?: boolean;
}

export function InlineEditText({ value, onSave, placeholder, style, autoEdit }: Props) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // autoEdit はマウント時の初期状態としてのみ効く（呼び出し側が key=task.id で新規マウントさせる
  // 前提）。マウント直後に1回だけ全選択し、続く文字入力でプレースホルダー的な初期値を
  // まるごと上書きできるようにする。
  useEffect(() => {
    if (autoEdit) inputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        style={{
          font: "inherit",
          fontSize: "inherit",
          color: "inherit",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          padding: "1px 4px",
          outline: "none",
          width: "100%",
          ...style,
        }}
      />
    );
  }

  return (
    <span
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true); }}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDraft(value); setEditing(true); } }}
      title="クリックして編集"
      style={{
        cursor: "text",
        borderBottom: "1px dashed transparent",
        display: "inline-block",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "var(--color-border-primary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "transparent"; }}
    >
      {value || <span style={{ color: "var(--color-text-tertiary)" }}>{placeholder}</span>}
    </span>
  );
}

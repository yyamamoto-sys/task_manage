import { useState, useRef, useEffect, type CSSProperties } from "react";

interface Props {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
}

export function InlineEditText({ value, onSave, placeholder, style }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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

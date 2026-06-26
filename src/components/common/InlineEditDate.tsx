import { useState, useRef, useEffect } from "react";

interface Props {
  value: string | null;
  onSave: (v: string | null) => void;
}

export function InlineEditDate({ value, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const isOverdue = value && value < new Date().toISOString().split("T")[0];

  if (editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <input
          ref={inputRef}
          type="date"
          defaultValue={value ?? ""}
          onBlur={e => { onSave(e.target.value || null); setEditing(false); }}
          onChange={e => { onSave(e.target.value || null); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            font: "inherit",
            fontSize: "inherit",
            border: "1px solid var(--color-brand)",
            borderRadius: "var(--radius-sm)",
            padding: "1px 4px",
            outline: "none",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
          }}
        />
        <button
          onMouseDown={e => { e.preventDefault(); onSave(null); setEditing(false); }}
          title="期日をクリア"
          style={{
            padding: "0 3px", fontSize: "10px",
            background: "transparent", border: "none",
            cursor: "pointer", color: "var(--color-text-tertiary)",
          }}
        >✕</button>
      </span>
    );
  }

  return (
    <span
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      title="クリックして期日を編集"
      style={{
        cursor: "text",
        fontSize: "inherit",
        color: value
          ? (isOverdue ? "var(--color-text-danger)" : "inherit")
          : "var(--color-text-tertiary)",
        fontWeight: isOverdue ? "500" : "inherit",
        borderBottom: "1px dashed transparent",
        display: "inline-block",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "var(--color-border-primary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "transparent"; }}
    >
      {value ? value.slice(5).replace("-", "/") : "期日未設定"}
    </span>
  );
}

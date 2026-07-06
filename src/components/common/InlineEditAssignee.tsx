import { useState, useRef, useEffect } from "react";
import type { Member } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";

interface Props {
  assigneeIds: string[];
  members: Member[];
  onSave: (ids: string[]) => void;
}

export function InlineEditAssignee({ assigneeIds, members, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (id: string) => {
    const next = assigneeIds.includes(id)
      ? assigneeIds.filter(x => x !== id)
      : [...assigneeIds, id];
    onSave(next);
  };

  const assignees = members.filter(m => assigneeIds.includes(m.id));

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <div
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); } }}
        title="クリックして担当者を変更"
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
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>未担当</span>
        )}
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          zIndex: 100,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          minWidth: "150px",
          maxHeight: "200px",
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
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { todayStr } from "../../lib/date";
import { useT } from "../../hooks/useT";
import { formatDueRelative, formatFullDateWithWeekday } from "../../lib/dueRelative";
import type { Task } from "../../lib/localData/types";

interface Props {
  value: string | null;
  onSave: (v: string | null) => void;
  /** 完了タスクは期限超過でも赤字強調しない（モバイルカード行と同じ判定に揃える） */
  isDone?: boolean;
  /** 値が未設定のときに表示するプレースホルダ文言。既定＝期日入力での従来文言（後方互換）。
   *  ガントの開始日入力（GanttParts.tsx）では「開始日未設定」を渡す */
  placeholder?: string;
  /** 渡すと期日を相対表示（超過・今日・明日・あとN日）にする。完了・中止は MM/DD を灰色で出す（一覧用・v3.199） */
  relativeStatus?: Task["status"];
}

export function InlineEditDate({ value, onSave, isDone, placeholder, relativeStatus }: Props) {
  const t = useT();
  const effectivePlaceholder = placeholder ?? t("common.date.dueUnset");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const isOverdue = !isDone && !!value && value < todayStr();
  const rel = relativeStatus && value ? formatDueRelative(value, relativeStatus, todayStr()) : null;

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
          title={t("common.date.clearTitle")}
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
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setEditing(true); } }}
      title={rel && value ? `${formatFullDateWithWeekday(value)} ${t("common.date.editTitle")}` : t("common.date.editTitle")}
      style={{
        cursor: "text",
        fontSize: "inherit",
        color: !value
          ? "var(--color-text-tertiary)"
          : rel
            ? (rel.tone === "overdue" ? "var(--color-text-danger)" : rel.tone === "today" ? "var(--color-text-purple)" : rel.tone === "muted" ? "var(--color-text-tertiary)" : "inherit")
            : (isOverdue ? "var(--color-text-danger)" : "inherit"),
        fontWeight: rel ? (rel.tone === "overdue" || rel.tone === "today" ? "600" : "inherit") : (isOverdue ? "500" : "inherit"),
        borderBottom: "1px dashed transparent",
        display: "inline-block",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "var(--color-border-primary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "transparent"; }}
    >
      {value ? (rel ? rel.label : value.slice(5).replace("-", "/")) : effectivePlaceholder}
    </span>
  );
}

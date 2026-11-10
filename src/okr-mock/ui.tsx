import { useEffect, type ReactNode } from "react";
import { members } from "./fixtures";
import { diffDays, formatMd, isOpen, TODAY } from "./logic";
import type { Seg, Task } from "./types";

export function memberOf(id: string) {
  return members.find((m) => m.id === id);
}

export function Avatar({ id }: { id: string }) {
  const m = memberOf(id);
  if (!m) return null;
  return (
    <span className="mk-avatar" style={{ background: m.color }} title={m.name}>
      {m.name.charAt(0)}
    </span>
  );
}

export function Avatars({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="mk-muted">担当なし</span>;
  return (
    <span className="mk-avatars">
      {ids.map((id) => (
        <Avatar key={id} id={id} />
      ))}
    </span>
  );
}

export function DueLabel({ task }: { task: Task }) {
  const late = isOpen(task) && task.due < TODAY;
  return (
    <span className={late ? "mk-chip mk-chip-red" : ""} style={late ? undefined : { fontSize: 13 }}>
      {formatMd(task.due)}
      {late ? ` ${diffDays(TODAY, task.due)}日超過` : ""}
    </span>
  );
}

export function StatusChip({ status }: { status: Task["status"] }) {
  const cls = status === "完了" ? "mk-chip-green" : status === "進行中" ? "mk-chip-blue" : "";
  return <span className={`mk-chip ${cls}`}>{status}</span>;
}

export function DiffText({ segs, kind }: { segs: Seg[]; kind: "ins" | "del" }) {
  return (
    <>
      {segs.map((s, i) =>
        s.changed ? (
          <span key={i} className={kind === "ins" ? "mk-ins" : "mk-del"}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="mk-overlay print-hide" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mk-modal">
        <div className="mk-modal-body">
          <h2 className="mk-h1" style={{ fontSize: 18 }}>
            {title}
          </h2>
          {children}
        </div>
        <div className="mk-modal-foot">{footer}</div>
      </div>
    </div>
  );
}

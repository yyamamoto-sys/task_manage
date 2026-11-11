import { useEffect, type ReactNode } from "react";
import { members, teams } from "./fixtures";
import { diffDays, formatMd, formatWindow, isOpen, isSharedAcrossKrs, isStaleScope, isUnregistered, sharedTfs, TODAY } from "./logic";
import { useMock, useWeek } from "./state";
import type { OkrItem, Pj, ReportLevel, Seg, Task } from "./types";

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

export function LevelChip({ level }: { level: ReportLevel }) {
  const cls = level === "順調" ? "mk-chip-green" : level === "注意" ? "mk-chip-yellow" : "mk-chip-red";
  return <span className={`mk-chip ${cls}`}>{level}</span>;
}

/** タスクが無い範囲は「停滞」ではなく「タスク未登録」、動いていない範囲は「停滞」 */
export function ScopeBadge({ tasks: list }: { tasks: Task[] }) {
  if (isUnregistered(list)) return <span className="mk-chip mk-chip-yellow">タスク未登録</span>;
  if (isStaleScope(list, TODAY)) return <span className="mk-chip mk-chip-red">停滞（7日以上動きなし）</span>;
  return null;
}

/** 今週の動きの期間と、どのチームの周期で数えているか */
export function WeekNote() {
  const { teamId, setTeamId } = useMock();
  const { team, win } = useWeek();
  return (
    <div className="mk-row mk-small" style={{ margin: "4px 0 8px" }}>
      <span>
        今週の動き：<strong>{formatWindow(win)}</strong>（{team.name}の前回チェックインの翌日〜今回のチェックイン日）
      </span>
      <select className="mk-select mk-small" style={{ width: 120 }} aria-label="数えるチーム" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 共有PJの印：どのTFと共有しているか */
export function SharedMark({ pj, items, exceptTfId }: { pj: Pj; items: OkrItem[]; exceptTfId?: string }) {
  const others = sharedTfs(pj, items, exceptTfId);
  if (others.length === 0) return null;
  const across = isSharedAcrossKrs(pj, items);
  return (
    <span className="mk-chip mk-chip-blue" style={{ marginLeft: 4 }} title="複数のTFに紐づくPJです。KR・全体の集計では1回だけ数えます">
      共有PJ：{others.map((i) => i.label).join("・")}と共有{across ? "（別KR）" : ""}
    </span>
  );
}

import type { ReactNode } from "react";
import { KR_COLORS, members, okrItems, OWNER_ID } from "./fixtures";
import { useMock } from "./state";
import type { KrRecord, Seg, Task } from "./types";

export function memberOf(id: string) {
  return members.find((m) => m.id === id);
}

export const nameOf = (id: string | null) => (id ? (memberOf(id)?.name ?? "") : "");

export const krLabel = (id: string) => okrItems.find((i) => i.id === id)?.label ?? id;
export const krText = (id: string) => okrItems.find((i) => i.id === id)?.text ?? "";
export const krName = (id: string) => `${krLabel(id)} ${krText(id)}`;

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

/** 色の点。●＝KRにつながる（色でKRを区別）、○＝つながりなし。文字の札は出さず、title と aria-label で伝える */
export function KrDot({ krId }: { krId: string | null }) {
  if (!krId) {
    return <span className="mk-kdot is-none" role="img" aria-label="KRにつながっていません" title="KRにつながっていません" />;
  }
  const label = `つながるKR：${krName(krId)}`;
  return <span className="mk-kdot" role="img" aria-label={label} title={label} style={{ background: KR_COLORS[krId] }} />;
}

export function KrDots({ krIds }: { krIds: string[] }) {
  if (krIds.length === 0) return <KrDot krId={null} />;
  return (
    <span className="mk-kdots">
      {krIds.map((k) => (
        <KrDot key={k} krId={k} />
      ))}
    </span>
  );
}

export function valueText(r: KrRecord, v: number | string): string {
  return r.kind === "number" ? `${v}${r.unit}` : String(v);
}

export function signed(n: number, unit = ""): string {
  if (n === 0) return `±0${unit}`;
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit}`;
}

/** 本人だけに見える画面。他の人として見ているときは中身を出さない */
export function PrivateGuard({ children }: { children: ReactNode }) {
  const { isOwner, viewerId, setViewerId } = useMock();
  if (isOwner) return <>{children}</>;
  return (
    <div className="mk-card" role="note">
      <strong>本人にしか見えません。</strong>
      <p className="mk-muted">
        この画面は、{nameOf(OWNER_ID)}さん本人だけの画面です。いま見ているのは{nameOf(viewerId)}さんの立場なので、中身は出しません。GMにも見えません。
      </p>
      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setViewerId(OWNER_ID)}>
        {nameOf(OWNER_ID)}さんとして見る
      </button>
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { KR_COLORS, members, okrItems, OWNER_ID } from "./fixtures";
import type { Pace } from "./logic";
import { useMock } from "./state";
import type { KrRecord, Seg, Task } from "./types";

export function memberOf(id: string) {
  return members.find((m) => m.id === id);
}

export const nameOf = (id: string | null) => (id ? (memberOf(id)?.name ?? "") : "");
export const surnameOf = (id: string | null) => nameOf(id).split(" ")[0];

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

/** 本人だけに見える部分。他の人の立場のときは中身を出さない */
export function PrivateGuard({ children }: { children: ReactNode }) {
  const { isOwner, viewerId, setViewerId } = useMock();
  if (isOwner) return <>{children}</>;
  return (
    <div className="mk-card" role="note">
      <strong>本人にしか見えません。</strong>
      <p className="mk-muted">
        ここは、{nameOf(OWNER_ID)}さん本人だけの部分です。いま見ているのは{nameOf(viewerId)}さんの立場なので、中身は出しません。GMにも見えません。
      </p>
      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setViewerId(OWNER_ID)}>
        {nameOf(OWNER_ID)}さんとして見る
      </button>
    </div>
  );
}

// ---------- 進みの印（色だけに頼らず、形と言葉も変える） ----------

export const PACE_INFO: Record<Pace, { label: string; color: string; hint: string }> = {
  reached: { label: "到達", color: "#d4a017", hint: "目標に届いています" },
  ahead: { label: "順調", color: "#1a9a6b", hint: "期の経過に対して進みが追いついています" },
  behind: { label: "遅れ", color: "#e08a00", hint: "期の経過に対して進みが下回っています" },
};

const STAR = "M0 -7 L2 -2.2 L7 -2 L3.2 1.4 L4.4 6.4 L0 3.6 L-4.4 6.4 L-3.2 1.4 L-7 -2 L-2 -2.2 Z";

/** 進みの印（SVGの中に置く）。遅れ＝三角、順調＝丸にチェック、到達＝星 */
export function PaceGlyph({ pace, x = 0, y = 0 }: { pace: Pace; x?: number; y?: number }) {
  const c = PACE_INFO[pace].color;
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      {pace === "behind" && (
        <>
          <path d="M0 -7 L7 6 L-7 6 Z" fill={c} stroke={c} strokeWidth={2} strokeLinejoin="round" />
          <path d="M0 -2 L0 2" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
          <circle cx={0} cy={4} r={0.9} fill="#fff" />
        </>
      )}
      {pace === "ahead" && (
        <>
          <circle r={7} fill={c} />
          <path d="M-3.2 0.2 L-0.8 2.8 L3.4 -2.6" stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {pace === "reached" && <path d={STAR} fill={c} stroke={c} strokeWidth={1.4} strokeLinejoin="round" />}
    </g>
  );
}

export function PaceBadge({ pace }: { pace: Pace }) {
  const info = PACE_INFO[pace];
  return (
    <span className="mk-pace" title={info.hint}>
      <svg width={16} height={16} viewBox="-8 -8 16 16" aria-hidden="true">
        <PaceGlyph pace={pace} />
      </svg>
      {info.label}
    </span>
  );
}

// ---------- SVG の操作部品 ----------

interface SvgButtonProps {
  label: string;
  onActivate: () => void;
  expanded?: boolean;
  pressed?: boolean;
  className?: string;
  krId?: string;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
  children: ReactNode;
}

/** SVG の図形をボタンとして使う（Enter／スペースで押せる・フォーカスの輪が出る） */
export function SvgButton({ label, onActivate, expanded, pressed, className, krId, onPointerDown, children }: SvgButtonProps) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
      className={`mk-svgbtn${className ? ` ${className}` : ""}`}
      data-kr={krId}
      onClick={onActivate}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </g>
  );
}

/** 長い文字列を幅に合わせて切る（SVG には自動の折り返しが無いため） */
export function trunc(s: string, n: number): string {
  const a = Array.from(s);
  return a.length <= n ? s : `${a.slice(0, n - 1).join("")}…`;
}

/** 文字数で最大 lines 行に折り返す。収まらなければ最終行を省略する */
export function wrapLines(s: string, perLine: number, lines: number): string[] {
  const a = Array.from(s);
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(a.slice(i * perLine, (i + 1) * perLine).join(""));
  if (a.length > perLine * lines) out[lines - 1] = `${out[lines - 1].slice(0, -1)}…`;
  return out.filter((l) => l.length > 0);
}

/** 節目の小さな演出（半分・目標到達）。1回だけ短く動く。動きを減らす設定のときは CSS で出さない */
export function Burst({ x, y, color, kind }: { x: number; y: number; color: string; kind: "half" | "reached" }) {
  const dots = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const d = 26 + (i % 2) * 8;
    return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), c: i % 3 === 0 ? "#d4a017" : i % 3 === 1 ? color : "#c2338a", star: i % 4 === 0 };
  });
  return (
    <g transform={`translate(${x} ${y})`} className="mk-burst" aria-hidden="true">
      <circle r={8} fill="none" stroke={color} strokeWidth={3} className="mk-burst-ring" />
      {dots.map((d, i) => (
        <g key={i} className="mk-burst-dot" style={{ ["--dx" as string]: `${d.dx}px`, ["--dy" as string]: `${d.dy}px` }}>
          {d.star ? <path d={STAR} transform="scale(0.55)" fill={d.c} /> : <circle r={3} fill={d.c} />}
        </g>
      ))}
      <text className="mk-burst-label" x={0} y={-30} textAnchor="middle" fontSize={12} fontWeight={700} fill={color}>
        {kind === "half" ? "半分を越えた" : "目標に届いた"}
      </text>
    </g>
  );
}

/** ダイアログ（目標の取り込み・対照表）。Esc で閉じる。閉じたら開いたボタンへ戻る */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      className="mk-overlay print-hide"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div ref={ref} tabIndex={-1} className="mk-modal" style={wide ? { maxWidth: 980 } : { maxWidth: 820 }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mk-modal-head">
          <strong>{title}</strong>
          <button type="button" className="mk-btn mk-btn-sm" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="mk-modal-body">{children}</div>
      </div>
    </div>
  );
}

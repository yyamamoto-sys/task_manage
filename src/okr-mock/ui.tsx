import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { krStyle, members, okrItems } from "./fixtures";
import { trapTarget, type Pace } from "./logic";
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

/** 色の点。●＝KRにつながる（色でKRを区別。色が足りないときは模様を重ねる）、○＝つながりなし。labeled のときは「KR1」などの文字を添える */
export function KrDot({ krId, labeled }: { krId: string | null; labeled?: boolean }) {
  if (!krId) {
    return <span className="mk-kdot is-none" role="img" aria-label="KRにつながっていません" title="KRにつながっていません" />;
  }
  const label = `つながるKR：${krName(krId)}`;
  const st = krStyle(krId);
  const dot = <span className={`mk-kdot${st.pattern > 0 ? " has-pattern" : ""}`} role="img" aria-label={label} title={label} style={{ background: st.color }} />;
  if (!labeled) return dot;
  return (
    <span className="mk-kdot-labeled">
      {dot}
      <span>{krLabel(krId)}</span>
    </span>
  );
}

export function KrDots({ krIds, labeled }: { krIds: string[]; labeled?: boolean }) {
  if (krIds.length === 0) return <KrDot krId={null} />;
  return (
    <span className="mk-kdots">
      {krIds.map((k) => (
        <KrDot key={k} krId={k} labeled={labeled} />
      ))}
    </span>
  );
}

export function valueText(r: KrRecord, v: number | string): string {
  return r.kind === "number" ? `${v}${r.unit}` : String(v);
}

/** 「11/3」のような月日（曜日なし） */
export function mdOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** 成果（チェックイン資料の「現状」）の1行。出どころの資料の日付を添える */
export function outcomeLine(r: KrRecord): string {
  const src = `（${mdOf(r.updatedAt)} の資料）`;
  return r.kind === "number" ? `成果 ${r.value}／${r.target}${r.unit}${src}` : `成果 いま${r.value}／目標${r.target}${src}`;
}

export function signed(n: number, unit = ""): string {
  if (n === 0) return `±0${unit}`;
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit}`;
}

// ---------- 進みの印（色だけに頼らず、形と言葉も変える） ----------

/** 「遅れ」の橙は、白地の文字にも橙の上の文字にも対比 4.5:1 以上になる色（mock4.css の --mk-warn・--mk-on-warn と同じ値） */
export const PACE_INFO: Record<Pace, { label: string; color: string; onColor: string; hint: string }> = {
  reached: { label: "到達", color: "#d4a017", onColor: "#fff", hint: "目標に届いています" },
  ahead: { label: "順調", color: "#1a9a6b", onColor: "#fff", hint: "期の経過に対して進みが追いついています" },
  behind: { label: "遅れ", color: "var(--mk-warn)", onColor: "var(--mk-on-warn)", hint: "期の経過に対して進みが下回っています" },
};

const STAR = "M0 -7 L2 -2.2 L7 -2 L3.2 1.4 L4.4 6.4 L0 3.6 L-4.4 6.4 L-3.2 1.4 L-7 -2 L-2 -2.2 Z";

/** 進みの印（SVGの中に置く）。遅れ＝三角、順調＝丸にチェック、到達＝星 */
export function PaceGlyph({ pace, x = 0, y = 0 }: { pace: Pace; x?: number; y?: number }) {
  const c = PACE_INFO[pace].color;
  const on = PACE_INFO[pace].onColor;
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      {pace === "behind" && (
        <>
          <path d="M0 -7 L7 6 L-7 6 Z" style={{ fill: c, stroke: c }} strokeWidth={2} strokeLinejoin="round" />
          <path d="M0 -2 L0 2" style={{ stroke: on }} strokeWidth={1.6} strokeLinecap="round" />
          <circle cx={0} cy={4} r={0.9} style={{ fill: on }} />
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
  /** false のとき Tab の停止対象から外す（帯など。ノードだけが止まるようにする） */
  focusable?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
  children: ReactNode;
}

/** SVG の図形をボタンとして使う（Enter／スペースで押せる・フォーカスの輪が出る） */
export function SvgButton({ label, onActivate, expanded, pressed, className, krId, focusable = true, onPointerDown, children }: SvgButtonProps) {
  return (
    <g
      role="button"
      tabIndex={focusable ? 0 : -1}
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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** 引き出し・ダイアログの中で Tab を回す（外へ出さない）。active のときだけ働く */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.getClientRects().length > 0);
      if (list.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const cur = list.indexOf(document.activeElement as HTMLElement);
      const to = trapTarget(list.length, cur === -1 ? (e.shiftKey ? 0 : list.length - 1) : cur, e.shiftKey);
      if (to !== null) {
        e.preventDefault();
        list[to].focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [ref, active]);
}

/** 画面の幅が px 以下か（詳細パネルを右からの引き出しにする判定） */
export function useNarrow(px: number): boolean {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** ダイアログ（O・KRの取り込み・対照表）。Esc で閉じる。閉じたら開いたボタンへ戻る。Tab は中で回る */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useFocusTrap(ref, true);
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

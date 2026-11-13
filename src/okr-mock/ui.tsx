import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { krBands, krStyle, members, okrItems } from "./fixtures";
import { trapTarget } from "./logic";
import { stepsOf } from "./steps";
import type { Hint, KrBands, KrRecord, Seg, Task } from "./types";

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

/** 結節点の印（SVGの中）。輪が2つ重なった形。★（成果につながった仕事）とは別の形。色には頼らず、形で見分ける */
export function JunctionGlyph({ x = 0, y = 0, r = 3.6 }: { x?: number; y?: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true" className="mk-junction-glyph">
      <circle cx={-r * 0.6} cy={0} r={r} fill="none" strokeWidth={1.5} />
      <circle cx={r * 0.6} cy={0} r={r} fill="none" strokeWidth={1.5} />
    </g>
  );
}

/** 結節点の印（文の中に置く） */
export function JunctionMark() {
  return (
    <svg width={18} height={12} viewBox="-9 -6 18 12" className="mk-junction-mark" role="img" aria-label="結節点の印">
      <JunctionGlyph r={4} />
    </svg>
  );
}

/** 「KR1 と KR3」「KR1・KR2・KR3」 */
export function krListText(krIds: string[]): string {
  const ls = krIds.map(krLabel);
  return ls.length === 2 ? `${ls[0]} と ${ls[1]}` : ls.join("・");
}

/** 手がかりの数字の値（例：18社） */
export function hintText(h: Hint, v: number): string {
  return `${v}${h.unit}`;
}

/** 「11/3」のような月日（曜日なし） */
export function mdOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** 手がかりの数字の1行（例：手がかり 18社／30社）。数値のないKRは null */
export function hintLine(r: KrRecord): string | null {
  return r.hint ? `手がかり ${r.hint.value}${r.hint.unit}／${r.hint.target}${r.hint.unit}` : null;
}

export function signed(n: number, unit = ""): string {
  if (n === 0) return `±0${unit}`;
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit}`;
}

// ---------- 段の目盛り ----------

/** 段の目盛りの中の、今の位置（0〜steps.length-1 の小数）。段と段の間は値で比例させる */
export function stepPos(value: number, steps: number[]): number {
  if (value <= steps[0]) return 0;
  for (let i = 1; i < steps.length; i++) {
    if (value <= steps[i]) return i - 1 + (value - steps[i - 1]) / (steps[i] - steps[i - 1]);
  }
  return steps.length - 1;
}

export interface StepScaleGeo {
  x: number;
  /** 線（トラック）の y */
  y: number;
  w: number;
}

/** 段の目盛り（SVGの中）。60・70・80（あれば90・100）の上に、今の位置の印を置く。良し悪しの色は付けず、KRの色で登る */
export function StepScaleG({ krId, value, bands, geo, fontSize = 10 }: { krId: string; value: number; bands: KrBands; geo: StepScaleGeo; fontSize?: number }) {
  const steps = stepsOf(bands);
  const color = krStyle(krId).color;
  const px = (i: number) => geo.x + (steps.length === 1 ? 0 : (i * geo.w) / (steps.length - 1));
  const pos = stepPos(value, steps);
  const mx = px(0) + (steps.length === 1 ? 0 : (pos * geo.w) / (steps.length - 1));
  return (
    <g aria-hidden="true">
      <rect x={geo.x} y={geo.y - 3} width={geo.w} height={6} rx={3} className="mk-track" />
      <rect x={geo.x} y={geo.y - 3} width={Math.max(6, mx - geo.x)} height={6} rx={3} fill={color} opacity={0.75} />
      {steps.map((st, i) => (
        <g key={st}>
          <circle cx={px(i)} cy={geo.y} r={4} className={st <= value ? "mk-step-on" : "mk-step-off"} style={st <= value ? { fill: color } : undefined} strokeWidth={1.5} stroke={color} />
          <text x={px(i)} y={geo.y + 17} textAnchor="middle" fontSize={fontSize} className="mk-svgtext-muted">
            {st}
          </text>
        </g>
      ))}
      <path d={`M ${mx} ${geo.y - 5} l -5 -8 l 10 0 Z`} fill={color} stroke="var(--color-bg-primary)" strokeWidth={1} />
      <text x={Math.min(mx, geo.x + geo.w - 8)} y={geo.y - 17} textAnchor="middle" fontSize={fontSize + 2} fontWeight={700} className="mk-svgtext">
        {value}
      </text>
    </g>
  );
}

/** 段の目盛り（文の中に置く。幅いっぱい） */
export function StepScale({ krId, value, width = 260, label }: { krId: string; value: number; width?: number; label?: string }) {
  const bands = krBands[krId];
  const text = label ?? `${krLabel(krId)} の見立て ${value}（AIの見立て）。段は ${stepsOf(bands).join("・")}`;
  return (
    <svg viewBox={`0 0 ${width} 44`} width="100%" style={{ maxWidth: width }} className="mk-stepscale" role="img" aria-label={text}>
      <StepScaleG krId={krId} value={value} bands={bands} geo={{ x: 12, y: 22, w: width - 24 }} />
    </svg>
  );
}

const STAR = "M0 -7 L2 -2.2 L7 -2 L3.2 1.4 L4.4 6.4 L0 3.6 L-4.4 6.4 L-3.2 1.4 L-7 -2 L-2 -2.2 Z";

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

/** 節目の小さな演出（段を越えた）。1回だけ短く動く。動きを減らす設定のときは CSS で出さない */
export function Burst({ x, y, color, step }: { x: number; y: number; color: string; step: number }) {
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
        {step} の段に届いた
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

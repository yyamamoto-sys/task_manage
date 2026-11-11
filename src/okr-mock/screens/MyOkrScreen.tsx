import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KR_COLORS, OWNER_ID, PERIOD_NAME, PERIOD_START, personalOkrs, tasks } from "../fixtures";
import { buildSummaryText, buildup, formatMd, TODAY } from "../logic";
import { useMock } from "../state";
import { krLabel, krName, nameOf, PrivateGuard } from "../ui";

type Pt = { x: number; y: number };
const DRAG_MIN = 4;

function Links() {
  const { items, personalLinks, togglePersonalLink } = useMock();
  const krs = items.filter((i) => i.kind === "kr");
  const mine = personalOkrs.filter((p) => p.ownerId === OWNER_ID);
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Record<string, HTMLElement | null>>({});
  const [pos, setPos] = useState<Record<string, Pt>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ pid: string; x: number; y: number } | null>(null);
  const startRef = useRef<Pt | null>(null);
  const movedRef = useRef(false);
  const pidRef = useRef<string | null>(null);
  const suppressClick = useRef(false);

  const measure = useCallback(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const next: Record<string, Pt> = {};
    for (const [key, el] of Object.entries(nodes.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[key] = { x: (key.startsWith("p:") ? r.right : r.left) - b.left, y: r.top + r.height / 2 - b.top };
    }
    setPos(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const b = box.current?.getBoundingClientRect();
      const s = startRef.current;
      if (!b || !s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_MIN) movedRef.current = true;
      setDrag((d) => (d ? { ...d, x: e.clientX - b.left, y: e.clientY - b.top } : d));
    };
    const onUp = (e: PointerEvent) => {
      if (movedRef.current) {
        suppressClick.current = true;
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-kr]");
        const krId = hit?.getAttribute("data-kr");
        const pid = pidRef.current;
        if (pid && krId && !personalLinks.some((l) => l.personalId === pid && l.krId === krId)) togglePersonalLink(pid, krId);
      }
      setDrag(null);
      startRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, personalLinks, togglePersonalLink]);

  const curve = (a: Pt, b: Pt) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  return (
    <div className="mk-linkbox" ref={box}>
      <svg className="mk-linksvg" aria-label="個人OKRとKRをつなぐ線">
        {personalLinks.map((l) => {
          const a = pos[`p:${l.personalId}`];
          const b = pos[`k:${l.krId}`];
          if (!a || !b) return null;
          const name = `${personalOkrs.find((p) => p.id === l.personalId)?.text}と${krLabel(l.krId)}のつながりを解除`;
          return (
            <g key={`${l.personalId}-${l.krId}`}>
              <path d={curve(a, b)} stroke={KR_COLORS[l.krId]} strokeWidth={3} fill="none" />
              <path
                d={curve(a, b)}
                className="mk-linkhit"
                stroke="transparent"
                strokeWidth={16}
                fill="none"
                role="button"
                tabIndex={0}
                aria-label={name}
                onClick={() => togglePersonalLink(l.personalId, l.krId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    togglePersonalLink(l.personalId, l.krId);
                  }
                }}
              >
                <title>{name}</title>
              </path>
            </g>
          );
        })}
        {drag && pos[`p:${drag.pid}`] && <path d={curve(pos[`p:${drag.pid}`], { x: drag.x, y: drag.y })} stroke="#888" strokeWidth={2} strokeDasharray="5 4" fill="none" />}
      </svg>
      <div className="mk-linkcols">
        <div className="mk-linkcol">
          <div className="mk-small mk-muted">個人OKR</div>
          {mine.map((p) => (
            <button
              key={p.id}
              type="button"
              ref={(el) => {
                nodes.current[`p:${p.id}`] = el;
              }}
              className={`mk-node${selected === p.id ? " is-selected" : ""}`}
              aria-pressed={selected === p.id}
              onPointerDown={(e) => {
                startRef.current = { x: e.clientX, y: e.clientY };
                pidRef.current = p.id;
                movedRef.current = false;
                const b = box.current?.getBoundingClientRect();
                if (b) setDrag({ pid: p.id, x: e.clientX - b.left, y: e.clientY - b.top });
              }}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                setSelected((s) => (s === p.id ? null : p.id));
              }}
            >
              {p.text}
            </button>
          ))}
        </div>
        <div className="mk-linkcol">
          <div className="mk-small mk-muted">グループOKR（KR）</div>
          {krs.map((k) => (
            <button
              key={k.id}
              type="button"
              data-kr={k.id}
              ref={(el) => {
                nodes.current[`k:${k.id}`] = el;
              }}
              className="mk-node"
              style={{ borderLeft: `6px solid ${KR_COLORS[k.id]}` }}
              onClick={() => {
                if (!selected) return;
                togglePersonalLink(selected, k.id);
                setSelected(null);
              }}
            >
              {k.label} {k.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Buildup() {
  const { items, linkCtx } = useMock();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const b = buildup(tasks, OWNER_ID, krs, PERIOD_START, TODAY, linkCtx);
  const colW = 34;
  const H = 170;
  const top = 18;
  const bottom = 28;
  const W = b.weeks.length * colW + 20;
  const maxStack = Math.max(1, ...b.weeks.map((_, i) => krs.reduce((s, k) => s + b.cumulative[k][i], 0)));
  const unit = (H - top - bottom) / maxStack;
  return (
    <div>
      <div className="mk-row mk-small">
        {krs.map((k) => (
          <span key={k} className="mk-chip" style={{ borderLeft: `8px solid ${KR_COLORS[k]}` }}>
            {krName(k)}
          </span>
        ))}
      </div>
      <div className="mk-table-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="週ごとの、KRにつながる仕事の累計完了件数">
          {b.weeks.map((w, i) => {
            let y = H - bottom;
            return (
              <g key={w}>
                {krs.map((k) => {
                  const n = b.cumulative[k][i];
                  const h = n * unit;
                  y -= h;
                  return h > 0 ? <rect key={k} x={10 + i * colW + 4} y={y} width={colW - 8} height={h} fill={KR_COLORS[k]}><title>{`${formatMd(w)}の週 ${krLabel(k)}：累計${n}件`}</title></rect> : null;
                })}
                <text x={10 + i * colW + colW / 2} y={y - 4} fontSize={10} textAnchor="middle" fill="currentColor">
                  {b.total[i]}
                </text>
                {i % 3 === 0 && (
                  <text x={10 + i * colW + colW / 2} y={H - 10} fontSize={10} textAnchor="middle" fill="currentColor">
                    {w.slice(5).replace("-", "/")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mk-muted">
        週の始まり（月曜）ごとの累計です。棒の上の数字は合計で、複数のKRにつながる仕事は、それぞれのKRに積んだうえで合計では1回に数えます。
      </p>
    </div>
  );
}

function Summary() {
  const { items, linkCtx, how, showToast } = useMock();
  const [text, setText] = useState<string | null>(null);
  const make = () =>
    setText(
      buildSummaryText({
        period: PERIOD_NAME,
        owner: nameOf(OWNER_ID),
        krs: items.filter((i) => i.kind === "kr"),
        tasks,
        memberId: OWNER_ID,
        start: PERIOD_START,
        today: TODAY,
        ctx: linkCtx,
        how,
      }),
    );
  return (
    <div>
      <button type="button" className="mk-btn mk-btn-primary" onClick={make}>
        期のまとめを出す
      </button>
      {text && (
        <div style={{ marginTop: 10 }}>
          <pre className="mk-pre">{text}</pre>
          <button
            type="button"
            className="mk-btn mk-btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(
                () => showToast("まとめをコピーしました"),
                () => showToast("コピーできませんでした。文面を選んでコピーしてください"),
              );
            }}
          >
            コピーする
          </button>
          <span className="mk-muted"> 送信する機能はありません。コピーして、必要な相手に自分で渡します。</span>
        </div>
      )}
    </div>
  );
}

export function MyOkrScreen() {
  return (
    <div>
      <h1 className="mk-h1">自分のOKR</h1>
      <p className="mk-lead">本人だけに見える画面です。GMにも見せません。</p>
      <PrivateGuard>
        <h2 className="mk-h2">個人OKRとKRをつなぐ</h2>
        <p className="mk-muted">
          左の個人OKRから右のKRへ、矢印をドラッグしてつなぎます。ドラッグしにくいときは、左を押してから右を押してもつなげます。線を押すと解除します。
        </p>
        <div className="mk-card">
          <Links />
        </div>
        <h2 className="mk-h2">効きの積み上がり</h2>
        <div className="mk-card">
          <Buildup />
        </div>
        <h2 className="mk-h2">期のまとめ</h2>
        <div className="mk-card">
          <Summary />
        </div>
      </PrivateGuard>
    </div>
  );
}

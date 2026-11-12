import { useEffect, useMemo, useRef, useState } from "react";
import { flowCounts, layoutFlow, ribbonPath, type Ribbon, type SegKind } from "../flow";
import { KR_COLORS, MINE_COLOR, okrItems, OWNER_ID, PERIOD_END, PERIOD_START, personalOkrs, pjsInit, tasks } from "../fixtures";
import { BANDS, krPace, krProgress, overallProgress, periodElapsed, TODAY } from "../logic";
import { useMock } from "../state";
import { Burst, krLabel, krText, memberOf, PACE_INFO, PaceGlyph, PrivateGuard, SvgButton, surnameOf, trunc, wrapLines } from "../ui";

const TOP = 28;
const KR_IDS_ALL = ["kr1", "kr2", "kr3"];

function segFill(kind: SegKind, krId: string): { fill: string; opacity: number; overlay: string | null } {
  const c = KR_COLORS[krId];
  switch (kind) {
    case "doneOther":
      return { fill: c, opacity: 0.85, overlay: null };
    case "doneMine":
      return { fill: MINE_COLOR, opacity: 0.95, overlay: "url(#mk-dots)" };
    case "openOther":
      return { fill: c, opacity: 0.22, overlay: `url(#mk-hatch-${krId})` };
    case "openMine":
      return { fill: MINE_COLOR, opacity: 0.3, overlay: "url(#mk-hatch-mine)" };
  }
}


function RibbonShape({ r, krId, onActivate }: { r: Ribbon; krId: string; onActivate: () => void }) {
  const label = `${r.id.includes(">obj") ? `${krLabel(krId)}から目標へ` : `${pjsInit.find((p) => p.id === r.fromId)?.name}から${krLabel(krId)}へ`}：終えた仕事${r.done}件、未完了${r.open}件。押すと${krLabel(krId)}の詳細を開きます`;
  return (
    <SvgButton label={label} onActivate={onActivate} className="mk-ribbon">
      <title>{label}</title>
      {r.segments.map((s) => {
        const f = segFill(s.kind, krId);
        const d = ribbonPath(r, s.offset, s.thickness);
        return (
          <g key={s.kind}>
            <path d={d} fill={f.fill} opacity={f.opacity} />
            {f.overlay && <path d={d} fill={f.overlay} />}
          </g>
        );
      })}
      <path d={ribbonPath(r, 0, r.width)} fill="none" className="mk-ribbon-ring" />
    </SvgButton>
  );
}

export function FlowDiagram() {
  const { mode, isOwner, viewerId, records, linkCtx, sel, setSel, personalLinks, togglePersonalLink, celebrations, proposals } = useMock();
  const scope = mode === "self" ? "self" : "team";
  const [expanded, setExpanded] = useState<string[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ pid: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClick = useRef(false);

  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const myPersonal = useMemo(() => personalOkrs.filter((p) => p.ownerId === OWNER_ID), []);

  const counts = useMemo(() => flowCounts({ tasks, pjs: pjsInit, ctx: linkCtx, ownerId: viewerId, scope }), [linkCtx, viewerId, scope]);
  const layout = useMemo(
    () => layoutFlow({ counts, krIds: KR_IDS_ALL, personalIds: scope === "self" ? myPersonal.map((p) => p.id) : [], expanded }),
    [counts, scope, myPersonal, expanded],
  );

  const dragging = drag !== null;
  const dragPid = drag?.pid;
  useEffect(() => {
    if (!dragging) return;
    const toSvg = (cx: number, cy: number) => {
      const svg = svgRef.current;
      const m = svg?.getScreenCTM();
      if (!svg || !m) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const q = pt.matrixTransform(m.inverse());
      return { x: q.x, y: q.y - TOP };
    };
    const onMove = (e: PointerEvent) => {
      const s = startRef.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 4) movedRef.current = true;
      const p = toSvg(e.clientX, e.clientY);
      setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : d));
    };
    const onUp = (e: PointerEvent) => {
      if (movedRef.current) {
        suppressClick.current = true;
        const krId = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-kr]")?.getAttribute("data-kr");
        if (dragPid && krId && !personalLinks.some((l) => l.personalId === dragPid && l.krId === krId)) togglePersonalLink(dragPid, krId);
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
  }, [dragging, dragPid, personalLinks, togglePersonalLink]);

  if (scope === "self" && !isOwner) {
    return (
      <section className="mk-card" aria-label="自分の流れの図">
        <PrivateGuard>{null}</PrivateGuard>
      </section>
    );
  }

  const objText = okrItems.find((i) => i.kind === "objective")?.text ?? "";
  const overall = overallProgress(records, KR_IDS_ALL);
  const H = layout.height + TOP;
  const taskOf = (id: string) => tasks.find((t) => t.id === id)!;
  const pjName = (id: string) => pjsInit.find((p) => p.id === id)?.name ?? "";
  const krCenterY = (krId: string) => {
    const n = layout.krNodes.find((k) => k.krId === krId)!;
    return n;
  };

  const curve = (ax: number, ay: number, bx: number, by: number) => {
    const dx = Math.max(40, Math.abs(bx - ax) / 2);
    return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
  };

  const personalPort = (pid: string) => layout.personal.find((p) => p.id === pid)!;

  return (
    <section className="mk-card mk-flow" aria-labelledby="mk-flow-h">
      <div className="mk-row">
        <h2 id="mk-flow-h" className="mk-h2 mk-h2-big" style={{ margin: 0 }}>
          <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r={10} fill="#1a9a6b" opacity={0.18} />
            <path d="M-7 -4 C0 -4 0 4 7 4 M-7 3 C-1 3 1 -3 7 -3" stroke="#1a9a6b" strokeWidth={2} fill="none" strokeLinecap="round" />
          </svg>
          {scope === "self" ? "あなたの仕事の流れ" : "仕事がどこへ流れているか"}
        </h2>
        <span className="mk-spacer" />
        <div className="mk-legend" aria-label="凡例">
          <span><i className="mk-lg mk-lg-done" />終えた仕事（帯の太さ）</span>
          <span><i className="mk-lg mk-lg-open" />未完了（薄い部分）</span>
          <span><i className="mk-lg mk-lg-mine" />あなたの分</span>
          <span><i className="mk-lg mk-lg-loose" />つながらない仕事</span>
        </div>
      </div>
      <p className="mk-muted">
        左のPJ（押すとタスクが開きます）から、中央のKR、右の目標へ。KRを押すと詳細、仕事を押すとつなぎ先を確かめられます。
        {scope === "self" && " 個人OKRからKRへ矢印をドラッグ（または、左を押してから右を押す）でつなぎます。"}
      </p>

      <div className="mk-flowscroll">
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${H}`} className="mk-flowsvg" role="group" aria-label="仕事から目標への流れの図">
          <defs>
            {KR_IDS_ALL.map((k) => (
              <pattern key={k} id={`mk-hatch-${k}`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={7} stroke={KR_COLORS[k]} strokeWidth={2.2} opacity={0.7} />
              </pattern>
            ))}
            <pattern id="mk-hatch-mine" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={7} stroke={MINE_COLOR} strokeWidth={2.2} opacity={0.75} />
            </pattern>
            <pattern id="mk-dots" width={8} height={8} patternUnits="userSpaceOnUse">
              <circle cx={4} cy={4} r={1.5} fill="#fff" opacity={0.85} />
            </pattern>
          </defs>

          <g className="mk-colhead">
            {scope === "self" && (
              <text x={layout.cols.personal.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
                個人OKR（あなただけ）
              </text>
            )}
            <text x={layout.cols.pj.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              仕事（PJごと）
            </text>
            <text x={layout.cols.kr.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              KR（進みのバー）
            </text>
            <text x={layout.cols.o.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              目標
            </text>
          </g>

          <g transform={`translate(0 ${TOP})`}>
            {/* 個人OKR→KRの矢印（PJのノードの後ろを通る） */}
            {scope === "self" &&
              personalLinks.map((l, i) => {
                const p = personalPort(l.personalId);
                const kn = krCenterY(l.krId);
                if (!p) return null;
                const idx = personalLinks.filter((x, j) => x.krId === l.krId && j < i).length;
                const bx = kn.x - 4;
                const by = kn.y + 16 + idx * 11;
                const name = `${myPersonal.find((x) => x.id === l.personalId)?.text}と${krLabel(l.krId)}のつながり。押すと解除します`;
                return (
                  <g key={`${l.personalId}-${l.krId}`}>
                    <path d={curve(p.x + p.w, p.y + p.h / 2, bx, by)} stroke={KR_COLORS[l.krId]} strokeWidth={3} fill="none" strokeLinecap="round" />
                    <path d={`M ${bx} ${by} l -9 -5 l 0 10 Z`} fill={KR_COLORS[l.krId]} />
                    <SvgButton label={name} onActivate={() => togglePersonalLink(l.personalId, l.krId)} className="mk-linkhit">
                      <title>{name}</title>
                      <path d={curve(p.x + p.w, p.y + p.h / 2, bx, by)} stroke="transparent" strokeWidth={14} fill="none" />
                    </SvgButton>
                  </g>
                );
              })}
            {drag && (
              <path d={curve(personalPort(drag.pid).x + personalPort(drag.pid).w, personalPort(drag.pid).y + personalPort(drag.pid).h / 2, drag.x, drag.y)} stroke="#888" strokeWidth={2} strokeDasharray="5 4" fill="none" />
            )}

            {layout.pjKr.map((r) => (
              <RibbonShape key={r.id} r={r} krId={r.toId} onActivate={() => setSel({ type: "kr", id: r.toId })} />
            ))}
            {layout.krO.map((r) => (
              <RibbonShape key={r.id} r={r} krId={r.fromId} onActivate={() => setSel({ type: "kr", id: r.fromId })} />
            ))}

            {/* 個人OKR */}
            {layout.personal.map((p) => {
              const po = myPersonal.find((x) => x.id === p.id)!;
              const lines = wrapLines(po.text, 9, 2);
              const isArmed = armed === p.id;
              const linked = personalLinks.filter((l) => l.personalId === p.id).map((l) => krLabel(l.krId));
              return (
                <SvgButton
                  key={p.id}
                  label={`個人OKR「${po.text}」。${isArmed ? "選択中。つなぎたいKRを押してください" : "押してから、つなぎたいKRを押すとつながります。ドラッグでもつなげます"}。いまのつなぎ先：${linked.length ? linked.join("、") : "なし"}`}
                  pressed={isArmed}
                  onActivate={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    setArmed((a) => (a === p.id ? null : p.id));
                  }}
                  onPointerDown={(e) => {
                    startRef.current = { x: e.clientX, y: e.clientY };
                    movedRef.current = false;
                    setDrag({ pid: p.id, x: p.x + p.w, y: p.y + p.h / 2 });
                  }}
                  className="mk-pnode"
                >
                  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={14} className={`mk-fnode${isArmed ? " is-armed" : ""}`} stroke={MINE_COLOR} strokeWidth={isArmed ? 3 : 2} />
                  <circle cx={p.x + 14} cy={p.y + 14} r={5} fill={MINE_COLOR} />
                  {lines.map((l, i) => (
                    <text key={i} x={p.x + 26} y={p.y + 18 + i * 14} fontSize={11} className="mk-svgtext">
                      {l}
                    </text>
                  ))}
                  <circle cx={p.x + p.w} cy={p.y + p.h / 2} r={5} fill={MINE_COLOR} />
                </SvgButton>
              );
            })}

            {/* PJ */}
            {layout.pjNodes.map((n) => {
              const name = pjName(n.pjId);
              const label = `PJ「${name}」：終えた仕事${n.done}件、未完了${n.open}件。押すとタスクを${n.expanded ? "閉じます" : "開きます"}`;
              return (
                <g key={n.pjId}>
                  <SvgButton label={label} onActivate={() => setExpanded((e) => (e.includes(n.pjId) ? e.filter((x) => x !== n.pjId) : [...e, n.pjId]))} expanded={n.expanded}>
                    <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} className="mk-fnode" />
                    <path d={`M ${n.x + 12} ${n.y + 11} h 7 l 2 2.5 h 9 v 11 h -18 Z`} fill="#7c8db5" opacity={0.85} />
                    <text x={n.x + 36} y={n.y + 22} fontSize={12} fontWeight={700} className="mk-svgtext">
                      {trunc(name, 13)}
                    </text>
                    <text x={n.x + 36} y={n.y + 36} fontSize={10.5} className="mk-svgtext-muted">
                      完了 {n.done} ／ 残り {n.open}
                    </text>
                    <path d={n.expanded ? `M ${n.x + n.w - 22} ${n.y + 18} l 6 6 l 6 -6` : `M ${n.x + n.w - 20} ${n.y + 14} l 6 6 l -6 6`} stroke="currentColor" strokeWidth={2} fill="none" className="mk-svgtext-muted" strokeLinecap="round" strokeLinejoin="round" />
                  </SvgButton>
                  {n.rows.map((row) => {
                    const t = taskOf(row.taskId);
                    const m = memberOf(t.assigneeId);
                    const isSel = sel?.type === "task" && sel.id === t.id;
                    return (
                      <SvgButton key={t.id} label={`仕事「${t.title}」担当${m?.name}、${t.status}。押すと詳細を開きます`} onActivate={() => setSel({ type: "task", id: t.id })}>
                        <rect x={n.x + 10} y={row.y} width={n.w - 10} height={20} rx={8} className={`mk-trow${isSel ? " is-sel" : ""}`} />
                        {t.status === "完了" ? (
                          <circle cx={n.x + 22} cy={row.y + 10} r={5} fill="#1a9a6b" />
                        ) : t.status === "進行中" ? (
                          <>
                            <circle cx={n.x + 22} cy={row.y + 10} r={5} fill="none" stroke="#3b6fd4" strokeWidth={1.6} />
                            <path d={`M ${n.x + 22} ${row.y + 5} A 5 5 0 0 1 ${n.x + 22} ${row.y + 15} Z`} fill="#3b6fd4" />
                          </>
                        ) : (
                          <circle cx={n.x + 22} cy={row.y + 10} r={5} fill="none" stroke="#8a93a6" strokeWidth={1.6} />
                        )}
                        <text x={n.x + 34} y={row.y + 14} fontSize={10.5} className="mk-svgtext">
                          {trunc(t.title, 12)}
                        </text>
                        <circle cx={n.x + n.w - 40} cy={row.y + 10} r={4} fill={m?.color} />
                        <text x={n.x + n.w - 33} y={row.y + 14} fontSize={9.5} className="mk-svgtext-muted">
                          {surnameOf(t.assigneeId)}
                        </text>
                      </SvgButton>
                    );
                  })}
                </g>
              );
            })}

            {/* KR */}
            {layout.krNodes.map((n) => {
              const r = records[n.krId];
              const p = krProgress(r);
              const pace = krPace(r, elapsed);
              const color = KR_COLORS[n.krId];
              const lines = wrapLines(krText(n.krId), 16, 2);
              const isSel = sel?.type === "kr" && sel.id === n.krId;
              const cel = celebrations.find((c) => c.krId === n.krId);
              const bx = n.x + 14;
              const bw = n.w - 28;
              const by = n.y + 86;
              const valueLine = r.kind === "number" ? `${r.value}${r.unit} ／ 目標 ${r.target}${r.unit}` : `いま ${r.value} ／ 目標 ${r.target}`;
              const label = `${krLabel(n.krId)} ${krText(n.krId)}：${valueLine}、進み${Math.round(p * 100)}パーセント、${PACE_INFO[pace].label}。押すと詳細を開きます`;
              return (
                <SvgButton
                  key={n.krId}
                  krId={n.krId}
                  label={label}
                  onActivate={() => {
                    if (armed) {
                      togglePersonalLink(armed, n.krId);
                      setArmed(null);
                      return;
                    }
                    setSel({ type: "kr", id: n.krId });
                  }}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={16} className={`mk-fnode${isSel ? " is-sel" : ""}`} stroke={color} strokeWidth={isSel ? 4 : 2.5} />
                  <rect x={n.x} y={n.y} width={8} height={n.h} rx={4} fill={color} />
                  <text x={n.x + 20} y={n.y + 22} fontSize={13} fontWeight={700} fill={color}>
                    {krLabel(n.krId)}
                  </text>
                  <PaceGlyph pace={pace} x={n.x + n.w - 62} y={n.y + 18} />
                  <text x={n.x + n.w - 50} y={n.y + 22} fontSize={11} fontWeight={700} className="mk-svgtext">
                    {PACE_INFO[pace].label}
                  </text>
                  {lines.map((l, i) => (
                    <text key={i} x={n.x + 20} y={n.y + 42 + i * 15} fontSize={12} className="mk-svgtext">
                      {l}
                    </text>
                  ))}
                  <text x={n.x + 20} y={n.y + 80} fontSize={11} className="mk-svgtext-muted">
                    {valueLine}{" "}{Math.round(p * 100)}%
                  </text>
                  {r.kind === "number" ? (
                    <>
                      <rect x={bx + 6} y={by} width={bw - 6} height={13} rx={6.5} className="mk-track" />
                      <rect x={bx + 6} y={by} width={Math.max(13, p * (bw - 6))} height={13} rx={6.5} fill={color} />
                    </>
                  ) : (
                    BANDS.slice()
                      .reverse()
                      .map((b, i, arr) => {
                        const w = (bw - 6 - (arr.length - 1) * 3) / arr.length;
                        const on = BANDS.indexOf(b) >= BANDS.indexOf(r.value);
                        return (
                          <g key={b}>
                            <rect x={bx + 6 + i * (w + 3)} y={by - 1} width={w} height={15} rx={5} className={on ? "" : "mk-track"} fill={on ? color : undefined} stroke={b === r.target ? "currentColor" : "none"} strokeWidth={2} strokeDasharray={b === r.target ? "3 2" : undefined} />
                            <text x={bx + 6 + i * (w + 3) + w / 2} y={by + 10.5} fontSize={9.5} fontWeight={700} textAnchor="middle" fill={on ? "#fff" : "currentColor"} className={on ? "" : "mk-svgtext-muted"}>
                              {b}
                            </text>
                          </g>
                        );
                      })
                  )}
                  <line x1={bx + 6 + elapsed * (bw - 6)} x2={bx + 6 + elapsed * (bw - 6)} y1={by - 6} y2={by + 19} className="mk-elapsed-tick" />
                  {cel && <Burst key={cel.id} x={n.x + n.w - 24} y={n.y + 14} color={color} kind={cel.kind} />}
                </SvgButton>
              );
            })}

            {/* 目標 */}
            {(() => {
              const o = layout.o;
              const cx = o.x + o.w / 2;
              const cy = o.y + 56;
              const R = 28;
              const C = 2 * Math.PI * R;
              const lines = wrapLines(objText, 8, 3);
              return (
                <g role="img" aria-label={`目標「${objText}」：全体の進み${Math.round(overall * 100)}パーセント、終えた仕事${o.done}件、未完了${o.open}件（重複は1回に数えています）`}>
                  <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={20} className="mk-fnode" stroke="#4a5a8a" strokeWidth={2.5} />
                  <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={10} className="mk-track-ring" />
                  <circle cx={cx} cy={cy} r={R} fill="none" stroke="#4a5a8a" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${overall * C} ${C}`} transform={`rotate(-90 ${cx} ${cy})`} />
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} className="mk-svgtext">
                    {Math.round(overall * 100)}%
                  </text>
                  {lines.map((l, i) => (
                    <text key={i} x={cx} y={o.y + 104 + i * 14} textAnchor="middle" fontSize={11} className="mk-svgtext">
                      {l}
                    </text>
                  ))}
                  <text x={cx} y={o.y + 154} textAnchor="middle" fontSize={10} className="mk-svgtext-muted">
                    完了 {o.done} ／ 残り {o.open}
                  </text>
                </g>
              );
            })()}

            {/* つながらない仕事 */}
            {layout.loose.length > 0 && (
              <g>
                <text x={0} y={layout.looseTop + 12} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
                  どのKRにもつながらない仕事（点線）。押すとAIの提案が出ます
                </text>
                {layout.loose.map((n) => {
                  const t = taskOf(n.taskId);
                  const skipped = proposals[t.id] === "skipped";
                  const isSel = sel?.type === "task" && sel.id === t.id;
                  return (
                    <SvgButton key={t.id} label={`つながらない仕事「${t.title}」（${pjName(t.pjId)}、担当${memberOf(t.assigneeId)?.name}）${skipped ? "。提案は見送り済み" : ""}。押すと詳細を開きます`} onActivate={() => setSel({ type: "task", id: t.id })}>
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} className={`mk-loose${isSel ? " is-sel" : ""}`} />
                      <circle cx={n.x + 14} cy={n.y + n.h / 2} r={5} fill="none" stroke="#8a93a6" strokeWidth={1.6} strokeDasharray="2 2" />
                      <text x={n.x + 28} y={n.y + 15} fontSize={11} className="mk-svgtext">
                        {trunc(t.title, 14)}
                      </text>
                      <text x={n.x + n.w - 10} y={n.y + 15} fontSize={10} textAnchor="end" className="mk-svgtext-muted">
                        {skipped ? "見送り済み・" : ""}
                        {surnameOf(t.assigneeId)}
                      </text>
                    </SvgButton>
                  );
                })}
              </g>
            )}
          </g>
        </svg>
      </div>
    </section>
  );
}

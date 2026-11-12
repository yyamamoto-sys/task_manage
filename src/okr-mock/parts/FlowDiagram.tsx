import { useEffect, useMemo, useRef, useState } from "react";
import { flowCounts, junctionIdsOf, layoutFlow, OTHER_PJ, ribbonPath, type Ribbon } from "../flow";
import { proposalKey } from "../userState";
import { aiCandidates, krStyle, PERIOD_END, PERIOD_START, personalOkrs, PERSONAL_NAME, MINE_COLOR, pjsInit, tasks } from "../fixtures";
import { BANDS, krIdsOfTask, krPace, krProgress, overallProgress, periodElapsed, PERSONAL_PJ, stepsToTarget, TODAY } from "../logic";
import { useMock } from "../state";
import { Burst, JunctionGlyph, JunctionMark, krLabel, krListText, krText, memberOf, outcomeLine, PACE_INFO, PaceGlyph, SvgButton, surnameOf, trunc, wrapLines } from "../ui";

const TOP = 28;

function pjName(id: string): string {
  if (id === PERSONAL_PJ) return PERSONAL_NAME;
  return pjsInit.find((p) => p.id === id)?.name ?? id;
}

function RibbonShape({ r, krId, label, onActivate, dim }: { r: Ribbon; krId: string; label: string; onActivate: () => void; dim?: boolean }) {
  const st = krStyle(krId);
  return (
    <SvgButton label={label} onActivate={onActivate} className={`mk-ribbon${dim ? " is-dim" : ""}`} focusable={false}>
      <title>{label}</title>
      {r.segments.map((s) => {
        const d = ribbonPath(r, s.offset, s.thickness);
        return (
          <g key={s.kind}>
            <path d={d} fill={st.color} opacity={s.kind === "done" ? 0.85 : 0.22} />
            {s.kind === "open" && <path d={d} fill={`url(#mk-hatch-${krId})`} />}
            {st.pattern > 0 && <path d={d} fill="url(#mk-kr-pat)" opacity={0.5} />}
          </g>
        );
      })}
      <path d={ribbonPath(r, 0, r.width)} fill="none" className="mk-ribbon-ring" />
    </SvgButton>
  );
}

export function FlowDiagram() {
  const { mode, viewerId, items, records, linkCtx, sel, setSel, personalLinks, togglePersonalLink, celebrations, changes, proposals, confirmedLinks, junctionOnly, setJunctionOnly } = useMock();
  const scope = mode === "self" ? "self" : "team";
  const [expanded, setExpanded] = useState<string[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ pid: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClick = useRef(false);

  const krIds = useMemo(() => items.filter((i) => i.kind === "kr").map((k) => k.id), [items]);
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const myPersonal = useMemo(() => personalOkrs.filter((p) => p.ownerId === viewerId), [viewerId]);

  const counts = useMemo(() => flowCounts({ tasks, ctx: linkCtx, ownerId: viewerId, scope, periodStart: PERIOD_START }), [linkCtx, viewerId, scope]);
  const layout = useMemo(
    () => layoutFlow({ counts, krIds, personalIds: scope === "self" ? myPersonal.map((p) => p.id) : [], expanded, showLoose: scope === "self" }),
    [counts, krIds, scope, myPersonal, expanded],
  );

  // 「押してから押す」の選択中は Esc で取り消せる
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

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

  const objText = items.find((i) => i.kind === "objective")?.text ?? "";
  const overall = overallProgress(records, krIds);
  const H = layout.height + TOP;
  const taskOf = (id: string) => tasks.find((t) => t.id === id)!;
  const krNode = (krId: string) => layout.krNodes.find((k) => k.krId === krId)!;

  const curve = (ax: number, ay: number, bx: number, by: number) => {
    const dx = Math.max(40, Math.abs(bx - ax) / 2);
    return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
  };

  const personalPort = (pid: string) => layout.personal.find((p) => p.id === pid)!;

  // 結節点＝2つ以上のKRにつながる仕事。強調は、結節点が1件以上あるときだけ効く
  const junctionIds = useMemo(() => junctionIdsOf(counts, linkCtx), [counts, linkCtx]);
  const jOn = junctionOnly && junctionIds.size > 0;
  const edgeHasJunction = (krId: string, pjIds: string[] | null) => counts.edges.some((e) => e.krId === krId && (pjIds === null || pjIds.includes(e.pjId)) && e.taskIds.some((id) => junctionIds.has(id)));
  const pjMembers = (pjId: string) => (pjId === OTHER_PJ ? (layout.pjNodes.find((n) => n.pjId === OTHER_PJ)?.members.map((m) => m.pjId) ?? []) : [pjId]);
  const junctionInPj = (pjId: string) => pjMembers(pjId).reduce((s, id) => s + (counts.linkedByPj[id] ?? []).filter((t) => junctionIds.has(t.id)).length, 0);
  const dimIf = (cond: boolean) => (jOn && cond ? " is-dim" : "");

  // 成果につながったと確かめられた仕事（全員に見える）。PJ→KRの帯と、PJの中の仕事に★を付ける
  const starredTasks = new Set(confirmedLinks.map((c) => c.task.id));
  const starsOnRibbon = (r: Ribbon): number => {
    const pjIds = r.fromId === OTHER_PJ ? (layout.pjNodes.find((n) => n.pjId === OTHER_PJ)?.members.map((m) => m.pjId) ?? []) : [r.fromId];
    return new Set(confirmedLinks.filter((c) => c.note.krId === r.toId && pjIds.includes(c.task.pjId)).map((c) => c.task.id)).size;
  };

  return (
    <section className="mk-card mk-flow" aria-labelledby="mk-flow-h">
      <div className="mk-row">
        <h2 id="mk-flow-h" className="mk-h2 mk-h2-big" style={{ margin: 0 }}>
          <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r={10} fill="#1a9a6b" opacity={0.18} />
            <path d="M-7 -4 C0 -4 0 4 7 4 M-7 3 C-1 3 1 -3 7 -3" stroke="#1a9a6b" strokeWidth={2} fill="none" strokeLinecap="round" />
          </svg>
          {scope === "self" ? "あなたの仕事の地図" : "仕事がどこへ流れているか"}
        </h2>
        <button
          type="button"
          className={`mk-btn mk-btn-sm mk-jbtn${jOn ? " is-on" : ""}`}
          aria-pressed={jOn}
          disabled={junctionIds.size === 0}
          title="2つ以上のKRにつながっている仕事とその帯だけを強調します。もう一度押すと戻ります"
          onClick={() => setJunctionOnly(!junctionOnly)}
        >
          <JunctionMark /> 結節点 {junctionIds.size}件
        </button>
        <span className="mk-spacer" />
        <div className="mk-legend" aria-label="凡例">
          <span>
            <i className="mk-lg mk-lg-done" />
            濃い＝終えた
          </span>
          <span>
            <i className="mk-lg mk-lg-open" />
            薄い＝残り
          </span>
          <span>
            <b aria-hidden="true">★</b>
            成果につながった仕事
          </span>
          <span>
            <JunctionMark />
            結節点（2つ以上のKRにつながる仕事）
          </span>
        </div>
      </div>
      <p className="mk-muted mk-kindnote">バーと輪は成果（資料の数字）、帯は仕事（終えた・残り）。仕事を終えても、成果は資料を読ませるまで動きません</p>
      <p className="mk-muted">
        左のPJ（押すと仕事が開きます）から、中央のKR、右のO（めざす姿）へ。帯の太さは、そのKR向けの仕事のうち何割かを表します。KRを押すと詳細、仕事を押すとつなぎ先を確かめられます。
        {scope === "self" && " 個人OKRからKRへ矢印をドラッグ（または、左を押してから右を押す）でつなぎます。"}
      </p>
      {armed && (
        <p className="mk-armed" role="status">
          KR を選んでください（Esc で取消）
        </p>
      )}

      <div className="mk-flowscroll">
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${H}`} className="mk-flowsvg" role="group" aria-label="仕事からO（めざす姿）への地図">
          <defs>
            {krIds.map((k) => (
              <pattern key={k} id={`mk-hatch-${k}`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={7} stroke={krStyle(k).color} strokeWidth={2.2} opacity={0.7} />
              </pattern>
            ))}
            <pattern id="mk-kr-pat" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1={0} y1={0} x2={0} y2={6} stroke="#fff" strokeWidth={2} />
            </pattern>
          </defs>

          <g className="mk-colhead">
            {scope === "self" && (
              <text x={layout.cols.personal.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
                個人OKR（あなただけ）
              </text>
            )}
            <text x={layout.cols.pj.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              PJ
            </text>
            <text x={layout.cols.kr.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              KR（成果＝進みのバー）
            </text>
            <text x={layout.cols.o.x} y={16} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
              O（めざす姿）
            </text>
          </g>

          <g transform={`translate(0 ${TOP})`}>
            {/* 個人OKR→KRの矢印（PJのノードの後ろを通る） */}
            {scope === "self" &&
              personalLinks.map((l, i) => {
                const p = layout.personal.find((x) => x.id === l.personalId);
                const kn = layout.krNodes.find((k) => k.krId === l.krId);
                if (!p || !kn) return null;
                const idx = personalLinks.filter((x, j) => x.krId === l.krId && j < i).length;
                const bx = kn.x - 4;
                const by = kn.y + 16 + idx * 11;
                const color = krStyle(l.krId).color;
                const name = `${myPersonal.find((x) => x.id === l.personalId)?.text}と${krLabel(l.krId)}のつながり。押すと解除します`;
                return (
                  <g key={`${l.personalId}-${l.krId}`}>
                    <path d={curve(p.x + p.w, p.y + p.h / 2, bx, by)} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />
                    <path d={`M ${bx} ${by} l -9 -5 l 0 10 Z`} fill={color} />
                    <SvgButton label={name} onActivate={() => togglePersonalLink(l.personalId, l.krId)} className="mk-linkhit">
                      <title>{name}</title>
                      <path d={curve(p.x + p.w, p.y + p.h / 2, bx, by)} stroke="transparent" strokeWidth={14} fill="none" />
                    </SvgButton>
                  </g>
                );
              })}
            {drag && personalPort(drag.pid) && (
              <path d={curve(personalPort(drag.pid).x + personalPort(drag.pid).w, personalPort(drag.pid).y + personalPort(drag.pid).h / 2, drag.x, drag.y)} stroke="#888" strokeWidth={2} strokeDasharray="5 4" fill="none" />
            )}

            {layout.pjKr.map((r) => (
              <RibbonShape
                key={r.id}
                r={r}
                krId={r.toId}
                label={`${r.fromId === OTHER_PJ ? "ほかのPJ" : pjName(r.fromId)}から${krLabel(r.toId)}へ：終えた仕事${r.done}件、残り${r.open}件${starsOnRibbon(r) > 0 ? `、成果につながった仕事${starsOnRibbon(r)}件` : ""}。押すと${krLabel(r.toId)}の詳細を開きます`}
                onActivate={() => setSel({ type: "kr", id: r.toId })}
                dim={jOn && !edgeHasJunction(r.toId, pjMembers(r.fromId))}
              />
            ))}
            {layout.krO.map((r) => (
              <RibbonShape
                key={r.id}
                r={r}
                dim={jOn && !edgeHasJunction(r.fromId, null)}
                krId={r.fromId}
                label={`${krLabel(r.fromId)}からO（めざす姿）へ：終えた仕事${r.done}件、残り${r.open}件。押すと${krLabel(r.fromId)}の詳細を開きます`}
                onActivate={() => setSel({ type: "kr", id: r.fromId })}
              />
            ))}
            {layout.pjKr.map((r) => {
              const stars = starsOnRibbon(r);
              return (
                <text key={`n-${r.id}`} x={r.labelX - 4} y={r.labelY} fontSize={10.5} className={`mk-svgtext${dimIf(!edgeHasJunction(r.toId, pjMembers(r.fromId)))}`} pointerEvents="none">
                  仕事 完了 {r.done}／残り {r.open}
                  {stars > 0 ? ` ★${stars}` : ""}
                </text>
              );
            })}

            {/* 個人OKR */}
            {layout.personal.map((p) => {
              const po = myPersonal.find((x) => x.id === p.id);
              if (!po) return null;
              const lines = wrapLines(po.text, 9, 2);
              const isArmed = armed === p.id;
              const linked = personalLinks.filter((l) => l.personalId === p.id).map((l) => krLabel(l.krId));
              return (
                <SvgButton
                  key={p.id}
                  label={`個人OKR「${po.text}」。${isArmed ? "選択中。つなぎたいKRを押してください。Escで取り消せます" : "押してから、つなぎたいKRを押すとつながります。ドラッグでもつなげます"}。いまのつなぎ先：${linked.length ? linked.join("、") : "なし"}`}
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

            {/* PJ（9以上のときは件数の多い順に8つ＋「ほか◯PJ」） */}
            {layout.pjNodes.map((n) => {
              const isOther = n.pjId === OTHER_PJ;
              const name = isOther ? `ほか${n.members.length}PJ` : pjName(n.pjId);
              const label = isOther
                ? `ほか${n.members.length}PJ：終えた仕事${n.done}件、残り${n.open}件。押すとPJの一覧を${n.expanded ? "閉じます" : "開きます"}`
                : `PJ「${name}」：終えた仕事${n.done}件、残り${n.open}件。押すと仕事を${n.expanded ? "閉じます" : "開きます"}`;
              const jc = junctionInPj(n.pjId);
              return (
                <g key={n.pjId} className={dimIf(jc === 0).trim() || undefined}>
                  <SvgButton label={`${label}${jc > 0 ? `。結節点の仕事${jc}件を含みます` : ""}`} onActivate={() => setExpanded((e) => (e.includes(n.pjId) ? e.filter((x) => x !== n.pjId) : [...e, n.pjId]))} expanded={n.expanded}>
                    <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} className="mk-fnode" />
                    <path d={`M ${n.x + 12} ${n.y + 11} h 7 l 2 2.5 h 9 v 11 h -18 Z`} fill="#7c8db5" opacity={0.85} />
                    <text x={n.x + 36} y={n.y + 22} fontSize={12} fontWeight={700} className="mk-svgtext">
                      {trunc(name, 12)}
                    </text>
                    <text x={n.x + 36} y={n.y + 36} fontSize={10.5} className="mk-svgtext-muted">
                      仕事 完了 {n.done}／残り {n.open}
                    </text>
                    {jc > 0 && (
                      <>
                        <JunctionGlyph x={n.x + n.w - 62} y={n.y + 33} />
                        <text x={n.x + n.w - 52} y={n.y + 36} fontSize={9.5} className="mk-svgtext">
                          結節点 {jc}
                        </text>
                      </>
                    )}
                    <path d={n.expanded ? `M ${n.x + n.w - 22} ${n.y + 18} l 6 6 l 6 -6` : `M ${n.x + n.w - 20} ${n.y + 14} l 6 6 l -6 6`} stroke="currentColor" strokeWidth={2} fill="none" className="mk-svgtext-muted" strokeLinecap="round" strokeLinejoin="round" />
                  </SvgButton>
                  {n.rows.map((row) => {
                    if (row.kind === "pj") {
                      const m = n.members.find((x) => x.pjId === row.id)!;
                      return (
                        <g key={row.id}>
                          <rect x={n.x + 10} y={row.y} width={n.w - 10} height={20} rx={8} className="mk-trow" />
                          <text x={n.x + 20} y={row.y + 14} fontSize={10.5} className="mk-svgtext">
                            {trunc(pjName(row.id), 9)}
                          </text>
                          <text x={n.x + n.w - 8} y={row.y + 14} fontSize={9.5} textAnchor="end" className="mk-svgtext-muted">
                            完了 {m.done}／残り {m.open}
                          </text>
                        </g>
                      );
                    }
                    const t = taskOf(row.id);
                    const m = memberOf(t.assigneeId);
                    const isSel = sel?.type === "task" && sel.id === t.id;
                    const tk = krIdsOfTask(t, linkCtx);
                    const isJ = tk.length >= 2;
                    const starred = starredTasks.has(t.id);
                    return (
                      <SvgButton
                        key={t.id}
                        className={dimIf(!isJ).trim() || undefined}
                        label={`仕事「${t.title}」担当${m?.name}、${t.status}${starred ? "、成果につながった仕事" : ""}${isJ ? `、結節点（${krListText(tk)}）` : ""}。押すと詳細を開きます`}
                        onActivate={() => setSel({ type: "task", id: t.id })}
                      >
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
                          {starred ? "★" : ""}
                          {trunc(t.title, (starred ? 10 : 11) - (isJ ? 4 : 0))}
                        </text>
                        {isJ && (
                          <>
                            <JunctionGlyph x={n.x + n.w - 82} y={row.y + 10} />
                            {tk.map((k, i) => (
                              <circle key={k} cx={n.x + n.w - 70 + i * 8} cy={row.y + 10} r={3} fill={krStyle(k).color} />
                            ))}
                          </>
                        )}
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
              const st = krStyle(n.krId);
              const color = st.color;
              const lines = wrapLines(krText(n.krId), 16, 2);
              const isSel = sel?.type === "kr" && sel.id === n.krId;
              const cel = celebrations.find((c) => c.krId === n.krId);
              const change = changes.find((c) => c.krId === n.krId);
              const bx = n.x + 14;
              const bw = n.w - 28;
              const by = n.y + 90;
              const steps = r.kind === "band" ? stepsToTarget(r) : 0;
              const valueLine = r.kind === "number" ? `${r.value}${r.unit} ／ 目標値 ${r.target}${r.unit}\u3000進み ${Math.round(p * 100)}%` : `いま ${r.value} ／ 目標の達成度 ${r.target}${steps > 0 ? `\u3000あと${steps}段` : ""}`;
              const label = `${krLabel(n.krId)} ${krText(n.krId)}：成果 ${valueLine}（${r.updatedAt}の資料）${pace ? `、${PACE_INFO[pace].label}` : ""}。押すと詳細を開きます`;
              return (
                <SvgButton
                  key={n.krId}
                  krId={n.krId}
                  className={dimIf(!edgeHasJunction(n.krId, null)).trim() || undefined}
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
                  {st.pattern > 0 && <rect x={n.x} y={n.y} width={8} height={n.h} rx={4} fill="url(#mk-kr-pat)" opacity={0.6} />}
                  <text x={n.x + 20} y={n.y + 22} fontSize={13} fontWeight={700} fill={color}>
                    {krLabel(n.krId)}
                  </text>
                  {pace ? (
                    <>
                      <PaceGlyph pace={pace} x={n.x + n.w - 62} y={n.y + 18} />
                      <text x={n.x + n.w - 50} y={n.y + 22} fontSize={11} fontWeight={700} className="mk-svgtext">
                        {PACE_INFO[pace].label}
                      </text>
                    </>
                  ) : (
                    <text x={n.x + n.w - 14} y={n.y + 22} fontSize={11} fontWeight={700} textAnchor="end" className="mk-svgtext">
                      達成度（仮の区分）
                    </text>
                  )}
                  {lines.map((l, i) => (
                    <text key={i} x={n.x + 20} y={n.y + 42 + i * 15} fontSize={12} className="mk-svgtext">
                      {l}
                    </text>
                  ))}
                  <text x={n.x + 20} y={n.y + 82} fontSize={11} className="mk-svgtext-muted">
                    {outcomeLine(r)}
                  </text>
                  {r.kind === "number" ? (
                    <>
                      <rect x={bx + 6} y={by} width={bw - 6} height={13} rx={6.5} className="mk-track" />
                      <rect x={bx + 6} y={by} width={Math.max(13, p * (bw - 6))} height={13} rx={6.5} fill={color} />
                      <line x1={bx + 6 + elapsed * (bw - 6)} x2={bx + 6 + elapsed * (bw - 6)} y1={by - 6} y2={by + 19} className="mk-elapsed-tick" />
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
                  {cel && <Burst key={cel.id} x={n.x + n.w - 24} y={n.y + 14} color={color} kind={cel.kind} />}
                  {change && (
                    <g className="mk-deltatag" aria-hidden="true">
                      <rect x={n.x + n.w - 64} y={n.y - 11} width={60} height={20} rx={10} fill={color} />
                      <text x={n.x + n.w - 34} y={n.y + 3} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">
                        {change.text}
                      </text>
                    </g>
                  )}
                </SvgButton>
              );
            })}

            {/* O（めざす姿） */}
            {(() => {
              const o = layout.o;
              const cx = o.x + o.w / 2;
              const cy = o.y + 52;
              const R = 26;
              const C = 2 * Math.PI * R;
              const lines = wrapLines(objText, 7, 4);
              return (
                <g role="img" aria-label={`O（めざす姿）「${objText}」：全体の進み${Math.round(overall * 100)}パーセント（数値のKRの平均）、終えた仕事${o.done}件、残り${o.open}件（重複は1回に数えています）`}>
                  <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={20} className="mk-fnode" stroke="#4a5a8a" strokeWidth={2.5} />
                  <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={10} className="mk-track-ring" />
                  <circle cx={cx} cy={cy} r={R} fill="none" stroke="#4a5a8a" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${overall * C} ${C}`} transform={`rotate(-90 ${cx} ${cy})`} />
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize={13} fontWeight={700} className="mk-svgtext">
                    {Math.round(overall * 100)}%
                  </text>
                  {lines.map((l, i) => (
                    <text key={i} x={cx} y={o.y + 98 + i * 14} textAnchor="middle" fontSize={11} className="mk-svgtext">
                      {l}
                    </text>
                  ))}
                  <text x={cx} y={o.y + o.h - 24} textAnchor="middle" fontSize={10} className="mk-svgtext-muted">
                    仕事
                  </text>
                  <text x={cx} y={o.y + o.h - 10} textAnchor="middle" fontSize={10} className="mk-svgtext-muted">
                    完了 {o.done}／残り {o.open}
                  </text>
                </g>
              );
            })()}

            {/* つながらない仕事：チーム表示では件数だけ。名前つきの一覧は本人が「自分」表示で見るときだけ */}
            {layout.looseCount > 0 && scope === "team" && (
              <text x={0} y={layout.looseTop + 12} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
                つながらない仕事 {layout.looseCount}件
              </text>
            )}
            {layout.loose.length > 0 && (
              <g>
                <text x={0} y={layout.looseTop + 12} fontSize={12} fontWeight={700} className="mk-svgtext-muted">
                  どのKRにもつながらない仕事（点線）。押すとAIの提案が出ます
                </text>
                {layout.loose.map((n) => {
                  const t = taskOf(n.taskId);
                  const tc = aiCandidates[t.pjId] ?? [];
                  const skipped = tc.length > 0 && tc.every((c) => proposals[proposalKey(t.id, c.krId)] === "skipped");
                  const isSel = sel?.type === "task" && sel.id === t.id;
                  return (
                    <SvgButton key={t.id} label={`つながらない仕事「${t.title}」（${pjName(t.pjId)}）${skipped ? "。提案は見送り済み" : ""}。押すと詳細を開きます`} onActivate={() => setSel({ type: "task", id: t.id })}>
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} className={`mk-loose${isSel ? " is-sel" : ""}`} />
                      <circle cx={n.x + 14} cy={n.y + n.h / 2} r={5} fill="none" stroke="#8a93a6" strokeWidth={1.6} strokeDasharray="2 2" />
                      <text x={n.x + 28} y={n.y + 15} fontSize={11} className="mk-svgtext">
                        {trunc(t.title, 16)}
                      </text>
                      <text x={n.x + n.w - 10} y={n.y + 15} fontSize={10} textAnchor="end" className="mk-svgtext-muted">
                        {skipped ? "見送り済み" : ""}
                      </text>
                    </SvgButton>
                  );
                })}
              </g>
            )}
          </g>
        </svg>
      </div>
      {/* 地図が見えない環境でも、数字を読めるように */}
      <p className="mk-sr">
        {krIds.map((k) => `${krLabel(k)}：終えた${krNode(k).done}件、残り${krNode(k).open}件`).join("。")}
      </p>
    </section>
  );
}

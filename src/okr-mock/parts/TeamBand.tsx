import { krStyle, PERIOD_END, PERIOD_NAME, PERIOD_START } from "../fixtures";
import { bandKrIds, BANDS, formatMd, gapPoints, isNotUpdated, krPace, krProgress, latestCheckinDate, overallProgress, paceOfProgress, periodElapsed, stepsToTarget, TODAY } from "../logic";
import { useMock } from "../state";
import { Burst, krLabel, krText, PaceBadge, PaceGlyph, PACE_INFO, valueText } from "../ui";
import type { KrRecord } from "../types";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const MONTHS = [7, 8, 9, 10, 11, 12];

/** 期の道のり（上）と全体の進み（下）を並べて、先行・遅れが見える図。全体の進みは数値のKRの平均 */
function Journey({ elapsed, progress }: { elapsed: number; progress: number }) {
  const X0 = 24;
  const W = 560;
  const ex = X0 + elapsed * W;
  const px = X0 + progress * W;
  const gap = gapPoints(progress, elapsed);
  const behind = paceOfProgress(progress, elapsed) === "behind";
  return (
    <svg viewBox="0 0 620 176" className="mk-journey" role="img" aria-label={`期の経過は${pct(elapsed)}、数値のKRの平均の進みは${pct(progress)}。${behind ? `期の経過より${gap}ポイント遅れ` : "期の経過に追いついています"}`}>
      <text x={X0} y={16} fontSize={12} fontWeight={700} className="mk-svgtext">
        期の道のり（{PERIOD_NAME}）
      </text>
      <rect x={X0} y={26} width={W} height={18} rx={9} className="mk-track" />
      <rect x={X0} y={26} width={Math.max(18, elapsed * W)} height={18} rx={9} fill="#7c8db5" opacity={0.55} />
      {MONTHS.map((m, i) => (
        <g key={m}>
          <line x1={X0 + (i / 6) * W} x2={X0 + (i / 6) * W} y1={44} y2={50} className="mk-tick" />
          <text x={X0 + ((i + 0.5) / 6) * W} y={62} fontSize={10} textAnchor="middle" className="mk-svgtext-muted">
            {m}月
          </text>
        </g>
      ))}
      <path d={`M ${ex} 20 L ${ex} 112`} className="mk-nowline" />
      <path d={`M ${ex - 20} 8 L ${ex + 42} 8 L ${ex + 42} 22 L ${ex - 20} 22 Z`} fill="#4a5a8a" transform="translate(0 -4)" />
      <text x={ex + 11} y={14} fontSize={10} fontWeight={700} textAnchor="middle" fill="#fff">
        いま {formatMd(TODAY).replace(/\(.\)/, "")}
      </text>

      <text x={X0} y={92} fontSize={12} fontWeight={700} className="mk-svgtext">
        全体の進み（数値のKRの平均）
      </text>
      <rect x={X0} y={100} width={W} height={22} rx={11} className="mk-track" />
      <rect x={X0} y={100} width={Math.max(22, progress * W)} height={22} rx={11} className={behind ? "mk-fill-warn" : undefined} fill={behind ? undefined : "#1a9a6b"} />
      <PaceGlyph pace={behind ? "behind" : "ahead"} x={Math.max(11, progress * W) + X0 - 12} y={111} />
      <text x={px + (progress * W > 60 ? -26 : 14)} y={116} fontSize={11} fontWeight={700} textAnchor={progress * W > 60 ? "end" : "start"} fill={progress * W > 60 ? "#fff" : "currentColor"} className={progress * W > 60 ? (behind ? "mk-text-on-warn" : "mk-text-on-fill") : "mk-svgtext"}>
        {pct(progress)}
      </text>
      {behind ? (
        <>
          <path d={`M ${px} 132 L ${ex} 132`} className="mk-stroke-warn" strokeWidth={3} strokeLinecap="round" strokeDasharray="1 6" />
          <text x={(px + ex) / 2} y={152} fontSize={12} fontWeight={700} textAnchor="middle" className="mk-text-warn">
            期の経過より {gap} ポイント遅れ
          </text>
        </>
      ) : (
        <text x={px} y={152} fontSize={12} fontWeight={700} textAnchor="middle" fill="#1a9a6b">
          期の経過に追いついています
        </text>
      )}
    </svg>
  );
}

/** KRごとの進みの輪。数値は期の経過と比べる。達成度は期の経過と比べず、目標まであと何段かで表す */
function Gauge({ krId, r, elapsed, stale }: { krId: string; r: KrRecord; elapsed: number; stale: boolean }) {
  const { setSel, sel, celebrations, changes } = useMock();
  const color = krStyle(krId).color;
  const p = krProgress(r);
  const pace = krPace(r, elapsed);
  const steps = r.kind === "band" ? stepsToTarget(r) : 0;
  const R = 30;
  const C = 2 * Math.PI * R;
  const ang = elapsed * Math.PI * 2 - Math.PI / 2;
  const cel = celebrations.find((c) => c.krId === krId);
  const change = changes.find((c) => c.krId === krId);
  const active = sel?.type === "kr" && sel.id === krId;
  const valueLine = r.kind === "number" ? `${r.value}${r.unit} / 目標値 ${r.target}${r.unit}` : `いま ${r.value} / 目標の達成度 ${r.target}`;
  return (
    <button
      type="button"
      className={`mk-gauge${active ? " is-active" : ""}`}
      style={{ borderTopColor: color }}
      aria-label={`${krLabel(krId)} ${krText(krId)}：${valueLine}、${r.kind === "number" ? `進み${pct(p)}、${pace ? PACE_INFO[pace].label : ""}` : steps > 0 ? `目標の達成度まであと${steps}段` : "目標の達成度に届いています"}${stale ? "、未更新" : ""}${change ? `、今回${change.text}` : ""}。押すと詳細を開きます`}
      onClick={() => setSel({ type: "kr", id: krId })}
    >
      {change && (
        <span className="mk-delta" aria-hidden="true">
          {change.text}
        </span>
      )}
      <svg viewBox="-44 -44 88 88" width={84} height={84} aria-hidden="true" style={{ overflow: "visible" }}>
        <circle r={R} fill="none" strokeWidth={10} className="mk-track-ring" />
        <circle r={R} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${p * C} ${C}`} transform="rotate(-90)" />
        {r.kind === "number" && <line x1={Math.cos(ang) * (R - 8)} y1={Math.sin(ang) * (R - 8)} x2={Math.cos(ang) * (R + 8)} y2={Math.sin(ang) * (R + 8)} className="mk-elapsed-tick" />}
        <text y={5} textAnchor="middle" fontSize={15} fontWeight={700} className="mk-svgtext">
          {pct(p)}
        </text>
        {cel && <Burst key={cel.id} x={0} y={-4} color={color} kind={cel.kind} />}
      </svg>
      <span className="mk-gauge-label">
        <strong style={{ color }}>{krLabel(krId)}</strong> {pace ? <PaceBadge pace={pace} /> : <span className="mk-pace">あと{steps}段</span>}
        {stale && <span className="mk-chip mk-chip-yellow">未更新</span>}
      </span>
      <span className="mk-gauge-text">{krText(krId)}</span>
      {r.kind === "band" ? (
        <span className="mk-bandsteps" aria-hidden="true">
          {BANDS.slice()
            .reverse()
            .map((b) => {
              const on = BANDS.indexOf(b) >= BANDS.indexOf(r.value);
              return (
                <i key={b} className={`${on ? "on" : ""}${b === r.target ? " target" : ""}`} style={on ? { background: color } : undefined}>
                  {b}
                </i>
              );
            })}
        </span>
      ) : null}
      <span className="mk-gauge-num">{valueLine}</span>
      <span className="mk-sr">目標値 {valueText(r, r.target)}</span>
    </button>
  );
}

export function TeamBand() {
  const { items, records, checkins } = useMock();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const progress = overallProgress(records, krs);
  const latest = latestCheckinDate(checkins);
  const bands = bandKrIds(records, krs);
  return (
    <section className="mk-card mk-band" aria-labelledby="mk-band-h">
      <h2 id="mk-band-h" className="mk-h2 mk-h2-big">
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r={10} fill="#3b6fd4" opacity={0.18} />
          <path d="M-6 4 L-2 -1 L1 2 L6 -5" stroke="#3b6fd4" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        チームはどこまで来たか
      </h2>
      <div className="mk-band-body">
        <div>
          <Journey elapsed={elapsed} progress={progress} />
          {bands.length > 0 && (
            <ul className="mk-bandline" aria-label="達成度（仮の区分）のKR">
              {bands.map((k) => {
                const r = records[k];
                if (r.kind !== "band") return null;
                const s = stepsToTarget(r);
                return (
                  <li key={k}>
                    <strong style={{ color: krStyle(k).color }}>{krLabel(k)}</strong> 達成度（仮の区分）：いま {r.value}、目標 {r.target}。{s > 0 ? `目標まであと${s}段` : "目標に届いています"}
                    <span className="mk-muted">（期の経過とは比べません）</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="mk-gauges">
          {krs.map((k) => (
            <Gauge key={k} krId={k} r={records[k]} elapsed={elapsed} stale={isNotUpdated(records[k], latest)} />
          ))}
        </div>
      </div>
      <p className="mk-muted">輪の細い目盛りは「期の経過」の位置です。数値のKRは、輪の先がその目盛りより手前なら遅れ、越えていれば順調です。達成度のKRは期の経過と比べず、あと何段かで表します。</p>
    </section>
  );
}

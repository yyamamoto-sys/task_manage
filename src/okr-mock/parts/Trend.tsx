import { krBands, krStyle } from "../fixtures";
import { trendOf } from "../reach";
import { effectiveEntries, maxStep } from "../steps";
import { useMock } from "../state";
import { hintText, mdOf } from "../ui";

const W = 300;
const H = 100;
const PAD_X = 26;
const TOP = 22;
const BOTTOM = 26;
const FLOOR = 60;

/** 成果の推移。チェックインの回ごとのAIの見立て（60〜）を主に描く。縦軸の下端は60。手がかりの数字は文で添える。資料に出なかった回は「未更新」 */
export function TrendChart({ krId }: { krId: string }) {
  const { records, history, checkins, assessHist } = useMock();
  const r = records[krId];
  const eff = effectiveEntries(assessHist[krId] ?? []);
  const points = trendOf(
    eff.map((e) => ({ date: e.date, value: e.assessment.value })),
    checkins,
  );
  if (!r || points.length === 0) return null;
  const color = krStyle(krId).color;
  const hi = maxStep(krBands[krId]);
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1));
  const y = (n: number) => H - BOTTOM - ((n - FLOOR) / (hi - FLOOR)) * (H - BOTTOM - TOP);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
  const text = points.map((p) => `${mdOf(p.date)} ${p.value}${p.updated ? "" : "（未更新）"}`).join(" → ");
  const hints = r.hint ? trendOf(history[krId] ?? [], checkins) : [];
  const hintTextLine = hints.map((p) => `${mdOf(p.date)} ${hintText(r.hint!, p.value)}${p.updated ? "" : "（未更新）"}`).join(" → ");
  return (
    <div className="mk-trend">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label={`見立ての推移（下端は60）：${text}`}>
        <line x1={PAD_X - 10} x2={W - PAD_X + 10} y1={y(FLOOR)} y2={y(FLOOR)} className="mk-tick" />
        <text x={4} y={y(FLOOR) + 3} fontSize={9} className="mk-svgtext-muted">
          60
        </text>
        {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <g key={p.checkinId}>
            <circle cx={x(i)} cy={y(p.value)} r={5} fill={p.updated ? color : "var(--color-bg-primary)"} stroke={color} strokeWidth={2}>
              <title>{`${mdOf(p.date)} ${p.value}${p.updated ? "" : "（この回は資料に出ず、前の見立てのまま）"}`}</title>
            </circle>
            <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" fontSize={10.5} fontWeight={700} className="mk-svgtext">
              {p.value}
            </text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} className="mk-svgtext-muted">
              {mdOf(p.date)}
            </text>
          </g>
        ))}
      </svg>
      <p className="mk-small mk-muted">{text}。白抜きの点は、その回の資料に出てこず、前の見立てのままの回（未更新）です。</p>
      {hintTextLine && <p className="mk-small mk-muted">手がかりの数字：{hintTextLine}</p>}
    </div>
  );
}

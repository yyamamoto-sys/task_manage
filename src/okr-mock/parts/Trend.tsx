import { krStyle } from "../fixtures";
import { bandRank, BANDS } from "../logic";
import { trendOf } from "../reach";
import { useMock } from "../state";
import { mdOf, valueText } from "../ui";

const W = 300;
const H = 92;
const PAD_X = 26;
const TOP = 22;
const BOTTOM = 26;

/** KRの成果の推移。チェックインの回ごとの値を小さな折れ線（達成度は段）で見せる。資料を読ませた分だけたまる（誰が読ませても同じ） */
export function TrendChart({ krId }: { krId: string }) {
  const { records, history, checkins } = useMock();
  const r = records[krId];
  const points = trendOf(history[krId] ?? [], checkins);
  if (!r || points.length === 0) return null;
  const color = krStyle(krId).color;
  const isBand = r.kind === "band";
  const nums = points.map((p) => (isBand ? bandRank(p.value as (typeof BANDS)[number]) : (p.value as number)));
  const lo = isBand ? 1 : Math.min(...nums);
  const hi = isBand ? BANDS.length : Math.max(...nums);
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1));
  const y = (n: number) => (hi === lo ? (TOP + H - BOTTOM) / 2 : H - BOTTOM - ((n - lo) / (hi - lo)) * (H - BOTTOM - TOP));
  const path = points
    .map((_, i) => {
      if (i === 0) return `M ${x(0)} ${y(nums[0])}`;
      return isBand ? `L ${x(i)} ${y(nums[i - 1])} L ${x(i)} ${y(nums[i])}` : `L ${x(i)} ${y(nums[i])}`;
    })
    .join(" ");
  const text = points.map((p) => `${mdOf(p.date)} ${valueText(r, p.value)}${p.updated ? "" : "（未更新）"}`).join(" → ");
  return (
    <div className="mk-trend">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label={`成果の推移：${text}`}>
        {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <g key={p.checkinId}>
            <circle cx={x(i)} cy={y(nums[i])} r={5} fill={p.updated ? color : "var(--color-bg-primary)"} stroke={color} strokeWidth={2}>
              <title>{`${mdOf(p.date)} ${valueText(r, p.value)}${p.updated ? "" : "（この回は資料に出ず、前の値のまま）"}`}</title>
            </circle>
            <text x={x(i)} y={y(nums[i]) - 9} textAnchor="middle" fontSize={10.5} fontWeight={700} className="mk-svgtext">
              {valueText(r, p.value)}
            </text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} className="mk-svgtext-muted">
              {mdOf(p.date)}
            </text>
          </g>
        ))}
      </svg>
      <p className="mk-small mk-muted">{text}。白抜きの点は、その回の資料に出てこず、前の値のままの回です。</p>
    </div>
  );
}

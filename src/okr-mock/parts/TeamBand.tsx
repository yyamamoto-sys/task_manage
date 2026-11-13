import { krBands, krStyle } from "../fixtures";
import { isNotUpdated, latestCheckinDate } from "../logic";
import { hasStretch, moveText, nextLine, stepMove } from "../steps";
import { useMock } from "../state";
import { hintLine, krLabel, krText, mdOf, StepScale } from "../ui";

/** KRごとの、段の目盛りの小さなカード。押すとKRの詳細を開く */
function Gauge({ krId }: { krId: string }) {
  const { setSel, sel, changes, assess, records, checkins } = useMock();
  const color = krStyle(krId).color;
  const ca = assess[krId];
  const r = records[krId];
  const stale = isNotUpdated(r, latestCheckinDate(checkins));
  const change = changes.find((c) => c.krId === krId);
  const active = sel?.type === "kr" && sel.id === krId;
  if (!ca) return null;
  const a = ca.cur.assessment;
  const mv = moveText(stepMove(ca));
  const hl = hintLine(r);
  const next = nextLine(a, krBands[krId]);
  return (
    <button
      type="button"
      className={`mk-gauge${active ? " is-active" : ""}`}
      style={{ borderTopColor: color }}
      aria-label={`${krLabel(krId)} ${krText(krId)}：AIの見立て ${a.value}、前回から${mv}。${next}${stale ? "。未更新" : ""}${change ? `。今回${change.text}` : ""}。押すと詳細を開きます`}
      onClick={() => setSel({ type: "kr", id: krId })}
    >
      {change && (
        <span className="mk-delta" aria-hidden="true">
          {change.text}
        </span>
      )}
      <span className="mk-gauge-label">
        <strong style={{ color }}>{krLabel(krId)}</strong>
        {hasStretch(krBands[krId]) && <span className="mk-stretch">背伸びの目標</span>}
        {stale && <span className="mk-chip mk-chip-yellow">未更新</span>}
      </span>
      <span className="mk-gauge-text">{krText(krId)}</span>
      <StepScale krId={krId} value={a.value} width={200} />
      <span className="mk-gauge-num">
        {`AIの見立て ${a.value}`}
        <span className="mk-muted">{`（前回から ${mv}）`}</span>
      </span>
      <span className="mk-gauge-text">{next}</span>
      {hl && <span className="mk-gauge-text">{hl}</span>}
      <span className="mk-gauge-text">（{mdOf(r.updatedAt)} の資料）</span>
    </button>
  );
}

export function TeamBand() {
  const { items } = useMock();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  return (
    <section className="mk-card mk-band" aria-labelledby="mk-band-h">
      <h2 id="mk-band-h" className="mk-h2 mk-h2-big">
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r={10} fill="#3b6fd4" opacity={0.18} />
          <path d="M-6 4 L-2 -1 L1 2 L6 -5" stroke="#3b6fd4" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        チームはいま、どの段にいるか
      </h2>
      <div className="mk-gauges">
        {krs.map((k) => (
          <Gauge key={k} krId={k} />
        ))}
      </div>
      <p className="mk-muted">見立ては、チェックイン資料の記述からAIが出したものです。数字は状態を観る手がかりで、数字だけで見立ては決まりません。</p>
    </section>
  );
}

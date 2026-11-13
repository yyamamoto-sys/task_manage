import { krBands, krStyle } from "../fixtures";
import { isNotUpdated, latestCheckinDate } from "../logic";
import { hasStretch, moveText, nextLine, stepMove } from "../steps";
import { useMock } from "../state";
import { hintLine, krLabel, krText, mdOf, StepScale } from "../ui";

/** 段の目盛りの凡例。1か所だけに置く。60台を悪い状態として見せない */
export function StepLegend() {
  return (
    <div className="mk-legend" role="note" aria-label="段の目盛りの凡例">
      <p className="mk-small">
        <strong>60</strong>＝これまでの進め方でも届く水準／<strong>70</strong>＝取り組みによる明確な前進／<strong>80</strong>＝周りから見ても成果が明らか／<strong>90・100</strong>＝これまでのやり方を超える
      </p>
      <p className="mk-small mk-muted">「背伸びの目標」は、90・100 の段を持つKRに付きます。</p>
      <p className="mk-small mk-muted">70 に届けば十分な前進です。60 台は、これまでの進め方で届く範囲にいるという意味で、悪い状態ではありません。</p>
    </div>
  );
}

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
  const { items, assess } = useMock();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const moved = krs.filter((k) => {
    const ca = assess[k];
    const m = ca ? stepMove(ca) : null;
    return m !== null && m !== 0;
  });
  return (
    <section className="mk-card mk-band" aria-labelledby="mk-band-h">
      <h2 id="mk-band-h" className="mk-h2 mk-h2-big">
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r={10} fill="#3b6fd4" opacity={0.18} />
          <path d="M-6 4 L-2 -1 L1 2 L6 -5" stroke="#3b6fd4" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        チームはいま、どの段にいるか
      </h2>
      <div className="mk-band-body">
        <div>
          <h3 className="mk-h3">前回から段の位置が動いたKR</h3>
          {moved.length === 0 ? (
            <p className="mk-muted">前回から動いたKRはありません。</p>
          ) : (
            <ul className="mk-bandline" aria-label="前回から段の位置が動いたKR">
              {moved.map((k) => {
                const ca = assess[k]!;
                return (
                  <li key={k}>
                    <strong style={{ color: krStyle(k).color }}>{krLabel(k)}</strong> {ca.prev!.assessment.value} → {ca.cur.assessment.value}（{moveText(stepMove(ca))}）
                  </li>
                );
              })}
            </ul>
          )}
          <StepLegend />
        </div>
        <div className="mk-gauges">
          {krs.map((k) => (
            <Gauge key={k} krId={k} />
          ))}
        </div>
      </div>
      <p className="mk-muted">見立ては、チェックイン資料の記述からAIが出したものです。数字は状態を観る手がかりで、数字だけで見立ては決まりません。</p>
    </section>
  );
}

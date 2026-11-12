import { KR_COLORS, PERIOD_END, PERIOD_START, tasks } from "../fixtures";
import { formatMd, periodElapsed, TODAY, weeklyFocus } from "../logic";
import { useMock } from "../state";
import { krLabel, krText, nameOf, StatusChip } from "../ui";

export function FocusCard() {
  const { items, records, linkCtx, isOwner, viewerId, setSel } = useMock();
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const krIds = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const list = weeklyFocus({ records, krIds, elapsed, tasks, ctx: linkCtx, memberId: viewerId, isOwnerView: isOwner });

  return (
    <section className="mk-card mk-focus" aria-labelledby="mk-focus-h">
      <h2 id="mk-focus-h" className="mk-h2 mk-h2-big">
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r={10} fill="#e08a00" opacity={0.2} />
          <path d="M-4 -6 L-4 7 M-4 -6 L6 -3 L-4 1" stroke="#e08a00" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        今週ここに力を
      </h2>
      {list.length === 0 ? (
        <p className="mk-muted">期の経過に対して遅れているKRはありません。いまの勢いを保ちましょう。</p>
      ) : (
        <div className="mk-focus-grid">
          {list.map((f) => (
            <div key={f.krId} className="mk-focus-item" style={{ borderLeftColor: KR_COLORS[f.krId] }}>
              <div className="mk-row">
                <strong style={{ color: KR_COLORS[f.krId] }}>{krLabel(f.krId)}</strong>
                <span>{krText(f.krId)}</span>
              </div>
              <div className="mk-small mk-muted" style={{ margin: "2px 0 6px" }}>
                期の経過より {Math.round(f.gap * 100)} ポイント遅れ
              </div>
              {isOwner ? (
                f.mine.length === 0 ? (
                  <p className="mk-muted">あなたの未着手・進行中の仕事は、このKRにはありません。</p>
                ) : (
                  <ol className="mk-focus-tasks">
                    {f.mine.map((t) => (
                      <li key={t.id}>
                        <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: t.id })}>
                          {t.title}
                        </button>{" "}
                        <StatusChip status={t.status} /> <span className="mk-muted">期日 {formatMd(t.due)}</span>
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <p className="mk-small">
                  このKRにつながる未完了の仕事は {f.openCount} 件です（{nameOf(viewerId)}さんの立場では件数だけを出します）。{" "}
                  <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "kr", id: f.krId })}>
                    詳細を開く
                  </button>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

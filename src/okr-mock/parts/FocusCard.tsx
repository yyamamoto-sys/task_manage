import { aiCandidates, krBands, krStyle, PERIOD_START } from "../fixtures";
import { candidateTasksForKr, formatMd, krIdsOfTask, latestCheckinDate, weeklyFocus } from "../logic";
import { krRegistration } from "../reach";
import { useMock } from "../state";
import { krLabel, krText, StatusChip } from "../ui";
import { ClaimsBanner } from "./Claims";

export function FocusCard() {
  const { tasks, items, records, assess, checkins, linkCtx, viewerId, setSel, picks, togglePick, takeProposal, showToast } = useMock();
  const krIds = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const assessOf = Object.fromEntries(krIds.map((k) => [k, assess[k]?.cur.assessment]));
  const list = weeklyFocus({ records, krIds, assessOf, bandsOf: krBands, tasks, ctx: linkCtx, memberId: viewerId, latest: latestCheckinDate(checkins) });

  return (
    <section className="mk-card mk-focus" aria-labelledby="mk-focus-h">
      <h2 id="mk-focus-h" className="mk-h2 mk-h2-big">
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r={10} fill="#e08a00" opacity={0.2} />
          <path d="M-4 -6 L-4 7 M-4 -6 L6 -3 L-4 1" stroke="#e08a00" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        今週ここに力を
      </h2>
      <ClaimsBanner />
      {list.length === 0 ? (
        <p className="mk-muted">いま、あなたの仕事がつながっていて、次の段への手がかりが見えるKRはありません。仕事をKRにつなぐと、ここに出ます。</p>
      ) : (
        <>
          <p className="mk-muted">自分の仕事の「今週やる」を押すと、今週やる仕事として印が付きます（あなたにだけ見えます）。</p>
          <div className="mk-focus-grid">
            {list.map((f) => {
              const reg = krRegistration(f.krId, tasks, linkCtx, PERIOD_START);
              const cands = f.mine.length === 0 ? candidateTasksForKr(tasks, viewerId, f.krId, linkCtx, aiCandidates) : [];
              return (
                <div key={f.krId} className="mk-focus-item" style={{ borderLeftColor: krStyle(f.krId).color }}>
                  <div className="mk-row">
                    <strong style={{ color: krStyle(f.krId).color }}>{krLabel(f.krId)}</strong>
                    <span>{krText(f.krId)}</span>
                    {f.stale && <span className="mk-chip mk-chip-yellow">未更新</span>}
                  </div>
                  <div className="mk-small mk-muted" style={{ margin: "2px 0 6px" }}>
                    {f.kind === "next" ? `次の段（${f.step}）への手がかり` : "あなたの仕事が最も多くつながるKRです"}
                    {reg !== "none" && f.openCount > 0 && (
                      <>
                        {" ／ "}このKRにつながる未完了の仕事は{reg === "partial" ? "登録された分で" : "全員で"} {f.openCount} 件
                      </>
                    )}{" "}
                    <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "kr", id: f.krId })}>
                      詳細を開く
                    </button>
                  </div>
                  {f.kind === "next" && assess[f.krId] && (
                    <ul className="mk-list mk-list-tight">
                      {assess[f.krId]!.cur.assessment.basis
                        .filter((b) => b.status !== "確認できた")
                        .map((b) => (
                          <li key={b.requirement}>
                            <span className="mk-chip">{b.status}</span> {b.requirement}
                          </li>
                        ))}
                    </ul>
                  )}
                  {f.mine.length > 0 ? (
                    <ol className="mk-focus-tasks">
                      {f.mine.map((t) => {
                        const on = picks.includes(t.id);
                        return (
                          <li key={t.id}>
                            <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: t.id })}>
                              {t.title}
                            </button>{" "}
                            <StatusChip status={t.status} /> <span className="mk-muted">期日 {formatMd(t.due)}</span>{" "}
                            <button type="button" className={`mk-pickbtn${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => togglePick(t)}>
                              {on ? "今週やる ✓" : "今週やる"}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div>
                      <p className="mk-small">この KR につなげられそうなあなたの仕事（AIの候補）</p>
                      {cands.length === 0 ? (
                        <p className="mk-muted">つなげられそうな仕事は見つかりませんでした。</p>
                      ) : (
                        <ul className="mk-list mk-list-tight">
                          {cands.map((c) => (
                            <li key={c.task.id}>
                              {c.task.title} <span className="mk-muted">{c.reason}</span>{" "}
                              <button
                                type="button"
                                className="mk-btn mk-btn-sm mk-btn-primary"
                                onClick={() => {
                                  takeProposal(c.task, f.krId);
                                  showToast(`「${c.task.title}」を${krLabel(f.krId)}${krIdsOfTask(c.task, linkCtx).length > 0 ? "にも" : "に"}つなぎました`);
                                }}
                              >
                                採る
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

import { formatMd } from "../logic";
import { useMock } from "../state";
import { KrDots, nameOf } from "../ui";

/** 決定事項と宿題の一覧（折りたたみ・一覧のみ。ここからタスクは作らない） */
export function DecisionsFold() {
  const { checkins, decisions, decisionsOpen, setDecisionsOpen, newDecisions } = useMock();
  const sorted = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <section className="mk-card" aria-labelledby="mk-dec-h">
      <h2 id="mk-dec-h" className="mk-h2" style={{ margin: 0 }}>
        <button type="button" className="mk-foldbtn" aria-expanded={decisionsOpen} aria-controls="mk-dec-body" onClick={() => setDecisionsOpen(!decisionsOpen)}>
          <span aria-hidden="true">{decisionsOpen ? "▾" : "▸"}</span> 決定事項と宿題（{decisions.length}件）
        </button>
        {newDecisions > 0 && <span className="mk-chip mk-chip-green" style={{ marginLeft: 8 }}>新しく{newDecisions}件</span>}
      </h2>
      {decisionsOpen && (
        <div id="mk-dec-body">
          <p className="mk-muted">チェックインの回ごとの一覧です。全員に見えます。ここからタスクを作ることはしません。</p>
          {sorted.map((c) => {
            const list = decisions.filter((d) => d.checkinId === c.id);
            return (
              <section key={c.id} aria-label={c.title} style={{ marginBottom: 12 }}>
                <h3 className="mk-h3">
                  {formatMd(c.date)} {c.title}
                </h3>
                {list.length === 0 ? (
                  <p className="mk-muted">この回の決定事項と宿題はありません。</p>
                ) : (
                  <div className="mk-table-wrap">
                    <table className="mk-table">
                      <thead>
                        <tr>
                          <th style={{ width: 60 }}>区分</th>
                          <th>内容</th>
                          <th style={{ width: 96 }}>KR</th>
                          <th style={{ width: 100 }}>担当者</th>
                          <th>出典</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((d) => (
                          <tr key={d.id}>
                            <td>
                              <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span>
                            </td>
                            <td>{d.text}</td>
                            <td>
                              <KrDots krIds={d.krIds} labeled />
                            </td>
                            <td>{d.ownerId ? nameOf(d.ownerId) : "―"}</td>
                            <td>
                              {d.source.doc} {d.source.page}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

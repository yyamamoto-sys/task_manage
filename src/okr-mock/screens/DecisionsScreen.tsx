import { formatMd } from "../logic";
import { useMock } from "../state";
import { nameOf } from "../ui";

export function DecisionsScreen() {
  const { checkins, decisions } = useMock();
  const sorted = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div>
      <h1 className="mk-h1">決定事項と宿題</h1>
      <p className="mk-lead">チェックインの回ごとの一覧です。全員に見えます。ここからタスクを作ることはしません。</p>
      {sorted.map((c) => {
        const list = decisions.filter((d) => d.checkinId === c.id);
        return (
          <section key={c.id} className="mk-card" style={{ marginBottom: 12 }} aria-label={c.title}>
            <h2 className="mk-h2" style={{ marginTop: 0 }}>
              {formatMd(c.date)} {c.title}
            </h2>
            {list.length === 0 ? (
              <p className="mk-muted">この回の決定事項と宿題はありません。</p>
            ) : (
              <table className="mk-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>区分</th>
                    <th>内容</th>
                    <th style={{ width: 110 }}>担当者</th>
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
                      <td>{d.ownerId ? nameOf(d.ownerId) : "―"}</td>
                      <td>
                        {d.source.doc} {d.source.page}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

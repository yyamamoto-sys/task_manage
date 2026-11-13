import { krBands } from "../fixtures";
import { formatMd, isNotUpdated, latestCheckinDate } from "../logic";
import { moveText, stepMove } from "../steps";
import { useMock } from "../state";
import { hintLine, krLabel, krText } from "../ui";

/** 対照表（補助表示）。KR詳細パネルの「表で見る」から開く。全KR分の段の基準・いまの見立て・前回からの動き */
export function CompareTable() {
  const { items, records, checkins, assess } = useMock();
  const krs = items.filter((i) => i.kind === "kr");
  const latest = latestCheckinDate(checkins);
  return (
    <div>
      <p className="mk-muted">
        KRごとの、段の基準と、いまのAIの見立てです。見立ては60が出発点で、資料の記述から決めています。直近のチェックイン（{formatMd(latest)}）の資料に出てこなかったKRは、前回のまま「未更新」と表示します。
      </p>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th>KR</th>
              <th>段の基準（60／70／80の要約）</th>
              <th>いま</th>
              <th>前回から</th>
            </tr>
          </thead>
          <tbody>
            {krs.map((kr) => {
              const r = records[kr.id];
              const ca = assess[kr.id];
              const b = krBands[kr.id];
              const hl = hintLine(r);
              return (
                <tr key={kr.id}>
                  <td>
                    <span className="mk-chip mk-chip-blue">{krLabel(kr.id)}</span> {krText(kr.id)}
                  </td>
                  <td>
                    <ul className="mk-list mk-list-tight">
                      {([60, 70, 80] as const).map((st) => (
                        <li key={st}>
                          <strong>{st}</strong> {b[st]}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    {ca ? (
                      <>
                        <strong>{ca.cur.assessment.value}</strong> <span className="mk-muted">（AIの見立て）</span>
                      </>
                    ) : (
                      "―"
                    )}
                    {hl && <div className="mk-small mk-muted">{hl}</div>}
                    <div className="mk-small mk-muted">
                      {r.updatedAt}
                      {r.source ? ` ${r.source.doc} ${r.source.page}` : ""}
                      {isNotUpdated(r, latest) && (
                        <>
                          {" "}
                          <span className="mk-chip mk-chip-yellow">未更新</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td>{ca ? moveText(stepMove(ca)) : "―"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

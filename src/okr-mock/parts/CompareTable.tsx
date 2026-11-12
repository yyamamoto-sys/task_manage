import { BANDS, formatMd, isNotUpdated, krGap, krMove, latestCheckinDate } from "../logic";
import { useMock } from "../state";
import { krLabel, krText, signed, valueText } from "../ui";

/** 対照表（補助表示）。KR詳細パネルの「表で見る」から開く。全KR分の目標・現状・差・動き */
export function CompareTable() {
  const { items, records, checkins } = useMock();
  const krs = items.filter((i) => i.kind === "kr");
  const latest = latestCheckinDate(checkins);
  return (
    <div>
      <p className="mk-muted">
        KRごとの目標値と現状です。直近のチェックイン（{formatMd(latest)}）の資料に出てこなかったKRは、前回の値のまま「未更新」と表示します。数値で測れないKRは達成度で表します。
        <span className="mk-chip mk-chip-yellow">達成度（仮の区分）</span> 現在は {BANDS.join("／")} の5段階です。
      </p>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th>KR</th>
              <th>目標値</th>
              <th>期首値</th>
              <th>現状</th>
              <th>差</th>
              <th>前回からの動き</th>
              <th>最終更新日と出典</th>
            </tr>
          </thead>
          <tbody>
            {krs.map((kr) => {
              const r = records[kr.id];
              const unit = r.kind === "number" ? r.unit : "段";
              return (
                <tr key={kr.id}>
                  <td>
                    <span className="mk-chip mk-chip-blue">{krLabel(kr.id)}</span> {krText(kr.id)}
                  </td>
                  <td>{valueText(r, r.target)}</td>
                  <td>{r.kind === "number" ? valueText(r, r.start) : "―"}</td>
                  <td>
                    <strong>{valueText(r, r.value)}</strong>
                  </td>
                  <td>{signed(krGap(r), unit)}</td>
                  <td>{signed(krMove(r), unit)}</td>
                  <td>
                    {r.updatedAt}
                    {r.source ? ` ${r.source.doc} ${r.source.page}` : ""}
                    {isNotUpdated(r, latest) && (
                      <>
                        {" "}
                        <span className="mk-chip mk-chip-yellow">未更新</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

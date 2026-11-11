import { Fragment } from "react";
import { OWNER_ID, tasks } from "../fixtures";
import { BANDS, formatMd, isNotUpdated, krGap, krIdsOfTask, krMove, latestCheckinDate, tasksDoneBetween, tasksOfKr } from "../logic";
import { useMock } from "../state";
import { KrDots, nameOf, signed, StatusChip, valueText } from "../ui";

export function TableScreen() {
  const { items, records, checkins, selectedKr, setSelectedKr, isOwner, linkCtx } = useMock();
  const krs = items.filter((i) => i.kind === "kr");
  const latest = latestCheckinDate(checkins);

  return (
    <div>
      <h1 className="mk-h1">対照表</h1>
      <p className="mk-lead">
        KRごとの目標と現状です。直近のチェックイン（{formatMd(latest)}）の資料に出てこなかったKRは、前回の値のまま「未更新」と表示します。行を押すと中身が開きます。
      </p>
      <p className="mk-muted">
        数値で測れないKRは達成度バンドで表します。<span className="mk-chip mk-chip-yellow">仮の区分</span> 現在は {BANDS.join("／")} の5段階で、実際の区分が決まったら差し替えます。
      </p>

      <div className="mk-table-wrap mk-card">
        <table className="mk-table">
          <thead>
            <tr>
              <th>KR</th>
              <th>目標</th>
              <th>現状</th>
              <th>差</th>
              <th>前回からの動き</th>
              <th>最終更新日と出典</th>
            </tr>
          </thead>
          <tbody>
            {krs.map((kr) => {
              const r = records[kr.id];
              const open = selectedKr === kr.id;
              const stale = isNotUpdated(r, latest);
              const gap = krGap(r);
              const mv = krMove(r);
              const unit = r.kind === "number" ? r.unit : "段";
              const krTasks = tasksOfKr(tasks, kr.id, linkCtx);
              const done = tasksDoneBetween(tasks, OWNER_ID, kr.id, r.prevAt, r.updatedAt, linkCtx);
              return (
                <Fragment key={kr.id}>
                  <tr className={open ? "is-open" : ""}>
                    <td>
                      <button type="button" className="mk-rowbtn" aria-expanded={open} onClick={() => setSelectedKr(open ? null : kr.id)}>
                        <span className="mk-chip mk-chip-blue">{kr.label}</span> {kr.text}
                      </button>
                    </td>
                    <td>{valueText(r, r.target)}</td>
                    <td>
                      <strong>{valueText(r, r.value)}</strong>
                    </td>
                    <td>{signed(gap, unit)}</td>
                    <td>{signed(mv, unit)}</td>
                    <td>
                      {r.updatedAt}
                      {r.source ? ` ${r.source.doc} ${r.source.page}` : ""}
                      {stale && (
                        <>
                          {" "}
                          <span className="mk-chip mk-chip-yellow">未更新</span>
                        </>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} className="mk-openrow">
                        <div className="mk-grid mk-grid-2">
                          <div>
                            <h2 className="mk-h2" style={{ marginTop: 0 }}>
                              {kr.label}ごとの仕事の一覧
                            </h2>
                            <p className="mk-muted">このKRにつながる仕事です（全員に見えます）。</p>
                            <ul className="mk-list">
                              {krTasks.map((t) => (
                                <li key={t.id}>
                                  {t.title} <span className="mk-muted">{nameOf(t.assigneeId)}</span> <StatusChip status={t.status} />
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h2 className="mk-h2" style={{ marginTop: 0 }}>
                              この動きの間にあなたが終えた仕事
                            </h2>
                            {isOwner ? (
                              <>
                                <p className="mk-muted">
                                  {formatMd(r.prevAt)}の翌日から{formatMd(r.updatedAt)}までに、あなたが完了した仕事です（本人だけに見えます）。
                                </p>
                                {done.length === 0 ? (
                                  <p className="mk-muted">該当する仕事はありません。</p>
                                ) : (
                                  <ul className="mk-list">
                                    {done.map((t) => (
                                      <li key={t.id}>
                                        {t.title} <span className="mk-muted">{formatMd(t.updated)}</span> <KrDots krIds={krIdsOfTask(t, linkCtx)} />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            ) : (
                              <p className="mk-muted">本人にしか見えません。</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

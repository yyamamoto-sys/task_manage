import { useState } from "react";
import { aiCandidates, howOptions, OWNER_ID, pjsInit, tasks } from "../fixtures";
import { formatMd, krIdsOfTask, linkedTasks, unlinkedTasks } from "../logic";
import { useMock } from "../state";
import { KrDots, krName, PrivateGuard, StatusChip } from "../ui";

function Body() {
  const { linkCtx, overrides, setOverride, proposals, setProposal, how, setHow } = useMock();
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = tasks
    .filter((t) => t.assigneeId === OWNER_ID)
    .sort((a, b) => Number(a.status === "完了") - Number(b.status === "完了") || (a.due < b.due ? -1 : 1));
  const linked = linkedTasks(mine, linkCtx);
  const loose = unlinkedTasks(mine, linkCtx);
  const pending = loose.filter((t) => proposals[t.id] !== "skipped");
  const skipped = loose.filter((t) => proposals[t.id] === "skipped");
  const pjName = (id: string) => pjsInit.find((p) => p.id === id)?.name ?? "";
  const isShared = (pjId: string) => (pjsInit.find((p) => p.id === pjId)?.tfIds.length ?? 0) > 1;

  return (
    <div>
      <p className="mk-muted">
        つながっている仕事 {linked.length}件／つながりなし {loose.length}件。複数のTFに付く共有PJの仕事は、1件に数えています。
      </p>

      {pending.length > 0 && (
        <>
          <h2 className="mk-h2">AIの提案（つながりのない仕事）</h2>
          <div className="mk-card">
            {pending.map((t) => {
              const c = aiCandidates[t.pjId]?.[0];
              if (!c) return null;
              return (
                <div key={t.id} className="mk-propose">
                  <div>
                    <strong>{t.title}</strong> <span className="mk-muted">{pjName(t.pjId)}</span>
                  </div>
                  <div className="mk-small">
                    つなぐ先の候補：{krName(c.krId)}（{c.reason}）
                  </div>
                  <div className="mk-row" style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="mk-btn mk-btn-sm mk-btn-primary"
                      onClick={() => {
                        setOverride(t.id, c.krId);
                        setProposal(t.id, "taken");
                      }}
                    >
                      採る
                    </button>
                    <button type="button" className="mk-btn mk-btn-sm" onClick={() => setProposal(t.id, "skipped")}>
                      見送る
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {skipped.length > 0 && (
        <p className="mk-muted">
          見送った提案：{skipped.map((t) => t.title).join("、")}
          {" "}
          <button type="button" className="mk-btn mk-btn-sm" onClick={() => skipped.forEach((t) => setProposal(t.id, undefined))}>
            見送りを戻す
          </button>
        </p>
      )}

      <h2 className="mk-h2">自分の仕事</h2>
      <p className="mk-muted">
        行の端の点は、つながるKRの色です。●＝KRにつながる、○＝つながりなし（点にカーソルを置くとKR名が出ます）。行を押すと、つなぎ先を変えられます。
      </p>
      <div className="mk-card">
        <ul className="mk-tasklist">
          {mine.map((t) => {
            const ks = krIdsOfTask(t, linkCtx);
            const open = openId === t.id;
            const cands = aiCandidates[t.pjId] ?? [];
            const cur = ks[0];
            return (
              <li key={t.id} className={open ? "is-open" : ""}>
                <button type="button" className="mk-taskrow" aria-expanded={open} onClick={() => setOpenId(open ? null : t.id)}>
                  <span className="mk-ttitle">{t.title}</span>
                  <span className="mk-muted">{pjName(t.pjId)}</span>
                  {isShared(t.pjId) && (
                    <span className="mk-chip mk-chip-blue" title="複数のTFに付くPJです。集計では1回だけ数えます">
                      共有PJ
                    </span>
                  )}
                  <StatusChip status={t.status} />
                  <span className="mk-muted">{formatMd(t.due)}</span>
                  <KrDots krIds={ks} />
                </button>
                {open && (
                  <div className="mk-taskpanel">
                    <div className="mk-small">つなぎ先を変える（AIの候補から選びます）</div>
                    <div className="mk-row" style={{ margin: "4px 0" }}>
                      {cands.map((c) => (
                        <button
                          key={c.krId}
                          type="button"
                          className={`mk-btn mk-btn-sm${cur === c.krId && overrides[t.id] === c.krId ? " mk-btn-primary" : ""}`}
                          title={c.reason}
                          onClick={() => setOverride(t.id, c.krId)}
                        >
                          {krName(c.krId)}
                        </button>
                      ))}
                      {overrides[t.id] && (
                        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setOverride(t.id, undefined)}>
                          既定に戻す
                        </button>
                      )}
                    </div>
                    {cur ? (
                      <fieldset className="mk-fieldset">
                        <legend className="mk-small">どう効くか（AIの案から選びます）</legend>
                        {howOptions[cur].map((h) => (
                          <label key={h} style={{ display: "block", padding: "2px 0" }}>
                            <input type="radio" name={`how-${t.id}`} checked={how[t.id] === h} onChange={() => setHow(t.id, h)} /> {h}
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <p className="mk-muted">つなぎ先を決めると、「どう効くか」の案が出ます。</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function TaskLinkScreen() {
  return (
    <div>
      <h1 className="mk-h1">仕事のつなぎ</h1>
      <p className="mk-lead">自分のタスクが、どのKRにつながっているかを見る画面です。本人だけに見えます。</p>
      <PrivateGuard>
        <Body />
      </PrivateGuard>
    </div>
  );
}

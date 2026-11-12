import { useEffect, useMemo, useRef, useState } from "react";
import { detectConflicts, mergeAssessments, mergeDrafts, notesOfResources, unresolved } from "../confirm";
import { krBands, nextCheckin, resources } from "../fixtures";
import { formatMd } from "../logic";
import { currentAssessment, moveText } from "../steps";
import { useMock } from "../state";
import { hintText, krLabel, krName, nameOf, useFocusTrap } from "../ui";

/** 「資料を読ませる」の引き出し。資料を選ぶ（複数可）→ AIの下書き → 資料どうしの食い違いを選ぶ → まとめて確定 */
export function DocDrawer() {
  const { records, items, assessHist, assess, confirmImport, confirmedBy, setDrawerOpen, showToast, tasks, reach } = useMock();
  const [resIds, setResIds] = useState<string[]>([]);
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [picks, setPicks] = useState<Record<string, number>>({});
  const ref = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => resources.filter((r) => resIds.includes(r.id)), [resIds]);
  const krs = items.filter((i) => i.kind === "kr");
  const close = () => setDrawerOpen(false);
  const checkinDate = nextCheckin.date;
  const conflicts = useMemo(() => detectConflicts(selected, records, checkinDate), [selected, records, checkinDate]);
  const drafts = useMemo(() => mergeDrafts(selected, conflicts, picks), [selected, conflicts, picks]);
  const open = unresolved(conflicts, picks);
  const notes = useMemo(() => notesOfResources(selected), [selected]);
  const assessedKrs = useMemo(() => [...new Set(selected.flatMap((r) => r.assessments.map((a) => a.krId)))], [selected]);
  const merged = useMemo(() => mergeAssessments(assessHist, selected, nextCheckin, krBands), [assessHist, selected]);
  const learnList = useMemo(() => selected.flatMap((r) => r.learnings.map((l, i) => ({ ...l, id: `${r.id}-${i}` }))), [selected]);
  // 他の人がいるときだけ出す（1人だけが使っている状態では、確定済みの案内は要らない）
  const confirmer = reach === "solo" ? undefined : confirmedBy[nextCheckin.id];

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useFocusTrap(ref, true);

  const toggle = (id: string) => {
    setResIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setRead(false);
    setValues({});
    setPicks({});
  };

  return (
    <div
      className="mk-drawer-wrap print-hide"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <button type="button" className="mk-drawer-scrim" aria-label="引き出しを閉じる" tabIndex={-1} onClick={close} />
      <div ref={ref} tabIndex={-1} className="mk-drawer" role="dialog" aria-modal="true" aria-labelledby="mk-drawer-h">
        <div className="mk-row">
          <h2 id="mk-drawer-h" className="mk-h2" style={{ margin: 0 }}>
            資料を読ませる
          </h2>
          <span className="mk-spacer" />
          <button type="button" className="mk-btn mk-btn-sm" onClick={close}>
            閉じる
          </button>
        </div>
        <p className="mk-muted">チェックインの後に使います。資料からAIの見立て・手がかりの数字・学び・決定事項・宿題の下書きを取り出し、直したい数字だけ直して、まとめて確定します。見立ては資料の記述だけから決まり、そのまま確定されます。誰でも操作できます。</p>
        {confirmer && (
          <div className="mk-card mk-note" role="status">
            この回（{formatMd(nextCheckin.date)} {nextCheckin.title}）は{nameOf(confirmer)}さんが確定済みです。続けて別の資料を確定すると、決定事項と宿題は資料ごとに足し合わされます。
          </div>
        )}
        <div className="mk-card mk-note" role="note">
          モックです。実際のファイルは読み込まず、AIも呼び出しません。下の結果は固定のデータです。
        </div>

        <h3 className="mk-h3">1. 資料を選ぶ（複数選べます）</h3>
        <fieldset className="mk-fieldset">
          <legend className="mk-small">読ませる資料（架空の2件・どちらも同じ回のもの）</legend>
          {resources.map((r) => (
            <label key={r.id} className={`mk-opt${resIds.includes(r.id) ? " is-on" : ""}`}>
              <input type="checkbox" name="res" checked={resIds.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name} <span className="mk-muted">{r.kind}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="mk-btn mk-btn-primary" style={{ marginTop: 8 }} disabled={selected.length === 0} onClick={() => setRead(true)}>
          読み取る（模擬）
        </button>

        {selected.length > 0 && read && (
          <>
            <h3 className="mk-h3">2. AIが読み取った下書き</h3>
            <h4 className="mk-panel-sub">AI の見立て（資料の記述だけから。60が出発点）</h4>
            {assessedKrs.length === 0 ? (
              <p className="mk-muted">この資料からは、見立てを取り出せませんでした。</p>
            ) : (
              <ul className="mk-list">
                {assessedKrs.map((k) => {
                  const before = assess[k];
                  const after = currentAssessment(merged[k] ?? []);
                  if (!after) return null;
                  const a = after.cur.assessment;
                  return (
                    <li key={k}>
                      <strong>{krName(k)}</strong>：前回 {before ? before.cur.assessment.value : "―"} → 案 <strong>{a.value}</strong>{" "}
                      <span className="mk-muted">（AI の見立て・前回から {before ? moveText(a.value - before.cur.assessment.value) : "前回なし"}）</span>
                      <div className="mk-small">{a.summary}</div>
                      <ul className="mk-list mk-list-tight">
                        {a.basis.map((b) => (
                          <li key={b.requirement}>
                            <span className="mk-chip">{b.status}</span> {b.requirement}
                            <span className="mk-muted">{b.quote ? `「${b.quote}」` : "（資料に記述なし）"}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            {drafts.length > 0 && (
              <>
                <h4 className="mk-panel-sub">手がかりの数字（直したい行だけ直してください）</h4>
                <div className="mk-table-wrap">
                  <table className="mk-table">
                    <thead>
                      <tr>
                        <th>KR</th>
                        <th>前回</th>
                        <th>現状の案</th>
                        <th>出典の箇所</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((d) => {
                        const r = records[d.krId];
                        const h = r.hint;
                        if (!h) return null;
                        const cur = values[d.krId] ?? d.value;
                        const inConflict = conflicts.some((c) => c.krId === d.krId);
                        return (
                          <tr key={d.krId}>
                            <td>{krName(d.krId)}</td>
                            <td>{hintText(h, h.value)}</td>
                            <td>
                              {inConflict && picks[d.krId] === undefined ? (
                                <span className="mk-chip mk-chip-yellow">下で選んでください</span>
                              ) : (
                                <label>
                                  <span className="mk-sr">{krName(d.krId)}の手がかりの数字</span>
                                  <input
                                    type="number"
                                    className="mk-input"
                                    style={{ width: 80 }}
                                    value={cur}
                                    onChange={(e) => {
                                      const n = e.target.valueAsNumber;
                                      if (!Number.isNaN(n)) setValues((p) => ({ ...p, [d.krId]: n }));
                                    }}
                                  />{" "}
                                  {h.unit}
                                </label>
                              )}
                            </td>
                            <td>
                              {d.source.doc} {d.source.page}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <h4 className="mk-panel-sub">学び・気づき</h4>
            {learnList.length === 0 ? (
              <p className="mk-muted">この資料からは、学び・気づきを取り出せませんでした。</p>
            ) : (
              <ul className="mk-list mk-list-tight">
                {learnList.map((l) => (
                  <li key={l.id}>
                    <strong>{krLabel(l.krId)}</strong> <span className="mk-chip">{l.kind}</span> {l.text}{" "}
                    <span className="mk-muted">
                      {l.source.doc} {l.source.page}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {krs.some((k) => !drafts.some((d) => d.krId === k.id) && !assessedKrs.includes(k.id)) && (
              <p className="mk-muted">
                資料に出てこなかったKR：{krs.filter((k) => !drafts.some((d) => d.krId === k.id) && !assessedKrs.includes(k.id)).map((k) => krLabel(k.id)).join("、")}（前回のまま、「未更新」と表示します）
              </p>
            )}

            {conflicts.length > 0 && (
              <>
                <h3 className="mk-h3">資料どうしの食い違い（どちらを採るか選んでください）</h3>
                {conflicts.map((c) => (
                  <fieldset key={c.krId} className="mk-fieldset mk-conflict">
                    <legend className="mk-small">
                      <strong>{krName(c.krId)}</strong>
                    </legend>
                    {c.options.map((o, i) => (
                      <label key={i} className={`mk-opt${picks[c.krId] === i ? " is-on" : ""}`}>
                        <input type="radio" name={`conf-${c.krId}`} checked={picks[c.krId] === i} onChange={() => setPicks((p) => ({ ...p, [c.krId]: i }))} />{" "}
                        <strong>{records[c.krId].hint ? hintText(records[c.krId].hint!, o.value) : o.value}</strong>{" "}
                        <span className="mk-muted">
                          {o.existing ? "すでに確定済みの値：" : ""}
                          {o.source.doc} {o.source.page}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </>
            )}

            <h3 className="mk-h3">3. 成果の記述と、関係しそうな仕事</h3>
            <p className="mk-muted">資料の中の成果の記述と、AIが推定した関連の仕事です。ここでは読むだけで、確定しません。「まとめて確定」すると、推定された結びつきが各仕事の担当者本人に「確かめてください」として届きます。</p>
            <ul className="mk-list">
              {notes.map((n) => (
                <li key={n.key}>
                  <strong>{krLabel(n.krId)}</strong> {n.change} 「{n.excerpt}」{" "}
                  <span className="mk-muted">{n.sources.map((x) => `${x.doc} ${x.page}`).join("／")}</span>
                  {n.links.length === 0 ? (
                    <div className="mk-small mk-muted">関係しそうな仕事は見つかりませんでした（結びつきは届きません）。</div>
                  ) : !n.links.some((l) => tasks.some((x) => x.id === l.taskId)) ? (
                    <div className="mk-small mk-muted">関係しそうな仕事は登録にありません。</div>
                  ) : (
                    <ul className="mk-list mk-list-tight">
                      {n.links.filter((l) => tasks.some((x) => x.id === l.taskId)).map((l) => {
                        const t = tasks.find((x) => x.id === l.taskId);
                        return (
                          <li key={l.taskId}>
                            {t?.title} <span className="mk-muted">担当：{nameOf(t?.assigneeId ?? null)}｜{l.reason}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <h3 className="mk-h3">4. 決定事項と宿題の取り出し結果</h3>
            <ul className="mk-list">
              {selected.flatMap((res) =>
                res.decisions.map((d, i) => (
                  <li key={`${res.id}-${i}`}>
                    <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span> {d.text}
                    {d.ownerId ? ` 担当：${nameOf(d.ownerId)}` : ""}{" "}
                    <span className="mk-muted">
                      {d.source.doc} {d.source.page}
                    </span>
                  </li>
                )),
              )}
            </ul>

            <div className="mk-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="mk-btn mk-btn-primary"
                disabled={open.length > 0}
                onClick={() => {
                  const found = confirmImport(resIds, picks, values);
                  setDrawerOpen(false);
                  showToast(found.length > 0 ? `地図に反映しました。${found.map((c) => `${krLabel(c.krId)}が${c.step} の段に届きました`).join("、")}` : "地図に反映し、決定事項と宿題の欄に加えました");
                }}
              >
                まとめて確定
              </button>
              <span className="mk-muted">{open.length > 0 ? "食い違いのすべてで、採る値を選ぶと押せます。" : "確定すると、地図と帯が新しい見立てになります。"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

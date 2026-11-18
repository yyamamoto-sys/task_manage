import { CopilotPromptHelp } from "./CopilotPromptHelp";
import { PasteReadBox } from "./PasteReadBox";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONSULT_ATTACHMENT_ACCEPT } from "../../../../lib/ai/consultationAttachmentLoader";
import { LONG_RESOURCE_CHARS } from "../checkinAi";
import { formatErrorForUser } from "../../../../lib/errorMessage";
import { detectConflicts, mergeAssessments, mergeDrafts, notesOfResources, unresolved } from "../confirm";
import { DEMO, krBands, nextCheckin, TODAY } from "../dataset";
import { formatMd } from "../logic";
import { currentAssessment, moveText } from "../steps";
import { guardUnsaved, useMock } from "../state";
import type { Checkin } from "../types";
import { hintText, krLabel, krName, nameOf, useFocusTrap } from "../ui";

const NEW_CI = "__new__";
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ci-${Date.now()}`);

/**
 * 「資料を読ませる」の引き出し。回を選ぶ（または新しく作る）→ 資料を加えて AI に読ませる（複数可）→
 * 読み取った資料を選ぶ → AIの下書き → 資料どうしの食い違いを選ぶ → まとめて確定。
 * AI を使えないとき（ゲスト・テスト）は、データにある資料だけで同じ流れを見せる
 */
export function DocDrawer() {
  const { records, items, assessHist, assess, confirmImport, confirmedBy, setDrawerOpen, showToast, tasks, reach, aiReady, resources, openCheckins, checkins, readResources, krDefs } = useMock();
  const [resIds, setResIds] = useState<string[]>([]);
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [picks, setPicks] = useState<Record<string, number>>({});
  const ref = useRef<HTMLDivElement>(null);

  // 回の選択（AI を使えるときだけ）。資料を読ませた未確定の回があれば、いちばん新しいものを最初に選ぶ
  const [newCi, setNewCi] = useState<Checkin>(() => ({ id: newId(), date: TODAY, title: `${formatMd(TODAY)}のチェックイン` }));
  const pool = useMemo(() => [...openCheckins, ...checkins].sort((a, b) => (a.date < b.date ? 1 : -1)), [openCheckins, checkins]);
  const [ciId, setCiId] = useState<string>(() => [...openCheckins].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.id ?? NEW_CI);
  const ci: Checkin = !aiReady ? nextCheckin : ciId === NEW_CI ? newCi : (pool.find((c) => c.id === ciId) ?? newCi);
  const listed = useMemo(() => (aiReady ? resources.filter((r) => r.checkinId === ci.id) : resources), [aiReady, resources, ci.id]);

  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => listed.filter((r) => resIds.includes(r.id)), [listed, resIds]);
  const krs = items.filter((i) => i.kind === "kr");
  const close = () => {
    if (busy) return;
    // 貼り付け欄に書きかけがあれば、閉じる前に破棄確認が出る（unsavedEditorRegistry）
    guardUnsaved(() => setDrawerOpen(false));
  };
  const conflicts = useMemo(() => detectConflicts(selected, records, ci.date), [selected, records, ci.date]);
  const drafts = useMemo(() => mergeDrafts(selected, conflicts, picks), [selected, conflicts, picks]);
  const open = unresolved(conflicts, picks);
  const notes = useMemo(() => notesOfResources(selected), [selected]);
  const assessedKrs = useMemo(() => [...new Set(selected.flatMap((r) => r.assessments.map((a) => a.krId)))], [selected]);
  const merged = useMemo(() => mergeAssessments(assessHist, selected, ci, krBands), [assessHist, selected, ci]);
  const learnList = useMemo(() => selected.flatMap((r) => r.learnings.map((l, i) => ({ ...l, id: `${r.id}-${i}` }))), [selected]);
  // 他の人がいるときだけ出す（1人だけが使っている状態では、確定済みの案内は要らない）
  const confirmer = reach === "solo" ? undefined : confirmedBy[ci.id];

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useFocusTrap(ref, true);

  const resetPick = () => {
    setRead(false);
    setValues({});
    setPicks({});
  };
  const toggle = (id: string) => {
    setResIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    resetPick();
  };
  const chooseCi = (id: string) => {
    setCiId(id);
    setResIds([]);
    resetPick();
  };

  // ファイル選択も貼り付けも、この1本の経路で読ませる
  const readFiles = async (list: File[]) => {
    if (list.length === 0 || busy) return { errors: [] as string[], notices: [] as string[] };
    const target = ci;
    setErrors([]);
    setNotices([]);
    setBusy({ done: 0, total: list.length });
    const { errors: errs, notices: notes } = await readResources(list, target, (done) => setBusy({ done, total: list.length }));
    setBusy(null);
    setErrors(errs);
    setNotices(notes);
    // 新しい回に読ませたら、その回を選んだ状態にし、次の「新しい回」は別の回にする
    if (ciId === NEW_CI && errs.length < list.length) {
      setCiId(target.id);
      setNewCi({ id: newId(), date: TODAY, title: `${formatMd(TODAY)}のチェックイン` });
    }
    const ok = list.length - errs.length;
    if (ok > 0) showToast(`${ok}件の資料を読み取りました。下の一覧で選んで、下書きを確かめてください`);
    return { errors: errs, notices: notes };
  };
  const runRead = async () => {
    if (files.length === 0 || busy) return;
    await readFiles(files);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
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
      <div ref={ref} tabIndex={-1} className="mk-drawer" role="dialog" aria-modal="true" aria-labelledby="mk-drawer-h" aria-busy={busy !== null}>
        <div className="mk-row">
          <h2 id="mk-drawer-h" className="mk-h2" style={{ margin: 0 }}>
            資料を読ませる
          </h2>
          <span className="mk-spacer" />
          <button type="button" className="mk-btn mk-btn-sm" onClick={close} disabled={busy !== null}>
            閉じる
          </button>
        </div>
        <p className="mk-muted">チェックインの後に使います。資料から、AIの見立て・手がかりの数字・学び・決定事項・宿題の下書きを取り出します。直したい数字だけ直して、まとめて確定します。見立ては資料の記述だけから決まり、そのまま確定されます。誰でも操作できます。</p>
        {confirmer && (
          <div className="mk-card mk-note" role="status">
            この回（{formatMd(ci.date)} {ci.title}）は{nameOf(confirmer)}さんが確定済みです。続けて別の資料を確定すると、決定事項と宿題は資料ごとに足し合わされます。
          </div>
        )}
        {DEMO && (
          <div className="mk-card mk-note" role="note">
            モックです。実際のファイルは読み込まず、AIも呼び出しません。下の結果は固定のデータです。
          </div>
        )}

        {aiReady && (
          <>
            <h3 className="mk-h3">1. 回を選ぶ</h3>
            <fieldset className="mk-fieldset" disabled={busy !== null}>
              <legend className="mk-small">資料を読ませる回</legend>
              <label className={`mk-opt${ciId === NEW_CI ? " is-on" : ""}`}>
                <input type="radio" name="ci" checked={ciId === NEW_CI} onChange={() => chooseCi(NEW_CI)} /> 新しい回
              </label>
              {ciId === NEW_CI && (
                <div className="mk-row" style={{ margin: "4px 0 8px 22px", flexWrap: "wrap" }}>
                  <label className="mk-small">
                    日付{" "}
                    <input type="date" className="mk-input" value={newCi.date} onChange={(e) => e.target.value && setNewCi((p) => ({ ...p, date: e.target.value }))} />
                  </label>
                  <label className="mk-small">
                    名前{" "}
                    <input type="text" className="mk-input" value={newCi.title} maxLength={60} onChange={(e) => setNewCi((p) => ({ ...p, title: e.target.value }))} />
                  </label>
                </div>
              )}
              {pool.slice(0, 6).map((c) => (
                <label key={c.id} className={`mk-opt${ciId === c.id ? " is-on" : ""}`}>
                  <input type="radio" name="ci" checked={ciId === c.id} onChange={() => chooseCi(c.id)} /> {formatMd(c.date)} {c.title}
                  {openCheckins.some((o) => o.id === c.id) && <span className="mk-muted">（まだ確定していません）</span>}
                </label>
              ))}
            </fieldset>

            <h3 className="mk-h3">2. 資料を加えて、AIに読ませる</h3>
            <p className="mk-small mk-muted">
              PowerPoint・PDF・Word・議事録や文字起こしのテキスト・字幕（.vtt／.srt）を、複数選べます。文字だけを取り出して送ります（画像・旧形式は読めません）。1件ずつ読むので、件数が多いと時間がかかります。長い資料（目安：{LONG_RESOURCE_CHARS / 1000}千字を超えるもの）は、前半と後半などに分けて読ませると確実です。
            </p>
            <CopilotPromptHelp krs={krs.map((k) => ({ label: k.label, text: k.text, def: krDefs[k.id] ?? null }))} />
            <PasteReadBox readFiles={readFiles} disabled={busy !== null || (ciId === NEW_CI && !newCi.title.trim())} />
            <div className="mk-row" style={{ flexWrap: "wrap" }}>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={CONSULT_ATTACHMENT_ACCEPT}
                aria-label="読ませる資料のファイル"
                disabled={busy !== null}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <button type="button" className="mk-btn mk-btn-primary" disabled={files.length === 0 || busy !== null || (ciId === NEW_CI && !newCi.title.trim())} onClick={() => void runRead()}>
                {busy ? `読み取り中…（${busy.done}／${busy.total}）` : "読み取る"}
              </button>
            </div>
            {notices.length > 0 && (
              <div className="mk-card mk-note" role="status">
                {notices.map((n) => (
                  <div key={n} className="mk-small">
                    {n}
                  </div>
                ))}
              </div>
            )}
            {errors.length > 0 && (
              <div className="mk-card mk-note" role="alert">
                {errors.map((e) => (
                  <div key={e} className="mk-small" style={{ whiteSpace: "pre-wrap" }}>
                    {e}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {listed.length === 0 ? (
          aiReady ? (
            <p className="mk-muted">この回に読ませた資料はまだありません。上で資料を選んで「読み取る」を押してください。</p>
          ) : (
            <div className="mk-card" role="note">
              資料（PowerPoint・PDF・議事録や文字起こし）をAIに読ませる機能は、ログインして使うときに使えます。それまでは、地図と仕事のつながりをそのまま使えます。
            </div>
          )
        ) : (
          <>
            <h3 className="mk-h3">{aiReady ? "3. 読み取った資料を選ぶ（複数選べます）" : "1. 資料を選ぶ（複数選べます）"}</h3>
            <fieldset className="mk-fieldset">
              <legend className="mk-small">{DEMO ? "読ませる資料（架空の2件・どちらも同じ回のもの）" : "読ませる資料"}</legend>
              {listed.map((r) => (
                <label key={r.id} className={`mk-opt${resIds.includes(r.id) ? " is-on" : ""}`}>
                  <input type="checkbox" name="res" checked={resIds.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name} <span className="mk-muted">{r.kind}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="mk-btn mk-btn-primary" style={{ marginTop: 8 }} disabled={selected.length === 0} onClick={() => setRead(true)}>
              {DEMO ? "読み取る（模擬）" : "下書きを見る"}
            </button>
          </>
        )}

        {selected.length > 0 && read && (
          <>
            <h3 className="mk-h3">AIが読み取った下書き</h3>
            <h4 className="mk-panel-sub">AIの見立て（資料の記述だけから。60が出発点）</h4>
            {assessedKrs.length === 0 ? (
              <p className="mk-muted">この資料からは、見立てを取り出せませんでした（段の基準文がまだ無いKRは、見立てを出しません）。</p>
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
                      <span className="mk-muted">（AIの見立て・前回から {before ? moveText(a.value - before.cur.assessment.value) : "前回なし"}）</span>
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
                        const h = records[d.krId]?.hint;
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
                        <strong>{records[c.krId]?.hint ? hintText(records[c.krId].hint!, o.value) : o.value}</strong>{" "}
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

            <h3 className="mk-h3">成果の記述と、関係しそうな仕事</h3>
            <p className="mk-muted">資料の中の成果の記述と、AIが推定した関連の仕事です。ここでは読むだけで、確定しません。「まとめて確定」すると、推定された結びつきが各仕事の担当者本人に「確かめてください」として届きます。</p>
            {notes.length === 0 ? (
              <p className="mk-muted">この資料からは、成果の記述を取り出せませんでした。</p>
            ) : (
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
            )}

            <h3 className="mk-h3">決定事項と宿題の取り出し結果</h3>
            {selected.every((r) => r.decisions.length === 0) ? (
              <p className="mk-muted">この資料からは、決定事項と宿題を取り出せませんでした。</p>
            ) : (
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
            )}

            <div className="mk-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="mk-btn mk-btn-primary"
                disabled={open.length > 0 || confirming}
                onClick={async () => {
                  setConfirmError(null);
                  setConfirming(true);
                  try {
                    const found = await confirmImport(resIds, picks, values);
                    setDrawerOpen(false);
                    showToast(found.length > 0 ? `地図に反映しました。${found.map((c) => `${krLabel(c.krId)}が${c.step} の段に届きました`).join("、")}` : "地図に反映し、決定事項と宿題の欄に加えました");
                  } catch (e) {
                    // 保存に失敗したら画面は確定前のまま。消えないエラーで知らせる（Section 15）
                    setConfirmError(e instanceof Error ? e.message : formatErrorForUser("確定を保存できませんでした", e));
                  } finally {
                    setConfirming(false);
                  }
                }}
              >
                {confirming ? "保存しています…" : "まとめて確定"}
              </button>
              <span className="mk-muted">{open.length > 0 ? "食い違いのすべてで、採る値を選ぶと押せます。" : "確定すると、地図と「チームはいま、どの段にいるか」の欄が新しい見立てになります。"}</span>
            </div>
            {confirmError && (
              <div className="mk-card mk-note" role="alert" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {confirmError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

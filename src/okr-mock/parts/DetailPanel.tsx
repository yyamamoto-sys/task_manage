import { useEffect, useRef } from "react";
import { aiCandidates, howOptions, krBands, krDefs, krStyle, MINE_COLOR, PERIOD_END, PERIOD_START, pjsInit, PERSONAL_NAME, tfsInit } from "../fixtures";
import {
  formatMd,
  hintTrailsPeriod,
  howKey,
  isNotUpdated,
  krIdsOfTask,
  latestCheckinDate,
  periodElapsed,
  periodTasks,
  PERSONAL_PJ,
  sharedWork,
  sortKrIds,
  tasksDoneBetween,
  tasksOfKr,
  TODAY,
  workDigest,
} from "../logic";
import { krRegistration, workPhrase } from "../reach";
import { useMock } from "../state";
import { hasStretch, learningsOfKr, moveText, nextLine, nextRequirements, stepMove, stepsOf } from "../steps";
import { proposalKey } from "../userState";
import { TrendChart } from "./Trend";
import { panelNarrowPx } from "../nav";
import { hintText, JunctionMark, KrDot, KrDots, krLabel, krListText, krName, krText, nameOf, signed, StatusChip, StepScale, useFocusTrap, useNarrow } from "../ui";

function KrPanel({ krId }: { krId: string }) {
  const { records, checkins, decisions, linkCtx, viewerId, setSel, setModal, confirmedLinks, items, tasks, assess, learnings } = useMock();
  const r = records[krId];
  const def = krDefs[krId];
  const bands = krBands[krId];
  const ca = assess[krId];
  const color = krStyle(krId).color;
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const stale = isNotUpdated(r, latestCheckinDate(checkins));
  const krTasks = tasksOfKr(periodTasks(tasks, PERIOD_START), krId, linkCtx);
  const shared = sharedWork(periodTasks(tasks, PERIOD_START), krId, linkCtx, items.filter((i) => i.kind === "kr").map((i) => i.id));
  const done = tasksDoneBetween(tasks, viewerId, krId, r.prevAt, r.updatedAt, linkCtx);
  const related = decisions.filter((d) => d.krIds.includes(krId));
  const rounds = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1)).filter((c) => related.some((d) => d.checkinId === c.id));
  const work = workDigest(krTasks);
  const reg = krRegistration(krId, tasks, linkCtx, PERIOD_START);
  const partial = reg === "partial";
  const scopeNote = partial ? "（登録された分）" : "";
  const effective = confirmedLinks.filter((c) => c.note.krId === krId);
  const starred = new Set(effective.map((c) => c.task.id));
  const trails = hintTrailsPeriod(r.hint, elapsed);
  const groups = learningsOfKr(learnings, krId, checkins);
  const nr = ca ? nextRequirements(ca.cur.assessment, bands) : null;
  const krTfs = tfsInit.filter((t) => t.krId === krId);
  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: color }}>
        <span style={{ color }}>{krLabel(krId)}</span> {krText(krId)}
        {hasStretch(bands) && <span className="mk-stretch">背伸びの目標</span>}
      </h3>
      <p className="mk-evidence">
        <strong>Oに近づいた証拠として見るもの</strong>：{def.evidence}
      </p>
      {ca && (
        <>
          <h4 className="mk-panel-sub">いまの段（AIの見立て）</h4>
          <StepScale krId={krId} value={ca.cur.assessment.value} width={320} />
          <p>
            <strong>{ca.cur.assessment.value}</strong> <span className="mk-muted">{`AIの見立て（前回から ${moveText(stepMove(ca))}）`}</span>
          </p>
          <p className="mk-small">{ca.cur.assessment.summary}</p>
          <p className="mk-small">{nextLine(ca.cur.assessment, bands)}</p>
          {nr && nr.items.length > 0 && (
            <ul className="mk-list mk-list-tight" aria-label={`${nr.step} の要件`}>
              {nr.items.map((b) => (
                <li key={b.requirement}>
                  <span className={`mk-chip ${b.status === "確認できた" ? "mk-chip-green" : b.status === "一部" ? "mk-chip-blue" : ""}`}>{b.status}</span> {b.requirement}
                  <div className="mk-small mk-muted">{b.quote ? `資料の記述：「${b.quote}」` : "資料に記述がありません"}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <details className="mk-bandsdoc">
        <summary>段の基準を見る</summary>
        <ul className="mk-list mk-list-tight">
          {stepsOf(bands).map((st) => (
            <li key={st}>
              <strong>{st}</strong> {bands[st as 60]}
            </li>
          ))}
        </ul>
      </details>
      <dl className="mk-dl">
        {r.hint && (
          <>
            <dt>手がかりの数字</dt>
            <dd>
              {hintText(r.hint, r.hint.value)}／{hintText(r.hint, r.hint.target)}
              <span className="mk-muted">（期首 {hintText(r.hint, r.hint.start)}・{r.hint.direction === "up" ? "増やす" : "減らす"}。前回から {signed(r.hint.value - r.hint.prev, r.hint.unit)}）</span>
              {trails && <div className="mk-small mk-muted">手がかりの数字の進みは、期の経過より小さいです</div>}
            </dd>
          </>
        )}
        <dt>出典</dt>
        <dd>
          {r.updatedAt}更新 {r.source ? `${r.source.doc} ${r.source.page}` : "出典なし"}
          {stale && (
            <>
              {" "}
              <span className="mk-chip mk-chip-yellow">未更新</span>
            </>
          )}
        </dd>
      </dl>
      <h4 className="mk-panel-sub">見立ての推移（チェックインの回ごと）</h4>
      <TrendChart krId={krId} />
      <h4 className="mk-panel-sub">学び・気づき（資料から。回ごと・新しい順）</h4>
      {groups.length === 0 ? (
        <p className="mk-muted">まだありません。</p>
      ) : (
        groups.map((g) => (
          <section key={g.checkin.id} aria-label={`${g.checkin.title}の学び`}>
            <div className="mk-small mk-muted">
              {formatMd(g.checkin.date)} {g.checkin.title}
            </div>
            <ul className="mk-list mk-list-tight">
              {g.items.map((l) => (
                <li key={l.id}>
                  <span className="mk-chip">{l.kind}</span> {l.text}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {reg === "none" ? (
        <p className="mk-muted mk-noreg-line">この KR につながる仕事は、アプリに登録されていません。見立てと学びはチェックイン資料から出ています。</p>
      ) : (
        <>
          <h4 className="mk-panel-sub">見立てと仕事の対比{scopeNote}</h4>
          <div className="mk-contrast" role="group" aria-label="見立てと仕事の対比">
            <div className="mk-contrast-row">
              <span className="mk-contrast-k">見立て</span>
              <span style={{ gridColumn: "2 / 4" }}>
                {ca ? `${ca.cur.assessment.value} の段（AIの見立て）` : "見立てなし"}
                <span className="mk-muted">（{hintTextOrNone(r)}資料は {formatMd(r.updatedAt)}）</span>
              </span>
            </div>
            <div className="mk-contrast-row">
              <span className="mk-contrast-k">仕事</span>
              <span className="mk-contrast-bar is-work" aria-hidden="true">
                <i style={{ width: `${work.pct ?? 0}%` }} />
              </span>
              <span>
                {work.pct === null ? "仕事なし" : `完了 ${work.pct}％`}
                <span className="mk-muted">（{work.done}／{work.total}件 完了）</span>
              </span>
            </div>
          </div>
        </>
      )}
      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setModal("table")}>
        表で見る（全KR）
      </button>

      {krTfs.length > 0 && (
        <>
          <h4 className="mk-panel-sub">このKRのTF</h4>
          <ul className="mk-list mk-list-tight" aria-label="このKRのTF">
            {krTfs.map((tf) => (
              <li key={tf.id}>
                <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "tf", id: tf.id })}>
                  {tf.short} {tf.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="mk-panel-sub">この成果につながった仕事（全員に見えます）</h4>
      {effective.length === 0 ? (
        <p className="mk-muted">まだありません。資料を確定すると、AIが資料の記述と仕事を結びつけます。担当者本人が「そのとおり」と確かめたものだけが、ここに出ます。</p>
      ) : (
        <ul className="mk-list mk-list-tight">
          {effective.map((c) => (
            <li key={`${c.note.key}|${c.task.id}`}>
              <b aria-hidden="true">★</b> <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: c.task.id })}>{c.task.title}</button> <span className="mk-muted">{nameOf(c.task.assigneeId)}</span>
              <div className="mk-small mk-muted">
                成果の記述：{c.note.change}「{c.note.excerpt}」
              </div>
            </li>
          ))}
        </ul>
      )}

      {reg !== "none" && (
        <>
          <h4 className="mk-panel-sub">このKRにつながる仕事{scopeNote}（全員に見えます）</h4>
          <ul className="mk-list mk-list-tight">
            {krTasks.map((t) => (
              <li key={t.id}>
                <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: t.id })}>
                  {t.title}
                </button>{" "}
                <span className="mk-muted">{nameOf(t.assigneeId)}</span> <StatusChip status={t.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      {reg !== "none" && shared.length > 0 && (
        <>
          <h4 className="mk-panel-sub">
            <JunctionMark /> ほかのKRとも重なる仕事{scopeNote}（全員に見えます）
          </h4>
          {shared.map((s) => (
            <div key={s.krId} className="mk-shared">
              <div className="mk-small">
                <KrDot krId={s.krId} labeled /> {krText(s.krId)}と共有している仕事（{s.tasks.length}件）
              </div>
              <ul className="mk-list mk-list-tight">
                {s.tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: t.id })}>
                      {t.title}
                    </button>{" "}
                    <span className="mk-muted">{nameOf(t.assigneeId)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {reg !== "none" && (
        <>
          <h4 className="mk-panel-sub">この動きの間にあなたが終えた仕事</h4>
          <p className="mk-muted">
            {formatMd(r.prevAt)}の翌日から{formatMd(r.updatedAt)}までに完了した仕事です（あなたにだけ見えます）。
          </p>
          {done.length === 0 ? (
            <p className="mk-muted">該当する仕事はありません。</p>
          ) : (
            <ul className="mk-list mk-list-tight">
              {done.map((t) => (
                <li key={t.id}>
                  {starred.has(t.id) && (
                    <>
                      <b aria-label="成果につながった仕事">★</b>{" "}
                    </>
                  )}
                  {t.title} <span className="mk-muted">{formatMd(t.updated)}</span> <KrDots krIds={krIdsOfTask(t, linkCtx)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h4 className="mk-panel-sub">このKRに関わる決定事項と宿題（回ごと）</h4>
      {related.length === 0 ? (
        <p className="mk-muted">ありません。</p>
      ) : (
        rounds.map((c) => (
          <section key={c.id} aria-label={c.title}>
            <div className="mk-small mk-muted">
              {formatMd(c.date)} {c.title}
            </div>
            <ul className="mk-list mk-list-tight">
              {related
                .filter((d) => d.checkinId === c.id)
                .map((d) => (
                  <li key={d.id}>
                    <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span> {d.text}
                    {d.ownerId ? <span className="mk-muted"> 担当：{nameOf(d.ownerId)}</span> : null}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function hintTextOrNone(r: { hint?: { value: number; target: number; unit: string } }): string {
  return r.hint ? `手がかり ${r.hint.value}／${r.hint.target}${r.hint.unit}、` : "";
}

function TaskPanel({ taskId }: { taskId: string }) {
  const { linkCtx, items, overrides, setOverride, proposals, takeProposal, setProposal, how, setHow, viewerId, setSel, mode, tasks } = useMock();
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const pj = pjsInit.find((p) => p.id === t.pjId);
  const pjLabel = t.pjId === PERSONAL_PJ ? PERSONAL_NAME : pj?.name;
  const krs = krIdsOfTask(t, linkCtx);
  const cands = aiCandidates[t.pjId] ?? [];
  const mine = t.assigneeId === viewerId;
  const override = overrides[t.id];
  const effectKr = krs[0];
  const krOrder = items.filter((i) => i.kind === "kr").map((i) => i.id);
  const candIds = cands.map((c) => c.krId);
  const others = krOrder.filter((k) => !candIds.includes(k));
  const toggleKr = (k: string) => setOverride(t, sortKrIds(krs.includes(k) ? krs.filter((x) => x !== k) : [...krs, k], krOrder));
  const krCheck = (krId: string, reason?: string) => (
    <label key={krId} className={`mk-opt${krs.includes(krId) ? " is-on" : ""}`}>
      <input type="checkbox" checked={krs.includes(krId)} onChange={() => toggleKr(krId)} /> <strong>{krName(krId)}</strong>
      {reason && <span className="mk-muted"> {reason}</span>}
    </label>
  );

  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: effectKr ? krStyle(effectKr).color : "var(--color-text-tertiary)" }}>
        {t.title}
      </h3>
      <dl className="mk-dl">
        <dt>PJ</dt>
        <dd>{pjLabel}</dd>
        <dt>担当</dt>
        <dd>{nameOf(t.assigneeId)}</dd>
        <dt>状態</dt>
        <dd>
          <StatusChip status={t.status} /> 期日 {formatMd(t.due)}
        </dd>
        <dt>つなぎ先</dt>
        <dd>
          {krs.length === 0 ? (
            "つながっていません"
          ) : (
            <>
              <KrDots krIds={krs} labeled /> {krs.map((k) => krName(k)).join("、")}
            </>
          )}
        </dd>
      </dl>
      {krs.length >= 2 && (
        <p className="mk-junction-line">
          <JunctionMark /> この仕事は {krListText(krs)} の結節点です
        </p>
      )}

      {krs.length === 0 ? (
        mine && mode === "self" ? (
          <>
            <h4 className="mk-panel-sub">AIの提案</h4>
            {cands.length === 0 && <p className="mk-muted">提案はありません。</p>}
            {cands.map((c) => {
              const state = proposals[proposalKey(t.id, c.krId)];
              return (
                <div key={c.krId} className="mk-proposal">
                  <p className="mk-small">
                    つなぎ先の候補：<strong>{krName(c.krId)}</strong>
                    <br />
                    <span className="mk-muted">{c.reason}</span>
                  </p>
                  <div className="mk-row">
                    <button type="button" className="mk-btn mk-btn-sm mk-btn-primary" onClick={() => takeProposal(t, c.krId)}>
                      採る
                    </button>
                    {state === "skipped" ? (
                      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setProposal(t.id, c.krId, undefined)}>
                        見送りを取り消す
                      </button>
                    ) : (
                      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setProposal(t.id, c.krId, "skipped")}>
                        見送る
                      </button>
                    )}
                    {state === "skipped" && <span className="mk-chip">見送り済み</span>}
                  </div>
                </div>
              );
            })}
            <h4 className="mk-panel-sub">ほかのKRにつなぐ（複数選べます）</h4>
            <fieldset className="mk-fieldset">
              <legend className="mk-sr">ほかのKR</legend>
              {others.map((k) => krCheck(k))}
            </fieldset>
          </>
        ) : (
          <p className="mk-muted">この仕事はどのKRにもつながっていません。名前つきの一覧とAIの提案は、担当の本人が「わたし」のページで見るときだけ出ます。</p>
        )
      ) : mine ? (
        <>
          <h4 className="mk-panel-sub">つなぎ先を変える（複数選べます）</h4>
          <fieldset className="mk-fieldset">
            <legend className="mk-sr">つなぎ先</legend>
            {cands.length > 0 && <div className="mk-small mk-muted">AIの候補</div>}
            {cands.map((c) => krCheck(c.krId, c.reason))}
            {others.length > 0 && <div className="mk-small mk-muted">ほかのKR</div>}
            {others.map((k) => krCheck(k))}
          </fieldset>
          <div className="mk-row">
            <button type="button" className="mk-btn mk-btn-sm" disabled={override === undefined} onClick={() => setOverride(t, undefined)}>
              もとに戻す
            </button>
            <span className="mk-muted">属するPJのKRに戻ります。</span>
          </div>
          <p className="mk-muted">つなぎ先から外したKRの「どう役立つか」だけが消えます。</p>
          {krs.map((k) => (
            <div key={k}>
              <h4 className="mk-panel-sub">この仕事は{krLabel(k)}にどう役立つか（AIの案から選ぶ）</h4>
              <fieldset className="mk-fieldset">
                <legend className="mk-sr">{krLabel(k)}にどう役立つか</legend>
                {(howOptions[k] ?? []).map((h) => (
                  <label key={h} className={`mk-opt${how[howKey(t.id, k)] === h ? " is-on" : ""}`}>
                    <input type="radio" name={`how-${t.id}-${k}`} checked={how[howKey(t.id, k)] === h} onChange={() => setHow(t.id, k, h)} /> {h}
                  </label>
                ))}
                <label className={`mk-opt${how[howKey(t.id, k)] === undefined ? " is-on" : ""}`}>
                  <input type="radio" name={`how-${t.id}-${k}`} checked={how[howKey(t.id, k)] === undefined} onChange={() => setHow(t.id, k, undefined)} /> 選ばない
                </label>
              </fieldset>
            </div>
          ))}
          <p className="mk-muted">
            <span className="mk-chip" style={{ borderLeft: `6px solid ${MINE_COLOR}` }}>あなただけ</span> 選んだ内容は、期のまとめの該当のKRにだけ使います。
          </p>
        </>
      ) : (
        <p className="mk-muted">この仕事の担当は{nameOf(t.assigneeId)}さんです。つなぎ先の変更は担当者本人だけが行います。</p>
      )}
      <button type="button" className="mk-btn mk-btn-sm" style={{ marginTop: 10 }} onClick={() => setSel(effectKr ? { type: "kr", id: effectKr } : null)}>
        {effectKr ? `${krLabel(effectKr)}の詳細へ` : "閉じる"}
      </button>
    </>
  );
}

/** TFの詳細。AIの見立て（60〜の値）はKRだけのもので、TFには値を付けない */
function TfPanel({ tfId }: { tfId: string }) {
  const { tasks, linkCtx, setSel } = useMock();
  const tf = tfsInit.find((t) => t.id === tfId);
  if (!tf) return null;
  const color = krStyle(tf.krId).color;
  const pjs = pjsInit.filter((p) => p.tfId === tf.id);
  const tfTasks = tasksOfKr(periodTasks(tasks, PERIOD_START), tf.krId, linkCtx).filter((t) => pjs.some((p) => p.id === t.pjId));
  const done = tfTasks.filter((t) => t.status === "完了").length;
  const open = tfTasks.length - done;
  const people = [...new Set(tfTasks.map((t) => t.assigneeId))];
  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: color }}>
        <span style={{ color }}>{tf.short}</span> {tf.name}
      </h3>
      <dl className="mk-dl">
        <dt>属するKR</dt>
        <dd>
          <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "kr", id: tf.krId })}>
            {krName(tf.krId)}
          </button>
        </dd>
        <dt>つながるPJ</dt>
        <dd>
          {pjs.length === 0 ? (
            "まだありません"
          ) : (
            <ul className="mk-list mk-list-tight" aria-label="つながるPJ">
              {pjs.map((p) => (
                <li key={p.id}>
                  <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "pj", id: p.id })}>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </dd>
        {tfTasks.length > 0 && (
          <>
            <dt>仕事</dt>
            <dd>{workPhrase(done, open)}</dd>
            <dt>関わる人</dt>
            <dd>{people.map((id) => nameOf(id)).join("、")}</dd>
          </>
        )}
      </dl>
      {tfTasks.length === 0 && <p className="mk-muted mk-noreg-line">このTFには、仕事の登録がありません。</p>}
    </>
  );
}

/** PJの詳細（TFの詳細から開く）。仕事の一覧と、つなぎ先のTF・KR */
function PjPanel({ pjId }: { pjId: string }) {
  const { tasks, linkCtx, setSel } = useMock();
  const pj = pjsInit.find((p) => p.id === pjId);
  if (!pj) return null;
  const pjTasks = periodTasks(tasks, PERIOD_START).filter((t) => t.pjId === pj.id);
  const tf = tfsInit.find((t) => t.id === pj.tfId);
  const krs = [...new Set(pjTasks.flatMap((t) => krIdsOfTask(t, linkCtx)))];
  const done = pjTasks.filter((t) => t.status === "完了").length;
  return (
    <>
      <h3 className="mk-panel-h">{pj.name}</h3>
      <dl className="mk-dl">
        {tf && (
          <>
            <dt>TF</dt>
            <dd>
              <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "tf", id: tf.id })}>
                {tf.short} {tf.name}
              </button>
            </dd>
          </>
        )}
        <dt>つなぎ先</dt>
        <dd>{krs.length === 0 ? "つながっていません" : krs.map((k) => krName(k)).join("、")}</dd>
        {pjTasks.length > 0 && (
          <>
            <dt>仕事</dt>
            <dd>{workPhrase(done, pjTasks.length - done)}</dd>
          </>
        )}
      </dl>
      {pjTasks.length === 0 ? (
        <p className="mk-muted mk-noreg-line">このPJには、仕事の登録がありません。</p>
      ) : (
        <ul className="mk-list mk-list-tight">
          {pjTasks.map((t) => (
            <li key={t.id}>
              <button type="button" className="mk-linkbtn" onClick={() => setSel({ type: "task", id: t.id })}>
                {t.title}
              </button>{" "}
              <span className="mk-muted">{nameOf(t.assigneeId)}</span> <StatusChip status={t.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 詳細パネル。幅が広いときは地図の右、狭いときは右から出る引き出し（境目はサイドバーの幅しだい。nav.ts の panelNarrowPx と mock4.css が同じ値）。
 * 開いたらパネルへフォーカスを移す。離れた場所から開いて見えない位置にあるときはスクロールする
 */
export function DetailPanel() {
  const { sel, setSel, sidebarCollapsed } = useMock();
  const narrow = useNarrow(panelNarrowPx(sidebarCollapsed));
  const ref = useRef<HTMLElement>(null);
  const key = sel ? `${sel.type}:${sel.id}` : "";

  useEffect(() => {
    if (!sel) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && document.contains(prev)) prev.focus?.();
    };
    // 開いた・閉じたときだけ。KR↔仕事の切替では戻さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel === null]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !key) return;
    el.focus({ preventScroll: true });
    if (!narrow) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [key, narrow]);

  useFocusTrap(ref, narrow && !!sel);

  // Esc で閉じる
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [key, setSel]);

  if (narrow && !sel) return null;
  const panel = (
    <>
      {narrow && <button type="button" className="mk-panel-scrim print-hide" aria-label="詳細パネルを閉じる" tabIndex={-1} onClick={() => setSel(null)} />}
      <aside
        ref={ref}
        tabIndex={-1}
        className={`mk-card mk-panel${narrow ? " is-drawer" : ""}${sel ? "" : " is-empty"}`}
        aria-label="詳細パネル"
        role={narrow ? "dialog" : undefined}
        aria-modal={narrow ? true : undefined}
      >
        <div className="mk-row" style={{ marginBottom: 6 }}>
          <span className="mk-muted">{!sel ? "詳細" : sel.type === "kr" ? "KRの詳細" : sel.type === "tf" ? "TFの詳細" : sel.type === "pj" ? "PJの詳細" : "仕事の詳細"}</span>
          <span className="mk-spacer" />
          {sel && (
            <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSel(null)} aria-label="詳細パネルを閉じる">
              閉じる
            </button>
          )}
        </div>
        {!sel ? <EmptyPanel /> : sel.type === "kr" ? <KrPanel krId={sel.id} /> : sel.type === "tf" ? <TfPanel tfId={sel.id} /> : sel.type === "pj" ? <PjPanel pjId={sel.id} /> : <TaskPanel taskId={sel.id} />}
      </aside>
    </>
  );
  // 広い画面では列を常に確保する（選んでいなくても同じ幅）。列の高さは地図に合わせ、中身が長ければ列の中でスクロールする
  return narrow ? panel : <div className="mk-panelcol">{panel}</div>;
}

/** 何も選んでいないときの案内。押せるものを小さな図で示す */
function EmptyPanel() {
  return (
    <div className="mk-empty">
      <p className="mk-empty-lead">KR か仕事を押すと、ここに詳しい内容が出ます</p>
      <svg viewBox="0 0 280 110" className="mk-empty-fig" role="img" aria-label="押せるもの：地図の中のKRのカードと、PJの中の仕事の行">
        <rect x={6} y={8} width={120} height={36} rx={9} className="mk-fnode" stroke="#3b6fd4" strokeWidth={2} />
        <text x={14} y={30} fontSize={11} className="mk-svgtext">
          KR のカード
        </text>
        <path d="M 134 26 L 160 26" stroke="currentColor" strokeWidth={1.5} className="mk-svgtext-muted" />
        <text x={166} y={30} fontSize={11} className="mk-svgtext">
          → KR の詳細
        </text>
        <rect x={6} y={62} width={120} height={22} rx={8} className="mk-trow" />
        <circle cx={18} cy={73} r={5} fill="none" stroke="#3b6fd4" strokeWidth={1.6} />
        <text x={30} y={77} fontSize={10.5} className="mk-svgtext">
          PJ の中の仕事
        </text>
        <path d="M 134 73 L 160 73" stroke="currentColor" strokeWidth={1.5} className="mk-svgtext-muted" />
        <text x={166} y={77} fontSize={11} className="mk-svgtext">
          → 仕事の詳細
        </text>
        <text x={6} y={104} fontSize={10} className="mk-svgtext-muted">
          帯を押しても KR の詳細が開きます
        </text>
      </svg>
    </div>
  );
}

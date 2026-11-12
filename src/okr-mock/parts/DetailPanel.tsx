import { aiCandidates, howOptions, KR_COLORS, MINE_COLOR, OWNER_ID, PERIOD_END, PERIOD_START, pjsInit, tasks } from "../fixtures";
import {
  formatMd,
  isNotUpdated,
  krGap,
  krIdsOfTask,
  krMove,
  krPace,
  krProgress,
  latestCheckinDate,
  periodElapsed,
  tasksDoneBetween,
  tasksOfKr,
  TODAY,
} from "../logic";
import { useMock } from "../state";
import { KrDots, krLabel, krName, krText, nameOf, PaceBadge, signed, StatusChip, valueText } from "../ui";

function KrPanel({ krId }: { krId: string }) {
  const { records, checkins, decisions, linkCtx, isOwner, setSel, setModal } = useMock();
  const r = records[krId];
  const color = KR_COLORS[krId];
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const p = krProgress(r);
  const stale = isNotUpdated(r, latestCheckinDate(checkins));
  const unit = r.kind === "number" ? r.unit : "段";
  const krTasks = tasksOfKr(tasks, krId, linkCtx);
  const done = tasksDoneBetween(tasks, OWNER_ID, krId, r.prevAt, r.updatedAt, linkCtx);
  const related = decisions.filter((d) => d.krIds.includes(krId));
  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: color }}>
        <span style={{ color }}>{krLabel(krId)}</span> {krText(krId)}
      </h3>
      <dl className="mk-dl">
        <dt>目標</dt>
        <dd>{valueText(r, r.target)}</dd>
        <dt>現状</dt>
        <dd>
          <strong>{valueText(r, r.value)}</strong>（進み {Math.round(p * 100)}%） <PaceBadge pace={krPace(r, elapsed)} />
        </dd>
        <dt>差</dt>
        <dd>{signed(krGap(r), unit)}</dd>
        <dt>前回からの動き</dt>
        <dd>{signed(krMove(r), unit)}</dd>
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
      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setModal("table")}>
        表で見る（全KR）
      </button>

      <h4 className="mk-panel-sub">このKRにつながる仕事（全員に見えます）</h4>
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

      <h4 className="mk-panel-sub">この動きの間にあなたが終えた仕事</h4>
      {isOwner ? (
        <>
          <p className="mk-muted">
            {formatMd(r.prevAt)}の翌日から{formatMd(r.updatedAt)}までに完了した仕事です（本人だけに見えます）。
          </p>
          {done.length === 0 ? (
            <p className="mk-muted">該当する仕事はありません。</p>
          ) : (
            <ul className="mk-list mk-list-tight">
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

      <h4 className="mk-panel-sub">このKRに関わる決定事項と宿題</h4>
      {related.length === 0 ? (
        <p className="mk-muted">ありません。</p>
      ) : (
        <ul className="mk-list mk-list-tight">
          {related.map((d) => (
            <li key={d.id}>
              <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span> {d.text}
              {d.ownerId ? <span className="mk-muted"> 担当：{nameOf(d.ownerId)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TaskPanel({ taskId }: { taskId: string }) {
  const { linkCtx, overrides, setOverride, proposals, setProposal, how, setHow, isOwner, setSel } = useMock();
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const pj = pjsInit.find((p) => p.id === t.pjId);
  const krs = krIdsOfTask(t, linkCtx);
  const cands = aiCandidates[t.pjId] ?? [];
  const mineTask = isOwner && t.assigneeId === OWNER_ID;
  const override = overrides[t.id];
  const skipped = proposals[t.id] === "skipped";
  const effectKr = krs[0];

  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: effectKr ? KR_COLORS[effectKr] : "var(--color-text-tertiary)" }}>
        {t.title}
      </h3>
      <dl className="mk-dl">
        <dt>PJ</dt>
        <dd>{pj?.name}</dd>
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
              <KrDots krIds={krs} /> {krs.map((k) => krName(k)).join("、")}
            </>
          )}
        </dd>
      </dl>

      {krs.length === 0 ? (
        <>
          <h4 className="mk-panel-sub">AIの提案</h4>
          {cands[0] ? (
            <p className="mk-small">
              つなぎ先の候補：<strong>{krName(cands[0].krId)}</strong>
              <br />
              <span className="mk-muted">{cands[0].reason}</span>
            </p>
          ) : (
            <p className="mk-muted">提案はありません。</p>
          )}
          {mineTask ? (
            <div className="mk-row">
              {cands[0] && (
                <button
                  type="button"
                  className="mk-btn mk-btn-sm mk-btn-primary"
                  onClick={() => {
                    setOverride(t.id, cands[0].krId);
                    setProposal(t.id, "taken");
                  }}
                >
                  採る
                </button>
              )}
              {skipped ? (
                <button type="button" className="mk-btn mk-btn-sm" onClick={() => setProposal(t.id, undefined)}>
                  見送りを取り消す
                </button>
              ) : (
                <button type="button" className="mk-btn mk-btn-sm" onClick={() => setProposal(t.id, "skipped")}>
                  見送る
                </button>
              )}
              {skipped && <span className="mk-chip">見送り済み</span>}
            </div>
          ) : (
            <p className="mk-muted">この仕事の担当は{nameOf(t.assigneeId)}さんです。つなぎ先は担当者本人が決めます。</p>
          )}
        </>
      ) : mineTask ? (
        <>
          <h4 className="mk-panel-sub">つなぎ先を変える（AIの候補から選ぶ）</h4>
          <fieldset className="mk-fieldset">
            <legend className="mk-sr">つなぎ先</legend>
            {cands.map((c) => (
              <label key={c.krId} className={`mk-opt${override === c.krId ? " is-on" : ""}`}>
                <input type="radio" name={`link-${t.id}`} checked={override === c.krId} onChange={() => setOverride(t.id, c.krId)} /> <strong>{krName(c.krId)}</strong>
                <span className="mk-muted"> {c.reason}</span>
              </label>
            ))}
            <label className={`mk-opt${override === undefined ? " is-on" : ""}`}>
              <input type="radio" name={`link-${t.id}`} checked={override === undefined} onChange={() => setOverride(t.id, undefined)} /> もとのつなぎ（PJのKR）にする
            </label>
          </fieldset>
          <h4 className="mk-panel-sub">この仕事はどう効くか（AIの案から選ぶ）</h4>
          <fieldset className="mk-fieldset">
            <legend className="mk-sr">どう効くか</legend>
            {(howOptions[effectKr] ?? []).map((h) => (
              <label key={h} className={`mk-opt${how[t.id] === h ? " is-on" : ""}`}>
                <input type="radio" name={`how-${t.id}`} checked={how[t.id] === h} onChange={() => setHow(t.id, h)} /> {h}
              </label>
            ))}
            <label className={`mk-opt${how[t.id] === undefined ? " is-on" : ""}`}>
              <input type="radio" name={`how-${t.id}`} checked={how[t.id] === undefined} onChange={() => setHow(t.id, undefined)} /> 選ばない
            </label>
          </fieldset>
          <p className="mk-muted">
            <span className="mk-chip" style={{ borderLeft: `6px solid ${MINE_COLOR}` }}>本人のみ</span> 選んだ内容は、期のまとめにだけ使います。
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

export function DetailPanel() {
  const { sel, setSel } = useMock();
  if (!sel) return null;
  return (
    <aside className="mk-card mk-panel" aria-label="詳細パネル">
      <div className="mk-row" style={{ marginBottom: 6 }}>
        <span className="mk-muted">{sel.type === "kr" ? "KRの詳細" : "仕事の詳細"}</span>
        <span className="mk-spacer" />
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSel(null)} aria-label="詳細パネルを閉じる">
          閉じる
        </button>
      </div>
      {sel.type === "kr" ? <KrPanel krId={sel.id} /> : <TaskPanel taskId={sel.id} />}
    </aside>
  );
}

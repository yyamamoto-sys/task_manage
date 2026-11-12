import { useEffect, useRef } from "react";
import { aiCandidates, howOptions, krStyle, MINE_COLOR, PERIOD_END, PERIOD_START, pjsInit, PERSONAL_NAME, tasks } from "../fixtures";
import {
  formatMd,
  howKey,
  isNotUpdated,
  krGap,
  krIdsOfTask,
  krMove,
  krPace,
  krProgress,
  latestCheckinDate,
  periodElapsed,
  periodTasks,
  PERSONAL_PJ,
  stepsToTarget,
  tasksDoneBetween,
  tasksOfKr,
  TODAY,
} from "../logic";
import { useMock } from "../state";
import { KrDots, krLabel, krName, krText, nameOf, PaceBadge, signed, StatusChip, useFocusTrap, useNarrow, valueText } from "../ui";

function KrPanel({ krId }: { krId: string }) {
  const { records, checkins, decisions, linkCtx, viewerId, setSel, setModal } = useMock();
  const r = records[krId];
  const color = krStyle(krId).color;
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const p = krProgress(r);
  const pace = krPace(r, elapsed);
  const stale = isNotUpdated(r, latestCheckinDate(checkins));
  const unit = r.kind === "number" ? r.unit : "段";
  const krTasks = tasksOfKr(periodTasks(tasks, PERIOD_START), krId, linkCtx);
  const done = tasksDoneBetween(tasks, viewerId, krId, r.prevAt, r.updatedAt, linkCtx);
  const related = decisions.filter((d) => d.krIds.includes(krId));
  return (
    <>
      <h3 className="mk-panel-h" style={{ borderLeftColor: color }}>
        <span style={{ color }}>{krLabel(krId)}</span> {krText(krId)}
      </h3>
      <dl className="mk-dl">
        {r.kind === "number" ? (
          <>
            <dt>期首値</dt>
            <dd>
              {valueText(r, r.start)}（{r.direction === "up" ? "増やす" : "減らす"}）
            </dd>
            <dt>目標値</dt>
            <dd>{valueText(r, r.target)}</dd>
          </>
        ) : (
          <>
            <dt>目標の達成度</dt>
            <dd>
              {r.target}（仮の区分）
            </dd>
          </>
        )}
        <dt>現状</dt>
        <dd>
          <strong>{valueText(r, r.value)}</strong>
          {r.kind === "number" ? (
            <>
              （進み {Math.round(p * 100)}%） {pace && <PaceBadge pace={pace} />}
            </>
          ) : stepsToTarget(r) > 0 ? (
            <>（目標まであと{stepsToTarget(r)}段。期の経過とは比べません）</>
          ) : (
            <>（目標に届いています）</>
          )}
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
      <p className="mk-muted">
        {formatMd(r.prevAt)}の翌日から{formatMd(r.updatedAt)}までに完了した仕事です（あなたにだけ見えます）。
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
  const { linkCtx, overrides, setOverride, proposals, takeProposal, setProposal, how, setHow, viewerId, setSel, mode } = useMock();
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const pj = pjsInit.find((p) => p.id === t.pjId);
  const pjLabel = t.pjId === PERSONAL_PJ ? PERSONAL_NAME : pj?.name;
  const krs = krIdsOfTask(t, linkCtx);
  const cands = aiCandidates[t.pjId] ?? [];
  const mine = t.assigneeId === viewerId;
  const override = overrides[t.id];
  const skipped = proposals[t.id] === "skipped";
  const effectKr = krs[0];

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

      {krs.length === 0 ? (
        mine && mode === "self" ? (
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
            <div className="mk-row">
              {cands[0] && (
                <button type="button" className="mk-btn mk-btn-sm mk-btn-primary" onClick={() => takeProposal(t, cands[0].krId)}>
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
          </>
        ) : (
          <p className="mk-muted">この仕事はどのKRにもつながっていません。名前つきの一覧とAIの提案は、担当の本人が「自分」表示で見るときだけ出ます。</p>
        )
      ) : mine ? (
        <>
          <h4 className="mk-panel-sub">つなぎ先を変える（AIの候補から選ぶ）</h4>
          <fieldset className="mk-fieldset">
            <legend className="mk-sr">つなぎ先</legend>
            {cands.map((c) => (
              <label key={c.krId} className={`mk-opt${override === c.krId ? " is-on" : ""}`}>
                <input type="radio" name={`link-${t.id}`} checked={override === c.krId} onChange={() => setOverride(t, c.krId)} /> <strong>{krName(c.krId)}</strong>
                <span className="mk-muted"> {c.reason}</span>
              </label>
            ))}
            <label className={`mk-opt${override === undefined ? " is-on" : ""}`}>
              <input type="radio" name={`link-${t.id}`} checked={override === undefined} onChange={() => setOverride(t, undefined)} /> もとのつなぎにする
            </label>
          </fieldset>
          <p className="mk-muted">つなぎ先を変えると、下で選んだ「どう効くか」は消えます。</p>
          {krs.map((k) => (
            <div key={k}>
              <h4 className="mk-panel-sub">この仕事は{krLabel(k)}にどう効くか（AIの案から選ぶ）</h4>
              <fieldset className="mk-fieldset">
                <legend className="mk-sr">{krLabel(k)}にどう効くか</legend>
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

/**
 * 詳細パネル。幅が広いときは地図の右、1100px 以下では右から出る引き出し。
 * 開いたらパネルへフォーカスを移す。離れた場所から開いて見えない位置にあるときはスクロールする
 */
export function DetailPanel() {
  const { sel, setSel } = useMock();
  const narrow = useNarrow(1100);
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

  if (!sel) return null;
  return (
    <>
      {narrow && <button type="button" className="mk-panel-scrim print-hide" aria-label="詳細パネルを閉じる" tabIndex={-1} onClick={() => setSel(null)} />}
      <aside
        ref={ref}
        tabIndex={-1}
        className={`mk-card mk-panel${narrow ? " is-drawer" : ""}`}
        aria-label="詳細パネル"
        role={narrow ? "dialog" : undefined}
        aria-modal={narrow ? true : undefined}
      >
        <div className="mk-row" style={{ marginBottom: 6 }}>
          <span className="mk-muted">{sel.type === "kr" ? "KRの詳細" : "仕事の詳細"}</span>
          <span className="mk-spacer" />
          <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSel(null)} aria-label="詳細パネルを閉じる">
            閉じる
          </button>
        </div>
        {sel.type === "kr" ? <KrPanel krId={sel.id} /> : <TaskPanel taskId={sel.id} />}
      </aside>
    </>
  );
}

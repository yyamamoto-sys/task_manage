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
  outcomeWorkLine,
  sharedWork,
  sortKrIds,
  stepsToTarget,
  tasksDoneBetween,
  tasksOfKr,
  TODAY,
  workDigest,
} from "../logic";
import { useMock } from "../state";
import { proposalKey } from "../userState";
import { JunctionMark, KrDot, KrDots, krLabel, krListText, krName, krText, mdOf, nameOf, PaceBadge, signed, StatusChip, useFocusTrap, useNarrow, valueText } from "../ui";

function KrPanel({ krId }: { krId: string }) {
  const { records, checkins, decisions, linkCtx, viewerId, setSel, setModal, confirmedLinks, items } = useMock();
  const r = records[krId];
  const color = krStyle(krId).color;
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  const p = krProgress(r);
  const pace = krPace(r, elapsed);
  const stale = isNotUpdated(r, latestCheckinDate(checkins));
  const unit = r.kind === "number" ? r.unit : "段";
  const krTasks = tasksOfKr(periodTasks(tasks, PERIOD_START), krId, linkCtx);
  const shared = sharedWork(periodTasks(tasks, PERIOD_START), krId, linkCtx, items.filter((i) => i.kind === "kr").map((i) => i.id));
  const done = tasksDoneBetween(tasks, viewerId, krId, r.prevAt, r.updatedAt, linkCtx);
  const related = decisions.filter((d) => d.krIds.includes(krId));
  const work = workDigest(krTasks);
  const outcomePct = Math.round(p * 100);
  const gapLine = outcomeWorkLine(outcomePct, work);
  const effective = confirmedLinks.filter((c) => c.note.krId === krId);
  const starred = new Set(effective.map((c) => c.task.id));
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
        <dt>成果（現状）</dt>
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
      <div className="mk-contrast" role="group" aria-label="成果と仕事の対比">
        <div className="mk-contrast-row">
          <span className="mk-contrast-k">成果</span>
          <span className="mk-contrast-bar" aria-hidden="true">
            <i style={{ width: `${outcomePct}%`, background: color }} />
          </span>
          <span>
            進み {outcomePct}％<span className="mk-muted">（{r.kind === "number" ? `${r.value}／${r.target}${r.unit}` : `いま${r.value}／目標${r.target}`}、{mdOf(r.updatedAt)} の資料）</span>
          </span>
        </div>
        <div className="mk-contrast-row">
          <span className="mk-contrast-k">仕事</span>
          <span className="mk-contrast-bar is-work" aria-hidden="true">
            <i style={{ width: `${work.pct ?? 0}%` }} />
          </span>
          <span>
            {work.pct === null ? "仕事なし" : `消化 ${work.pct}％`}
            <span className="mk-muted">（{work.done}／{work.total}件 終えた）</span>
          </span>
        </div>
        {gapLine && <p className="mk-contrast-gap">{gapLine}</p>}
      </div>
      <button type="button" className="mk-btn mk-btn-sm" onClick={() => setModal("table")}>
        表で見る（全KR）
      </button>

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

      {shared.length > 0 && (
        <>
          <h4 className="mk-panel-sub">
            <JunctionMark /> ほかのKRとも重なる仕事（全員に見えます）
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
  const { linkCtx, items, overrides, setOverride, proposals, takeProposal, setProposal, how, setHow, viewerId, setSel, mode } = useMock();
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
          <p className="mk-muted">この仕事はどのKRにもつながっていません。名前つきの一覧とAIの提案は、担当の本人が「自分」表示で見るときだけ出ます。</p>
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
          <p className="mk-muted">つなぎ先から外したKRの「どう効くか」だけが消えます。</p>
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
          <span className="mk-muted">{!sel ? "詳細" : sel.type === "kr" ? "KRの詳細" : "仕事の詳細"}</span>
          <span className="mk-spacer" />
          {sel && (
            <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSel(null)} aria-label="詳細パネルを閉じる">
              閉じる
            </button>
          )}
        </div>
        {!sel ? <EmptyPanel /> : sel.type === "kr" ? <KrPanel krId={sel.id} /> : <TaskPanel taskId={sel.id} />}
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

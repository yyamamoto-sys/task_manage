import { useState } from "react";
import { krStyle, PERIOD_NAME, PERIOD_START, pastWeeks, WEEK_START } from "../fixtures";
import { addDays, answerKey, buildSummaryText, buildup, formatMd, krIdsOfTask, picksOutcome, TODAY, tasksMovedInWeek, weekKrIds, weeklyView } from "../logic";
import { useMock } from "../state";
import { effectiveEntries } from "../steps";
import type { Effect, Match } from "../types";
import { krLabel, krName, mdOf, nameOf, StatusChip } from "../ui";
import { ClaimsList } from "./Claims";

const EFFECTS: Effect[] = ["役立った", "少し役立った", "今週は役立たなかった"];
const MATCHES: Match[] = ["そのとおり", "少し違う", "違う"];

function Choice<T extends string>({ name, options, value, onChange }: { name: string; options: T[]; value?: T; onChange: (v: T) => void }) {
  return (
    <span className="mk-row">
      {options.map((o) => (
        <label key={o} className={`mk-choice${value === o ? " is-on" : ""}`}>
          <input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} /> {o}
        </label>
      ))}
    </span>
  );
}

/** 今週やると選んだ仕事が、どうなったか */
function Picks() {
  const { picks, tasks } = useMock();
  const out = picksOutcome(tasks, picks);
  return (
    <div>
      {out.total === 0 ? (
        <p className="mk-muted">まだ選んでいません。「今週ここに力を」の自分の仕事で「今週やる」を押すと、ここに出ます。</p>
      ) : (
        <>
          <p className="mk-small">
            {(["完了", "進行中", "未着手"] as const)
              .filter((k) => out.counts[k] > 0)
              .map((k) => `${k} ${out.counts[k]}件`)
              .join("／")}
          </p>
          <ul className="mk-list mk-list-tight">
            {out.rows.map(({ task, outcome }) => (
              <li key={task.id}>
                {task.title} <StatusChip status={task.status} /> <span className="mk-muted">{outcome}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Reflect() {
  const { viewerId, linkCtx, items, answers, setAnswer, tasks } = useMock();
  const [showPast, setShowPast] = useState(false);
  const krOrder = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const myKrs = weekKrIds(tasks, viewerId, WEEK_START, linkCtx, krOrder);
  const past = pastWeeks[viewerId] ?? [];
  return (
    <div>
      <p className="mk-muted">
        今週（{formatMd(WEEK_START)}〜{formatMd(addDays(WEEK_START, 6))}）に動いた仕事がつながるKRごとに、選んで答えます。文章は書きません。自分で開いたときだけ使います。
      </p>
      {myKrs.length === 0 ? (
        <p className="mk-muted">今週は動いた仕事がありません。</p>
      ) : (
        <div className="mk-reflect-grid">
          {myKrs.map((k) => {
            const a = answers[answerKey(WEEK_START, k)];
            const moved = tasksMovedInWeek(tasks, viewerId, WEEK_START).filter((t) => krIdsOfTask(t, linkCtx).includes(k));
            return (
              <section key={k} className="mk-reflect-item" style={{ borderTopColor: krStyle(k).color }} aria-label={krName(k)}>
                <strong>{krName(k)}</strong>
                <div className="mk-small" style={{ margin: "6px 0 2px" }}>
                  今週の仕事はKRに役立ったか
                </div>
                <Choice name={`eff-${k}`} options={EFFECTS} value={a?.effect} onChange={(v) => setAnswer(k, { effect: v })} />
                <div className="mk-aiview">
                  <span className="mk-chip mk-chip-blue">AIのまとめ</span> {weeklyView(moved)}
                </div>
                <Choice name={`mat-${k}`} options={MATCHES} value={a?.match} onChange={(v) => setAnswer(k, { match: v })} />
              </section>
            );
          })}
        </div>
      )}
      {past.length > 0 && (
        <button type="button" className="mk-btn mk-btn-sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
          {showPast ? "過去の週を閉じる" : "過去の週を見返す"}
        </button>
      )}
      {showPast &&
        past.map((w) => (
          <div key={w.weekStart} className="mk-table-wrap" style={{ marginTop: 10 }}>
            <strong>{formatMd(w.weekStart)}の週</strong>
            <table className="mk-table">
              <thead>
                <tr>
                  <th>KR</th>
                  <th>役立ったか</th>
                  <th>AIのまとめ</th>
                  <th>まとめへの答え</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(w.answers).map(([k, x]) => (
                  <tr key={k}>
                    <td>{krName(k)}</td>
                    <td>{x.effect}</td>
                    <td>{x.view}</td>
                    <td>{x.match}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

/** 本人の仕事のうち、成果につながったと本人が確かめたもの */
function useMyOutcomes() {
  const { confirmedLinks, viewerId } = useMock();
  return confirmedLinks.filter((c) => c.task.assigneeId === viewerId);
}

function Buildup() {
  const { items, linkCtx, viewerId, tasks } = useMock();
  const mine = useMyOutcomes();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const b = buildup(tasks, viewerId, krs, PERIOD_START, TODAY, linkCtx);
  const colW = 30;
  const H = 150;
  const top = 18;
  const bottom = 26;
  const W = b.weeks.length * colW + 20;
  const maxStack = Math.max(1, ...b.weeks.map((_, i) => krs.reduce((s, k) => s + b.cumulative[k][i], 0)));
  const unit = (H - top - bottom) / maxStack;
  return (
    <div>
      <div className="mk-row mk-small">
        {krs.map((k) => (
          <span key={k} className="mk-chip" style={{ borderLeft: `8px solid ${krStyle(k).color}` }}>
            {krName(k)}
          </span>
        ))}
      </div>
      <div className="mk-table-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="週ごとの、KRにつながる仕事の累計完了件数">
          {b.weeks.map((w, i) => {
            let y = H - bottom;
            return (
              <g key={w}>
                {krs.map((k, ki) => {
                  const n = b.cumulative[k][i];
                  const h = n * unit;
                  y -= h;
                  return h > 0 ? (
                    <rect key={k} x={10 + i * colW + 4} y={y} width={colW - 8} height={h} rx={ki === krs.length - 1 ? 4 : 1} fill={krStyle(k).color}>
                      <title>{`${formatMd(w)}の週 ${krLabel(k)}：累計${n}件`}</title>
                    </rect>
                  ) : null;
                })}
                <text x={10 + i * colW + colW / 2} y={y - 4} fontSize={10} textAnchor="middle" className="mk-svgtext">
                  {b.total[i]}
                </text>
                {i % 3 === 0 && (
                  <text x={10 + i * colW + colW / 2} y={H - 10} fontSize={10} textAnchor="middle" className="mk-svgtext-muted">
                    {w.slice(5).replace("-", "/")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <h4 className="mk-panel-sub">成果につながった仕事{mine.length > 0 ? `（${mine.length}件）` : ""}</h4>
      {mine.length === 0 ? (
        <p className="mk-muted">まだありません。「成果につながったかもしれない仕事」で「そのとおり」を選ぶと、ここに積み上がります。</p>
      ) : (
        <ul className="mk-list mk-list-tight">
          {mine.map((c) => (
            <li key={`${c.note.key}|${c.task.id}`}>
              <b aria-hidden="true">★</b> {c.task.title} <span className="mk-muted">→ {krLabel(c.note.krId)} {c.note.change}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mk-muted">週の始まり（月曜）ごとの累計です。今期（{PERIOD_START}以降）に終えた仕事だけを数えます。棒の上の数字は合計で、複数のKRにつながる仕事は、それぞれのKRに積んだうえで合計では1回に数えます。</p>
    </div>
  );
}

function Summary() {
  const { items, linkCtx, how, showToast, viewerId, tasks, answers, assessHist, learnings, checkins } = useMock();
  const mine = useMyOutcomes();
  const [text, setText] = useState<string | null>(null);
  const reflections = [
    ...(pastWeeks[viewerId] ?? []).flatMap((w) => Object.entries(w.answers).map(([k, x]) => ({ weekStart: w.weekStart, krLabel: krLabel(k), effect: x.effect as string }))),
    ...Object.entries(answers).flatMap(([key, x]) => (x.effect ? [{ weekStart: key.split("|")[0], krLabel: krLabel(key.split("|")[1]), effect: x.effect as string }] : [])),
  ].sort((p, q) => (p.weekStart < q.weekStart ? -1 : p.weekStart > q.weekStart ? 1 : 0));
  const make = () =>
    setText(
      buildSummaryText({
        period: PERIOD_NAME,
        owner: nameOf(viewerId),
        krs: items.filter((i) => i.kind === "kr"),
        tasks,
        memberId: viewerId,
        start: PERIOD_START,
        today: TODAY,
        ctx: linkCtx,
        how,
        reflections,
        trends: items
          .filter((i) => i.kind === "kr")
          .map((k) => ({ krLabel: krLabel(k.id), eff: effectiveEntries(assessHist[k.id] ?? []) }))
          .filter((t) => t.eff.length > 0)
          .map((t) => ({ krLabel: t.krLabel, text: t.eff.map((e) => `${mdOf(e.date)} ${e.assessment.value}`).join(" → ") })),
        learnings: [...learnings]
          .sort((a, b) => (checkins.find((c) => c.id === a.checkinId)?.date ?? "").localeCompare(checkins.find((c) => c.id === b.checkinId)?.date ?? ""))
          .map((l) => ({ krLabel: krLabel(l.krId), kind: l.kind, text: l.text })),
        outcomes: mine.map((c) => ({ title: c.task.title, krLabel: krLabel(c.note.krId), change: c.note.change, excerpt: c.note.excerpt })),
      }),
    );
  return (
    <div>
      <button type="button" className="mk-btn mk-btn-primary" onClick={make}>
        期のまとめを出す
      </button>
      {text && (
        <div style={{ marginTop: 10 }}>
          <pre className="mk-pre">{text}</pre>
          <button
            type="button"
            className="mk-btn mk-btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(
                () => showToast("まとめをコピーしました"),
                () => showToast("コピーできませんでした。文面を選んでコピーしてください"),
              );
            }}
          >
            コピーする
          </button>
          <span className="mk-muted"> 送信する機能はありません。コピーして、必要な相手に自分で渡します。</span>
        </div>
      )}
    </div>
  );
}

export function SelfSection() {
  const { viewerId } = useMock();
  return (
    <section className="mk-card" aria-labelledby="mk-self-h">
      <h2 id="mk-self-h" className="mk-h2 mk-h2-big">
        {nameOf(viewerId)}さんだけの振り返り
      </h2>
      <p className="mk-muted">ここは本人だけの部分です。ほかの人にも、GMにも見えません。</p>
      <h3 className="mk-h3">今週やると選んだ仕事</h3>
      <Picks />
      <ClaimsList />
      <h3 className="mk-h3">今週の振り返り</h3>
      <Reflect />
      <h3 className="mk-h3">成果につながった仕事の積み上げ</h3>
      <Buildup />
      <h3 className="mk-h3">期のまとめ</h3>
      <Summary />
    </section>
  );
}

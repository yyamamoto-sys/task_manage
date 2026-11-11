import { useState } from "react";
import { aiViews, OWNER_ID, pastWeeks, tasks } from "../fixtures";
import { addDays, formatMd, krIdsOfTask, TODAY, weekStartOf } from "../logic";
import { useMock } from "../state";
import type { Effect, Match } from "../types";
import { krName, PrivateGuard } from "../ui";

const EFFECTS: Effect[] = ["よく効いた", "少し", "効かせられなかった"];
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

function Body() {
  const { linkCtx, answers, setAnswer } = useMock();
  const [showPast, setShowPast] = useState(false);
  const ws = weekStartOf(TODAY);
  const myKrs = [...new Set(tasks.filter((t) => t.assigneeId === OWNER_ID).flatMap((t) => krIdsOfTask(t, linkCtx)))].sort();

  return (
    <div>
      <p className="mk-muted">今週（{formatMd(ws)}〜{formatMd(addDays(ws, 6))}）に関わったKRごとに、選んで答えます。文章は書きません。</p>
      {myKrs.map((k) => (
        <section key={k} className="mk-card" style={{ marginBottom: 10 }} aria-label={krName(k)}>
          <strong>{krName(k)}</strong>
          <div className="mk-small" style={{ margin: "6px 0 2px" }}>今週の効き具合</div>
          <Choice name={`eff-${k}`} options={EFFECTS} value={answers[k]?.effect} onChange={(v) => setAnswer(k, { effect: v })} />
          <div className="mk-aiview">
            <span className="mk-chip mk-chip-blue">AIの見立て</span> {aiViews[k] ?? "今週のあなたの仕事は、このKRを少し進めました。"}
          </div>
          <Choice name={`mat-${k}`} options={MATCHES} value={answers[k]?.match} onChange={(v) => setAnswer(k, { match: v })} />
        </section>
      ))}

      <h2 className="mk-h2">過去の週の回答</h2>
      <button type="button" className="mk-btn mk-btn-sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
        {showPast ? "閉じる" : "見返す"}
      </button>
      {showPast &&
        pastWeeks.map((w) => (
          <section key={w.weekStart} className="mk-card" style={{ marginTop: 10 }} aria-label={`${formatMd(w.weekStart)}の週`}>
            <strong>{formatMd(w.weekStart)}の週</strong>
            <table className="mk-table">
              <thead>
                <tr>
                  <th>KR</th>
                  <th>効き具合</th>
                  <th>AIの見立て</th>
                  <th>見立てへの答え</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(w.answers).map(([k, a]) => (
                  <tr key={k}>
                    <td>{krName(k)}</td>
                    <td>{a.effect}</td>
                    <td>{a.view}</td>
                    <td>{a.match}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
    </div>
  );
}

export function ReflectScreen() {
  return (
    <div>
      <h1 className="mk-h1">週の振り返り</h1>
      <p className="mk-lead">自分で開いたときだけ使う画面です。自動では出ません。本人だけに見えます。</p>
      <PrivateGuard>
        <Body />
      </PrivateGuard>
    </div>
  );
}

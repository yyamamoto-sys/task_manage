import { useState } from "react";
import { aiViews, KR_COLORS, OWNER_ID, PERIOD_NAME, PERIOD_START, pastWeeks, tasks } from "../fixtures";
import { addDays, buildSummaryText, buildup, formatMd, krIdsOfTask, TODAY, weekStartOf } from "../logic";
import { useMock } from "../state";
import type { Effect, Match } from "../types";
import { krLabel, krName, nameOf, PrivateGuard } from "../ui";

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

function Reflect() {
  const { linkCtx, answers, setAnswer } = useMock();
  const [showPast, setShowPast] = useState(false);
  const ws = weekStartOf(TODAY);
  const myKrs = [...new Set(tasks.filter((t) => t.assigneeId === OWNER_ID).flatMap((t) => krIdsOfTask(t, linkCtx)))].sort();
  return (
    <div>
      <p className="mk-muted">
        今週（{formatMd(ws)}〜{formatMd(addDays(ws, 6))}）に関わったKRごとに、選んで答えます。文章は書きません。自分で開いたときだけ使います。
      </p>
      <div className="mk-reflect-grid">
        {myKrs.map((k) => (
          <section key={k} className="mk-reflect-item" style={{ borderTopColor: KR_COLORS[k] }} aria-label={krName(k)}>
            <strong>{krName(k)}</strong>
            <div className="mk-small" style={{ margin: "6px 0 2px" }}>
              今週の効き具合
            </div>
            <Choice name={`eff-${k}`} options={EFFECTS} value={answers[k]?.effect} onChange={(v) => setAnswer(k, { effect: v })} />
            <div className="mk-aiview">
              <span className="mk-chip mk-chip-blue">AIの見立て</span> {aiViews[k] ?? "今週のあなたの仕事は、このKRを少し進めました。"}
            </div>
            <Choice name={`mat-${k}`} options={MATCHES} value={answers[k]?.match} onChange={(v) => setAnswer(k, { match: v })} />
          </section>
        ))}
      </div>
      <button type="button" className="mk-btn mk-btn-sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
        {showPast ? "過去の週を閉じる" : "過去の週を見返す"}
      </button>
      {showPast &&
        pastWeeks.map((w) => (
          <div key={w.weekStart} className="mk-table-wrap" style={{ marginTop: 10 }}>
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
          </div>
        ))}
    </div>
  );
}

function Buildup() {
  const { items, linkCtx } = useMock();
  const krs = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const b = buildup(tasks, OWNER_ID, krs, PERIOD_START, TODAY, linkCtx);
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
          <span key={k} className="mk-chip" style={{ borderLeft: `8px solid ${KR_COLORS[k]}` }}>
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
                    <rect key={k} x={10 + i * colW + 4} y={y} width={colW - 8} height={h} rx={ki === krs.length - 1 ? 4 : 1} fill={KR_COLORS[k]}>
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
      <p className="mk-muted">週の始まり（月曜）ごとの累計です。棒の上の数字は合計で、複数のKRにつながる仕事は、それぞれのKRに積んだうえで合計では1回に数えます。</p>
    </div>
  );
}

function Summary() {
  const { items, linkCtx, how, showToast } = useMock();
  const [text, setText] = useState<string | null>(null);
  const make = () =>
    setText(
      buildSummaryText({
        period: PERIOD_NAME,
        owner: nameOf(OWNER_ID),
        krs: items.filter((i) => i.kind === "kr"),
        tasks,
        memberId: OWNER_ID,
        start: PERIOD_START,
        today: TODAY,
        ctx: linkCtx,
        how,
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
  return (
    <section className="mk-card" aria-labelledby="mk-self-h">
      <h2 id="mk-self-h" className="mk-h2 mk-h2-big">
        あなただけの振り返り
      </h2>
      <PrivateGuard>
        <h3 className="mk-h3">今週の振り返り</h3>
        <Reflect />
        <h3 className="mk-h3">効きの積み上がり</h3>
        <Buildup />
        <h3 className="mk-h3">期のまとめ</h3>
        <Summary />
      </PrivateGuard>
    </section>
  );
}

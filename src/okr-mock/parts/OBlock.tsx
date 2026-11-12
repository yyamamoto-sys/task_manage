import { krStyle, OBJECTIVE_WHY } from "../fixtures";
import { recentLearnings } from "../steps";
import { useMock } from "../state";
import { krLabel, mdOf } from "../ui";

/** 画面の最上部。O（めざす姿）を主役に置き、その下に「なぜこのOか」を添える */
export function OBlock() {
  const { items } = useMock();
  const o = items.find((i) => i.kind === "objective");
  if (!o) return null;
  return (
    <section className="mk-card mk-oblock" aria-labelledby="mk-o-h">
      <div className="mk-oblock-k">O（めざす姿）</div>
      <h2 id="mk-o-h" className="mk-oblock-text">
        {o.text}
      </h2>
      <div className="mk-oblock-why">
        <strong>なぜこのOか</strong>
        <p>{OBJECTIVE_WHY}</p>
      </div>
      <p className="mk-small mk-muted">KRは、Oに近づいた証拠です。数字を達成するための評価基準ではありません。</p>
    </section>
  );
}

/** 最近の学び（資料から拾ったもの）。新しい順に最大3件。0件のときは枠ごと出さない */
export function RecentLearnings() {
  const { learnings, checkins } = useMock();
  const list = recentLearnings(learnings, checkins, 3);
  if (list.length === 0) return null;
  return (
    <section className="mk-card mk-learnfeed" aria-labelledby="mk-learn-h">
      <h2 id="mk-learn-h" className="mk-h3" style={{ margin: "0 0 4px" }}>
        最近の学び
      </h2>
      <ul className="mk-list mk-list-tight">
        {list.map((l) => (
          <li key={l.id}>
            <span className="mk-kdot" aria-hidden="true" style={{ background: krStyle(l.krId).color }} /> <span className="mk-chip">{l.kind}</span> {l.text}{" "}
            <span className="mk-muted">
              {krLabel(l.krId)}・{mdOf(checkinDate(l.checkinId, checkins))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function checkinDate(id: string, checkins: { id: string; date: string }[]): string {
  return checkins.find((c) => c.id === id)?.date ?? "";
}

import { useMemo } from "react";
import { PERIOD_START, WEEK_START } from "../fixtures";
import { flowCounts } from "../flow";
import { mineLine, mineLineText, summaryCards } from "../allPage";
import { answerKey, picksOutcome, weekKrIds } from "../logic";
import { useMock } from "../state";
import { krLabel } from "../ui";
import { useMyClaims } from "./Claims";

/** 「全て」のページ：あなたの分の1行（地図に出ている仕事から数える） */
export function MineLine() {
  const { tasks, linkCtx, viewerId, items } = useMock();
  const text = useMemo(() => {
    const counts = flowCounts({ tasks, ctx: linkCtx, ownerId: viewerId, scope: "team", periodStart: PERIOD_START });
    const krIds = items.filter((i) => i.kind === "kr").map((k) => k.id);
    return mineLineText(mineLine(counts, viewerId, krIds, linkCtx), krLabel);
  }, [tasks, linkCtx, viewerId, items]);
  return (
    <p className="mk-mineline" role="note">
      {text}
    </p>
  );
}

/** 「全て」のページ：わたしの要約。本人だけに関する内容。押すと「わたし」のページの該当箇所へ移る */
export function MineSummary() {
  const { picks, tasks, viewerId, linkCtx, items, answers, setMode } = useMock();
  const { pending } = useMyClaims();
  const krOrder = items.filter((i) => i.kind === "kr").map((k) => k.id);
  const myKrs = weekKrIds(tasks, viewerId, WEEK_START, linkCtx, krOrder);
  const cards = summaryCards({
    picks: picksOutcome(tasks, picks).total,
    pending,
    reflectKrs: myKrs.length,
    reflectDone: myKrs.filter((k) => answers[answerKey(WEEK_START, k)]?.effect).length,
  });
  if (cards.length === 0) return null;
  return (
    <section className="mk-card" aria-labelledby="mk-mysum-h">
      <h2 id="mk-mysum-h" className="mk-h2 mk-h2-big">
        わたしの要約<span className="mk-muted mk-small">（あなただけ）</span>
      </h2>
      <div className="mk-mysum">
        {cards.map((c) => (
          <button key={c.key} type="button" className="mk-mysum-card" aria-label={`${c.label} ${c.value}。押すと「わたし」のページへ移ります`} onClick={() => setMode("self", c.anchor)}>
            <span className="mk-small mk-muted">{c.label}</span>
            <strong>{c.value}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

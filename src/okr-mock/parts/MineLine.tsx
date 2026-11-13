import { useMemo } from "react";
import { PERIOD_START } from "../fixtures";
import { flowCounts } from "../flow";
import { mineLine, mineLineText } from "../allPage";
import { useMock } from "../state";
import { krLabel } from "../ui";

/** 流れの図を「全体」にしているときの、図の下のあなたの分の1行（地図に出ている仕事から数える） */
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

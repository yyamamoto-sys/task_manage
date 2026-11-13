import { describe, expect, it } from "vitest";
import { mineTaskIds } from "../allPage";
import { flowCounts, layoutFlow, tfInputOf, type FlowLayout, type Ribbon } from "../flow";
import { okrItems, PERIOD_START, pjsInit, REACH_PJ_IDS, tasks, WEEK_START } from "../fixtures";
import { itemsInQuarter, type LinkCtx } from "../logic";
import { registeredTasks } from "../reach";
import * as U from "../userState";

const ctx: LinkCtx = { pjs: pjsInit, items: itemsInQuarter(okrItems, "4Q"), overrides: U.mergedOverrides(U.initialUserStates(WEEK_START)) };
const krIds = ["kr1", "kr2", "kr3"];

type View = "team" | "self" | "all";
const EPS = 0.001;

function layoutOf(view: View, reach: "all" | "pjs" | "solo", maxPj?: number): FlowLayout {
  const ts = registeredTasks(tasks, reach, "m2", REACH_PJ_IDS);
  const counts = flowCounts({ tasks: ts, ctx, ownerId: "m2", scope: view === "self" ? "self" : "team", periodStart: PERIOD_START });
  return layoutFlow({
    counts,
    krIds,
    personalIds: view === "team" ? [] : ["po1"],
    expanded: [],
    showLoose: view === "self",
    maxPj,
    mineIds: view === "all" ? mineTaskIds(counts, "m2") : undefined,
    tf: tfInputOf(ctx, view !== "self"),
  });
}

const frame = (l: FlowLayout, id: string): { x: number; y: number; w: number; h: number } => {
  const f = l.pjNodes.find((n) => n.pjId === id) ?? l.tfNodes.find((n) => n.tfId === id) ?? l.krNodes.find((n) => n.krId === id);
  if (!f) throw new Error(`枠が無い: ${id}`);
  return f;
};

/** 1本の帯が、出どころの枠の右端から行き先の枠の左端まで、枠の内側の高さで、同じ太さでつながっているか */
function checkRibbon(l: FlowLayout, r: Ribbon, label: string) {
  const from = frame(l, r.fromId);
  const to = frame(l, r.toId);
  expect(r.sx, `${label} 始点x`).toBeCloseTo(from.x + from.w, 5);
  expect(r.tx, `${label} 終点x`).toBeCloseTo(to.x, 5);
  expect(r.sy, `${label} 始点y(上)`).toBeGreaterThanOrEqual(from.y - EPS);
  expect(r.sy + r.width, `${label} 始点y(下)`).toBeLessThanOrEqual(from.y + from.h + EPS);
  expect(r.ty, `${label} 終点y(上)`).toBeGreaterThanOrEqual(to.y - EPS);
  expect(r.ty + r.width, `${label} 終点y(下)`).toBeLessThanOrEqual(to.y + to.h + EPS);
  expect(r.width, `${label} 太さ`).toBeGreaterThan(0);
  if (r.segments.length) expect(r.segments.reduce((s, x) => s + x.thickness, 0), `${label} 区切りの合計`).toBeCloseTo(r.width, 5);
  if (r.mineSegs) expect(r.mineSegs.reduce((s, x) => s + x.thickness, 0), `${label} 濃淡の合計`).toBeCloseTo(r.width, 5);
}

describe("帯の幾何：どの表示でも、帯は枠から枠まで途切れずにつながる", () => {
  const views: View[] = ["team", "self", "all"];
  const reaches = ["all", "pjs", "solo"] as const;
  for (const view of views) {
    for (const reach of reaches) {
      for (const maxPj of [undefined, 3]) {
        it(`${view}／利用の広がり ${reach}／PJ上限 ${maxPj ?? "既定"}`, () => {
          const l = layoutOf(view, reach, maxPj);
          expect(l.tfKr.length).toBeGreaterThan(0);
          for (const r of l.pjTf) checkRibbon(l, r, `PJ→TF ${r.id}`);
          for (const r of l.tfKr) checkRibbon(l, r, `TF→KR ${r.id}`);
          for (const tn of l.tfNodes) {
            const inSum = l.pjTf.filter((r) => r.toId === tn.tfId).reduce((s, r) => s + r.width, 0);
            const outSum = l.tfKr.filter((r) => r.fromId === tn.tfId).reduce((s, r) => s + r.width, 0);
            expect(inSum, `${tn.tfId} 入る＝出る`).toBeCloseTo(outSum, 5);
          }
        });
      }
    }
  }
});

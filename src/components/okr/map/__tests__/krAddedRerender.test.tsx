// 地図を開いたまま KR の顔ぶれが変わっても、その直後の描画で例外にならない（v3.219）。
// 本番では MockProvider の状態（krDefs・records）は初回の値のままで、新しい KR は読み直し後の loaded にだけある。
import "../../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import App from "../App";
import { buildOkrMapCore } from "../adapter";
import type { OkrMapData } from "../dataset";
import { fillRecords, emptyRecords } from "../repository";
import { hasStretch, maxStep, stepsOf } from "../steps";
import { source } from "./prodSource";

const dataOf = (withK3: boolean): OkrMapData => {
  const src = source();
  if (withK3) {
    src.keyResults = [...src.keyResults, { id: "k3", objective_id: "o1", title: "新しいKR", is_deleted: false }];
    src.taskForces = [...src.taskForces, { id: "tf3-4q", kr_id: "k3", tf_number: "1", quarter: "4Q", name: "新しいTF", leader_member_id: null, is_deleted: false }];
  }
  const core = buildOkrMapCore(src);
  const krIds = core.items.filter((i) => i.kind === "kr").map((i) => i.id);
  const rec = fillRecords(emptyRecords(krIds.filter((k) => k !== "k3")), krIds);
  return { ...core, ...rec, nextCheckin: { id: "next", date: src.today, title: "次の回" }, recordsGen: withK3 ? 1 : 0 };
};

describe("KR が増えた直後の再描画", () => {
  it("2本で描いたあと3本のデータで描き直しても落ちない（新しい KR の段・記録が undefined にならない）", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(createElement(App, { data: dataOf(false) })));
    expect(() => act(() => root.render(createElement(App, { data: dataOf(true) })))).not.toThrow();
    act(() => root.unmount());
  });
  it("段の定めが無い（undefined）KR でも steps の部品は落ちない", () => {
    expect(stepsOf(undefined)).toEqual([60, 70, 80]);
    expect(maxStep(undefined)).toBe(80);
    expect(hasStretch(undefined)).toBe(false);
  });
});

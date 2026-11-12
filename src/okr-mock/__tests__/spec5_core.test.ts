import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mergeDecisions } from "../confirm";
import { checkinsInit, decisionsInit, nextCheckin, recordsInit, resources, tasks } from "../fixtures";
import { krProgress } from "../logic";
import type { NumberRecord } from "../types";

describe("(a) 同じ回の資料を複数確定しても決定事項と宿題は足し合わされる", () => {
  it("deck と minutes を続けて確定すると、両方の決定事項が残る", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const minutes = resources.find((r) => r.id === "minutes")!;
    const once = mergeDecisions(decisionsInit, [deck], nextCheckin);
    const twice = mergeDecisions(once, [minutes], nextCheckin);
    const ofCheckin = twice.filter((d) => d.checkinId === nextCheckin.id);
    expect(ofCheckin).toHaveLength(deck.decisions.length + minutes.decisions.length);
    expect(ofCheckin.map((d) => d.text)).toContain(deck.decisions[0].text);
    expect(ofCheckin.map((d) => d.text)).toContain(minutes.decisions[0].text);
    expect(new Set(ofCheckin.map((d) => d.id)).size).toBe(ofCheckin.length);
    expect(twice.filter((d) => d.checkinId !== nextCheckin.id)).toHaveLength(decisionsInit.length);
    expect(checkinsInit.length).toBeGreaterThan(0);
  });
});

describe("(b) 鈴木以外に切り替えても自分の仕事のつなぎ先を変えられる", () => {
  it("高橋さんが自分の仕事の詳細を開くと、つなぎ先を変える欄が出る", () => {
    const mine = tasks.find((t) => t.assigneeId === "m3" && t.pjId === "p1" && t.status !== "完了")!;
    const h = renderToStaticMarkup(createElement(App, { initial: { viewerId: "m3", sel: { type: "task", id: mine.id } } }));
    expect(h).toContain("つなぎ先を変える");
    const other = tasks.find((t) => t.assigneeId === "m2" && t.pjId === "p1" && t.status !== "完了")!;
    const h2 = renderToStaticMarkup(createElement(App, { initial: { viewerId: "m3", sel: { type: "task", id: other.id } } }));
    expect(h2).not.toContain("つなぎ先を変える");
  });
});

describe("(c) 期首値つきの進み", () => {
  it("期首65・現状71・目標値80 → 0.4", () => {
    const r = { ...(recordsInit.kr2 as NumberRecord), start: 65, direction: "up" as const, value: 71, target: 80 };
    expect(krProgress(r)).toBeCloseTo(0.4, 5);
  });
});

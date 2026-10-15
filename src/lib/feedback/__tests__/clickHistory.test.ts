// src/lib/feedback/__tests__/clickHistory.test.ts
//
// v3.157：クリック履歴（直近5件・種類と位置だけ）。DOM が無い node 環境なので、closest/getAttribute だけを持つ擬似要素で検査する。
//  ① 記録するのは タグ名・role・data-tour-id・座標・時刻だけ（文字・属性値は読まない）
//  ② data-feedback-ui（ベル・モーダル）の内側は記録しない
//  ③ 5件まで／キーボード操作は座標なし／プログラムのクリックは無視／止めたらリスナーを解除する

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClickRecorder, describeClickTarget, getRecentClicks, resetClickHistory, startClickHistory, type ClickRecord,
} from "../clickHistory";

interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  parent: FakeEl | null;
  getAttribute(name: string): string | null;
  closest(selector: string): FakeEl | null;
}

function el(tag: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null): FakeEl {
  const node: FakeEl = {
    tagName: tag.toUpperCase(), attrs, parent,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    closest(selector) {
      const parts = selector.split(",").map(s => s.trim());
      const matches = (n: FakeEl) => parts.some(p => (p.startsWith("[") ? p.slice(1, -1) in n.attrs : n.tagName.toLowerCase() === p));
      for (let cur: FakeEl | null = node; cur; cur = cur.parent) if (matches(cur)) return cur;
      return null;
    },
  };
  return node;
}

beforeEach(() => resetClickHistory());

describe("describeClickTarget", () => {
  it("最も近い意味のある要素の種類と、領域の目印（data-tour-id）を返す", () => {
    const region = el("div", { "data-tour-id": "okr-week-cards" });
    const row = el("tr", {}, region);
    const btn = el("button", { role: "tab" }, row);
    const inner = el("span", {}, btn);
    expect(describeClickTarget(inner)).toEqual({ tag: "button", role: "tab", tour: "okr-week-cards" });
    expect(describeClickTarget(row)).toEqual({ tag: "tr", role: null, tour: "okr-week-cards" });
  });

  it("🔴 要素の文字・aria-label・入力値は読まない（結果にそれらのキーが無い）", () => {
    const btn = el("button", { "aria-label": "顧客Aに電話", title: "秘密のタスク名", value: "pw", role: "button" });
    const d = describeClickTarget(btn);
    expect(d).toEqual({ tag: "button", role: "button", tour: null });
    expect(JSON.stringify(d)).not.toMatch(/顧客|秘密|pw/);
  });

  it("role・data-tour-id が形式に合わなければ null にする（文字列を通さない）", () => {
    const btn = el("button", { role: "x y;drop", "data-tour-id": "日本語の目印" });
    expect(describeClickTarget(btn)).toEqual({ tag: "button", role: null, tour: null });
  });

  it("🔴 data-feedback-ui（ベル・モーダル）の内側は記録しない", () => {
    const panel = el("div", { "data-feedback-ui": "" });
    const btn = el("button", {}, panel);
    expect(describeClickTarget(btn)).toBeNull();
    expect(describeClickTarget(panel)).toBeNull();
  });

  it("要素でないもの（テキストノード等）は null", () => {
    expect(describeClickTarget(null)).toBeNull();
    expect(describeClickTarget({})).toBeNull();
  });
});

describe("createClickRecorder", () => {
  const rec = (n: number): ClickRecord => ({ tag: "button", role: null, tour: null, at: n, x: n, y: n, vw: 100, vh: 100 });
  it("直近 max 件だけ（古い順）。返す配列を書き換えても内部に影響しない", () => {
    const r = createClickRecorder(5);
    for (let i = 1; i <= 7; i++) r.push(rec(i));
    expect(r.recent().map(c => c.at)).toEqual([3, 4, 5, 6, 7]);
    const copy = r.recent();
    copy[0].at = 999;
    expect(r.recent()[0].at).toBe(3);
    r.clear();
    expect(r.recent()).toEqual([]);
  });
});

describe("startClickHistory", () => {
  function fakeWindow() {
    const handlers = new Map<string, { fn: (e: Event) => void; capture: unknown }>();
    return {
      handlers,
      addEventListener: vi.fn((type: string, fn: (e: Event) => void, capture?: unknown) => { handlers.set(type, { fn, capture }); }),
      removeEventListener: vi.fn((type: string, fn: (e: Event) => void) => { if (handlers.get(type)?.fn === fn) handlers.delete(type); }),
    };
  }
  const ev = (target: unknown, over: Record<string, unknown> = {}) => ({ target, clientX: 100.4, clientY: 200.6, detail: 1, isTrusted: true, ...over }) as unknown as Event;

  it("capture フェーズの click だけを購読し、座標とビューポートを記録する（丸め）", () => {
    const w = fakeWindow();
    startClickHistory({ target: w as never, now: () => 5000, viewport: () => ({ w: 1280, h: 720 }) });
    expect(w.addEventListener).toHaveBeenCalledTimes(1);
    expect(w.handlers.get("click")?.capture).toBe(true);
    w.handlers.get("click")?.fn(ev(el("button")));
    expect(getRecentClicks()).toEqual([{ tag: "button", role: null, tour: null, at: 5000, x: 100, y: 201, vw: 1280, vh: 720 }]);
  });

  it("キーボード操作のクリック（detail=0）は座標なし／プログラムのクリックは記録しない／ベル・モーダル内は記録しない", () => {
    const w = fakeWindow();
    startClickHistory({ target: w as never, now: () => 1, viewport: () => ({ w: 10, h: 10 }) });
    const fn = w.handlers.get("click")!.fn;
    fn(ev(el("button"), { detail: 0 }));
    fn(ev(el("button"), { isTrusted: false }));
    fn(ev(el("button", {}, el("div", { "data-feedback-ui": "" }))));
    const clicks = getRecentClicks();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].x).toBeNull();
    expect(clicks[0].y).toBeNull();
  });

  it("止めるとリスナーを解除する。開始時に履歴を空にする", () => {
    const w = fakeWindow();
    const stop = startClickHistory({ target: w as never, now: () => 1, viewport: () => ({ w: 10, h: 10 }) });
    w.handlers.get("click")!.fn(ev(el("a")));
    expect(getRecentClicks()).toHaveLength(1);
    stop();
    expect(w.handlers.has("click")).toBe(false);
    const w2 = fakeWindow();
    startClickHistory({ target: w2 as never, now: () => 1, viewport: () => ({ w: 10, h: 10 }) });
    expect(getRecentClicks()).toEqual([]);
  });
});

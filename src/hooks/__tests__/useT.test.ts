// src/hooks/__tests__/useT.test.ts
//
// 🔴 v3.135（CLAUDE.md Section 69）：useT の戻り値は再描画で同じ関数のまま、言語を切り替えたときだけ変わる。
// 描画ごとに別の関数だった v3.134 までは、これを依存に持つ取得の effect が止まらなくなった（v3.133 のベル）。

import "../../__tests__/miniDom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useT } from "../useT";
import { useLangStore } from "../../stores/langStore";

function renderHook<R>(hook: () => R) {
  const results: R[] = [];
  let bump: () => void = () => {};
  function Probe() {
    const [, setN] = useState(0);
    bump = () => setN(n => n + 1);
    results.push(hook());
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Probe)));
  return {
    results,
    rerender: () => act(() => bump()),
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => { useLangStore.setState({ lang: "ja" }); });

describe("useT の参照の安定性", () => {
  it("再描画しても同じ関数を返す", () => {
    const h = renderHook(() => useT());
    h.rerender();
    h.rerender();
    expect(h.results.length).toBeGreaterThanOrEqual(3);
    expect(h.results[1]).toBe(h.results[0]);
    expect(h.results[h.results.length - 1]).toBe(h.results[0]);
    h.unmount();
  });

  it("言語を切り替えたときだけ別の関数になる", () => {
    const h = renderHook(() => useT());
    const before = h.results[h.results.length - 1];
    act(() => { useLangStore.setState({ lang: "en" }); });
    const after = h.results[h.results.length - 1];
    expect(after).not.toBe(before);
    h.rerender();
    expect(h.results[h.results.length - 1]).toBe(after);
    h.unmount();
  });
});

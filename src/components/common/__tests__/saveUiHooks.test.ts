// src/components/common/__tests__/saveUiHooks.test.ts
//
// v3.155：保存の見せ方の共通フック（saveUi.tsx）。実際に描画して挙動を確かめる（最小 DOM は miniDom）。
//  - useSnapshotDirty：key が変わった最初の値を基準にし、以後の差分を dirty とする
//  - useFormSave：二重実行を止め、成功は true＋トースト、失敗は false＋エラー文を保持（入力は呼び出し側が保持）

import "../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useFormSave, useSnapshotDirty } from "../saveUi";

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

function mount(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
}

describe("useSnapshotDirty", () => {
  const seen: boolean[] = [];
  function Probe({ value, k }: { value: { a: string }; k: string | null }) {
    seen.push(useSnapshotDirty(value, k));
    return null;
  }
  const last = () => seen[seen.length - 1];

  it("開いた時点の値が基準：同じ値は未変更、変えたら dirty、元に戻せば未変更に戻る", () => {
    seen.length = 0;
    mount(createElement(Probe, { value: { a: "x" }, k: "id1" }));
    expect(last()).toBe(false);
    act(() => root!.render(createElement(Probe, { value: { a: "y" }, k: "id1" })));
    expect(last()).toBe(true);
    act(() => root!.render(createElement(Probe, { value: { a: "x" }, k: "id1" })));
    expect(last()).toBe(false);
  });

  it("key（編集対象）が変わったら、その最初の値を新しい基準にする", () => {
    seen.length = 0;
    mount(createElement(Probe, { value: { a: "x" }, k: "id1" }));
    act(() => root!.render(createElement(Probe, { value: { a: "z" }, k: "id2" })));
    expect(last()).toBe(false);
    act(() => root!.render(createElement(Probe, { value: { a: "z2" }, k: "id2" })));
    expect(last()).toBe(true);
  });
});

describe("useFormSave", () => {
  type Api = ReturnType<typeof useFormSave>;
  let api: Api;
  function Probe() {
    api = useFormSave();
    return null;
  }

  it("成功したら true を返し、エラー文は空のまま", async () => {
    mount(createElement(Probe));
    let ok = false;
    await act(async () => { ok = await api.run(async () => {}, "保存に失敗しました"); });
    expect(ok).toBe(true);
    expect(api.error).toBe("");
    expect(api.saving).toBe(false);
  });

  it("失敗したら false を返し、エラー文（ラベル付き）を保持する。次の保存の開始でクリアされる", async () => {
    mount(createElement(Probe));
    let ok = true;
    await act(async () => { ok = await api.run(async () => { throw new Error("boom"); }, "保存に失敗しました"); });
    expect(ok).toBe(false);
    expect(api.error).toContain("保存に失敗しました");
    expect(api.error).toContain("boom");
    await act(async () => { await api.run(async () => {}, "保存に失敗しました"); });
    expect(api.error).toBe("");
  });

  it("保存中の二重実行は2回目を実行しない", async () => {
    mount(createElement(Probe));
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let first: Promise<boolean> = Promise.resolve(false);
    act(() => { first = api.run(async () => { calls++; await gate; }, "x"); });
    let second = true;
    await act(async () => { second = await api.run(async () => { calls++; }, "x"); });
    expect(second).toBe(false);
    await act(async () => { release(); await first; });
    expect(calls).toBe(1);
  });
});

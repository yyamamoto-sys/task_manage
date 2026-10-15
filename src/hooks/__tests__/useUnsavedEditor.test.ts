// src/hooks/__tests__/useUnsavedEditor.test.ts
//
// v3.155：useUnsavedEditor の登録・解除の対称性。
// 設定画面の編集フォーム（プロフィール・パスワード・AdminView のルート）が使うフックで、
// dirty の間だけレジストリ（Section 46）が「未保存あり」を返し、アンマウントで必ず解除される。
// 解除漏れがあると画面を離れた後も確認ダイアログが出続ける（誤検知）。

import "../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useUnsavedEditor } from "../useUnsavedEditor";
import {
  _resetUnsavedEditorRegistryForTest, _unsavedEditorRegistrySizeForTest, hasUnsavedEditors,
} from "../../lib/editing/unsavedEditorRegistry";

function Probe({ dirty }: { dirty: boolean }) {
  useUnsavedEditor(dirty);
  return null;
}

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  _resetUnsavedEditorRegistryForTest();
});

function mount(dirty: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Probe, { dirty })));
}
const rerender = (dirty: boolean) => act(() => root!.render(createElement(Probe, { dirty })));

describe("useUnsavedEditor", () => {
  it("マウントで登録され、isDirty の変化が（再登録なしで）そのまま反映される", () => {
    mount(false);
    expect(_unsavedEditorRegistrySizeForTest()).toBe(1);
    expect(hasUnsavedEditors()).toBe(false);
    rerender(true);
    expect(_unsavedEditorRegistrySizeForTest()).toBe(1);
    expect(hasUnsavedEditors()).toBe(true);
    rerender(false);
    expect(hasUnsavedEditors()).toBe(false);
  });

  it("アンマウントで必ず解除される（dirty のまま離れても残らない）", () => {
    mount(true);
    expect(hasUnsavedEditors()).toBe(true);
    act(() => root!.unmount());
    root = null;
    expect(_unsavedEditorRegistrySizeForTest()).toBe(0);
    expect(hasUnsavedEditors()).toBe(false);
  });
});

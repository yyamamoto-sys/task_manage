// src/hooks/__tests__/useConfirmClose.test.ts
//
// v3.169（M53）：dirty のときだけ確認を挟み、dirty でなければ確認なしで閉じる。
// 「開いた直後に誤って確認が出ない」ことと、「確認で断ったら閉じない」ことを検査する。

import "../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmMock = vi.fn<(m: string, o?: unknown) => Promise<boolean>>();
vi.mock("../../lib/dialog", () => ({ confirmDialog: (m: string, o?: unknown) => confirmMock(m, o) }));

import { useConfirmClose } from "../useConfirmClose";
import { _resetUnsavedEditorRegistryForTest, hasUnsavedEditors } from "../../lib/editing/unsavedEditorRegistry";

let requestClose: (() => Promise<void>) | null = null;
function Probe({ dirty, busy, onClose }: { dirty: boolean; busy?: boolean; onClose: () => void }) {
  requestClose = useConfirmClose({ dirty, busy, message: "msg", onClose });
  return null;
}

let root: Root | null = null;
function mount(props: { dirty: boolean; busy?: boolean; onClose: () => void }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Probe, props)));
}

beforeEach(() => confirmMock.mockReset());
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  _resetUnsavedEditorRegistryForTest();
});

describe("useConfirmClose", () => {
  it("dirty でなければ確認なしで閉じ、レジストリにも未保存として載らない", async () => {
    const onClose = vi.fn();
    mount({ dirty: false, onClose });
    expect(hasUnsavedEditors()).toBe(false);
    await act(async () => { await requestClose!(); });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dirty なら danger の確認を挟み、OK で閉じる・キャンセルなら閉じない", async () => {
    const onClose = vi.fn();
    mount({ dirty: true, onClose });
    expect(hasUnsavedEditors()).toBe(true);
    confirmMock.mockResolvedValueOnce(false);
    await act(async () => { await requestClose!(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmMock.mock.calls[0][1]).toMatchObject({ tone: "danger" });
    confirmMock.mockResolvedValueOnce(true);
    await act(async () => { await requestClose!(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy（保存中）の間は閉じる操作を無視する", async () => {
    const onClose = vi.fn();
    mount({ dirty: true, busy: true, onClose });
    await act(async () => { await requestClose!(); });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

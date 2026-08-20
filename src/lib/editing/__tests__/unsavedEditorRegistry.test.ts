// src/lib/editing/__tests__/unsavedEditorRegistry.test.ts
//
// 【設計意図】
// registerUnsavedEditor/unregisterUnsavedEditorの対称性（登録した分だけ確実に解除できる。
// 解除漏れが「編集していないのに毎回警告が出る」不具合の原因になるため、ここを最優先で
// 固定する）と、hasUnsavedEditors/confirmDiscardUnsavedEditsの判定ロジックを検証する。
//
// confirmDialog自体はConfirmModal未登録時にwindow.confirm()へフォールバックするが、
// vitest.config.tsのtest環境は"node"（windowが存在しない）のため、実際にダイアログへ
// 到達するケースはvi.mockで差し替えて検証する（hasUnsavedEditors()===falseの経路は
// window に触れないため素の関数のまま検証できる）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerUnsavedEditor,
  unregisterUnsavedEditor,
  hasUnsavedEditors,
  confirmDiscardUnsavedEdits,
  _resetUnsavedEditorRegistryForTest,
  _unsavedEditorRegistrySizeForTest,
} from "../unsavedEditorRegistry";

vi.mock("../../dialog", () => ({
  confirmDialog: vi.fn(),
}));

describe("unsavedEditorRegistry", () => {
  beforeEach(() => {
    _resetUnsavedEditorRegistryForTest();
    vi.clearAllMocks();
  });

  it("初期状態では未保存の編集は無い", () => {
    expect(hasUnsavedEditors()).toBe(false);
    expect(_unsavedEditorRegistrySizeForTest()).toBe(0);
  });

  it("登録したeditorのgetterがfalseならhasUnsavedEditorsもfalse", () => {
    registerUnsavedEditor("editor-1", () => false);
    expect(hasUnsavedEditors()).toBe(false);
  });

  it("登録したeditorのgetterがtrueならhasUnsavedEditorsもtrue", () => {
    registerUnsavedEditor("editor-1", () => true);
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("複数登録のうち1つでもdirtyならtrue（1つの編集画面が汚れているだけで検知できる）", () => {
    registerUnsavedEditor("editor-1", () => false);
    registerUnsavedEditor("editor-2", () => true);
    registerUnsavedEditor("editor-3", () => false);
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("【登録/解除の対称性】unregisterすると、そのeditorはhasUnsavedEditorsの判定から外れる（解除漏れ防止の核心）", () => {
    registerUnsavedEditor("editor-1", () => true);
    expect(hasUnsavedEditors()).toBe(true);
    unregisterUnsavedEditor("editor-1");
    expect(hasUnsavedEditors()).toBe(false);
    expect(_unsavedEditorRegistrySizeForTest()).toBe(0);
  });

  it("【登録/解除の対称性】register→unregisterを繰り返しても件数が増え続けない（同一idの重複登録・解除漏れが無いことの確認）", () => {
    for (let i = 0; i < 5; i++) {
      registerUnsavedEditor("editor-1", () => true);
      unregisterUnsavedEditor("editor-1");
    }
    expect(_unsavedEditorRegistrySizeForTest()).toBe(0);
    expect(hasUnsavedEditors()).toBe(false);
  });

  it("同じidで再登録すると上書きされる（別インスタンスとして二重に残らない）", () => {
    registerUnsavedEditor("editor-1", () => true);
    registerUnsavedEditor("editor-1", () => false);
    expect(_unsavedEditorRegistrySizeForTest()).toBe(1);
    expect(hasUnsavedEditors()).toBe(false);
  });

  it("未登録のidをunregisterしても例外を投げない（何も無い状態からの解除は安全）", () => {
    expect(() => unregisterUnsavedEditor("does-not-exist")).not.toThrow();
    expect(_unsavedEditorRegistrySizeForTest()).toBe(0);
  });

  it("getterは呼び出し時に評価される（pull型。値の更新し忘れが起きない設計の確認）", () => {
    let dirty = false;
    registerUnsavedEditor("editor-1", () => dirty);
    expect(hasUnsavedEditors()).toBe(false);
    dirty = true; // registryへの再登録なしに、参照先の値だけを変える
    expect(hasUnsavedEditors()).toBe(true);
  });

  it("confirmDiscardUnsavedEdits：未保存の編集が無ければconfirmDialogを呼ばずtrueを返す", async () => {
    const { confirmDialog } = await import("../../dialog");
    const result = await confirmDiscardUnsavedEdits();
    expect(result).toBe(true);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it("confirmDiscardUnsavedEdits：未保存の編集があればconfirmDialogを呼び、その戻り値をそのまま返す", async () => {
    const { confirmDialog } = await import("../../dialog");
    vi.mocked(confirmDialog).mockResolvedValueOnce(true);
    registerUnsavedEditor("editor-1", () => true);

    const result = await confirmDiscardUnsavedEdits();

    expect(result).toBe(true);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    const [, opts] = vi.mocked(confirmDialog).mock.calls[0];
    // 安全側のデフォルト：背景クリック（cancel）が「このまま編集を続ける」＝切り替えない側になること
    expect(opts).toMatchObject({
      tone: "danger",
      confirmLabel: "破棄して切り替える",
      cancelLabel: "このまま編集を続ける",
    });
  });

  it("confirmDiscardUnsavedEdits：ユーザーが「このまま編集を続ける」を選んだらfalseを返す", async () => {
    const { confirmDialog } = await import("../../dialog");
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    registerUnsavedEditor("editor-1", () => true);

    const result = await confirmDiscardUnsavedEdits();

    expect(result).toBe(false);
  });
});

// src/components/common/__tests__/saveUi.test.ts
//
// v3.155：保存の見せ方の共通部品（設計仕様 §3）の純粋な判断部分。
//  - 保存ボタンの3状態（未変更＝保存済み／変更あり＝保存／保存中）と追加フォームの扱い
//  - Enter／Ctrl(Cmd)+Enter で保存してよいキー操作（IME 変換確定の Enter は無視・Section 44）

import { describe, expect, it } from "vitest";
import { resolveSaveButtonState, shouldSaveOnKey, type SaveKeyInfo } from "../saveUi";

describe("resolveSaveButtonState（保存ボタンの3状態）", () => {
  it("編集フォーム：未変更は saved、変更ありは ready、保存中は saving", () => {
    expect(resolveSaveButtonState({ dirty: false })).toBe("saved");
    expect(resolveSaveButtonState({ dirty: true })).toBe("ready");
    expect(resolveSaveButtonState({ dirty: true, saving: true })).toBe("saving");
    expect(resolveSaveButtonState({ dirty: false, saving: true })).toBe("saving");
  });

  it("追加フォーム：未入力でも『保存済み』にはならない（ready。押せるかは dirty＝入力が揃ったかで決まる）", () => {
    expect(resolveSaveButtonState({ mode: "add", dirty: false })).toBe("ready");
    expect(resolveSaveButtonState({ mode: "add", dirty: true })).toBe("ready");
    expect(resolveSaveButtonState({ mode: "add", dirty: true, saving: true })).toBe("saving");
  });
});

function key(over: Partial<SaveKeyInfo>): SaveKeyInfo {
  return {
    key: "Enter", ctrlKey: false, metaKey: false, isComposing: false, defaultPrevented: false,
    tagName: "INPUT", inputType: "text", ...over,
  };
}

describe("shouldSaveOnKey（Enter・Ctrl/Cmd+Enter で保存）", () => {
  it("単一行の input の Enter は bubble フェーズで保存する（capture では保存しない）", () => {
    expect(shouldSaveOnKey(key({}), "bubble")).toBe(true);
    expect(shouldSaveOnKey(key({}), "capture")).toBe(false);
  });

  it("Ctrl／Cmd+Enter は capture フェーズで、どこからでも保存する（textarea でも）。bubble では二重に保存しない", () => {
    expect(shouldSaveOnKey(key({ ctrlKey: true, tagName: "TEXTAREA", inputType: "" }), "capture")).toBe(true);
    expect(shouldSaveOnKey(key({ metaKey: true, tagName: "DIV", inputType: "" }), "capture")).toBe(true);
    expect(shouldSaveOnKey(key({ ctrlKey: true }), "bubble")).toBe(false);
  });

  it("IME 変換確定中の Enter は無視する（Ctrl/Cmd 付きも）", () => {
    expect(shouldSaveOnKey(key({ isComposing: true }), "bubble")).toBe(false);
    expect(shouldSaveOnKey(key({ isComposing: true, ctrlKey: true }), "capture")).toBe(false);
  });

  it("textarea・ボタン・チェックボックス上の単純な Enter では保存しない（改行・押下のまま）", () => {
    expect(shouldSaveOnKey(key({ tagName: "TEXTAREA", inputType: "" }), "bubble")).toBe(false);
    expect(shouldSaveOnKey(key({ tagName: "BUTTON", inputType: "" }), "bubble")).toBe(false);
    expect(shouldSaveOnKey(key({ inputType: "checkbox" }), "bubble")).toBe(false);
    expect(shouldSaveOnKey(key({ inputType: "radio" }), "bubble")).toBe(false);
  });

  it("子要素（CustomSelect の検索 input 等）が既に preventDefault した Enter は保存しない", () => {
    expect(shouldSaveOnKey(key({ defaultPrevented: true }), "bubble")).toBe(false);
  });

  it("Enter 以外のキーでは何もしない", () => {
    expect(shouldSaveOnKey(key({ key: "a" }), "bubble")).toBe(false);
    expect(shouldSaveOnKey(key({ key: "Escape", ctrlKey: true }), "capture")).toBe(false);
  });
});

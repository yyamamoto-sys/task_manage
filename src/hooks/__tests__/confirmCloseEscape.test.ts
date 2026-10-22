// src/hooks/__tests__/confirmCloseEscape.test.ts
//
// v3.174（共通UI 55回目）：ドロップダウン（CustomSelect の panel）を Esc で閉じたとき、
// 同じ Esc で編集モーダルまで閉じてしまう（未編集なら確認なし）不具合の再発防止。
// useConfirmClose は role="dialog" と role="listbox" が DOM にある間の Esc を無視し、
// CustomSelect のパネルは role="listbox" を持つ。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isEscapeOwnedByOverlay } from "../useConfirmClose";

function fakeDoc(roles: string[]): Pick<Document, "querySelector"> {
  return {
    querySelector: ((sel: string) => {
      const wanted = [...sel.matchAll(/\[role="([^"]+)"\]/g)].map(m => m[1]);
      return roles.some(r => wanted.includes(r)) ? ({} as Element) : null;
    }) as Document["querySelector"],
  };
}

describe("isEscapeOwnedByOverlay", () => {
  it("何も開いていなければ Esc はモーダルのもの", () => {
    expect(isEscapeOwnedByOverlay(fakeDoc([]))).toBe(false);
  });
  it("確認ダイアログが前面なら無視する", () => {
    expect(isEscapeOwnedByOverlay(fakeDoc(["dialog"]))).toBe(true);
  });
  it("開いているドロップダウン（listbox）があるときも無視する", () => {
    expect(isEscapeOwnedByOverlay(fakeDoc(["listbox"]))).toBe(true);
  });
});

describe("CustomSelect のパネル", () => {
  it("role=listbox を持つ（useConfirmClose が Esc の持ち主を判別する目印）", () => {
    const src = readFileSync(new URL("../../components/common/CustomSelect.tsx", import.meta.url), "utf-8");
    expect(src).toMatch(/ref=\{panelRef\}\s+role="listbox"/);
  });
});

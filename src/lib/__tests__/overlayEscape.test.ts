import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeOnEscapeAndStop } from "../overlayEscape";
import { isEscapeOwnedByOverlay } from "../../hooks/useConfirmClose";

const ev = (key: string, isComposing = false) => ({
  key, isComposing, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
});

describe("closeOnEscapeAndStop（M70）", () => {
  it("Esc でパネルを閉じ、モーダルへ伝えない", () => {
    const e = ev("Escape");
    const close = vi.fn();
    expect(closeOnEscapeAndStop(e, close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
  it("Esc 以外・IME 変換中は何もしない", () => {
    const close = vi.fn();
    const a = ev("ArrowDown");
    const b = ev("Escape", true);
    expect(closeOnEscapeAndStop(a, close)).toBe(false);
    expect(closeOnEscapeAndStop(b, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(a.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(b.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});

describe("CustomSelect の配線", () => {
  const src = readFileSync(resolve(__dirname, "../../components/common/CustomSelect.tsx"), "utf-8")
    .split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  it("Esc は window の capture 段階で受ける（document のバブリングでは先に並ぶモーダルを止められない）", () => {
    expect(src).toContain("closeOnEscapeAndStop(");
    expect(src).toMatch(/window\.addEventListener\("keydown",\s*handler,\s*true\)/);
    expect(src).toMatch(/window\.removeEventListener\("keydown",\s*handler,\s*true\)/);
    expect(src).not.toMatch(/document\.addEventListener\("keydown"/);
  });
  it("useConfirmClose の role=listbox 判定は残る（他のオーバーレイ用の安全網として矛盾しない）", () => {
    const doc = { querySelector: (sel: string) => (sel.includes("listbox") ? {} : null) };
    expect(isEscapeOwnedByOverlay(doc as never)).toBe(true);
  });
});

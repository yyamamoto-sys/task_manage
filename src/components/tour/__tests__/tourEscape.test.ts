import { describe, it, expect, vi } from "vitest";
import { handleTourEscape } from "../tourEscape";

function ev(key: string, isComposing = false) {
  return { key, isComposing, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
}

describe("handleTourEscape（ツアー中の Esc）", () => {
  it("通常の Esc はツアーを終え、背後のモーダルへ届かないよう止める", () => {
    const end = vi.fn();
    const e = ev("Escape");
    expect(handleTourEscape(e, false, end)).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
    expect(e.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("IME の変換中の Esc ではツアーを終えない（変換の取り消しに使われる）", () => {
    const end = vi.fn();
    const e = ev("Escape", true);
    expect(handleTourEscape(e, false, end)).toBe(false);
    expect(end).not.toHaveBeenCalled();
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("ドロップダウンが開いているときは、そちらを閉じる Esc に任せる", () => {
    const end = vi.fn();
    const e = ev("Escape");
    expect(handleTourEscape(e, true, end)).toBe(false);
    expect(end).not.toHaveBeenCalled();
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("Esc 以外のキーは何もしない", () => {
    const end = vi.fn();
    expect(handleTourEscape(ev("Enter"), false, end)).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });
});

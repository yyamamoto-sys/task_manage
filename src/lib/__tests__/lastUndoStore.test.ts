import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setLastUndoAction,
  consumeLastUndoAction,
  clearLastUndoAction,
  peekLastUndoAction,
} from "../lastUndoStore";

describe("lastUndoStore", () => {
  beforeEach(() => {
    clearLastUndoAction();
  });

  it("初期状態では何も登録されていない", () => {
    expect(peekLastUndoAction()).toBeNull();
    expect(consumeLastUndoAction()).toBeNull();
  });

  it("登録したアクションを consume で取り出せる", () => {
    const action = vi.fn();
    setLastUndoAction(action);
    const consumed = consumeLastUndoAction();
    expect(consumed).toBe(action);
  });

  it("consume すると同時にクリアされる（二重発火防止）", () => {
    const action = vi.fn();
    setLastUndoAction(action);
    consumeLastUndoAction();
    expect(peekLastUndoAction()).toBeNull();
    expect(consumeLastUndoAction()).toBeNull();
  });

  it("より新しい登録は古い登録を置き換える", () => {
    const first = vi.fn();
    const second = vi.fn();
    setLastUndoAction(first);
    setLastUndoAction(second);
    const consumed = consumeLastUndoAction();
    expect(consumed).toBe(second);
    expect(consumed).not.toBe(first);
  });

  it("clearLastUndoAction で明示的にクリアできる", () => {
    setLastUndoAction(vi.fn());
    clearLastUndoAction();
    expect(peekLastUndoAction()).toBeNull();
  });

  it("peek はクリアしない", () => {
    const action = vi.fn();
    setLastUndoAction(action);
    expect(peekLastUndoAction()).toBe(action);
    expect(peekLastUndoAction()).toBe(action);
    expect(consumeLastUndoAction()).toBe(action);
  });
});

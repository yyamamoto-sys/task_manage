import { describe, it, expect } from "vitest";
import { isOverWipLimit, WIP_LIMIT_DEFAULT } from "../kanbanWip";

describe("isOverWipLimit", () => {
  it("既定上限(4)ちょうどは超過ではない", () => {
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT)).toBe(false);
  });

  it("既定上限を1件でも超えると超過", () => {
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT + 1)).toBe(true);
  });

  it("上限未満は超過ではない", () => {
    expect(isOverWipLimit(0)).toBe(false);
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT - 1)).toBe(false);
  });

  it("カスタム上限を指定できる", () => {
    expect(isOverWipLimit(3, 2)).toBe(true);
    expect(isOverWipLimit(2, 2)).toBe(false);
  });
});

import { parseStoredWipLimit, parseWipLimitInput, serializeWipLimit } from "../kanbanWip";

describe("WIP上限の変更（v3.201）", () => {
  it("上限なし(null)は超過にならない", () => {
    expect(isOverWipLimit(100, null)).toBe(false);
  });
  it("保存値の読み出し：未保存は既定・none は上限なし・範囲外は丸める", () => {
    expect(parseStoredWipLimit(null)).toBe(4);
    expect(parseStoredWipLimit("none")).toBeNull();
    expect(parseStoredWipLimit("7")).toBe(7);
    expect(parseStoredWipLimit("0")).toBe(1);
    expect(parseStoredWipLimit("500")).toBe(99);
    expect(parseStoredWipLimit("abc")).toBe(4);
  });
  it("入力欄：空欄は上限なし・数値は1〜99に丸める・数値以外は無視", () => {
    expect(parseWipLimitInput("")).toBeNull();
    expect(parseWipLimitInput(" 6 ")).toBe(6);
    expect(parseWipLimitInput("0")).toBe(1);
    expect(parseWipLimitInput("120")).toBe(99);
    expect(parseWipLimitInput("あ")).toBeUndefined();
  });
  it("保存→読み出しで元に戻る", () => {
    for (const v of [null, 1, 4, 99]) expect(parseStoredWipLimit(serializeWipLimit(v))).toBe(v);
  });
});

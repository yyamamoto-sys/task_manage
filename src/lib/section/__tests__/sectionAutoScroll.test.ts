import { describe, expect, it } from "vitest";
import { sectionAutoScrollDelta } from "../sectionAutoScroll";

describe("sectionAutoScrollDelta（端48px以内で自動スクロール・最大16px/フレーム）", () => {
  const top = 100, bottom = 600;
  it("中央では動かさない", () => {
    expect(sectionAutoScrollDelta(350, top, bottom)).toBe(0);
    expect(sectionAutoScrollDelta(148, top, bottom)).toBe(0);
    expect(sectionAutoScrollDelta(552, top, bottom)).toBe(0);
  });
  it("上端に近いと上へ（負）・下端に近いと下へ（正）", () => {
    expect(sectionAutoScrollDelta(120, top, bottom)).toBeLessThan(0);
    expect(sectionAutoScrollDelta(580, top, bottom)).toBeGreaterThan(0);
  });
  it("端に近いほど速い", () => {
    const far = Math.abs(sectionAutoScrollDelta(140, top, bottom));
    const near = Math.abs(sectionAutoScrollDelta(105, top, bottom));
    expect(near).toBeGreaterThan(far);
    expect(Math.abs(sectionAutoScrollDelta(560, top, bottom))).toBeLessThan(Math.abs(sectionAutoScrollDelta(595, top, bottom)));
  });
  it("端ちょうど・領域の外は最大16で頭打ち", () => {
    expect(sectionAutoScrollDelta(100, top, bottom)).toBe(-16);
    expect(sectionAutoScrollDelta(-500, top, bottom)).toBe(-16);
    expect(sectionAutoScrollDelta(600, top, bottom)).toBe(16);
    expect(sectionAutoScrollDelta(5000, top, bottom)).toBe(16);
  });
  it("帯の境界（48px）では動かさず、47pxでは最低1px動く", () => {
    expect(sectionAutoScrollDelta(148, top, bottom)).toBe(0);
    expect(sectionAutoScrollDelta(147, top, bottom)).toBe(-1);
  });
  it("不正な領域は0", () => {
    expect(sectionAutoScrollDelta(100, 300, 300)).toBe(0);
    expect(sectionAutoScrollDelta(100, 300, 200)).toBe(0);
  });
});

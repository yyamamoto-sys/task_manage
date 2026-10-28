import { describe, it, expect } from "vitest";
import { computeIsMobile } from "../viewport";

describe("computeIsMobile", () => {
  it("PC screen 1536 / inner 768 -> PC", () => expect(computeIsMobile(1536, 768)).toBe(false));
  it("PC screen 1536 / inner 500 -> mobile", () => expect(computeIsMobile(1536, 500)).toBe(true));
  it("PC screen 1536 / inner 512 (境界) -> mobile", () => expect(computeIsMobile(1536, 512)).toBe(true));
  it("スマホ screen 390 / inner 390 -> mobile", () => expect(computeIsMobile(390, 390)).toBe(true));
  it("タブレット screen 1024 / inner 800 -> PC", () => expect(computeIsMobile(1024, 800)).toBe(false));
  it("タブレット screen 820 / inner 768 -> mobile", () => expect(computeIsMobile(820, 768)).toBe(true));
});

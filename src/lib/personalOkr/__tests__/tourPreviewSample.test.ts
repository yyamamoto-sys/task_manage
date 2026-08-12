import { describe, it, expect } from "vitest";
import { shouldInjectOkrTourPreviewSample } from "../tourPreviewSample";

describe("shouldInjectOkrTourPreviewSample", () => {
  it("ツアーが実行中でなければ、KRが0本でも差し込まない", () => {
    expect(shouldInjectOkrTourPreviewSample(false, 0)).toBe(false);
  });

  it("ツアーが実行中でなければ、KRが有っても差し込まない", () => {
    expect(shouldInjectOkrTourPreviewSample(false, 3)).toBe(false);
  });

  it("ツアー実行中・対象期のKRが0本なら差し込む", () => {
    expect(shouldInjectOkrTourPreviewSample(true, 0)).toBe(true);
  });

  it("ツアー実行中でも、対象期に1本でもKRがあれば差し込まない（実データを使う）", () => {
    expect(shouldInjectOkrTourPreviewSample(true, 1)).toBe(false);
    expect(shouldInjectOkrTourPreviewSample(true, 3)).toBe(false);
  });
});

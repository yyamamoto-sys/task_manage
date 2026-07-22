import { describe, it, expect } from "vitest";
import { isCompletedForProgress } from "../taskMeta";

describe("isCompletedForProgress：進捗%集計の「完了扱い」判定（M33解消・2026-07-22）", () => {
  it("done は完了扱い", () => {
    expect(isCompletedForProgress("done")).toBe(true);
  });

  it("cancelled は done と同じ完了扱い", () => {
    expect(isCompletedForProgress("cancelled")).toBe(true);
  });

  it("on_hold は未完了扱い（まだ動く可能性があるため）", () => {
    expect(isCompletedForProgress("on_hold")).toBe(false);
  });

  it("todo は未完了扱い", () => {
    expect(isCompletedForProgress("todo")).toBe(false);
  });

  it("in_progress は未完了扱い", () => {
    expect(isCompletedForProgress("in_progress")).toBe(false);
  });
});

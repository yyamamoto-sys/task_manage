import { describe, it, expect } from "vitest";
import { computeRangeSelection } from "../selectionRange";

describe("computeRangeSelection", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  it("アンカー→ターゲットが前方なら間のidを両端含めて返す", () => {
    expect(computeRangeSelection(ordered, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("アンカー→ターゲットが後方（逆順クリック）でも同じ範囲を返す", () => {
    expect(computeRangeSelection(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("アンカーとターゲットが同じなら単体を返す", () => {
    expect(computeRangeSelection(ordered, "c", "c")).toEqual(["c"]);
  });

  it("アンカーが無い（null）ならターゲット単体を返す", () => {
    expect(computeRangeSelection(ordered, null, "c")).toEqual(["c"]);
  });

  it("アンカーが表示順配列に存在しないならターゲット単体を返す（フォールバック）", () => {
    expect(computeRangeSelection(ordered, "z", "c")).toEqual(["c"]);
  });

  it("ターゲットが表示順配列に存在しないならターゲット単体を返す（フォールバック）", () => {
    expect(computeRangeSelection(ordered, "b", "z")).toEqual(["z"]);
  });
});

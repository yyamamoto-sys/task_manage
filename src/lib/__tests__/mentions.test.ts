import { describe, it, expect } from "vitest";
import { extractMentions, mentionsEqual } from "../mentions";

describe("extractMentions", () => {
  it("@short_name を抽出する（重複除去）", () => {
    expect(extractMentions("@yamamoto さん確認お願いします @tanaka @yamamoto")).toEqual(["yamamoto", "tanaka"]);
  });

  it("メンションが無ければ空配列", () => {
    expect(extractMentions("メンションなしのコメント")).toEqual([]);
  });
});

describe("mentionsEqual", () => {
  it("同じ集合なら true", () => {
    expect(mentionsEqual(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("異なる集合なら false", () => {
    expect(mentionsEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("要素数が同じでも中身の集合が違えば false（重複混入ケース）", () => {
    // a={a,b} b={a} という集合の違いを、配列の長さだけで見誤らないことを確認する
    expect(mentionsEqual(["a", "b"], ["a", "a"])).toBe(false);
  });

  it("空配列同士は true", () => {
    expect(mentionsEqual([], [])).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { computeActualActivitiesDirty, toActualActivitiesSaveValue } from "../actualActivitiesForm";

describe("computeActualActivitiesDirty", () => {
  it("値が保存済みと同じならfalse", () => {
    expect(computeActualActivitiesDirty("急遽対応した", "急遽対応した")).toBe(false);
  });

  it("値が変わっていればtrue", () => {
    expect(computeActualActivitiesDirty("急遽対応した", "他の対応")).toBe(true);
  });

  it("保存済みがnull/undefinedのとき、空文字は未変更扱い", () => {
    expect(computeActualActivitiesDirty("", null)).toBe(false);
    expect(computeActualActivitiesDirty("", undefined)).toBe(false);
  });

  it("保存済みがnullで新規入力があればtrue", () => {
    expect(computeActualActivitiesDirty("新規入力", null)).toBe(true);
  });
});

describe("toActualActivitiesSaveValue", () => {
  it("🔴 空欄はnullを返す（undefinedではない。postgrest-jsの仕様）", () => {
    expect(toActualActivitiesSaveValue("")).toBeNull();
  });

  it("記入がある場合はそのまま返す", () => {
    expect(toActualActivitiesSaveValue("急遽対応した")).toBe("急遽対応した");
  });
});

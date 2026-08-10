import { describe, expect, it } from "vitest";
import { mapKrKindHint, parseBandValue, parseWeightPct } from "../importFieldParse";

describe("mapKrKindHint", () => {
  it("グループKR1〜9はすべてgroup_kr", () => {
    expect(mapKrKindHint("グループKR1")).toBe("group_kr");
    expect(mapKrKindHint("グループKR9")).toBe("group_kr");
  });
  it("全社共通/OM共通/AGM共通/リーダー共通をそれぞれ判定する", () => {
    expect(mapKrKindHint("全社共通")).toBe("company_common");
    expect(mapKrKindHint("OM共通")).toBe("om_common");
    expect(mapKrKindHint("AGM共通")).toBe("agm_common");
    expect(mapKrKindHint("リーダー共通")).toBe("leader_common");
  });
  it("全般はgeneral", () => {
    expect(mapKrKindHint("全般")).toBe("general");
  });
  it("null/undefined/空文字/想定外の文字列はgeneralにフォールバックする", () => {
    expect(mapKrKindHint(null)).toBe("general");
    expect(mapKrKindHint(undefined)).toBe("general");
    expect(mapKrKindHint("")).toBe("general");
    expect(mapKrKindHint("よくわからない種別")).toBe("general");
  });
});

describe("parseBandValue", () => {
  it("60/70/80/90/100はそのまま返す", () => {
    expect(parseBandValue(60)).toBe(60);
    expect(parseBandValue(100)).toBe(100);
  });
  it("文字列表記（%付き）もパースする", () => {
    expect(parseBandValue("70%")).toBe(70);
    expect(parseBandValue("80％")).toBe(80);
  });
  it("60/70/80/90/100以外の数値はnullを返す（弾く）", () => {
    expect(parseBandValue(65)).toBeNull();
    expect(parseBandValue(50)).toBeNull();
    expect(parseBandValue(0)).toBeNull();
  });
  it("null/undefined/非数値はnull", () => {
    expect(parseBandValue(null)).toBeNull();
    expect(parseBandValue(undefined)).toBeNull();
    expect(parseBandValue("不明")).toBeNull();
  });
});

describe("parseWeightPct", () => {
  it("数値・単位付き文字列をパースする", () => {
    expect(parseWeightPct(35)).toBe(35);
    expect(parseWeightPct("35 ％")).toBe(35);
    expect(parseWeightPct("25%")).toBe(25);
  });
  it("負値・非数値・null/undefinedはnull", () => {
    expect(parseWeightPct(-5)).toBeNull();
    expect(parseWeightPct("不明")).toBeNull();
    expect(parseWeightPct(null)).toBeNull();
    expect(parseWeightPct(undefined)).toBeNull();
  });
  it("0はnullではなく0を返す", () => {
    expect(parseWeightPct(0)).toBe(0);
  });
});

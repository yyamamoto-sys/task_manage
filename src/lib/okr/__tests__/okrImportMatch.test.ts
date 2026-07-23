import { describe, it, expect } from "vitest";
import { matchMemberByName } from "../okrImportMatch";

const members = [
  { id: "m1", display_name: "駒井 映里", short_name: "駒井" },
  { id: "m2", display_name: "山本 勇気", short_name: "山本" },
  { id: "m3", display_name: "田中 太郎", short_name: "田中" },
];

describe("matchMemberByName", () => {
  it("display_nameの完全一致を返す", () => {
    expect(matchMemberByName("駒井 映里", members)?.id).toBe("m1");
  });

  it("short_nameの完全一致を返す", () => {
    expect(matchMemberByName("山本", members)?.id).toBe("m2");
  });

  it("display_nameを含む部分一致を返す（1件のみヒット）", () => {
    expect(matchMemberByName("駒井", members)?.id).toBe("m1");
  });

  it("該当なしはnull", () => {
    expect(matchMemberByName("鈴木 健太", members)).toBeNull();
  });

  it("null/undefined/空文字はnull", () => {
    expect(matchMemberByName(null, members)).toBeNull();
    expect(matchMemberByName(undefined, members)).toBeNull();
    expect(matchMemberByName("", members)).toBeNull();
    expect(matchMemberByName("   ", members)).toBeNull();
  });

  it("複数件が部分一致する場合は曖昧としてnull", () => {
    const ambiguous = [
      { id: "a1", display_name: "田中 太郎", short_name: "太郎" },
      { id: "a2", display_name: "田中 花子", short_name: "花子" },
    ];
    // どちらの display_name/short_name も完全一致せず、"田中"というヒントが両方の
    // display_name に部分一致してしまうケース（exact一致が無いため曖昧判定に落ちる）
    expect(matchMemberByName("田中", ambiguous)).toBeNull();
  });
});

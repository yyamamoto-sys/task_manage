import { describe, it, expect } from "vitest";
import { fieldLabel, formatChangeValue } from "../fieldLabels";
import type { Member } from "../../localData/types";

function mkMember(partial: Partial<Member> & { id: string }): Member {
  return {
    id: partial.id,
    display_name: partial.display_name ?? partial.id,
    short_name: partial.short_name ?? partial.id,
    initials: partial.initials ?? "AA",
    teams_account: "",
    color_bg: "#fff",
    color_text: "#000",
    is_deleted: false,
  };
}

describe("fieldLabel", () => {
  it("taskの既知フィールドを日本語化する", () => {
    expect(fieldLabel("task", "status")).toBe("ステータス");
    expect(fieldLabel("task", "due_date")).toBe("期日");
  });

  it("projectの既知フィールドを日本語化する", () => {
    expect(fieldLabel("project", "owner_member_id")).toBe("オーナー");
  });

  it("未知のフィールドはそのまま返す", () => {
    expect(fieldLabel("task", "mystery_field")).toBe("mystery_field");
  });
});

describe("formatChangeValue", () => {
  const members = [mkMember({ id: "m1", short_name: "山本" })];

  it("null/未設定は「（未設定）」にする", () => {
    expect(formatChangeValue("task", "name", null, members)).toBe("（未設定）");
    expect(formatChangeValue("task", "name", "", members)).toBe("（未設定）");
  });

  it("taskのstatusはラベル変換する", () => {
    expect(formatChangeValue("task", "status", "done", members)).toBe("完了");
  });

  it("assignee_member_idはメンバー名に変換する", () => {
    expect(formatChangeValue("task", "assignee_member_id", "m1", members)).toBe("山本");
  });

  it("assignee_member_idsは複数名を「、」で結合する", () => {
    expect(formatChangeValue("task", "assignee_member_ids", ["m1"], members)).toBe("山本");
  });

  it("booleanははい/いいえに変換する", () => {
    expect(formatChangeValue("task", "is_deleted", true, members)).toBe("はい");
    expect(formatChangeValue("task", "is_deleted", false, members)).toBe("いいえ");
  });

  it("projectのstatusはラベル変換する", () => {
    expect(formatChangeValue("project", "status", "completed", members)).toBe("完了");
  });
});

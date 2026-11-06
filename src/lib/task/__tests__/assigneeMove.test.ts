import { describe, it, expect } from "vitest";
import { UNASSIGNED_KEY, assigneePatch, moveAssigneeIds } from "../assigneeMove";

describe("moveAssigneeIds", () => {
  it("単独担当：移動元を移動先に入れ替える", () => {
    expect(moveAssigneeIds(["a"], "a", "b")).toEqual(["b"]);
  });
  it("複数担当：移動元だけを入れ替え、他の担当者と順序は残す", () => {
    expect(moveAssigneeIds(["a", "c"], "a", "b")).toEqual(["b", "c"]);
    expect(moveAssigneeIds(["c", "a"], "a", "b")).toEqual(["c", "b"]);
  });
  it("移動先が既に担当者なら、移動元を外すだけ", () => {
    expect(moveAssigneeIds(["a", "b"], "a", "b")).toEqual(["b"]);
    expect(moveAssigneeIds(["a", "b", "c"], "b", "a")).toEqual(["a", "c"]);
  });
  it("未割り当てから移す＝追加", () => {
    expect(moveAssigneeIds([], UNASSIGNED_KEY, "b")).toEqual(["b"]);
  });
  it("未割り当てへ移す＝移動元を外す（複数担当なら残りは維持）", () => {
    expect(moveAssigneeIds(["a"], "a", UNASSIGNED_KEY)).toEqual([]);
    expect(moveAssigneeIds(["a", "c"], "a", UNASSIGNED_KEY)).toEqual(["c"]);
  });
  it("同じ列・既に未割り当て・移動元が担当者でない場合の扱い", () => {
    expect(moveAssigneeIds(["a"], "a", "a")).toBeNull();
    expect(moveAssigneeIds([], UNASSIGNED_KEY, UNASSIGNED_KEY)).toBeNull();
    expect(moveAssigneeIds(["x"], "zzz", UNASSIGNED_KEY)).toBeNull();
    expect(moveAssigneeIds(["x"], "zzz", "b")).toEqual(["x", "b"]);
    expect(moveAssigneeIds(["b"], "zzz", "b")).toBeNull();
  });
  it("入力配列を変更しない", () => {
    const ids = ["a", "c"];
    moveAssigneeIds(ids, "a", "b");
    expect(ids).toEqual(["a", "c"]);
  });
});

describe("assigneePatch", () => {
  it("先頭を主FKにし、空なら空文字", () => {
    expect(assigneePatch(["b", "c"])).toEqual({ assignee_member_ids: ["b", "c"], assignee_member_id: "b" });
    expect(assigneePatch([])).toEqual({ assignee_member_ids: [], assignee_member_id: "" });
  });
});

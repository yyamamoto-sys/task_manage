import { describe, it, expect, vi } from "vitest";
import type { KeyResult, TaskForce, ProjectTaskForce } from "../../localData/types";
import { diffTfLinks, applyProjectTaskForceLinks, buildCurrentQuarterKrTfGroups } from "../projectTaskForceLinks";

const kr = (id: string): KeyResult => ({ id, objective_id: "o1", title: id, is_deleted: false });
const tf = (id: string, kr_id: string, tf_number: string, extra: Partial<TaskForce> = {}): TaskForce => ({
  id, kr_id, tf_number, name: id, leader_member_id: null, is_deleted: false, ...extra,
} as TaskForce);

describe("diffTfLinks", () => {
  it("managedTfIds 省略時は全件が増減対象（AdminView従来の挙動）", () => {
    expect(diffTfLinks(["a", "b"], ["b", "c"])).toEqual({ toAdd: ["c"], toRemove: ["a"] });
  });
  it("managedTfIds 外（今期以外）の既存紐づけは、選ばれていなくても消さない", () => {
    const r = diffTfLinks(["old", "cur1", "cur2"], ["cur2", "new"], new Set(["cur1", "cur2", "new"]));
    expect(r.toRemove).toEqual(["cur1"]);
    expect(r.toAdd).toEqual(["new"]);
  });
});

describe("applyProjectTaskForceLinks", () => {
  it("他PJの紐づけには触れず、今期分だけ add/remove を呼ぶ", async () => {
    const existing: ProjectTaskForce[] = [
      { project_id: "p1", tf_id: "old" }, { project_id: "p1", tf_id: "cur1" }, { project_id: "p2", tf_id: "cur1" },
    ];
    const add = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    await applyProjectTaskForceLinks({
      projectId: "p1", desiredTfIds: ["new"], existingLinks: existing,
      managedTfIds: new Set(["cur1", "new"]), add, remove,
    });
    expect(add).toHaveBeenCalledWith({ project_id: "p1", tf_id: "new" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("p1", "cur1");
  });
});

describe("buildCurrentQuarterKrTfGroups", () => {
  it("指定四半期のTFだけをKRごとに出し、削除済み・他期・TFの無いKRは除く。quarter未設定は今期扱い", () => {
    const groups = buildCurrentQuarterKrTfGroups(
      [kr("k1"), kr("k2"), kr("k3")],
      [
        tf("a", "k1", "2", { quarter: "3Q" }), tf("b", "k1", "1", { quarter: "3Q" }),
        tf("c", "k1", "3", { quarter: "4Q" }), tf("d", "k2", "1", { quarter: "3Q", is_deleted: true }),
        tf("e", "k3", "1", { quarter: "3Q" }),
      ],
      "3Q",
    );
    expect(groups.map(g => g.krLabel)).toEqual(["KR1", "KR3"]);
    expect(groups[0].tfs.map(t => t.label)).toEqual(["TF1-1", "TF1-2"]);
    expect(groups[1].tfs[0].label).toBe("TF3-1");
  });
});

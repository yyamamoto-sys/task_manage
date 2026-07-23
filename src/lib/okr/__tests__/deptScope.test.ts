import { describe, it, expect } from "vitest";
import {
  DEFAULT_OKR_GROUP_ID,
  objectivesInGroup,
  pickCurrentObjectiveForGroup,
  keyResultsInGroup,
  taskForcesInGroup,
  quarterlyObjectivesInGroup,
  quarterlyObjectivesInGroupForQuarter,
} from "../deptScope";
import type { Objective, KeyResult, TaskForce, QuarterlyObjective } from "../../localData/types";

function obj(id: string, groupId: string | null, isCurrent: boolean): Objective {
  return {
    id, title: `obj-${id}`, period: "2026年度", is_current: isCurrent,
    group_id: groupId, updated_by: "u1",
  };
}
function kr(id: string, objectiveId: string): KeyResult {
  return { id, objective_id: objectiveId, title: `kr-${id}`, is_deleted: false, updated_by: "u1" };
}
function tf(id: string, krId: string): TaskForce {
  return {
    id, kr_id: krId, tf_number: "1", name: `tf-${id}`,
    leader_member_id: "m1", is_deleted: false, updated_by: "u1",
  };
}
function qObj(id: string, groupId: string | null, quarter: QuarterlyObjective["quarter"]): QuarterlyObjective {
  return {
    id, objective_id: "o-egg", quarter, title: `qo-${id}`,
    group_id: groupId, is_deleted: false, updated_by: "u1",
  };
}

describe("objectivesInGroup", () => {
  it("group_idが一致するObjectiveだけを返す", () => {
    const objectives = [obj("o-egg", "grp-egg", true), obj("o-aid", "grp-aid", true)];
    expect(objectivesInGroup(objectives, "grp-aid").map(o => o.id)).toEqual(["o-aid"]);
  });

  it("groupIdがnullなら空配列を返す（未確定な部署コンテキストで誤って全件返さない）", () => {
    const objectives = [obj("o-egg", "grp-egg", true)];
    expect(objectivesInGroup(objectives, null)).toEqual([]);
  });

  it("group_idがnullのObjectiveはgrp-egg扱い（バックフィル前の安全網）", () => {
    const objectives = [obj("o-legacy", null, true)];
    expect(objectivesInGroup(objectives, DEFAULT_OKR_GROUP_ID).map(o => o.id)).toEqual(["o-legacy"]);
    expect(objectivesInGroup(objectives, "grp-aid")).toEqual([]);
  });
});

describe("pickCurrentObjectiveForGroup", () => {
  it("他部署のis_current Objectiveが混ざらない", () => {
    const objectives = [obj("o-egg", "grp-egg", true), obj("o-aid", "grp-aid", true)];
    expect(pickCurrentObjectiveForGroup(objectives, "grp-egg")?.id).toBe("o-egg");
    expect(pickCurrentObjectiveForGroup(objectives, "grp-aid")?.id).toBe("o-aid");
  });

  it("is_currentが無ければ配下の先頭を返す", () => {
    const objectives = [obj("o-old", "grp-aid", false)];
    expect(pickCurrentObjectiveForGroup(objectives, "grp-aid")?.id).toBe("o-old");
  });

  it("該当部署のObjectiveが無ければnull（他部署にis_currentがあっても混ざらない）", () => {
    const objectives = [obj("o-egg", "grp-egg", true)];
    expect(pickCurrentObjectiveForGroup(objectives, "grp-aid")).toBeNull();
  });
});

describe("keyResultsInGroup / taskForcesInGroup", () => {
  const objectives = [obj("o-egg", "grp-egg", true), obj("o-aid", "grp-aid", true)];
  const keyResults = [kr("kr-egg", "o-egg"), kr("kr-aid", "o-aid")];
  const taskForces = [tf("tf-egg", "kr-egg"), tf("tf-aid", "kr-aid")];

  it("KRはObjective経由で部署を継承する", () => {
    expect(keyResultsInGroup(keyResults, objectives, "grp-aid").map(k => k.id)).toEqual(["kr-aid"]);
    expect(keyResultsInGroup(keyResults, objectives, "grp-egg").map(k => k.id)).toEqual(["kr-egg"]);
  });

  it("TFはKR経由で部署を継承する", () => {
    expect(taskForcesInGroup(taskForces, keyResults, objectives, "grp-aid").map(t => t.id)).toEqual(["tf-aid"]);
    expect(taskForcesInGroup(taskForces, keyResults, objectives, "grp-egg").map(t => t.id)).toEqual(["tf-egg"]);
  });
});

describe("quarterlyObjectivesInGroup / quarterlyObjectivesInGroupForQuarter", () => {
  it("group_idが一致するQuarterlyObjectiveだけを返す", () => {
    const qObjs = [qObj("qo-egg", "grp-egg", "1Q"), qObj("qo-aid", "grp-aid", "1Q")];
    expect(quarterlyObjectivesInGroup(qObjs, "grp-aid").map(q => q.id)).toEqual(["qo-aid"]);
  });

  it("groupIdがnullなら空配列を返す", () => {
    const qObjs = [qObj("qo-egg", "grp-egg", "1Q")];
    expect(quarterlyObjectivesInGroup(qObjs, null)).toEqual([]);
  });

  it("group_idがnullのQuarterlyObjectiveはgrp-egg扱い（バックフィル前の安全網）", () => {
    const qObjs = [qObj("qo-legacy", null, "1Q")];
    expect(quarterlyObjectivesInGroup(qObjs, DEFAULT_OKR_GROUP_ID).map(q => q.id)).toEqual(["qo-legacy"]);
    expect(quarterlyObjectivesInGroup(qObjs, "grp-aid")).toEqual([]);
  });

  it("部署×四半期の両方で絞り込む", () => {
    const qObjs = [
      qObj("qo-aid-1q", "grp-aid", "1Q"),
      qObj("qo-aid-2q", "grp-aid", "2Q"),
      qObj("qo-egg-1q", "grp-egg", "1Q"),
    ];
    expect(quarterlyObjectivesInGroupForQuarter(qObjs, "grp-aid", "1Q").map(q => q.id)).toEqual(["qo-aid-1q"]);
  });
});

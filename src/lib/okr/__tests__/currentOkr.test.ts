import { describe, it, expect } from "vitest";
import {
  currentKeyResultsInGroup, currentTaskForcesInGroup, previousKeyResultsInGroup,
  previousTaskForcesInGroup, previousObjectivesInGroup, findKeyResultForLabel,
} from "../deptScope";
import { krHasTf, krTfNote } from "../../../components/okr/map/reach";
import { matchExistingKrId } from "../okrImportMatch";
import type { Objective, KeyResult, TaskForce } from "../../localData/types";
import type { LinkCtx } from "../../../components/okr/map/logic";

const obj = (id: string, g: string, cur: boolean, created = "2026-01-01"): Objective =>
  ({ id, title: id, period: id, is_current: cur, group_id: g, created_at: created, updated_by: "u" });
const kr = (id: string, o: string): KeyResult => ({ id, objective_id: o, title: id, is_deleted: false, updated_by: "u" });
const tf = (id: string, k: string): TaskForce =>
  ({ id, kr_id: k, tf_number: "1", name: id, leader_member_id: "m", is_deleted: false, updated_by: "u" });

// AID: 下期（前の期・3Q の TF）と 4Q（今の期）。EGG は別の部署
const objs = [obj("aid-h2", "g1", false, "2026-07-01"), obj("aid-4q", "g1", true, "2026-10-01"), obj("egg-3q", "g2", true)];
const krs = [kr("kr-old1", "aid-h2"), kr("kr-old2", "aid-h2"), kr("kr-new1", "aid-4q"), kr("kr-new2", "aid-4q"), kr("kr-egg", "egg-3q")];
const tfs = [tf("tf-old", "kr-old1"), tf("tf-new", "kr-new1"), tf("tf-egg", "kr-egg")];

describe("今の期の KR・TF（is_current の Objective だけ）", () => {
  it("今の期の KR だけを返す（前の期・他部署は出さない）", () => {
    expect(currentKeyResultsInGroup(krs, objs, "g1").map(k => k.id)).toEqual(["kr-new1", "kr-new2"]);
  });
  it("TF も今の期の KR の下だけ", () => {
    expect(currentTaskForcesInGroup(tfs, krs, objs, "g1").map(t => t.id)).toEqual(["tf-new"]);
  });
  it("部署が未確定（null）なら空", () => {
    expect(currentKeyResultsInGroup(krs, objs, null)).toEqual([]);
  });
  it("既に前の期の KR に紐づいた行は、keep に渡した KR・TF を残す（紐づけを壊さない）", () => {
    expect(currentKeyResultsInGroup(krs, objs, "g1", ["kr-old1"]).map(k => k.id)).toEqual(["kr-old1", "kr-new1", "kr-new2"]);
    expect(currentTaskForcesInGroup(tfs, krs, objs, "g1", ["tf-old"]).map(t => t.id)).toEqual(["tf-old", "tf-new"]);
  });
  it("前の期の KR・TF・Objective は同じ部署の今の期以外。新しい期が先", () => {
    expect(previousKeyResultsInGroup(krs, objs, "g1").map(k => k.id)).toEqual(["kr-old1", "kr-old2"]);
    expect(previousTaskForcesInGroup(tfs, krs, objs, "g1").map(t => t.id)).toEqual(["tf-old"]);
    expect(previousObjectivesInGroup(objs, "g1").map(o => o.id)).toEqual(["aid-h2"]);
  });
  it("前の期の KR に紐づいた行でもラベルは引ける", () => {
    expect(findKeyResultForLabel(krs, "kr-old1")?.title).toBe("kr-old1");
    expect(findKeyResultForLabel(krs, null)).toBeNull();
  });
});

describe("KRとTFの間で見るのはTFの有無（タスクの有無ではない）", () => {
  const ctx = { pjs: [], items: [
    { id: "kr1", kind: "kr", parentId: "o", label: "KR1", text: "a" },
    { id: "kr2", kind: "kr", parentId: "o", label: "KR2", text: "b" },
    { id: "tf1", kind: "tf", parentId: "kr1", label: "TF1-1", text: "c" },
  ], overrides: {} } as unknown as LinkCtx;
  it("TFがあるKRには注記を出さない（仕事が無くても出さない）", () => {
    expect(krHasTf("kr1", ctx)).toBe(true);
    expect(krTfNote("kr1", ctx)).toBeNull();
  });
  it("今期のTFが無いKRだけ「今期のTFなし」。タスクの語は使わない", () => {
    expect(krTfNote("kr2", ctx)).toBe("今期のTFなし");
    expect(krTfNote("kr2", ctx)).not.toMatch(/仕事|タスク/);
  });
});

describe("OKR取込：既存に追記のときの紐づけ先の既定", () => {
  const existing = [{ id: "k1", title: "共創パートナー企業を30社にする" }, { id: "k2", title: "定型業務を減らす" }];
  it("同名（KR番号・空白の違いは無視）があればその KR", () => {
    expect(matchExistingKrId("KR1：共創パートナー企業を 30社にする", existing)).toBe("k1");
    expect(matchExistingKrId("定型業務を減らす", existing)).toBe("k2");
  });
  it("無ければ null（新規）", () => {
    expect(matchExistingKrId("まったく別のKR", existing)).toBeNull();
    expect(matchExistingKrId("", existing)).toBeNull();
  });
});

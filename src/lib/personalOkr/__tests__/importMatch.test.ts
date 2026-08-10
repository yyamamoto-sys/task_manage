import { describe, expect, it } from "vitest";
import {
  rankExistingPersonalKrMatches, pickDefaultMapping, rankGroupTfMatches,
} from "../importMatch";
import type { KeyResult, PersonalKr, TaskForce } from "../../localData/types";

function makePersonalKr(overrides: Partial<PersonalKr>): PersonalKr {
  return {
    id: "pk-default",
    member_id: "m1",
    group_id: "grp-aid",
    fiscal_year: 2026,
    quarter: "3Q",
    kr_kind: "group_kr",
    label: "エース（AAS）",
    weight_pct: 35,
    display_order: 0,
    is_deleted: false,
    ...overrides,
  };
}

describe("rankExistingPersonalKrMatches", () => {
  const existing = [
    makePersonalKr({ id: "pk-aas", label: "エース（AAS）", kr_kind: "group_kr" }),
    makePersonalKr({ id: "pk-aiic", label: "AIIC/MCM無償版", kr_kind: "group_kr" }),
    makePersonalKr({ id: "pk-self", label: "自己研鑽", kr_kind: "general" }),
  ];

  it("ラベルが完全一致する既存KRを最上位候補にする", () => {
    const ranked = rankExistingPersonalKrMatches("AAS", "group_kr", existing);
    // "AAS"はpk-aasのlabel「エース（AAS）」に含まれる部分一致（括弧内が完全一致）
    expect(ranked[0].personalKr.id).toBe("pk-aas");
  });

  it("種別が異なると同じ文字列でもスコアが下がる", () => {
    const rankedGroupKr = rankExistingPersonalKrMatches("自己研鑽", "group_kr", existing);
    const rankedGeneral = rankExistingPersonalKrMatches("自己研鑽", "general", existing);
    const scoreGroupKr = rankedGroupKr.find(c => c.personalKr.id === "pk-self")!.score;
    const scoreGeneral = rankedGeneral.find(c => c.personalKr.id === "pk-self")!.score;
    expect(scoreGeneral).toBeGreaterThan(scoreGroupKr);
  });

  it("既存KRが空配列でも例外を投げない", () => {
    expect(rankExistingPersonalKrMatches("AAS", "group_kr", [])).toEqual([]);
  });
});

describe("pickDefaultMapping", () => {
  it("最有力候補のスコアが閾値以上なら対応づけを既定選択にする", () => {
    const candidates = [{ personalKr: makePersonalKr({ id: "pk-1" }), score: 0.9 }];
    expect(pickDefaultMapping(candidates)).toBe("pk-1");
  });
  it("候補が曖昧（閾値未満）なら新規作成（null）を返す", () => {
    const candidates = [{ personalKr: makePersonalKr({ id: "pk-1" }), score: 0.1 }];
    expect(pickDefaultMapping(candidates)).toBeNull();
  });
  it("候補が0件でもnullを返す", () => {
    expect(pickDefaultMapping([])).toBeNull();
  });
});

describe("rankGroupTfMatches", () => {
  const krs: KeyResult[] = [
    { id: "kr-1", objective_id: "obj-1", title: "統合営業の属人化を仕組みに変える", is_deleted: false, created_at: "", updated_at: "", updated_by: "" },
  ];
  const tfs: TaskForce[] = [
    { id: "tf-1", kr_id: "kr-1", tf_number: "1", name: "AIIC/MCM無償版開発", leader_member_id: null, is_deleted: false, created_at: "", updated_at: "", updated_by: "" },
    { id: "tf-2", kr_id: "kr-1", tf_number: "2", name: "エース（AAS）改修", leader_member_id: null, is_deleted: false, created_at: "", updated_at: "", updated_by: "" },
  ];

  it("ヒント文字列に含まれるTF名を優先して候補に挙げる", () => {
    const ranked = rankGroupTfMatches("グループKR1／KR1-TF2 AAS", tfs, krs);
    expect(ranked[0].taskForce.id).toBe("tf-2");
  });

  it("ヒントが空・nullなら空配列を返す（自動確定しない安全側）", () => {
    expect(rankGroupTfMatches(null, tfs, krs)).toEqual([]);
    expect(rankGroupTfMatches("", tfs, krs)).toEqual([]);
  });

  it("親KRが見つからないTFはスキップする", () => {
    const orphanTfs: TaskForce[] = [{ id: "tf-x", kr_id: "kr-missing", tf_number: "1", name: "AAS", leader_member_id: null, is_deleted: false, created_at: "", updated_at: "", updated_by: "" }];
    expect(rankGroupTfMatches("AAS", orphanTfs, krs)).toEqual([]);
  });
});

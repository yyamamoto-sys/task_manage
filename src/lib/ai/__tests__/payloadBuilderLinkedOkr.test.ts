import { describe, it, expect } from "vitest";
import { buildPayload } from "../payloadBuilder";
import { buildSystemPrompt } from "../systemPrompt";
import { currentQuarter } from "../../date";
import type { Member, Project, KeyResult, TaskForce, Objective, Quarter } from "../../localData/types";

// 実データに近い構成：全社（グループ）のObjectiveが先に並び、自部署のObjectiveが後ろにある。
// PJは自部署の今期TF・自部署の別Objective配下のTF・過去期のTFに紐づく。
const member: Member = {
  id: "m1", display_name: "山本", short_name: "山本", initials: "YY", teams_account: "",
  color_bg: "#fff", color_text: "#000", is_deleted: false,
};
const pj: Project = {
  id: "pj-1", name: "AAS再設計", purpose: "営業支援", contribution_memo: "", owner_member_id: "m1",
  owner_member_ids: ["m1"], status: "active", color_tag: "#000", start_date: "2026-01-01",
  end_date: "2026-12-31", is_deleted: false,
};
const objectives: Objective[] = [
  { id: "o-all", title: "グループ全体の目標", period: "2026年度", is_current: true, group_id: "grp-all" },
  { id: "o-aid", title: "AIDの目標", purpose: "情報戦略", period: "2026年度", is_current: true, group_id: "grp-aid" },
  { id: "o-aid-old", title: "AIDの旧目標", period: "2025年度", is_current: false, group_id: "grp-aid" },
];
const keyResults: KeyResult[] = [
  { id: "kr-all-1", objective_id: "o-all", title: "全社KR1", is_deleted: false },
  { id: "kr-all-2", objective_id: "o-all", title: "全社KR2", is_deleted: false },
  { id: "kr-aid-1", objective_id: "o-aid", title: "営業の仕組みを3つ稼働", is_deleted: false },
  { id: "kr-aid-2", objective_id: "o-aid", title: "AI活用の定着", is_deleted: false },
  { id: "kr-old-1", objective_id: "o-aid-old", title: "旧KR", is_deleted: false },
];
const now = currentQuarter();
const past: Quarter = now === "1Q" ? "2Q" : "1Q";
const tf = (over: Partial<TaskForce>): TaskForce => ({
  id: "x", kr_id: "kr-aid-1", tf_number: "1", name: "x", leader_member_id: "m1", is_deleted: false, ...over,
});
const taskForces: TaskForce[] = [
  tf({ id: "tf-now", kr_id: "kr-aid-1", tf_number: "2", name: "エース再設計", description: "統合営業の索敵装置を作る", quarter: now }),
  tf({ id: "tf-old-obj", kr_id: "kr-old-1", tf_number: "1", name: "旧目標のTF", quarter: now }),
  tf({ id: "tf-past", kr_id: "kr-aid-2", tf_number: "3", name: "過去期のTF", quarter: past }),
];

function build() {
  return buildPayload({
    projects: [pj], tasks: [], members: [member], consultation: "x", scope: "related_pj",
    targetPjId: "pj-1",
    projectTaskForces: [
      { project_id: "pj-1", tf_id: "tf-now" },
      { project_id: "pj-1", tf_id: "tf-old-obj" },
      { project_id: "pj-1", tf_id: "tf-past" },
    ],
    includeOKR: true,
    currentObjective: { id: "o-aid", title: "AIDの目標", period: "2026年度" },
    objectives, keyResults, taskForces,
  }).payload;
}

describe("buildPayload — PJに紐づいたTF→KR→Objective がAIに届く（v3.214）", () => {
  it("linked_tf_numbers のKR番号は所属Objective内の並び順（全社KRが先にあっても TF1-2 になる）", () => {
    expect(build().projects[0].linked_tf_numbers).toContain("TF1-2");
  });

  it("linked_okr に TF・KR・Objective の名称と期が入る", () => {
    const e = build().projects[0].linked_okr!.find(x => x.tf_name === "エース再設計")!;
    expect(e).toMatchObject({
      tf_label: "TF1-2", tf_purpose: "統合営業の索敵装置を作る", tf_leader: "山本",
      kr_label: "KR1", kr_title: "営業の仕組みを3つ稼働",
      objective_title: "AIDの目標", objective_period: "2026年度",
      is_current_quarter: true, is_current_objective: true,
    });
  });

  it("現在Objective以外・過去期のTFへの紐づけも linked_okr に入り、区別できる", () => {
    const list = build().projects[0].linked_okr!;
    const old = list.find(x => x.tf_name === "旧目標のTF")!;
    expect(old.objective_title).toBe("AIDの旧目標");
    expect(old.is_current_objective).toBe(false);
    const p = list.find(x => x.tf_name === "過去期のTF")!;
    expect(p.is_current_quarter).toBe(false);
    expect(p.quarter).toBe(past);
  });

  it("紐づけが無いPJには linked_okr を付けない", () => {
    const payload = buildPayload({
      projects: [pj], tasks: [], members: [member], consultation: "x", scope: "all_pj",
      includeOKR: true, objectives, keyResults, taskForces,
      currentObjective: { id: "o-aid", title: "AIDの目標", period: "2026年度" },
    }).payload;
    expect(payload.projects[0].linked_okr).toBeUndefined();
  });

  it("systemPrompt が貢献の観点と『前の回答より今回の紐づけを正とする』を指示している", () => {
    const sp = buildSystemPrompt("change");
    expect(sp).toContain("linked_okr");
    expect(sp).toContain("貢献");
    expect(sp).toContain("前の回答を引き継がない");
  });
});

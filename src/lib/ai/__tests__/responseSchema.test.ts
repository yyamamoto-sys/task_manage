// src/lib/ai/__tests__/responseSchema.test.ts
//
// 構造化出力のスキーマ（responseSchema.ts）と responseParser の型・検証が食い違っていないか。
// 項目名の過不足は Record<keyof 型> でコンパイル時に止まるので、ここでは
// enum の値・パーサが返す項目・Anthropic のスキーマ制約を実行時に見る。

import { describe, it, expect } from "vitest";
import {
  CONSULTATION_RESPONSE_SCHEMA, PROPOSAL_PROPERTIES, PROPOSAL_REQUIRED, RESPONSE_PROPERTIES,
  SCHEMA_ACTION_TYPES, SCHEMA_DATE_CERTAINTY, SCHEMA_TASK_STATUSES,
} from "../responseSchema";
import {
  parseAIResponse, VALID_ACTION_TYPES, VALID_DATE_CERTAINTY, VALID_BULK_TASK_STATUSES,
} from "../responseParser";

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) { node.forEach((c) => walk(c, visit)); return; }
  if (!node || typeof node !== "object") return;
  visit(node as Node);
  for (const v of Object.values(node as Node)) walk(v, visit);
}

const FULL_PROPOSAL = {
  proposal_id: "prop_001",
  title: "t",
  description: "d",
  action_type: "add_task",
  target_task_ids: ["task_001"],
  target_pj_ids: ["pj_001"],
  suggested_date: "2026-11-20",
  suggested_start_date: "2026-11-16",
  suggested_end_date: "2026-11-30",
  shift_days: 7,
  suggested_assignee: "山本",
  date_certainty: "exact",
  is_simulation: false,
  needs_confirmation: true,
  new_project_tasks: [{ name: "a", suggested_assignee: "山本", suggested_start_date: "2026-11-16", suggested_due_date: "2026-11-20", suggested_description: "x" }],
  new_subtasks: [{ name: "b" }],
  parent_task: "task_001",
  find: "第2回",
  replace: "第3回",
  new_status: "done",
};

describe("responseSchema と responseParser の一致", () => {
  it("enum の値がパーサの許容値と一致する", () => {
    expect([...SCHEMA_ACTION_TYPES].sort()).toEqual([...VALID_ACTION_TYPES].sort());
    expect([...SCHEMA_DATE_CERTAINTY].sort()).toEqual([...VALID_DATE_CERTAINTY].sort());
    expect([...SCHEMA_TASK_STATUSES].sort()).toEqual([...VALID_BULK_TASK_STATUSES].sort());
  });

  it("スキーマどおりの返答をパーサが落とさずに全項目受け取り、返す項目がスキーマの項目と一致する", () => {
    const raw = JSON.stringify({ reply: "r", proposals: [FULL_PROPOSAL], follow_up_suggestions: ["f"] });
    const parsed = parseAIResponse(raw, "end_turn");
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(RESPONSE_PROPERTIES).sort());
    expect(Object.keys(parsed.proposals[0]).sort()).toEqual(Object.keys(PROPOSAL_PROPERTIES).sort());
    expect(parsed.proposals[0]).toEqual(FULL_PROPOSAL);
    expect(Object.keys(FULL_PROPOSAL).sort()).toEqual(Object.keys(PROPOSAL_PROPERTIES).sort());
  });

  it("パーサが必須とする項目はスキーマでも必須", () => {
    for (const k of ["proposal_id", "title", "action_type"] as const) expect(PROPOSAL_REQUIRED).toContain(k);
    expect(CONSULTATION_RESPONSE_SCHEMA.required).toEqual(expect.arrayContaining(["proposals"]));
  });
});

describe("Anthropic のスキーマ制約（structured outputs）", () => {
  it("全オブジェクトが additionalProperties:false で、required は properties の部分集合", () => {
    let objects = 0;
    walk(CONSULTATION_RESPONSE_SCHEMA, (n) => {
      if (n.type !== "object") return;
      objects++;
      expect(n.additionalProperties).toBe(false);
      const props = Object.keys(n.properties as Node);
      for (const r of n.required as string[]) expect(props).toContain(r);
    });
    expect(objects).toBe(4);
  });

  it("使えないキーワードを含まない", () => {
    const banned = ["minLength", "maxLength", "minimum", "maximum", "multipleOf", "maxItems", "$ref", "pattern"];
    walk(CONSULTATION_RESPONSE_SCHEMA, (n) => {
      for (const b of banned) expect(Object.keys(n)).not.toContain(b);
    });
  });

  it("任意項目（required に無い項目）は合計24個以内", () => {
    let optional = 0;
    walk(CONSULTATION_RESPONSE_SCHEMA, (n) => {
      if (n.type !== "object") return;
      const req = new Set(n.required as string[]);
      optional += Object.keys(n.properties as Node).filter((k) => !req.has(k)).length;
    });
    expect(optional).toBeLessThanOrEqual(24);
  });
});

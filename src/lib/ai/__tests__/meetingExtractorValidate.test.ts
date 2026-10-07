import { describe, it, expect } from "vitest";
import { validateAnalysis, toIsoDateOrNull } from "../meetingExtractor";

const base = {
  summary: "要約",
  new_tasks: [],
  status_updates: [],
  decisions: [],
  risks: [],
};

describe("toIsoDateOrNull", () => {
  it("実在する YYYY-MM-DD はそのまま返す", () => {
    expect(toIsoDateOrNull("2026-10-08")).toBe("2026-10-08");
    expect(toIsoDateOrNull("2028-02-29")).toBe("2028-02-29");
  });

  it("形式違い・実在しない日付・文字列以外は null", () => {
    for (const v of ["2026/10/08", "10月8日", "来週", "2026-1-8", "2026-10-08T00:00:00", " 2026-10-08",
      "2026-02-30", "2026-13-01", "2027-02-29", "0000-00-00", "", null, undefined, 20261008, {}]) {
      expect(toIsoDateOrNull(v)).toBeNull();
    }
  });
});

describe("validateAnalysis", () => {
  it("トップレベルの型が欠けていれば例外", () => {
    expect(() => validateAnalysis(null)).toThrow();
    expect(() => validateAnalysis({ ...base, new_tasks: "x" })).toThrow();
    expect(() => validateAnalysis({ ...base, summary: 1 })).toThrow();
  });

  it("new_tasks の不正な日付は null にする", () => {
    const r = validateAnalysis({
      ...base,
      new_tasks: [
        { name: "A", assignee_short_name: "山本", start_date: "来週月曜", due_date: "2026-02-30", project_hint: null, priority: "high", source_quote: "q" },
        { name: "B", assignee_short_name: null, start_date: "2026-10-12", due_date: "2026-10-16", project_hint: "PJ", priority: null, source_quote: "q" },
      ],
    });
    expect(r.new_tasks[0].start_date).toBeNull();
    expect(r.new_tasks[0].due_date).toBeNull();
    expect(r.new_tasks[1].start_date).toBe("2026-10-12");
    expect(r.new_tasks[1].due_date).toBe("2026-10-16");
  });

  it("new_tasks の priority が想定外なら null、文字列項目が文字列でなければ安全な値にする", () => {
    const r = validateAnalysis({
      ...base,
      new_tasks: [
        { name: "A", assignee_short_name: 3, start_date: null, due_date: null, project_hint: {}, priority: "urgent", source_quote: 5 },
      ],
    });
    expect(r.new_tasks[0].priority).toBeNull();
    expect(r.new_tasks[0].assignee_short_name).toBeNull();
    expect(r.new_tasks[0].project_hint).toBeNull();
    expect(r.new_tasks[0].source_quote).toBe("");
  });

  it("名前の無い new_tasks・オブジェクトでない要素は除く", () => {
    const r = validateAnalysis({
      ...base,
      new_tasks: [null, "x", { name: "" }, { name: 1 }, { name: "残る" }],
    });
    expect(r.new_tasks.map(t => t.name)).toEqual(["残る"]);
  });

  it("status_updates の new_status が5値以外なら候補ごと除く", () => {
    const r = validateAnalysis({
      ...base,
      status_updates: [
        { task_name_hint: "A", suggested_task_id: "t1", new_status: "完了", reason: "r", source_quote: "q" },
        { task_name_hint: "B", suggested_task_id: "t2", new_status: "done", reason: "r", source_quote: "q" },
        { task_name_hint: "C", suggested_task_id: 7, new_status: "on_hold", reason: null, source_quote: null },
      ],
    });
    expect(r.status_updates.map(u => u.task_name_hint)).toEqual(["B", "C"]);
    expect(r.status_updates[1].suggested_task_id).toBeNull();
    expect(r.status_updates[1].reason).toBe("");
    expect(r.status_updates[1].source_quote).toBe("");
  });

  it("decisions / risks は文字列だけ残す", () => {
    const r = validateAnalysis({ ...base, decisions: ["決定", 1, { a: 1 }], risks: [null, "リスク"] });
    expect(r.decisions).toEqual(["決定"]);
    expect(r.risks).toEqual(["リスク"]);
  });
});

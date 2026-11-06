import { describe, it, expect } from "vitest";
import {
  parseVisibleColumns, toggleColumn, sameColumns, filterVisibleColumns,
  DEFAULT_VISIBLE_COLUMNS, TOGGLEABLE_COLUMNS,
} from "../listColumns";

describe("parseVisibleColumns", () => {
  it("正常な配列は表の列順に正規化される", () => {
    expect(parseVisibleColumns(["status", "due_date"])).toEqual(["due_date", "status"]);
  });
  it("空配列は「すべて隠す」として有効", () => {
    expect(parseVisibleColumns([])).toEqual([]);
  });
  it("重複は畳む", () => {
    expect(parseVisibleColumns(["status", "status"])).toEqual(["status"]);
  });
  it("未保存・配列でない・未知の列名・型違いは全列表示に戻す", () => {
    const all = [...DEFAULT_VISIBLE_COLUMNS];
    expect(parseVisibleColumns(undefined)).toEqual(all);
    expect(parseVisibleColumns(null)).toEqual(all);
    expect(parseVisibleColumns("status")).toEqual(all);
    expect(parseVisibleColumns({})).toEqual(all);
    expect(parseVisibleColumns(["status", "bogus"])).toEqual(all);
    expect(parseVisibleColumns(["status", 3])).toEqual(all);
    expect(parseVisibleColumns(["name"])).toEqual(all);
  });
});

describe("toggleColumn / sameColumns", () => {
  it("外す・戻す（順序は正規化）", () => {
    const off = toggleColumn(TOGGLEABLE_COLUMNS, "assignee");
    expect(off).toEqual(["due_date", "status", "priority", "estimated_hours"]);
    expect(toggleColumn(off, "assignee")).toEqual([...TOGGLEABLE_COLUMNS]);
  });
  it("sameColumns は順序に依存しない", () => {
    expect(sameColumns(["status", "due_date"], ["due_date", "status"])).toBe(true);
    expect(sameColumns(["status"], ["due_date"])).toBe(false);
    expect(sameColumns([], ["due_date"])).toBe(false);
  });
});

describe("filterVisibleColumns", () => {
  const defs = [
    { key: "select" }, { key: "due_date" }, { key: "name" }, { key: "assignee" },
    { key: "status" }, { key: "priority" }, { key: "estimated_hours" },
  ];
  it("☐とタスク名は visible に関係なく残る", () => {
    expect(filterVisibleColumns(defs, []).map(c => c.key)).toEqual(["select", "name"]);
  });
  it("指定した列だけが元の順で残る", () => {
    expect(filterVisibleColumns(defs, ["priority", "due_date"]).map(c => c.key))
      .toEqual(["select", "due_date", "name", "priority"]);
  });
  it("全列表示なら全部残る", () => {
    expect(filterVisibleColumns(defs, TOGGLEABLE_COLUMNS)).toHaveLength(7);
  });
});

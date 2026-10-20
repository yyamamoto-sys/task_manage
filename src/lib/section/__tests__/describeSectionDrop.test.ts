import { describe, it, expect } from "vitest";
import type { ProjectSection } from "../../localData/types";
import { UNSECTIONED_KEY, computeSectionDropOrder } from "../sections";
import { describeSectionDrop } from "../describeSectionDrop";

const sec = (id: string, sort_order: number): ProjectSection =>
  ({ id, project_id: "p1", name: `名${id}`, sort_order, is_deleted: false });
const list = [sec("a", 0), sec("b", 1), sec("c", 2)];

describe("describeSectionDrop", () => {
  it("下の見出しへ落とすと『相手』の後に入る（線は下端）", () => {
    expect(describeSectionDrop(list, "a", "c")).toEqual({ side: "bottom", kind: "after", label: "『名c』の後に入ります" });
    expect(describeSectionDrop(list, "a", "b")?.kind).toBe("after");
  });
  it("上の見出しへ落とすと『相手』の前に入る（線は上端）", () => {
    expect(describeSectionDrop(list, "c", "a")).toEqual({ side: "top", kind: "before", label: "『名a』の前に入ります" });
  });
  it("未分類へ落とすと先頭に入る（線は上端）", () => {
    expect(describeSectionDrop(list, "c", UNSECTIONED_KEY)).toEqual({ side: "top", kind: "first", label: "先頭に入ります" });
  });
  it("順番が変わらない位置（自分自身・先頭のものを未分類へ・不明な id）は null", () => {
    expect(describeSectionDrop(list, "b", "b")).toBeNull();
    expect(describeSectionDrop(list, "a", UNSECTIONED_KEY)).toBeNull();
    expect(describeSectionDrop(list, "zzz", "a")).toBeNull();
    expect(describeSectionDrop(list, "a", "zzz")).toBeNull();
  });
  it("実際の並べ替え（computeSectionDropOrder）と結果が食い違わない", () => {
    const keys = [...list.map(s => s.id), UNSECTIONED_KEY];
    for (const from of list.map(s => s.id)) {
      for (const to of keys) {
        const order = computeSectionDropOrder(list, from, to);
        const d = describeSectionDrop(list, from, to);
        expect(d === null).toBe(order === null);
        if (order && d) {
          const pos = order.indexOf(from);
          if (d.kind === "first") expect(pos).toBe(0);
          if (d.kind === "after") expect(order[pos - 1]).toBe(to);
          if (d.kind === "before") expect(order[pos + 1]).toBe(to);
        }
      }
    }
  });
});

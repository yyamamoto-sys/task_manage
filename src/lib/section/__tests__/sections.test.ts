import { describe, it, expect } from "vitest";
import type { Task, ProjectSection } from "../../localData/types";
import {
  sectionsOfProject, nextSectionSortOrder, normalizeSectionName, buildNewSection, computeSectionReorder,
  moveItem, computeSectionMoveOrder, normalizeTaskSection, followParentSection, computeSectionProgress, UNSECTIONED_KEY,
} from "../sections";

const sec = (id: string, project_id: string, sort_order: number, extra: Partial<ProjectSection> = {}): ProjectSection =>
  ({ id, project_id, name: id, sort_order, is_deleted: false, ...extra });

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, name: id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
  is_deleted: false, ...extra,
});

describe("sectionsOfProject / nextSectionSortOrder", () => {
  const all = [sec("b", "p1", 1), sec("a", "p1", 0), sec("x", "p2", 0), sec("d", "p1", 2, { is_deleted: true })];
  it("そのPJの有効なグループを sort_order 順で返す", () => {
    expect(sectionsOfProject(all, "p1").map(s => s.id)).toEqual(["a", "b"]);
  });
  it("PJ未指定は空", () => expect(sectionsOfProject(all, null)).toEqual([]));
  it("次の sort_order は最大+1（削除済みは数えない）", () => {
    expect(nextSectionSortOrder(all, "p1")).toBe(2);
    expect(nextSectionSortOrder(all, "none")).toBe(0);
  });
});

describe("グループ名・作成", () => {
  it("前後の空白を除き、空は作らない", () => {
    expect(normalizeSectionName("  第1回 ")).toBe("第1回");
    expect(normalizeSectionName("   ")).toBeNull();
    expect(normalizeSectionName("あ".repeat(150))?.length).toBe(100);
  });
  it("buildNewSection は末尾の sort_order で作る", () => {
    const s = buildNewSection("p1", " 準備 ", [sec("a", "p1", 3)], "u1", "id-1");
    expect(s).toMatchObject({ id: "id-1", project_id: "p1", name: "準備", sort_order: 4, is_deleted: false, updated_by: "u1" });
    expect(buildNewSection("p1", "", [], "u1")).toBeNull();
  });
});

describe("並べ替え", () => {
  it("変わったものだけ新しい sort_order で返す", () => {
    const cur = [sec("a", "p1", 0), sec("b", "p1", 1), sec("c", "p1", 2)];
    const out = computeSectionReorder(cur, ["b", "a", "c"]);
    expect(out.map(s => [s.id, s.sort_order])).toEqual([["b", 0], ["a", 1]]);
  });
  it("moveItem は範囲外・同位置なら元の配列", () => {
    const l = [1, 2, 3];
    expect(moveItem(l, 0, 0)).toBe(l);
    expect(moveItem(l, 0, 5)).toBe(l);
    expect(moveItem(l, 0, 2)).toEqual([2, 3, 1]);
  });
});

describe("normalizeTaskSection（DB トリガー enforce_task_section_integrity と同じ規則）", () => {
  const sections = [sec("s1", "p1", 0), sec("s2", "p2", 0), sec("sd", "p1", 1, { is_deleted: true })];
  it("変更が無ければ同じオブジェクトを返し、section_id のキーを足さない", () => {
    const t = task("t1");
    const out = normalizeTaskSection(t, [t], sections);
    expect(out).toBe(t);
    expect("section_id" in out).toBe(false);
  });
  it("同じPJのグループはそのまま", () => {
    const t = task("t1", { section_id: "s1" });
    expect(normalizeTaskSection(t, [t], sections)).toBe(t);
  });
  it("別PJのグループ・削除済み・存在しないグループは null に戻る", () => {
    expect(normalizeTaskSection(task("t", { section_id: "s2" }), [], sections).section_id).toBeNull();
    expect(normalizeTaskSection(task("t", { section_id: "sd" }), [], sections).section_id).toBeNull();
    expect(normalizeTaskSection(task("t", { section_id: "zzz" }), [], sections).section_id).toBeNull();
  });
  it("PJなしは null", () => {
    expect(normalizeTaskSection(task("t", { project_id: null, section_id: "s1" }), [], sections).section_id).toBeNull();
  });
  it("PJを変えたら（グループは元のPJのまま）null に戻る", () => {
    expect(normalizeTaskSection(task("t", { project_id: "p2", section_id: "s1" }), [], sections).section_id).toBeNull();
  });
  it("子は親と同じグループ（子の指定は無視）", () => {
    const parent = task("p", { section_id: "s1" });
    const child = task("c", { parent_task_id: "p", section_id: null });
    expect(normalizeTaskSection(child, [parent, child], sections).section_id).toBe("s1");
    const parent2 = task("p2");
    const child2 = task("c2", { parent_task_id: "p2", section_id: "s1" });
    expect(normalizeTaskSection(child2, [parent2, child2], sections).section_id).toBeNull();
  });
});

describe("followParentSection", () => {
  it("親の子だけを揃え、変化が無ければ同じ配列", () => {
    const tasks = [task("p"), task("c1", { parent_task_id: "p" }), task("c2", { parent_task_id: "p", section_id: "s1" }), task("o")];
    const out = followParentSection(tasks, "p", "s1");
    expect(out.find(t => t.id === "c1")?.section_id).toBe("s1");
    expect(out.find(t => t.id === "o")?.section_id).toBeUndefined();
    expect(followParentSection(out, "p", "s1")).toBe(out);
  });
});

describe("computeSectionProgress", () => {
  it("グループごとの完了数／件数（中止は除外・未分類は末尾）", () => {
    const sections = [sec("s1", "p1", 0), sec("s2", "p1", 1)];
    const tasks = [
      task("a", { section_id: "s1", status: "done" }), task("b", { section_id: "s1" }),
      task("c", { section_id: "s2", status: "cancelled" }), task("d"),
    ];
    const rows = computeSectionProgress(tasks, sections, "p1");
    expect(rows.map(r => [r.key, r.done, r.total])).toEqual([["s1", 1, 2], ["s2", 0, 0], [UNSECTIONED_KEY, 0, 1]]);
  });
});

describe("computeSectionMoveOrder（⋮の一番上へ・上へ・下へ・一番下へ）", () => {
  const list = [sec("a", "p1", 0), sec("b", "p1", 1), sec("c", "p1", 2)];
  it("一番下のものを一番上へ", () => expect(computeSectionMoveOrder(list, "c", "top")).toEqual(["c", "a", "b"]));
  it("先頭のものを一番下へ", () => expect(computeSectionMoveOrder(list, "a", "bottom")).toEqual(["b", "c", "a"]));
  it("上へ・下へは1つだけ動く", () => {
    expect(computeSectionMoveOrder(list, "b", "up")).toEqual(["b", "a", "c"]);
    expect(computeSectionMoveOrder(list, "b", "down")).toEqual(["a", "c", "b"]);
  });
  it("端・見つからない id は null（何もしない）", () => {
    expect(computeSectionMoveOrder(list, "a", "top")).toBeNull();
    expect(computeSectionMoveOrder(list, "a", "up")).toBeNull();
    expect(computeSectionMoveOrder(list, "c", "down")).toBeNull();
    expect(computeSectionMoveOrder(list, "c", "bottom")).toBeNull();
    expect(computeSectionMoveOrder(list, "zzz", "top")).toBeNull();
    expect(computeSectionMoveOrder([sec("a", "p1", 0)], "a", "top")).toBeNull();
  });
});

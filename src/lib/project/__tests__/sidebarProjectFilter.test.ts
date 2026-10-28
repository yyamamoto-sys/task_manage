import { describe, it, expect } from "vitest";
import { filterSidebarProjects, sortProjectsMineFirst, type SidebarProjectStatus } from "../sidebarProjectFilter";

interface P { id: string; is_deleted?: boolean; status: SidebarProjectStatus; }

function mk(id: string, status: SidebarProjectStatus, is_deleted = false): P {
  return { id, status, is_deleted };
}

describe("filterSidebarProjects", () => {
  const projects: P[] = [
    mk("active-1", "active"),
    mk("completed-1", "completed"),
    mk("archived-1", "archived"),
    mk("deleted-1", "active", true),
  ];

  it("既定（showCompletedAndArchived=false）：activeのみ出す・completed/archivedは隠す・削除済みは常に隠す", () => {
    const result = filterSidebarProjects(projects, { showCompletedAndArchived: false });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("showCompletedAndArchived=true：completedもarchivedも出す", () => {
    const result = filterSidebarProjects(projects, { showCompletedAndArchived: true });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1", "archived-1"]);
  });

  it("pinnedProjectId：archivedかつトグルOFFでも、選択中のPJだけは表示する", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, pinnedProjectId: "archived-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "archived-1"]);
  });

  it("pinnedProjectId：completedかつトグルOFFでも、選択中のPJだけは表示する", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, pinnedProjectId: "completed-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1"]);
  });

  it("pinnedProjectId：削除済みのPJはpinされていても出さない", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, pinnedProjectId: "deleted-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("pinnedProjectIdがnull：通常どおりの絞り込みのみ", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, pinnedProjectId: null,
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("showCompletedAndArchived=false（基準ケース）：completed/archivedを除外", () => {
    const result = filterSidebarProjects(
      [mk("a", "active"), mk("b", "completed"), mk("c", "archived")],
      { showCompletedAndArchived: false },
    );
    expect(result.map(p => p.id)).toEqual(["a"]);
  });

});

describe("sortProjectsMineFirst", () => {
  const list = ["a", "b", "c", "d", "e"].map(id => ({ id }));

  it("担当ありのPJを上にまとめ、各グループ内は元の順を保つ（安定ソート）", () => {
    expect(sortProjectsMineFirst(list, new Set(["d", "b"])).map(p => p.id)).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("PJを1件も減らさない（担当が0件でも全件でも件数は同じ）", () => {
    expect(sortProjectsMineFirst(list, new Set()).map(p => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(sortProjectsMineFirst(list, new Set(["a", "b", "c", "d", "e"])).map(p => p.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("担当ありの集合に実在しないidが混じっていても無視する", () => {
    expect(sortProjectsMineFirst(list, new Set(["zzz", "c"])).map(p => p.id)).toEqual(["c", "a", "b", "d", "e"]);
  });
});

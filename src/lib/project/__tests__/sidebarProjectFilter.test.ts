import { describe, it, expect } from "vitest";
import { filterSidebarProjects, type SidebarProjectStatus } from "../sidebarProjectFilter";

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

  it("既定（showCompletedAndArchived=false・mineOnly=false）：activeのみ出す・completed/archivedは隠す・削除済みは常に隠す", () => {
    const result = filterSidebarProjects(projects, { showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set() });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("showCompletedAndArchived=true：completedもarchivedも出す", () => {
    const result = filterSidebarProjects(projects, { showCompletedAndArchived: true, mineOnly: false, myProjectIds: new Set() });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1", "archived-1"]);
  });

  it("mineOnly=true：myProjectIdsに無いものは（トグルに関わらず）隠す", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: true, mineOnly: true, myProjectIds: new Set(["active-1"]),
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("mineOnly=true・showCompletedAndArchived=false・自分のPJが1件もない：空", () => {
    const result = filterSidebarProjects(projects, { showCompletedAndArchived: false, mineOnly: true, myProjectIds: new Set() });
    expect(result).toEqual([]);
  });

  it("pinnedProjectId：archivedかつトグルOFFでも、選択中のPJだけは表示する", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: "archived-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "archived-1"]);
  });

  it("pinnedProjectId：completedかつトグルOFFでも、選択中のPJだけは表示する", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: "completed-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1"]);
  });

  it("pinnedProjectId：mineOnlyの絞り込みまでは免除しない（既存挙動と同じ扱い）", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, mineOnly: true, myProjectIds: new Set(), pinnedProjectId: "archived-1",
    });
    expect(result).toEqual([]);
  });

  it("pinnedProjectId：削除済みのPJはpinされていても出さない", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: "deleted-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("pinnedProjectIdがnull：通常どおりの絞り込みのみ", () => {
    const result = filterSidebarProjects(projects, {
      showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: null,
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("mineOnly=false・showCompletedAndArchived=false（全パターンの基準ケース）：completed/archivedを除外", () => {
    const result = filterSidebarProjects(
      [mk("a", "active"), mk("b", "completed"), mk("c", "archived")],
      { showCompletedAndArchived: false, mineOnly: false, myProjectIds: new Set() },
    );
    expect(result.map(p => p.id)).toEqual(["a"]);
  });

  it("mineOnly=true・showCompletedAndArchived=true：mineに含まれるものだけ（completed/archived込み）", () => {
    const result = filterSidebarProjects(
      [mk("a", "active"), mk("b", "completed"), mk("c", "archived")],
      { showCompletedAndArchived: true, mineOnly: true, myProjectIds: new Set(["a", "c"]) },
    );
    expect(result.map(p => p.id)).toEqual(["a", "c"]);
  });
});

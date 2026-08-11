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

  it("既定（showArchived=false・mineOnly=false）：active/completedは出す・archivedは隠す・削除済みは常に隠す", () => {
    const result = filterSidebarProjects(projects, { showArchived: false, mineOnly: false, myProjectIds: new Set() });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1"]);
  });

  it("showArchived=true：archivedも出す", () => {
    const result = filterSidebarProjects(projects, { showArchived: true, mineOnly: false, myProjectIds: new Set() });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1", "archived-1"]);
  });

  it("mineOnly=true：myProjectIdsに無いものは（archivedトグルに関わらず）隠す", () => {
    const result = filterSidebarProjects(projects, {
      showArchived: true, mineOnly: true, myProjectIds: new Set(["active-1"]),
    });
    expect(result.map(p => p.id)).toEqual(["active-1"]);
  });

  it("mineOnly=true・showArchived=false・自分のPJが1件もない：空", () => {
    const result = filterSidebarProjects(projects, { showArchived: false, mineOnly: true, myProjectIds: new Set() });
    expect(result).toEqual([]);
  });

  it("pinnedProjectId：archivedかつトグルOFFでも、選択中のPJだけは表示する", () => {
    const result = filterSidebarProjects(projects, {
      showArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: "archived-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1", "archived-1"]);
  });

  it("pinnedProjectId：mineOnlyの絞り込みまでは免除しない（既存挙動と同じ扱い）", () => {
    const result = filterSidebarProjects(projects, {
      showArchived: false, mineOnly: true, myProjectIds: new Set(), pinnedProjectId: "archived-1",
    });
    expect(result).toEqual([]);
  });

  it("pinnedProjectId：削除済みのPJはpinされていても出さない", () => {
    const result = filterSidebarProjects(projects, {
      showArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: "deleted-1",
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1"]);
  });

  it("pinnedProjectIdがnull：通常どおりの絞り込みのみ", () => {
    const result = filterSidebarProjects(projects, {
      showArchived: false, mineOnly: false, myProjectIds: new Set(), pinnedProjectId: null,
    });
    expect(result.map(p => p.id)).toEqual(["active-1", "completed-1"]);
  });

  it("mineOnly=false・showArchived=false（全パターンの基準ケース）：archivedのみ除外", () => {
    const result = filterSidebarProjects(
      [mk("a", "active"), mk("b", "completed"), mk("c", "archived")],
      { showArchived: false, mineOnly: false, myProjectIds: new Set() },
    );
    expect(result.map(p => p.id)).toEqual(["a", "b"]);
  });

  it("mineOnly=true・showArchived=true：mineに含まれるものだけ（archived込み）", () => {
    const result = filterSidebarProjects(
      [mk("a", "active"), mk("b", "completed"), mk("c", "archived")],
      { showArchived: true, mineOnly: true, myProjectIds: new Set(["a", "c"]) },
    );
    expect(result.map(p => p.id)).toEqual(["a", "c"]);
  });
});

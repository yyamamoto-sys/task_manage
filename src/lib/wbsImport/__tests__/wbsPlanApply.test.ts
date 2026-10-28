import { describe, it, expect } from "vitest";
import { parseWbsGrid, type WbsCell, type WbsParseResult } from "../wbsParse";
import { buildWbsPlan, type WbsPlanContext } from "../wbsPlan";
import { applyWbsPlan, type WbsApplyDeps } from "../wbsApply";
import type { Task } from "../../localData/types";
import { HEADER } from "./wbsTestHelpers";

const GRID: WbsCell[][] = [
  [...HEADER, "担当者"],
  ["1", "G", "準備", null, null, null, null, null, null],
  ["1.1", "P", "要件整理", "2026-01-05", "2026-01-09", 5, null, "完了", "ヤマ"],
  ["1.1.1", "C", "ヒアリング", "2026-01-05", "2026-01-06", 2, null, "完了", "存在しない人"],
  ["1.1.2", "C", "まとめ", "2026-01-07", "2026-01-09", 3, "1.1.1", "ユーザー・仮", null],
  ["1.2", "P", "判断日", "2026-01-12", "2026-01-12", 1, "1.1", "マイルストーン・社内確認", null],
  ["1.3", "P", "日付なしの節目", null, null, null, null, "マイルストーン", null],
  ["2", "G", "実施", null, null, null, null, null, null],
  ["2.1", "P", "構築", "2026-01-13", "2026-01-20", 6, "1.2", null, null],
];

function parsed(): WbsParseResult {
  const o = parseWbsGrid(GRID);
  if (!o.ok) throw new Error(o.error);
  return o.result;
}

function ctx(over: Partial<WbsPlanContext> = {}): WbsPlanContext {
  let n = 0;
  return {
    target: { kind: "new", name: "架空PJ", purpose: "検証", color: "#000" },
    currentUserId: "me",
    members: [{ id: "u1", short_name: "ヤマ", display_name: "山田 太郎" }, { id: "me", short_name: "自分", display_name: "自分 本人" }],
    existingTasks: [],
    existingSections: [],
    now: "2026-10-28T00:00:00.000Z",
    newId: () => `id${++n}`,
    ...over,
  };
}

describe("buildWbsPlan", () => {
  it("新しいPJ：グループ・親子・タグ・メモ・担当者・並び順・先行タスク・マイルストーン", () => {
    const plan = buildWbsPlan(parsed(), ctx());
    expect(plan.project).toMatchObject({ name: "架空PJ", start_date: "2026-01-05", end_date: "2026-01-20", owner_member_id: "me" });
    expect(plan.sections.map(s => [s.name, s.sort_order])).toEqual([["準備", 0], ["実施", 1]]);
    expect(plan.tasks.map(t => t.name)).toEqual(["要件整理", "ヒアリング", "まとめ", "判断日", "日付なしの節目", "構築"]);
    const t = (name: string) => plan.tasks.find(x => x.name === name) as Task;
    const secPrep = plan.sections[0].id;
    expect(t("ヒアリング")).toMatchObject({ parent_task_id: t("要件整理").id, section_id: secPrep, status: "done" });
    expect(t("構築").section_id).toBe(plan.sections[1].id);
    expect(t("まとめ").tags).toEqual(["ユーザー", "仮"]);
    expect(t("判断日").comment).toBe("備考：社内確認");
    expect(t("判断日").tags).toEqual(["マイルストーン"]);
    expect(t("要件整理").assignee_member_ids).toEqual(["u1"]);
    expect(t("ヒアリング").assignee_member_ids).toEqual(["me"]);
    expect(plan.extraWarnings.get(2)?.[0]).toContain("照合できません");
    // 並び順：トップ0,1,2,3、子0,1
    expect(plan.tasks.filter(x => !x.parent_task_id).map(x => x.display_order)).toEqual([0, 1, 2, 3]);
    expect(plan.tasks.filter(x => x.parent_task_id).map(x => x.display_order)).toEqual([0, 1]);
    // 親は子の保存で状態が動くため todo で作り、最後に本来の完了へ合わせる
    expect(t("要件整理").status).toBe("todo");
    expect(plan.finalStatuses).toEqual([{ taskId: t("要件整理").id, status: "done" }]);
    expect(plan.dependencies).toHaveLength(3);
    expect(plan.dependencies).toContainEqual({ predecessorTaskId: t("ヒアリング").id, successorTaskId: t("まとめ").id });
    expect(plan.milestones.map(m => [m.name, m.date])).toEqual([["判断日", "2026-01-12"]]);
    expect([...plan.extraWarnings.values()].flat().join()).toContain("日付が無いためマイルストーン");
  });

  it("既存PJ：同名グループは既存へ入れ、無ければ作る。並びは末尾から", () => {
    const existingSections = [{ id: "s-old", project_id: "pj", name: "準備", sort_order: 4, is_deleted: false }];
    const existingTasks = [{ project_id: "pj", parent_task_id: null, is_deleted: false, display_order: 7 } as Task];
    const plan = buildWbsPlan(parsed(), ctx({ target: { kind: "existing", projectId: "pj" }, existingSections, existingTasks }));
    expect(plan.project).toBeNull();
    expect(plan.reusedSectionNames).toEqual(["準備"]);
    expect(plan.sections.map(s => [s.name, s.sort_order])).toEqual([["実施", 5]]);
    expect(plan.tasks[0]).toMatchObject({ section_id: "s-old", project_id: "pj", display_order: 8 });
  });

  it("担当者の列が無ければ取り込む本人", () => {
    const o = parseWbsGrid([HEADER, ["1", "P", "a", null, null, null, null, null]]);
    if (!o.ok) throw new Error(o.error);
    const plan = buildWbsPlan(o.result, ctx());
    expect(plan.tasks[0].assignee_member_ids).toEqual(["me"]);
    expect(plan.tasks[0].section_id).toBeUndefined();
  });
});

function makeDeps(failAt?: { fn: "saveTask" | "addTaskDependency" | "saveMilestone"; nth: number }) {
  const log: string[] = [];
  const tasks = new Map<string, Task>();
  const calls: Record<string, number> = {};
  const hit = (fn: string) => {
    calls[fn] = (calls[fn] ?? 0) + 1;
    if (failAt && failAt.fn === fn && failAt.nth === calls[fn]) throw new Error(`${fn} 失敗`);
  };
  const deps: WbsApplyDeps = {
    saveProject: async p => { log.push(`+project:${p.name}`); },
    deleteProject: async id => { log.push(`-project:${id}`); },
    saveProjectSection: async s => { log.push(`+section:${s.name}`); },
    deleteProjectSection: async id => { log.push(`-section:${id}`); },
    saveTask: async t => { hit("saveTask"); tasks.set(t.id, t); log.push(`+task:${t.name}:${t.status}`); },
    deleteTask: async id => { log.push(`-task:${id}`); },
    getTask: id => tasks.get(id),
    getTaskStatus: id => tasks.get(id)?.status,
    addTaskDependency: async (p, s) => { hit("addTaskDependency"); log.push(`+dep:${p}>${s}`); },
    findDependencyId: (p, s) => `${p}>${s}`,
    removeTaskDependency: async id => { log.push(`-dep:${id}`); },
    saveMilestone: async m => { hit("saveMilestone"); log.push(`+ms:${m.name}`); },
    deleteMilestone: async id => { log.push(`-ms:${id}`); },
  };
  return { deps, log };
}

describe("applyWbsPlan", () => {
  it("PJ→グループ→タスク→親の状態合わせ→先行タスク→マイルストーンの順に書く", async () => {
    const plan = buildWbsPlan(parsed(), ctx());
    const { deps, log } = makeDeps();
    const out = await applyWbsPlan(plan, "me", deps);
    expect(out).toEqual({ ok: true, counts: { project: 1, sections: 2, tasks: 6, dependencies: 3, milestones: 1 } });
    const kinds = log.map(l => l.split(":")[0]);
    expect(kinds[0]).toBe("+project");
    const lastTask = kinds.lastIndexOf("+task");
    expect(kinds.indexOf("+dep")).toBeGreaterThan(lastTask);
    expect(kinds.indexOf("+ms")).toBeGreaterThan(kinds.lastIndexOf("+dep"));
    expect(log).toContain("+task:要件整理:todo");
    expect(log.filter(l => l.startsWith("+task:要件整理")).pop()).toBe("+task:要件整理:done");
  });

  it("途中で失敗したら作ったものを逆順に取り消し、どの段階で何件まで書けたかを返す", async () => {
    const plan = buildWbsPlan(parsed(), ctx());
    const { deps, log } = makeDeps({ fn: "addTaskDependency", nth: 2 });
    const out = await applyWbsPlan(plan, "me", deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stage).toBe("先行タスクの設定");
    expect(out.written).toEqual({ project: 1, sections: 2, tasks: 6, dependencies: 1, milestones: 0 });
    expect(out.rolledBack).toBe(true);
    expect(log.filter(l => l.startsWith("-")).map(l => l.split(":")[0])).toEqual(
      ["-dep", "-task", "-task", "-task", "-task", "-task", "-task", "-section", "-section", "-project"],
    );
  });

  it("取り消しも失敗したら、残った件数を返す", async () => {
    const plan = buildWbsPlan(parsed(), ctx({ target: { kind: "existing", projectId: "pj" } }));
    const { deps } = makeDeps({ fn: "saveTask", nth: 3 });
    deps.deleteTask = async id => { if (id === plan.tasks[0].id) throw new Error("削除失敗"); };
    const out = await applyWbsPlan(plan, "me", deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.written.tasks).toBe(2);
    expect(out.rolledBack).toBe(false);
    expect(out.remaining.tasks).toBe(1);
    expect(out.remaining.project).toBe(0);
  });
});

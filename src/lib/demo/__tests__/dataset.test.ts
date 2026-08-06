// src/lib/demo/__tests__/dataset.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）モード用データの機械的な検証。「実データが混ざる」
// 「参照が壊れる」は事故になるため、ここで固定する。
// buildDemoDataset() 自体はテストから静的importしてよい（テストファイルは
// 本番バンドルに含まれないため Section 19 の対象外）。production コード側から
// dataset.ts を静的importしていないことは、このファイル末尾のソース走査テストで
// 別途検証する。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoDataset } from "../dataset";
import { DEMO_GROUP_ID, GUEST_ASSIGNED_TASK_IDS } from "../constants";
import { canAddDependency } from "../../dependencies/cycleCheck";
import { computeOverloadRanges } from "../../gantt/overload";
import { addDays } from "../../date";

describe("buildDemoDataset", () => {
  const dataset = buildDemoDataset();

  it("PJ・タスク・メンバー・OKRの規模が要求どおりである", () => {
    expect(dataset.projects.length).toBeGreaterThanOrEqual(5);
    expect(dataset.projects.length).toBeLessThanOrEqual(6);
    expect(dataset.tasks.length).toBeGreaterThanOrEqual(50);
    expect(dataset.tasks.length).toBeLessThanOrEqual(70);
    expect(dataset.members.length).toBeGreaterThanOrEqual(5);
    expect(dataset.members.length).toBeLessThanOrEqual(6);
    expect(dataset.objectives.length).toBe(1);
    expect(dataset.keyResults.length).toBeGreaterThanOrEqual(2);
    expect(dataset.keyResults.length).toBeLessThanOrEqual(3);
  });

  describe("実データ混入の検知：id接頭辞とgroup_id", () => {
    it("全エンティティのidが demo- 接頭辞である", () => {
      const allIds = [
        ...dataset.members.map(m => m.id),
        ...dataset.projects.map(p => p.id),
        ...dataset.tasks.map(t => t.id),
        ...dataset.objectives.map(o => o.id),
        ...dataset.keyResults.map(k => k.id),
        ...dataset.taskForces.map(tf => tf.id),
        ...dataset.todos.map(td => td.id),
        ...dataset.taskDependencies.map(d => d.id),
        ...dataset.milestones.map(m => m.id),
      ];
      expect(allIds.length).toBeGreaterThan(0);
      for (const id of allIds) {
        expect(id.startsWith("demo-")).toBe(true);
      }
    });

    it("group_idを持つエンティティは全て DEMO_GROUP_ID である", () => {
      for (const m of dataset.members) expect(m.group_id).toBe(DEMO_GROUP_ID);
      for (const p of dataset.projects) expect(p.group_id).toBe(DEMO_GROUP_ID);
      for (const t of dataset.tasks) expect(t.group_id).toBe(DEMO_GROUP_ID);
      for (const o of dataset.objectives) expect(o.group_id).toBe(DEMO_GROUP_ID);
      for (const d of dataset.taskDependencies) expect(d.group_id).toBe(DEMO_GROUP_ID);
    });
  });

  describe("参照整合性", () => {
    const memberIds = new Set(dataset.members.map(m => m.id));
    const projectIds = new Set(dataset.projects.map(p => p.id));
    const taskIds = new Set(dataset.tasks.map(t => t.id));
    const todoIds = new Set(dataset.todos.map(t => t.id));
    const tfIds = new Set(dataset.taskForces.map(tf => tf.id));
    const krIds = new Set(dataset.keyResults.map(k => k.id));
    const objIds = new Set(dataset.objectives.map(o => o.id));

    it("task.project_id は存在するPJを指す（nullは許容）", () => {
      for (const t of dataset.tasks) {
        if (t.project_id != null) expect(projectIds.has(t.project_id)).toBe(true);
      }
    });

    it("task.assignee_member_id は存在するメンバーを指す", () => {
      for (const t of dataset.tasks) {
        expect(memberIds.has(t.assignee_member_id)).toBe(true);
      }
    });

    it("task.parent_task_id は存在するタスクを指す（nullは許容）", () => {
      for (const t of dataset.tasks) {
        if (t.parent_task_id != null) expect(taskIds.has(t.parent_task_id)).toBe(true);
      }
    });

    it("task.todo_ids の参照先は存在する", () => {
      for (const t of dataset.tasks) {
        for (const id of t.todo_ids) expect(todoIds.has(id)).toBe(true);
      }
    });

    it("taskDependency の predecessor/successor は存在するタスクを指す", () => {
      for (const d of dataset.taskDependencies) {
        expect(taskIds.has(d.predecessor_task_id)).toBe(true);
        expect(taskIds.has(d.successor_task_id)).toBe(true);
      }
    });

    it("milestone.project_id は存在するPJを指す", () => {
      for (const m of dataset.milestones) {
        expect(projectIds.has(m.project_id)).toBe(true);
      }
    });

    it("keyResult.objective_id / taskForce.kr_id / todo.tf_id は存在する親を指す", () => {
      for (const kr of dataset.keyResults) expect(objIds.has(kr.objective_id)).toBe(true);
      for (const tf of dataset.taskForces) expect(krIds.has(tf.kr_id)).toBe(true);
      for (const td of dataset.todos) expect(tfIds.has(td.tf_id)).toBe(true);
    });

    it("taskForce.leader_member_id は存在するメンバーを指す（nullは許容）", () => {
      for (const tf of dataset.taskForces) {
        if (tf.leader_member_id != null) expect(memberIds.has(tf.leader_member_id)).toBe(true);
      }
    });

    it("依存関係グラフに循環がない（canAddDependencyで1本ずつ再検証）", () => {
      const soFar: { predecessor_task_id: string; successor_task_id: string }[] = [];
      for (const d of dataset.taskDependencies) {
        const result = canAddDependency(soFar, d.predecessor_task_id, d.successor_task_id);
        expect(result.ok).toBe(true);
        soFar.push(d);
      }
    });
  });

  describe("画面要件の充足", () => {
    it("タスクのステータスが5種類すべて含まれる", () => {
      const statuses = new Set(dataset.tasks.map(t => t.status));
      const expected = ["todo", "in_progress", "done", "on_hold", "cancelled"] as const;
      for (const s of expected) {
        expect(statuses.has(s)).toBe(true);
      }
    });

    it("タスク依存関係が1本以上ある", () => {
      expect(dataset.taskDependencies.length).toBeGreaterThan(0);
    });

    it("ベースライン日付（当初計画）が入ったタスクが1件以上ある", () => {
      const withBaseline = dataset.tasks.filter(t => t.baseline_start_date && t.baseline_due_date);
      expect(withBaseline.length).toBeGreaterThan(0);
    });

    it("マイルストーンが1件以上ある", () => {
      expect(dataset.milestones.length).toBeGreaterThan(0);
    });

    it("優先度に high/mid/low のバリエーションがある", () => {
      const priorities = new Set(dataset.tasks.map(t => t.priority));
      expect(priorities.has("high")).toBe(true);
      expect(priorities.has("mid")).toBe(true);
      expect(priorities.has("low")).toBe(true);
    });

    it("タグが付いたタスクが複数ある", () => {
      const tagged = dataset.tasks.filter(t => (t.tags ?? []).length > 0);
      expect(tagged.length).toBeGreaterThan(1);
    });

    it("親子タスク（parent_task_id）が存在する", () => {
      expect(dataset.tasks.some(t => t.parent_task_id != null)).toBe(true);
    });

    it("OKR：Objective→KR→TF→ToDo→Task の紐づけが1セット以上通っている", () => {
      const linked = dataset.tasks.filter(t => t.todo_ids.length > 0);
      expect(linked.length).toBeGreaterThan(0);
      for (const t of linked) {
        for (const todoId of t.todo_ids) {
          const todo = dataset.todos.find(td => td.id === todoId);
          expect(todo).toBeTruthy();
          const tf = dataset.taskForces.find(f => f.id === todo!.tf_id);
          expect(tf).toBeTruthy();
          const kr = dataset.keyResults.find(k => k.id === tf!.kr_id);
          expect(kr).toBeTruthy();
          expect(dataset.objectives.some(o => o.id === kr!.objective_id)).toBe(true);
        }
      }
    });

    it("1人のメンバーに過負荷帯（同時アクティブタスク4件以上）が発生する期間がある", () => {
      // ガントの人別ビューが実際に使う関数（lib/gantt/overload.ts）そのもので判定する
      // （真実の源を二重化しない）。
      const rangeStart = addDays(new Date(), -60);
      const rangeEnd = addDays(new Date(), 120);
      const byMember = new Map<string, typeof dataset.tasks>();
      for (const t of dataset.tasks) {
        if (t.status !== "todo" && t.status !== "in_progress") continue;
        const list = byMember.get(t.assignee_member_id) ?? [];
        list.push(t);
        byMember.set(t.assignee_member_id, list);
      }
      const anyOverloaded = [...byMember.values()].some(
        tasks => computeOverloadRanges(tasks, rangeStart, rangeEnd).length > 0,
      );
      expect(anyOverloaded).toBe(true);
    });
  });

  describe("ゲスト自身の担当タスク（マイページ既定ウィジェット用）", () => {
    it("GUEST_ASSIGNED_TASK_IDS はすべて dataset.tasks に存在する", () => {
      const taskIds = new Set(dataset.tasks.map(t => t.id));
      for (const id of GUEST_ASSIGNED_TASK_IDS) expect(taskIds.has(id)).toBe(true);
    });

    it("ゲスト担当タスクは今週（0〜7日以内）に期日があり、工数が入力されている", () => {
      for (const id of GUEST_ASSIGNED_TASK_IDS) {
        const t = dataset.tasks.find(x => x.id === id)!;
        expect(t.due_date).toBeTruthy();
        expect(t.estimated_hours).not.toBeNull();
        expect(t.status === "todo" || t.status === "in_progress").toBe(true);
      }
    });
  });
});

// ===== 静的importの禁止（Section 19：ダウンロード量の最小化） =====
//
// dataset.ts はサンプルデータ本体（重い）のため、「サンプルを見る」を押した人だけが
// ダウンロードするよう動的importでのみ読み込む設計にしている。将来誰かが誤って
// 静的importに戻すと、通常利用者のバンドルにサンプルデータが混ざってしまうため、
// ソースを走査して防ぐ（modalStyles.test.ts / logout.test.ts と同じ流儀）。

describe("dataset.ts は動的importでのみ読み込まれる（静的import禁止）", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const SRC_DIR = path.resolve(__dirname, "../../../");

  function collectStaticImportSites(dir: string, results: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectStaticImportSites(full, results);
      } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
        const content = fs.readFileSync(full, "utf-8");
        // `import ... from ".../dataset"`（静的import）のみを検出する。
        // `import(".../dataset")`（動的import・関数呼び出し形）は対象外。
        const staticImportRe = /import\s+(?:type\s+)?[^;]*?\bfrom\s+["'][^"']*\/demo\/dataset["']/g;
        if (staticImportRe.test(content)) {
          results.push(path.relative(SRC_DIR, full).replace(/\\/g, "/"));
        }
      }
    }
    return results;
  }

  it("dataset.ts を静的importしているのはテストファイル以外に存在しない", () => {
    const sites = collectStaticImportSites(SRC_DIR, []);
    expect(sites).toEqual([]);
  });
});

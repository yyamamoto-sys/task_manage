import { describe, it, expect } from "vitest";
import type { Task, TaskDependency, TaskTaskForce, TaskProject } from "../../localData/types";
import {
  replaceInName,
  buildDuplicatedTasks,
  buildDuplicatedTaskForceLinks,
  buildDuplicatedTaskProjectLinks,
} from "../duplicateSelectedTasks";
import { computeInheritOffsetDays } from "../inheritTaskDates";
import { buildInheritedDependencies } from "../taskInheritance";

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t-1", name: "タスク", project_id: "pj-1", todo_ids: [],
    assignee_member_id: "m-1", assignee_member_ids: ["m-1"], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    ...over,
  };
}

let idCounter = 0;
function makeGenerateId() {
  idCounter = 0;
  return () => `new-${++idCounter}`;
}

describe("replaceInName", () => {
  it("findが空なら置換しない", () => {
    expect(replaceInName("第1回セミナー", "", "第2回")).toBe("第1回セミナー");
  });

  it("findがnameに含まれていなければ変化しない（対象が無い場合）", () => {
    expect(replaceInName("キックオフ", "第1回", "第2回")).toBe("キックオフ");
  });

  it("findをreplaceに置き換える", () => {
    expect(replaceInName("第1回セミナー準備", "第1回", "第2回")).toBe("第2回セミナー準備");
  });

  it("正規表現の特殊文字を含むfindもリテラルとして扱う", () => {
    expect(replaceInName("企画（案）打合せ", "（案）", "（確定）")).toBe("企画（確定）打合せ");
  });

  it("複数箇所に出現する場合は全て置換する", () => {
    expect(replaceInName("第1回準備・第1回本番", "第1回", "第2回")).toBe("第2回準備・第2回本番");
  });
});

describe("buildDuplicatedTasks — 日付移動", () => {
  it("基準より後（offset正）：開始日・期日ともに後ろへ移動する", () => {
    const tasks = [makeTask({ id: "t-1", start_date: "2026-09-01", due_date: "2026-09-10" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: 7, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBe("2026-09-08");
    expect(result[0].due_date).toBe("2026-09-17");
  });

  it("基準より前（offset負）：前へ移動する", () => {
    const tasks = [makeTask({ start_date: "2026-09-01", due_date: "2026-09-10" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: -5, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBe("2026-08-27");
    expect(result[0].due_date).toBe("2026-09-05");
  });

  it("基準と当日同じ（offset=0）：日付は変わらない", () => {
    const tasks = [makeTask({ start_date: "2026-09-01", due_date: "2026-09-10" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: 0, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBe("2026-09-01");
    expect(result[0].due_date).toBe("2026-09-10");
  });

  it("開始日のみ：期日はnullのまま維持される", () => {
    const tasks = [makeTask({ start_date: "2026-09-01", due_date: null })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: 7, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBe("2026-09-08");
    expect(result[0].due_date).toBeNull();
  });

  it("期日のみ：開始日はnullのまま維持される", () => {
    const tasks = [makeTask({ start_date: null, due_date: "2026-09-10" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: 7, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBeNull();
    expect(result[0].due_date).toBe("2026-09-17");
  });

  it("両方なし：offsetが有効でも両方nullのまま", () => {
    const tasks = [makeTask({ start_date: null, due_date: null })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: 7, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBeNull();
    expect(result[0].due_date).toBeNull();
  });

  it("dateOffsetDaysがnull（基準未確定）：両方nullになる", () => {
    const tasks = [makeTask({ start_date: "2026-09-01", due_date: "2026-09-10" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].start_date).toBeNull();
    expect(result[0].due_date).toBeNull();
  });

  it("月跨ぎ：8/28+7日=9/4", () => {
    const offset = computeInheritOffsetDays("2026-08-28", "2026-09-04");
    const tasks = [makeTask({ due_date: "2026-08-28" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: offset, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].due_date).toBe("2026-09-04");
  });

  it("年跨ぎ：12/28+7日=翌年1/4", () => {
    const offset = computeInheritOffsetDays("2026-12-28", "2027-01-04");
    const tasks = [makeTask({ due_date: "2026-12-28" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: offset, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].due_date).toBe("2027-01-04");
  });

  it("うるう年：2028/2/28+1日=2028/2/29（うるう年の存在を正しく計算する）", () => {
    const offset = computeInheritOffsetDays("2028-02-28", "2028-02-29");
    expect(offset).toBe(1);
    const tasks = [makeTask({ due_date: "2028-02-28" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: offset, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].due_date).toBe("2028-02-29");
  });

  it("うるう年をまたぐ基準移動：平年2027/2/28から翌年うるう年2028/2/28へ移動しても暦日差分は365日で計算される", () => {
    const offset = computeInheritOffsetDays("2027-02-28", "2028-02-28");
    const tasks = [makeTask({ due_date: "2027-03-01" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: offset, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    // 2027-02-28 → 2028-02-28 は365日（2028がうるう年でも2/29をまだ通過していないため）
    expect(offset).toBe(365);
    expect(result[0].due_date).toBe("2028-02-29"); // 2027-03-01 + 365日 = 2028-02-29（うるう年）
  });
});

describe("buildDuplicatedTasks — 名前置換", () => {
  it("nameFind/nameReplaceを全タスクの名前に適用する", () => {
    const tasks = [makeTask({ id: "t-1", name: "第1回：企画" }), makeTask({ id: "t-2", name: "第1回：準備" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "第1回", nameReplace: "第2回",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].name).toBe("第2回：企画");
    expect(result[1].name).toBe("第2回：準備");
  });

  it("置換対象が名前に無い場合は元の名前のまま", () => {
    const tasks = [makeTask({ name: "キックオフ" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "第1回", nameReplace: "第2回",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].name).toBe("キックオフ");
  });
});

describe("buildDuplicatedTasks — 引き継ぐ/リセットするフィールド", () => {
  it("project_id・担当者・優先度・見積工数・コメント・todo_ids・タグを引き継ぐ", () => {
    const tasks = [makeTask({
      project_id: "pj-1", assignee_member_id: "m-1", assignee_member_ids: ["m-1", "m-2"],
      priority: "high", estimated_hours: 8, comment: "メモ", todo_ids: ["todo-1"], tags: ["A", "B"],
    })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].project_id).toBe("pj-1");
    expect(result[0].assignee_member_id).toBe("m-1");
    expect(result[0].assignee_member_ids).toEqual(["m-1", "m-2"]);
    expect(result[0].priority).toBe("high");
    expect(result[0].estimated_hours).toBe(8);
    expect(result[0].comment).toBe("メモ");
    expect(result[0].todo_ids).toEqual(["todo-1"]);
    expect(result[0].tags).toEqual(["A", "B"]);
  });

  it("ステータスはtodoにリセットする（元がdoneでも）", () => {
    const tasks = [makeTask({ status: "done" })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].status).toBe("todo");
  });

  it("baseline_start_date/baseline_due_date/finalized_mentionsは引き継がない（新規タスクとして改めて捕捉させる）", () => {
    const tasks = [makeTask({ baseline_start_date: "2026-01-01", baseline_due_date: "2026-01-10", finalized_mentions: ["m-1"] })];
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: tasks, dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].baseline_start_date).toBeUndefined();
    expect(result[0].baseline_due_date).toBeUndefined();
    expect(result[0].finalized_mentions).toBeUndefined();
  });
});

describe("buildDuplicatedTasks — 親子関係（選択範囲をまたぐ場合）", () => {
  it("親子とも選択されている場合：新しい親子関係で張り替える", () => {
    const parent = makeTask({ id: "p-1", name: "親" });
    const child = makeTask({ id: "c-1", name: "子", parent_task_id: "p-1" });
    const { tasks: result, idMap } = buildDuplicatedTasks({
      selectedTasks: [parent, child], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    const newParent = result.find(t => t.name === "親")!;
    const newChild = result.find(t => t.name === "子")!;
    expect(newChild.parent_task_id).toBe(newParent.id);
    expect(idMap.get("p-1")).toBe(newParent.id);
  });

  it("子だけ選択・親は選択されていない場合：複製後は独立したトップレベルタスクになる（親の情報は失われる）", () => {
    const child = makeTask({ id: "c-1", name: "子", parent_task_id: "p-1" }); // 親p-1は選択に含めない
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: [child], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result[0].parent_task_id).toBeNull();
  });

  it("親だけ選択・子は選択されていない場合：親は複製されるが子は複製されない（複製結果に含まれない）", () => {
    const parent = makeTask({ id: "p-1", name: "親" });
    // 子は selectedTasks に渡さない（選択されていない想定）
    const { tasks: result } = buildDuplicatedTasks({
      selectedTasks: [parent], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("親");
  });
});

describe("依存関係の複製（buildInheritedDependenciesを再利用）", () => {
  it("先行・後続の両方が選択されている場合のみ複製される（片側だけの場合は複製されない）", () => {
    const a = makeTask({ id: "a", name: "A" });
    const b = makeTask({ id: "b", name: "B" });
    const c = makeTask({ id: "c", name: "C" }); // 選択に含めない（片側のみ）
    const { idMap } = buildDuplicatedTasks({
      selectedTasks: [a, b], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    const deps: TaskDependency[] = [
      { id: "d1", predecessor_task_id: "a", successor_task_id: "b", is_deleted: false }, // 両方選択→複製される
      { id: "d2", predecessor_task_id: "b", successor_task_id: "c", is_deleted: false }, // cが未選択→複製されない
    ];
    const pairs = buildInheritedDependencies(deps, idMap);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({
      predecessorTaskId: idMap.get("a"),
      successorTaskId: idMap.get("b"),
    });
    void c; // 未選択であることの説明用（selectedTasksに渡さないことがポイント）
  });

  it("論理削除済みの依存は複製しない", () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    const { idMap } = buildDuplicatedTasks({
      selectedTasks: [a, b], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    const deps: TaskDependency[] = [
      { id: "d1", predecessor_task_id: "a", successor_task_id: "b", is_deleted: true },
    ];
    expect(buildInheritedDependencies(deps, idMap)).toHaveLength(0);
  });
});

describe("buildDuplicatedTaskForceLinks / buildDuplicatedTaskProjectLinks", () => {
  it("選択範囲内のタスクのTF紐づけのみ複製する", () => {
    const a = makeTask({ id: "a" });
    const { idMap } = buildDuplicatedTasks({
      selectedTasks: [a], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    const links: TaskTaskForce[] = [
      { task_id: "a", tf_id: "tf-1" },
      { task_id: "unrelated", tf_id: "tf-2" },
    ];
    const result = buildDuplicatedTaskForceLinks(links, idMap);
    expect(result).toEqual([{ task_id: idMap.get("a"), tf_id: "tf-1" }]);
  });

  it("選択範囲内のタスクの追加PJ紐づけのみ複製する", () => {
    const a = makeTask({ id: "a" });
    const { idMap } = buildDuplicatedTasks({
      selectedTasks: [a], dateOffsetDays: null, nameFind: "", nameReplace: "",
      createdBy: "u1", now: "2026-08-12T00:00:00Z", generateId: makeGenerateId(),
    });
    const links: TaskProject[] = [
      { task_id: "a", project_id: "pj-2" },
      { task_id: "unrelated", project_id: "pj-3" },
    ];
    const result = buildDuplicatedTaskProjectLinks(links, idMap);
    expect(result).toEqual([{ task_id: idMap.get("a"), project_id: "pj-2" }]);
  });
});

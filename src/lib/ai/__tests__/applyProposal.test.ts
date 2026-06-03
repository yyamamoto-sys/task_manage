import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UIProposal } from "../proposalMapper";

// ===== Supabase クライアントモック =====
// vi.mock は import が hoist されるので、モック側で動的にメソッドを差し替えるための参照を共有する。

interface MockResult {
  data?: unknown;
  error?: { message: string } | null;
}
interface MockCall {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
  /** select/update のとき、どの列を取りに行ったか */
  selectArgs?: unknown[];
}

const mockState = {
  /** key = `${table}:${op}` のキューから順に取り出して返す */
  queue: new Map<string, MockResult[]>(),
  /** 全ての .from() 呼び出し履歴 */
  calls: [] as MockCall[],
  /** 物理削除（DELETE）が呼ばれたら例外を投げて検知 */
  physicalDeleteAttempts: 0,
};

function queueResult(table: string, op: "select" | "update" | "insert", result: MockResult) {
  const key = `${table}:${op}`;
  if (!mockState.queue.has(key)) mockState.queue.set(key, []);
  mockState.queue.get(key)!.push(result);
}

function popResult(table: string, op: string): MockResult {
  const key = `${table}:${op}`;
  const q = mockState.queue.get(key);
  return q?.shift() ?? { data: null, error: null };
}

function resetMock() {
  mockState.queue.clear();
  mockState.calls = [];
  mockState.physicalDeleteAttempts = 0;
}

vi.mock("../../supabase/client", () => {
  function makeBuilder(table: string, op: "select" | "update" | "insert" | "delete", payload?: unknown) {
    const call: MockCall = { table, op, payload, filters: [] };
    mockState.calls.push(call);

    if (op === "delete") {
      mockState.physicalDeleteAttempts++;
    }

    const builder: Record<string, unknown> = {};
    builder.eq = (...args: unknown[]) => {
      call.filters.push({ method: "eq", args });
      return builder;
    };
    builder.single = () => Promise.resolve(popResult(table, op));
    builder.select = (...args: unknown[]) => {
      call.selectArgs = args;
      return builder;
    };
    // thenable: await で resolve できるようにする
    builder.then = (onResolve: (v: MockResult) => unknown, onReject?: (e: unknown) => unknown) =>
      Promise.resolve(popResult(table, op)).then(onResolve, onReject);
    return builder;
  }

  const supabase = {
    from: (table: string) => ({
      select: (..._cols: unknown[]) => makeBuilder(table, "select"),
      update: (payload: unknown) => makeBuilder(table, "update", payload),
      insert: (payload: unknown) => makeBuilder(table, "insert", payload),
      delete: () => makeBuilder(table, "delete"),
    }),
  };
  return { supabase, isMisconfigured: false };
});

// モック設定後に SUT を import する
import { applyProposal, applyProposalWithConfirmation } from "../applyProposal";
import type { ConfirmationDialog } from "../applyProposal";

// ===== ヘルパー =====

function makeProposal(over: Partial<UIProposal>): UIProposal {
  return {
    proposal_id: "p1",
    title: "提案1",
    description: "説明",
    action_type: "info",
    action_label: "情報",
    action_color: "",
    target_task_ids: [],
    target_pj_ids: [],
    date_certainty: "exact",
    is_simulation: false,
    needs_confirmation: false,
    canApply: true,
    ...over,
  };
}

// ===== テスト =====

beforeEach(() => {
  resetMock();
});

describe("applyProposal — 物理削除しないこと（最重要）", () => {
  it("scope_reduce → 確認ダイアログを返すだけで .delete() は呼ばれない", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", { data: { id: "task-uuid-1", name: "T1" }, error: null });

    const result = await applyProposal(
      makeProposal({
        action_type: "scope_reduce",
        target_task_ids: ["task_001"],
      }),
      shortIdMap,
      "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    expect(mockState.physicalDeleteAttempts).toBe(0);
  });

  it("applyProposalWithConfirmation の scope_reduce 確定時も .delete() は呼ばれず is_deleted=true で更新", async () => {
    queueResult("tasks", "update", { data: null, error: null });

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "scope_reduce",
      items: [],
      target_task_uuids: ["task-uuid-1"],
      target_pj_uuids: [],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(mockState.physicalDeleteAttempts).toBe(0);
    const updateCall = mockState.calls.find(c => c.op === "update" && c.table === "tasks");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.payload as Record<string, unknown>;
    expect(payload.is_deleted).toBe(true);
    expect(payload.deleted_by).toBe("user-1");
    expect(payload.deleted_at).toBeDefined();
  });

  it("PJ削除時は配下タスクも is_deleted=true で更新（個別 delete 呼び出しなし）", async () => {
    // tasks 一括更新 → projects 単体更新の順
    queueResult("tasks", "update", { data: null, error: null });
    queueResult("projects", "update", { data: null, error: null });

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "scope_reduce",
      items: [],
      target_task_uuids: [],
      target_pj_uuids: ["pj-uuid-1"],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(mockState.physicalDeleteAttempts).toBe(0);

    const tasksUpdate = mockState.calls.find(c => c.op === "update" && c.table === "tasks");
    expect(tasksUpdate).toBeDefined();
    expect((tasksUpdate!.payload as Record<string, unknown>).is_deleted).toBe(true);
    // 配下タスクは project_id でフィルタしている
    expect(tasksUpdate!.filters.some(f => f.args[0] === "project_id" && f.args[1] === "pj-uuid-1")).toBe(true);

    const pjUpdate = mockState.calls.find(c => c.op === "update" && c.table === "projects");
    expect(pjUpdate).toBeDefined();
    expect((pjUpdate!.payload as Record<string, unknown>).is_deleted).toBe(true);
  });
});

describe("applyProposal — needs_confirmation 系（DBを書き換えない）", () => {
  it("date_change はタスクを SELECT のみで UPDATE しない", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", {
      data: { id: "task-uuid-1", name: "T1", due_date: "2026-05-10" },
      error: null,
    });

    const result = await applyProposal(
      makeProposal({
        action_type: "date_change",
        target_task_ids: ["task_001"],
        suggested_date: "2026-05-20",
      }),
      shortIdMap,
      "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    if (result.type !== "needs_confirmation") return;
    expect(result.dialog.action_type).toBe("date_change");
    expect(result.dialog.items[0]).toEqual({
      task_id: "task-uuid-1",
      task_name: "T1",
      current_value: "2026-05-10",
      suggested_value: "2026-05-20",
    });
    // UPDATE が呼ばれていない
    expect(mockState.calls.some(c => c.op === "update")).toBe(false);
  });

  it("date_change で shift_days が指定されたら現在の期日に日数を加算する", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", {
      data: { id: "task-uuid-1", name: "T1", due_date: "2026-05-10" },
      error: null,
    });

    const result = await applyProposal(
      makeProposal({
        action_type: "date_change",
        target_task_ids: ["task_001"],
        shift_days: 7,
      }),
      shortIdMap,
      "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    if (result.type !== "needs_confirmation") return;
    expect(result.dialog.items[0].suggested_value).toBe("2026-05-17");
  });

  it("assignee はタスクとメンバーを SELECT のみで UPDATE しない", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", {
      data: { id: "task-uuid-1", name: "T1", assignee_member_id: "m-old" },
      error: null,
    });
    queueResult("members", "select", { data: { short_name: "旧担当" }, error: null });

    const result = await applyProposal(
      makeProposal({
        action_type: "assignee",
        target_task_ids: ["task_001"],
        suggested_assignee: "新担当",
      }),
      shortIdMap,
      "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    if (result.type !== "needs_confirmation") return;
    expect(result.dialog.items[0]).toEqual({
      task_id: "task-uuid-1",
      task_name: "T1",
      current_value: "旧担当",
      suggested_value: "新担当",
    });
    expect(mockState.calls.some(c => c.op === "update")).toBe(false);
  });

  it("assignee で suggested_assignee が空なら error を返す", async () => {
    const result = await applyProposal(
      makeProposal({
        action_type: "assignee",
        target_task_ids: ["task_001"],
        suggested_assignee: undefined,
      }),
      new Map(),
      "user-1",
    );
    expect(result.type).toBe("error");
  });
});

describe("applyProposal — risk / no_tasks / deadline_risk（コメント追記）", () => {
  it("risk: SELECT してから UPDATE の2ステップ・楽観ロック付きで comment に追記する", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    // appendTaskComment 内：select → update.select の順
    queueResult("tasks", "select", {
      data: { comment: "既存コメント", updated_at: "2026-05-01T00:00:00Z" },
      error: null,
    });
    queueResult("tasks", "update", {
      data: [{ id: "task-uuid-1" }],
      error: null,
    });

    const result = await applyProposal(
      makeProposal({
        action_type: "risk",
        target_task_ids: ["task_001"],
        description: "リスクあり",
      }),
      shortIdMap,
      "user-1",
    );

    expect(result.type).toBe("success");

    // SELECT が先に呼ばれ、UPDATE には楽観ロック用 eq("updated_at", "2026-05-01T00:00:00Z") が含まれる
    const updateCall = mockState.calls.find(c => c.op === "update" && c.table === "tasks");
    expect(updateCall).toBeDefined();
    const optimisticLock = updateCall!.filters.find(
      f => f.args[0] === "updated_at" && f.args[1] === "2026-05-01T00:00:00Z",
    );
    expect(optimisticLock).toBeDefined();

    // 新しい comment に AIアドバイスタグが含まれる
    const payload = updateCall!.payload as Record<string, string>;
    expect(payload.comment).toContain("既存コメント");
    expect(payload.comment).toContain("[AIアドバイス");
    expect(payload.comment).toContain("リスクあり");
  });

  it("空の comment（null）に追記したら、AIアドバイスタグだけが入る", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", {
      data: { comment: null, updated_at: "2026-05-01T00:00:00Z" },
      error: null,
    });
    queueResult("tasks", "update", { data: [{ id: "task-uuid-1" }], error: null });

    await applyProposal(
      makeProposal({
        action_type: "deadline_risk",
        target_task_ids: ["task_001"],
        description: "期限リスク",
      }),
      shortIdMap,
      "user-1",
    );

    const updateCall = mockState.calls.find(c => c.op === "update");
    const payload = updateCall!.payload as Record<string, string>;
    expect(payload.comment).toMatch(/^\[AIアドバイス.*\]\n期限リスク$/s);
  });

  it("競合時（UPDATE が0件）はエラーを返す", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    queueResult("tasks", "select", {
      data: { comment: "", updated_at: "2026-05-01T00:00:00Z" },
      error: null,
    });
    queueResult("tasks", "update", { data: [], error: null }); // ★ 競合：0件更新

    const result = await applyProposal(
      makeProposal({ action_type: "risk", target_task_ids: ["task_001"], description: "x" }),
      shortIdMap,
      "user-1",
    );
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toMatch(/他のユーザー/);
  });
});

describe("applyProposal — 例外的なアクション", () => {
  it("info はエラーを返す（UI上は反映ボタンが出ない）", async () => {
    const result = await applyProposal(
      makeProposal({ action_type: "info" }),
      new Map(),
      "user-1",
    );
    expect(result.type).toBe("error");
  });

  it("milestone は未対応エラーを返す（CLAUDE.md Section 6-10）", async () => {
    const result = await applyProposal(
      makeProposal({ action_type: "milestone" }),
      new Map(),
      "user-1",
    );
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toMatch(/マイルストーン/);
  });

  it("shortIdMap に存在しない task_id は無視される（エラーにならない）", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    // task_999 は shortIdMap にない → resolveUUID は null → continue
    // task_001 は SELECT → not found
    queueResult("tasks", "select", { data: null, error: null });

    const result = await applyProposal(
      makeProposal({
        action_type: "date_change",
        target_task_ids: ["task_999", "task_001"],
        suggested_date: "2026-06-01",
      }),
      shortIdMap,
      "user-1",
    );
    // タスクが解決できないので「対象タスクが見つかりませんでした」エラー
    expect(result.type).toBe("error");
  });
});

describe("applyProposalWithConfirmation — date_change の確定", () => {
  it("確認済みの値でタスクの due_date を更新し、updated_by を記録する", async () => {
    queueResult("tasks", "select", { data: { due_date: "2026-05-10" }, error: null });
    queueResult("tasks", "update", { data: null, error: null });

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "date_change",
      items: [{
        task_id: "task-uuid-1",
        task_name: "T1",
        current_value: "2026-05-10",
        suggested_value: "2026-05-20",
      }],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { "task-uuid-1": "2026-05-25" },
      "user-1",
    );

    expect(result.type).toBe("success");
    const updateCall = mockState.calls.find(c => c.op === "update");
    const payload = updateCall!.payload as Record<string, string>;
    expect(payload.due_date).toBe("2026-05-25");
    expect(payload.updated_by).toBe("user-1");
  });

  it("confirmedValues に値がない task_id は更新されない", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "date_change",
      items: [{
        task_id: "task-uuid-1",
        task_name: "T1",
        current_value: "2026-05-10",
        suggested_value: "2026-05-20",
      }],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(mockState.calls.filter(c => c.op === "update")).toHaveLength(0);
  });
});

describe("applyProposalWithConfirmation — assignee の確定", () => {
  it("confirmedValues のメンバーIDで assignee_member_id を更新する", async () => {
    queueResult("tasks", "select", { data: { assignee_member_id: "m-old" }, error: null });
    queueResult("tasks", "update", { data: null, error: null });

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "assignee",
      items: [{
        task_id: "task-uuid-1",
        task_name: "T1",
        current_value: "旧",
        suggested_value: "新",
      }],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { "task-uuid-1": "m-new" },
      "user-1",
    );

    expect(result.type).toBe("success");
    const updateCall = mockState.calls.find(c => c.op === "update");
    const payload = updateCall!.payload as Record<string, string>;
    expect(payload.assignee_member_id).toBe("m-new");
  });
});

describe("applyProposalWithConfirmation — add_task", () => {
  it("INSERT で新規タスクを追加（status=todo, is_deleted=false）", async () => {
    queueResult("tasks", "insert", { data: null, error: null });

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "add_task",
      items: [],
      new_task_items: [{
        temp_id: "tmp-1",
        task_name: "新タスク",
        project_id: "pj-1",
      }],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      {
        "tmp-1_name": "確定タスク名",
        "tmp-1_assignee_id": "m-1",
        "tmp-1_due_date": "2026-06-01",
      },
      "user-1",
    );

    expect(result.type).toBe("success");
    const insertCall = mockState.calls.find(c => c.op === "insert");
    expect(insertCall).toBeDefined();
    const payload = insertCall!.payload as Record<string, unknown>;
    expect(payload.name).toBe("確定タスク名");
    expect(payload.project_id).toBe("pj-1");
    expect(payload.assignee_member_id).toBe("m-1");
    expect(payload.due_date).toBe("2026-06-01");
    expect(payload.status).toBe("todo");
    expect(payload.is_deleted).toBe(false);
  });

  it("空の名前のタスクはスキップされる", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "add_task",
      items: [],
      new_task_items: [{ temp_id: "tmp-1", task_name: "" }],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { "tmp-1_name": "   " }, // trim 後に空
      "user-1",
    );

    expect(result.type).toBe("success");
    expect(mockState.calls.filter(c => c.op === "insert")).toHaveLength(0);
  });

  it("new_subtask_items があると 親→子（parent_task_id・project_id継承・display_order連番）を作成する", async () => {
    queueResult("tasks", "insert", { data: null, error: null }); // 親
    queueResult("tasks", "insert", { data: null, error: null }); // 子1
    queueResult("tasks", "insert", { data: null, error: null }); // 子2

    const dialog: ConfirmationDialog = {
      proposal_id: "p1",
      action_type: "add_task",
      items: [],
      new_task_items: [{ temp_id: "parent", task_name: "大分類", project_id: "pj-1" }],
      new_subtask_items: [
        { temp_id: "c1", task_name: "子1", project_id: "pj-1" },
        { temp_id: "c2", task_name: "子2", project_id: "pj-1" },
      ],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { parent_name: "大分類", c1_name: "子1", c2_name: "子2" },
      "user-1",
    );

    expect(result.type).toBe("success");
    const inserts = mockState.calls.filter(c => c.op === "insert" && c.table === "tasks");
    expect(inserts).toHaveLength(3);

    // 1件目＝親（parent_task_id を持たない）
    const parent = inserts[0].payload as Record<string, unknown>;
    expect(parent.name).toBe("大分類");
    expect(parent.parent_task_id).toBeUndefined();

    // 2・3件目＝子（親の id にぶら下がる・project_id は親に揃う・display_order は 0,1）
    const child1 = inserts[1].payload as Record<string, unknown>;
    const child2 = inserts[2].payload as Record<string, unknown>;
    expect(child1.name).toBe("子1");
    expect(child1.parent_task_id).toBe(parent.id);
    expect(child1.project_id).toBe("pj-1");
    expect(child1.display_order).toBe(0);
    expect(child2.parent_task_id).toBe(parent.id);
    expect(child2.display_order).toBe(1);

    // Undo 用に親＋子の3件分の操作が積まれる
    if (result.type !== "success") return;
    expect(result.snapshot.operations).toHaveLength(3);
    expect(result.snapshot.label).toContain("階層化");
  });
});

// src/lib/ai/__tests__/applyProposal.test.ts
//
// 【v3.71で書き換え】applyProposal.ts / applyProposalWithConfirmation が appStore の choke point
// （saveTask/saveProject/deleteTask/deleteProject）経由に統一されたため、`supabase.from(...)` の
// 呼び出し順・payload形をそのまま検査する旧テストは実装の詳細に依存しすぎていた。
// guestWriteBranches.test.ts と同じ方式で、低レベルCRUD（lib/supabase/store.ts）をモックし、
// 「appStoreのstateがどう変わったか」「どの choke point 関数が呼ばれたか」という振る舞いを検査する。
// これにより、B1（依存ゲート）・B3（自動リスケ連鎖）・B4（ベースライン捕捉）が実際に
// choke point 経由で効くこと自体は appStore.test.ts 側の既存テストが担保し、このファイルは
// 「AI提案の反映がその choke point を実際に通ること」「部分失敗時の警告メッセージ」を検査する。

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UIProposal } from "../proposalMapper";
import type { Task, Project, Member } from "../../localData/types";

const storeMock = vi.hoisted(() => ({
  fetchCriticalData: vi.fn(),
  fetchOkrData: vi.fn(),
  fetchGroups: vi.fn(),
  ConflictError: class ConflictError extends Error {},
  upsertGroup: vi.fn(), softDeleteGroup: vi.fn(),
  fetchLoadingTips: vi.fn(), upsertLoadingTip: vi.fn(), softDeleteLoadingTip: vi.fn(),
  upsertMember: vi.fn(), softDeleteMember: vi.fn(),
  upsertObjective: vi.fn(),
  upsertKeyResult: vi.fn(), softDeleteKeyResult: vi.fn(),
  upsertTaskForce: vi.fn(), softDeleteTaskForce: vi.fn(),
  upsertToDo: vi.fn(), softDeleteToDo: vi.fn(),
  upsertProject: vi.fn(), softDeleteProject: vi.fn(), restoreProject: vi.fn(),
  upsertTask: vi.fn(), softDeleteTask: vi.fn(), restoreTask: vi.fn(),
  upsertMilestone: vi.fn(), softDeleteMilestone: vi.fn(),
  insertProjectTaskForce: vi.fn(), deleteProjectTaskForce: vi.fn(),
  upsertQuarterlyObjective: vi.fn(),
  insertTaskTaskForce: vi.fn(), deleteTaskTaskForce: vi.fn(),
  insertTaskProject: vi.fn(), deleteTaskProject: vi.fn(),
  insertTaskDependency: vi.fn(), softDeleteTaskDependency: vi.fn(),
  upsertMemberTag: vi.fn(), softDeleteMemberTag: vi.fn(), replaceMemberTagMembers: vi.fn(),
}));

vi.mock("../../supabase/store", () => storeMock);

// reportError は window.dispatchEvent を呼ぶブラウザ専用実装（src/lib/errorReporter.ts）。
// vitest環境（environment:"node"）にはwindowが無いため、appStore.saveTask等の失敗処理
// （handleSaveError内のreportError呼び出し）がReferenceErrorで元のエラーを揉み消してしまう。
// このファイルの関心はappStore自体の失敗リカバリではなくapplyProposal.tsの部分失敗ハンドリング
// なので、reportErrorはno-opにしておく。
vi.mock("../../errorReporter", () => ({ reportError: vi.fn() }));

import { useAppStore } from "../../../stores/appStore";
import { applyProposal, applyProposalWithConfirmation } from "../applyProposal";
import type { ConfirmationDialog } from "../applyProposal";

const INITIAL_STATE = useAppStore.getState();
function resetStore() {
  useAppStore.setState(INITIAL_STATE, true);
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: "task-uuid-1", name: "T1", project_id: null, todo_ids: [],
    assignee_member_id: "", assignee_member_ids: [], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    ...over,
  };
}

function makeProject(over: Partial<Project>): Project {
  return {
    id: "pj-uuid-1", name: "PJ1", purpose: "目的", contribution_memo: "",
    owner_member_id: "m1", owner_member_ids: ["m1"], status: "active", color_tag: "#000",
    start_date: "2026-01-01", end_date: "2026-12-31", is_deleted: false,
    ...over,
  };
}

function makeMember(over: Partial<Member>): Member {
  return {
    id: "m-1", display_name: "山田太郎", short_name: "山田", initials: "YT",
    teams_account: "", color_bg: "#fff", color_text: "#000", is_deleted: false,
    ...over,
  };
}

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

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  storeMock.upsertTask.mockResolvedValue("2026-08-12T00:00:00.000Z");
  storeMock.upsertProject.mockResolvedValue("2026-08-12T00:00:00.000Z");
});

describe("applyProposal / undoApply：choke point 経由になっていること（v3.71）", () => {
  it("applyProposal.ts / undoApply.ts は supabase/client を直接importしない（機械チェック）", async () => {
    const fs = await import("node:fs");
    const applySrc = fs.readFileSync(new URL("../applyProposal.ts", import.meta.url), "utf-8");
    const undoSrc = fs.readFileSync(new URL("../undoApply.ts", import.meta.url), "utf-8");
    expect(applySrc).not.toMatch(/from ["']\.\.\/supabase\/client["']/);
    expect(undoSrc).not.toMatch(/from ["']\.\.\/supabase\/client["']/);
    // guestApplyStore.ts は choke point 統一により不要になったため撤去済み（v3.71）。
    // import文としての参照が無いことだけを検査する（設計意図コメント内の言及は許容）。
    expect(applySrc).not.toMatch(/from ["'].*guestApplyStore["']/);
    expect(undoSrc).not.toMatch(/from ["'].*guestApplyStore["']/);
  });
});

describe("applyProposal — 物理削除しないこと（最重要・deleteTask/deleteProjectはis_deletedフラグのみ）", () => {
  it("scope_reduce → 確認ダイアログを返すだけで書き込みは発生しない", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({})] });

    const result = await applyProposal(
      makeProposal({ action_type: "scope_reduce", target_task_ids: ["task_001"] }),
      shortIdMap, "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    expect(storeMock.softDeleteTask).not.toHaveBeenCalled();
  });

  it("applyProposalWithConfirmation の scope_reduce 確定時は appStore.deleteTask 経由で is_deleted=true にする", async () => {
    useAppStore.setState({ tasks: [makeTask({})] });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "scope_reduce", items: [],
      target_task_uuids: ["task-uuid-1"], target_pj_uuids: [],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(storeMock.softDeleteTask).toHaveBeenCalledWith("task-uuid-1", "user-1");
    expect(useAppStore.getState().tasks.find(t => t.id === "task-uuid-1")?.is_deleted).toBe(true);
  });

  it("PJ削除時は配下タスク（is_deleted=false のみ）→PJ本体の順にdeleteTask/deleteProjectが呼ばれる", async () => {
    useAppStore.setState({
      projects: [makeProject({})],
      tasks: [
        makeTask({ id: "t-1", project_id: "pj-uuid-1", is_deleted: false }),
        makeTask({ id: "t-2", project_id: "pj-uuid-1", is_deleted: true }), // 既に削除済み→対象外
      ],
    });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "scope_reduce", items: [],
      target_task_uuids: [], target_pj_uuids: ["pj-uuid-1"],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(storeMock.softDeleteTask).toHaveBeenCalledTimes(1);
    expect(storeMock.softDeleteTask).toHaveBeenCalledWith("t-1", "user-1");
    expect(storeMock.softDeleteProject).toHaveBeenCalledWith("pj-uuid-1", "user-1");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-1")?.is_deleted).toBe(true);
    expect(useAppStore.getState().projects.find(p => p.id === "pj-uuid-1")?.is_deleted).toBe(true);
  });
});

describe("applyProposal — needs_confirmation 系（書き込みが発生しない）", () => {
  it("date_change はタスクのstoreスナップショットから確認ダイアログを組み立てる", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({ due_date: "2026-05-10" })] });

    const result = await applyProposal(
      makeProposal({ action_type: "date_change", target_task_ids: ["task_001"], suggested_date: "2026-05-20" }),
      shortIdMap, "user-1",
    );

    expect(result.type).toBe("needs_confirmation");
    if (result.type !== "needs_confirmation") return;
    expect(result.dialog.items[0]).toEqual({
      task_id: "task-uuid-1", task_name: "T1", current_value: "2026-05-10", suggested_value: "2026-05-20",
    });
    expect(storeMock.upsertTask).not.toHaveBeenCalled();
  });

  it("date_change で shift_days が指定されたら現在の期日に日数を加算する", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({ due_date: "2026-05-10" })] });

    const result = await applyProposal(
      makeProposal({ action_type: "date_change", target_task_ids: ["task_001"], shift_days: 7 }),
      shortIdMap, "user-1",
    );
    if (result.type !== "needs_confirmation") throw new Error("unreachable");
    expect(result.dialog.items[0].suggested_value).toBe("2026-05-17");
  });

  it("assignee はタスク・メンバーのstoreスナップショットから確認ダイアログを組み立てる", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({
      tasks: [makeTask({ assignee_member_id: "m-old" })],
      members: [makeMember({ id: "m-old", short_name: "旧担当" })],
    });

    const result = await applyProposal(
      makeProposal({ action_type: "assignee", target_task_ids: ["task_001"], suggested_assignee: "新担当" }),
      shortIdMap, "user-1",
    );
    expect(result.type).toBe("needs_confirmation");
    if (result.type !== "needs_confirmation") return;
    expect(result.dialog.items[0]).toEqual({
      task_id: "task-uuid-1", task_name: "T1", current_value: "旧担当", suggested_value: "新担当",
    });
    expect(storeMock.upsertTask).not.toHaveBeenCalled();
  });

  it("assignee で suggested_assignee が空なら error を返す", async () => {
    const result = await applyProposal(
      makeProposal({ action_type: "assignee", target_task_ids: ["task_001"], suggested_assignee: undefined }),
      new Map(), "user-1",
    );
    expect(result.type).toBe("error");
  });
});

describe("applyProposal — risk / no_tasks / deadline_risk（appStore.saveTask経由でcommentに追記）", () => {
  it("risk: saveTask経由でcommentに追記される（choke pointを通るため既存コメントの後ろに連結）", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({ comment: "既存コメント" })] });

    const result = await applyProposal(
      makeProposal({ action_type: "risk", target_task_ids: ["task_001"], description: "リスクあり" }),
      shortIdMap, "user-1",
    );

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    const savedTask = useAppStore.getState().tasks.find(t => t.id === "task-uuid-1");
    expect(savedTask?.comment).toContain("既存コメント");
    expect(savedTask?.comment).toContain("[AIアドバイス");
    expect(savedTask?.comment).toContain("リスクあり");
  });

  it("空の comment に追記したら、AIアドバイスタグだけが入る", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({ comment: "" })] });

    await applyProposal(
      makeProposal({ action_type: "deadline_risk", target_task_ids: ["task_001"], description: "期限リスク" }),
      shortIdMap, "user-1",
    );
    const savedTask = useAppStore.getState().tasks.find(t => t.id === "task-uuid-1");
    expect(savedTask?.comment).toMatch(/^\[AIアドバイス.*\]\n期限リスク$/s);
  });

  it("saveTaskが失敗した場合はtype:errorを返す（formatErrorForUser経由）", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    useAppStore.setState({ tasks: [makeTask({})] });
    storeMock.upsertTask.mockRejectedValueOnce(new Error("boom"));

    const result = await applyProposal(
      makeProposal({ action_type: "risk", target_task_ids: ["task_001"], description: "x" }),
      shortIdMap, "user-1",
    );
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toContain("boom");
  });
});

describe("applyProposal — 例外的なアクション", () => {
  it("info はエラーを返す（UI上は反映ボタンが出ない）", async () => {
    const result = await applyProposal(makeProposal({ action_type: "info" }), new Map(), "user-1");
    expect(result.type).toBe("error");
  });

  it("milestone は未対応エラーを返す（CLAUDE.md Section 6-10）", async () => {
    const result = await applyProposal(makeProposal({ action_type: "milestone" }), new Map(), "user-1");
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toMatch(/マイルストーン/);
  });

  it("shortIdMap に存在しない task_id は無視される（エラーにならない）", async () => {
    const shortIdMap = new Map([["task_001", "task-uuid-1"]]);
    // task_999 は shortIdMap にない → resolveUUID は null → continue
    // task_001 は store に存在しない → not found
    const result = await applyProposal(
      makeProposal({ action_type: "date_change", target_task_ids: ["task_999", "task_001"], suggested_date: "2026-06-01" }),
      shortIdMap, "user-1",
    );
    expect(result.type).toBe("error");
  });
});

describe("applyProposalWithConfirmation — date_change の確定", () => {
  it("確認済みの値でタスクの due_date を更新し、updated_by を記録する（saveTask経由）", async () => {
    useAppStore.setState({ tasks: [makeTask({ due_date: "2026-05-10" })] });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "date_change",
      items: [{ task_id: "task-uuid-1", task_name: "T1", current_value: "2026-05-10", suggested_value: "2026-05-20" }],
    };
    const result = await applyProposalWithConfirmation(dialog, { "task-uuid-1": "2026-05-25" }, "user-1");

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    const saved = useAppStore.getState().tasks.find(t => t.id === "task-uuid-1");
    expect(saved?.due_date).toBe("2026-05-25");
    expect(saved?.updated_by).toBe("user-1");
  });

  it("confirmedValues に値がない task_id は更新されない", async () => {
    useAppStore.setState({ tasks: [makeTask({ due_date: "2026-05-10" })] });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "date_change",
      items: [{ task_id: "task-uuid-1", task_name: "T1", current_value: "2026-05-10", suggested_value: "2026-05-20" }],
    };
    const result = await applyProposalWithConfirmation(dialog, {}, "user-1");

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).not.toHaveBeenCalled();
  });

  it("複数タスクのうち1件がsaveTaskで失敗しても、成功分は反映され警告付きのsuccessを返す（部分失敗の方針）", async () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: "task-uuid-1", name: "T1", due_date: "2026-05-10" }),
        makeTask({ id: "task-uuid-2", name: "T2", due_date: "2026-05-10" }),
      ],
    });
    storeMock.upsertTask.mockImplementation(async (task: Task) => {
      if (task.id === "task-uuid-2") throw new Error("先行タスクが未完了のため完了にできません");
      return "2026-08-12T00:00:00.000Z";
    });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "date_change",
      items: [
        { task_id: "task-uuid-1", task_name: "T1", current_value: "2026-05-10", suggested_value: "2026-05-20" },
        { task_id: "task-uuid-2", task_name: "T2", current_value: "2026-05-10", suggested_value: "2026-05-20" },
      ],
    };
    const result = await applyProposalWithConfirmation(
      dialog, { "task-uuid-1": "2026-05-25", "task-uuid-2": "2026-05-25" }, "user-1",
    );

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.warning).toContain("1件は反映できませんでした");
    expect(result.warning).toContain("T2");
    expect(useAppStore.getState().tasks.find(t => t.id === "task-uuid-1")?.due_date).toBe("2026-05-25");
    // 失敗した項目はUndoSnapshotのoperationsに積まれない（成功した1件だけがUndo対象）。
    // 楽観更新のロールバック自体はappStore.saveTask側の既存のリカバリ機構（handleSaveError→load）
    // の責務であり、このファイルの検証範囲はapplyProposal.tsが失敗項目を正しく除外することまで。
    expect(result.snapshot.operations).toHaveLength(1);
    expect(result.snapshot.operations[0]).toMatchObject({ taskId: "task-uuid-1" });
  });

  it("全件が失敗した場合はtype:errorを返す", async () => {
    useAppStore.setState({ tasks: [makeTask({ due_date: "2026-05-10" })] });
    storeMock.upsertTask.mockRejectedValue(new Error("boom"));
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "date_change",
      items: [{ task_id: "task-uuid-1", task_name: "T1", current_value: "2026-05-10", suggested_value: "2026-05-20" }],
    };
    const result = await applyProposalWithConfirmation(dialog, { "task-uuid-1": "2026-05-25" }, "user-1");
    expect(result.type).toBe("error");
  });

  it("dialog.itemsが後続→先行の順（依存関係のトポロジカル順になっていない）でも、" +
     "先行タスクを先に反映するため、後続タスクの確定値がB3自動リスケ連鎖で上書きされない" +
     "（v3.77バグ修正の回帰テスト）", async () => {
    // A（先行）→B（後続）の依存があるデータ。dialog.itemsはAIの返した順のまま
    // 「B（後続）が先、A（先行）が後」という、意図的にトポロジカル順ではない並びにする。
    useAppStore.setState({
      tasks: [
        makeTask({ id: "task-a", name: "A", due_date: "2026-05-01" }),
        makeTask({ id: "task-b", name: "B", start_date: "2026-05-02", due_date: "2026-05-10" }),
      ],
      taskDependencies: [
        { id: "dep-1", predecessor_task_id: "task-a", successor_task_id: "task-b", is_deleted: false },
      ],
    });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "date_change",
      items: [
        { task_id: "task-b", task_name: "B", current_value: "2026-05-10", suggested_value: "2026-05-12" },
        { task_id: "task-a", task_name: "A", current_value: "2026-05-01", suggested_value: "2026-05-20" },
      ],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { "task-b": "2026-05-12", "task-a": "2026-05-20" },
      "user-1",
    );

    expect(result.type).toBe("success");
    // Aの確定値（先行タスク）はそのまま反映される
    expect(useAppStore.getState().tasks.find(t => t.id === "task-a")?.due_date).toBe("2026-05-20");
    // Bの確定値（後続タスク）が、Aの反映で発火するB3自動リスケ連鎖に上書きされず、
    // 利用者が確認画面で確定した日付のまま残ること
    expect(useAppStore.getState().tasks.find(t => t.id === "task-b")?.due_date).toBe("2026-05-12");
  });
});

describe("applyProposalWithConfirmation — assignee の確定", () => {
  it("confirmedValues のメンバーIDで assignee_member_id を更新する（saveTask経由）", async () => {
    useAppStore.setState({ tasks: [makeTask({ assignee_member_id: "m-old" })] });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "assignee",
      items: [{ task_id: "task-uuid-1", task_name: "T1", current_value: "旧", suggested_value: "新" }],
    };
    const result = await applyProposalWithConfirmation(dialog, { "task-uuid-1": "m-new" }, "user-1");

    expect(result.type).toBe("success");
    expect(useAppStore.getState().tasks.find(t => t.id === "task-uuid-1")?.assignee_member_id).toBe("m-new");
  });
});

describe("applyProposalWithConfirmation — add_task", () => {
  it("saveTask経由で新規タスクを追加（status=todo, is_deleted=false）", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_task", items: [],
      new_task_items: [{ temp_id: "tmp-1", task_name: "新タスク", project_id: "pj-1" }],
    };
    const result = await applyProposalWithConfirmation(
      dialog,
      { "tmp-1_name": "確定タスク名", "tmp-1_assignee_ids": "m-1", "tmp-1_due_date": "2026-06-01" },
      "user-1",
    );

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    const created = useAppStore.getState().tasks.find(t => t.name === "確定タスク名");
    expect(created).toBeDefined();
    expect(created?.project_id).toBe("pj-1");
    expect(created?.assignee_member_id).toBe("m-1");
    expect(created?.due_date).toBe("2026-06-01");
    expect(created?.status).toBe("todo");
    expect(created?.is_deleted).toBe(false);
  });

  it("空の名前のタスクはスキップされる", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_task", items: [],
      new_task_items: [{ temp_id: "tmp-1", task_name: "" }],
    };
    const result = await applyProposalWithConfirmation(dialog, { "tmp-1_name": "   " }, "user-1");

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).not.toHaveBeenCalled();
  });

  it("new_subtask_items があると 親→子（parent_task_id・project_id継承・display_order連番）を作成する", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_task", items: [],
      new_task_items: [{ temp_id: "parent", task_name: "大分類", project_id: "pj-1" }],
      new_subtask_items: [
        { temp_id: "c1", task_name: "子1", project_id: "pj-1" },
        { temp_id: "c2", task_name: "子2", project_id: "pj-1" },
      ],
    };
    const result = await applyProposalWithConfirmation(
      dialog, { parent_name: "大分類", c1_name: "子1", c2_name: "子2" }, "user-1",
    );

    expect(result.type).toBe("success");
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(3);

    const parent = useAppStore.getState().tasks.find(t => t.name === "大分類");
    expect(parent).toBeDefined();
    expect(parent?.parent_task_id).toBeNull();

    const child1 = useAppStore.getState().tasks.find(t => t.name === "子1");
    const child2 = useAppStore.getState().tasks.find(t => t.name === "子2");
    expect(child1?.parent_task_id).toBe(parent?.id);
    expect(child1?.project_id).toBe("pj-1");
    expect(child1?.display_order).toBe(0);
    expect(child2?.parent_task_id).toBe(parent?.id);
    expect(child2?.display_order).toBe(1);

    if (result.type !== "success") return;
    expect(result.snapshot.operations).toHaveLength(3);
    expect(result.snapshot.label).toContain("階層化");
  });

  it("子タスクの1件がsaveTaskで失敗しても、親と他の子は作成され警告付きのsuccessを返す", async () => {
    storeMock.upsertTask.mockImplementation(async (task: Task) => {
      if (task.name === "子1") throw new Error("boom");
      return "2026-08-12T00:00:00.000Z";
    });
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_task", items: [],
      new_task_items: [{ temp_id: "parent", task_name: "大分類", project_id: "pj-1" }],
      new_subtask_items: [
        { temp_id: "c1", task_name: "子1", project_id: "pj-1" },
        { temp_id: "c2", task_name: "子2", project_id: "pj-1" },
      ],
    };
    const result = await applyProposalWithConfirmation(
      dialog, { parent_name: "大分類", c1_name: "子1", c2_name: "子2" }, "user-1",
    );

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.warning).toContain("1件は反映できませんでした");
    expect(useAppStore.getState().tasks.some(t => t.name === "大分類")).toBe(true);
    expect(useAppStore.getState().tasks.some(t => t.name === "子2")).toBe(true);
    // 子1（失敗分）のUndo操作は積まれない（親＋子2の2件だけ）
    expect(result.snapshot.operations).toHaveLength(2);
  });
});

describe("applyProposalWithConfirmation — add_project", () => {
  it("saveProject→saveTaskの順でPJと初期タスクを作成する", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_project", items: [],
      new_project: { name: "新PJ", purpose: "目的" },
      new_project_task_items: [{ temp_id: "t1", task_name: "初期タスク" }],
    };
    const result = await applyProposalWithConfirmation(
      dialog, { project_name: "新PJ", project_purpose: "目的", t1_name: "初期タスク" }, "user-1",
    );

    expect(result.type).toBe("success");
    expect(storeMock.upsertProject).toHaveBeenCalledTimes(1);
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    const project = useAppStore.getState().projects.find(p => p.name === "新PJ");
    expect(project).toBeDefined();
    const task = useAppStore.getState().tasks.find(t => t.name === "初期タスク");
    expect(task?.project_id).toBe(project?.id);
  });

  it("プロジェクト名が空ならタスク作成を試みずerrorを返す", async () => {
    const dialog: ConfirmationDialog = {
      proposal_id: "p1", action_type: "add_project", items: [],
      new_project: { name: "", purpose: "目的" },
    };
    const result = await applyProposalWithConfirmation(dialog, { project_name: "  " }, "user-1");
    expect(result.type).toBe("error");
    expect(storeMock.upsertProject).not.toHaveBeenCalled();
  });
});

// src/lib/ai/__tests__/applyProposalGuestBranch.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）の「AI提案の反映」開放（CLAUDE.md Section 23・v3.69）の再発防止テスト。
// 【v3.71で更新】applyProposal.ts / undoApply.ts は choke point 統一により
// `appStore`（saveTask/saveProject/deleteTask/restoreTask/deleteProject/restoreProject）経由に
// なった。ゲスト分岐は appStore 側の既存の isGuestMode() 分岐にそのまま乗るため、
// このファイル専用の guestApplyStore.ts は不要になり撤去した。本テストの検証内容自体は
// 変わらない（choke point がどこにあっても、ゲストではsupabaseに一切到達しないことが
// 変わらず成り立つべきため）：
//   - ゲストのときは supabase.from(...) が一度も呼ばれない（Proxyに到達させない）
//   - 反映結果が useAppStore のstateに正しく反映される
//   - Undo（applyUndo）も同様にゲストではsupabaseを呼ばない

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setGuestMode } from "../../guestMode";
import type { Task, Project } from "../../localData/types";

const fromSpy = vi.fn();

vi.mock("../../supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => { fromSpy(...args); throw new Error("ゲストではsupabase.from()を呼んではいけない"); } },
  isMisconfigured: false,
}));

import { useAppStore } from "../../../stores/appStore";
import { applyProposal, applyProposalWithConfirmation } from "../applyProposal";
import { applyUndo } from "../undoApply";

const INITIAL_STATE = useAppStore.getState();
function resetStore() {
  useAppStore.setState(INITIAL_STATE, true);
}

const dummyTask: Task = {
  id: "gt-1", name: "ゲストタスク", project_id: null, todo_ids: [],
  assignee_member_id: "", assignee_member_ids: [], status: "todo", priority: null,
  start_date: null, due_date: "2026-08-20", estimated_hours: null, comment: "元コメント", is_deleted: false,
};

const dummyProject: Project = {
  id: "gp-1", name: "ゲストPJ", purpose: "目的", contribution_memo: "",
  owner_member_id: "m1", owner_member_ids: ["m1"], status: "active", color_tag: "#000000",
  start_date: "2026-08-01", end_date: "2026-08-31", is_deleted: false,
};

const shortIdMap = new Map<string, string>([["task_001", "gt-1"], ["pj_001", "gp-1"]]);

describe("applyProposal / undoApply：ゲスト分岐", () => {
  beforeEach(() => {
    resetStore();
    useAppStore.setState({ tasks: [dummyTask], projects: [dummyProject], currentGroupId: "grp-demo" });
    fromSpy.mockReset();
    setGuestMode(true);
  });

  it("risk：コメント追記がsupabaseを呼ばずタスクのcommentに反映される", async () => {
    const result = await applyProposal(
      { proposal_id: "p1", action_type: "risk", title: "リスク", description: "遅延の恐れ", target_task_ids: ["task_001"], target_pj_ids: [] } as never,
      shortIdMap, "__guest__",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(result.type).toBe("success");
    const task = useAppStore.getState().tasks.find(t => t.id === "gt-1");
    expect(task?.comment).toContain("遅延の恐れ");
    expect(task?.comment).toContain("元コメント");
  });

  it("date_change：確認ダイアログの組み立て→反映まで一貫してsupabaseを呼ばない", async () => {
    const dialogResult = await applyProposal(
      { proposal_id: "p2", action_type: "date_change", title: "日程変更", description: "", target_task_ids: ["task_001"], target_pj_ids: [], suggested_date: "2026-09-01" } as never,
      shortIdMap, "__guest__",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(dialogResult.type).toBe("needs_confirmation");
    if (dialogResult.type !== "needs_confirmation") throw new Error("unreachable");

    const applyResult = await applyProposalWithConfirmation(
      dialogResult.dialog, { "gt-1": "2026-09-01" }, "__guest__", "grp-demo",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(applyResult.type).toBe("success");
    expect(useAppStore.getState().tasks.find(t => t.id === "gt-1")?.due_date).toBe("2026-09-01");
  });

  it("scope_reduce：PJと配下タスクの論理削除がsupabaseを呼ばずstateに反映される", async () => {
    const dialogResult = await applyProposal(
      { proposal_id: "p3", action_type: "scope_reduce", title: "縮小", description: "", target_task_ids: [], target_pj_ids: ["pj_001"] } as never,
      shortIdMap, "__guest__",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    if (dialogResult.type !== "needs_confirmation") throw new Error("unreachable");

    const applyResult = await applyProposalWithConfirmation(dialogResult.dialog, {}, "__guest__", "grp-demo");
    expect(fromSpy).not.toHaveBeenCalled();
    expect(applyResult.type).toBe("success");
    expect(useAppStore.getState().projects.find(p => p.id === "gp-1")?.is_deleted).toBe(true);

    if (applyResult.type !== "success") throw new Error("unreachable");
    const undoResult = await applyUndo(applyResult.snapshot, "__guest__");
    expect(fromSpy).not.toHaveBeenCalled();
    expect(undoResult.type).toBe("success");
    expect(useAppStore.getState().projects.find(p => p.id === "gp-1")?.is_deleted).toBe(false);
  });

  it("add_task：新規タスク作成がsupabaseを呼ばずstateに追加される", async () => {
    const dialogResult = await applyProposal(
      { proposal_id: "p4", action_type: "add_task", title: "新規タスク", description: "", target_task_ids: [], target_pj_ids: [] } as never,
      shortIdMap, "__guest__",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    if (dialogResult.type !== "needs_confirmation") throw new Error("unreachable");

    const tempId = dialogResult.dialog.new_task_items![0].temp_id;
    const applyResult = await applyProposalWithConfirmation(
      dialogResult.dialog, { [`${tempId}_name`]: "新規タスク" }, "__guest__", "grp-demo",
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(applyResult.type).toBe("success");
    expect(useAppStore.getState().tasks.some(t => t.name === "新規タスク")).toBe(true);
  });
});

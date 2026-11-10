import { describe, it, expect } from "vitest";
import {
  applyProposalToPreview, diffTasksForPreview, summarizeChanges, onlyChangedTasks, describeChange,
} from "../ganttPreviewDiff";
import type { Task } from "../../localData/types";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id: "p1", todo_ids: [], assignee_member_id: "m1", assignee_member_ids: ["m1"],
    status: "todo", priority: null, start_date: null, due_date: "2026-11-10", estimated_hours: null,
    comment: "", is_deleted: false, ...over,
  };
}

const TASKS = [task("a"), task("b", { due_date: "2026-11-20" }), task("c")];
const noMember = () => undefined;

describe("applyProposalToPreview", () => {
  it("date_change: suggested_date を対象だけに入れる（元の配列は変えない）", () => {
    const after = applyProposalToPreview(TASKS, { action_type: "date_change", suggested_date: "2026-12-01" }, ["a"], noMember);
    expect(after.find(t => t.id === "a")!.due_date).toBe("2026-12-01");
    expect(after.find(t => t.id === "b")!.due_date).toBe("2026-11-20");
    expect(TASKS[0].due_date).toBe("2026-11-10");
  });

  it("date_change: shift_days があれば各タスクの期日に加算する（反映時と同じ）", () => {
    const after = applyProposalToPreview(TASKS, { action_type: "date_change", shift_days: 7, suggested_date: "2026-12-31" }, ["a", "b"], noMember);
    expect(after.find(t => t.id === "a")!.due_date).toBe("2026-11-17");
    expect(after.find(t => t.id === "b")!.due_date).toBe("2026-11-27");
  });

  it("assignee: 短縮名から引いたメンバーに置き換える。引けなければ変えない", () => {
    const find = (n: string) => (n === "山本" ? "m2" : undefined);
    const ok = applyProposalToPreview(TASKS, { action_type: "assignee", suggested_assignee: "山本" }, ["a"], find);
    expect(ok.find(t => t.id === "a")!.assignee_member_ids).toEqual(["m2"]);
    const ng = applyProposalToPreview(TASKS, { action_type: "assignee", suggested_assignee: "不明" }, ["a"], find);
    expect(ng.find(t => t.id === "a")!.assignee_member_id).toBe("m1");
  });
});

describe("diffTasksForPreview", () => {
  it("変わっていないタスクは含めない", () => {
    expect(diffTasksForPreview(TASKS, TASKS).size).toBe(0);
  });

  it("日付変更・担当変更を種類つきで返す", () => {
    const after = TASKS.map(t =>
      t.id === "a" ? { ...t, due_date: "2026-11-17" }
        : t.id === "b" ? { ...t, assignee_member_id: "m2", assignee_member_ids: ["m2"] } : t);
    const d = diffTasksForPreview(TASKS, after);
    expect(d.get("a")).toMatchObject({ kind: "date", beforeDue: "2026-11-10", afterDue: "2026-11-17" });
    expect(d.get("b")!.kind).toBe("assignee");
    expect(d.has("c")).toBe(false);
  });

  it("新規追加・削除（一覧から消えた／中止）を検出する", () => {
    const after = [TASKS[0], { ...TASKS[1], status: "cancelled" as const }, task("n")];
    const d = diffTasksForPreview(TASKS, after);
    expect(d.get("n")!.kind).toBe("added");
    expect(d.get("b")!.kind).toBe("removed");
    expect(d.get("c")!.kind).toBe("removed");
  });

  it("日付と担当が同時に変わったときは日程変更として扱う", () => {
    const after = [{ ...TASKS[0], due_date: "2026-11-11", assignee_member_id: "m2", assignee_member_ids: ["m2"] }];
    expect(diffTasksForPreview([TASKS[0]], after).get("a")!.kind).toBe("date");
  });

  it("担当の並び順が違うだけでは変更にしない", () => {
    const b = task("x", { assignee_member_ids: ["m1", "m2"] });
    const a = task("x", { assignee_member_ids: ["m2", "m1"] });
    expect(diffTasksForPreview([b], [a]).size).toBe(0);
  });

  it("期日が未設定から入る場合も日程変更", () => {
    const b = task("x", { due_date: null });
    const a = task("x", { due_date: "2026-12-01" });
    expect(diffTasksForPreview([b], [a]).get("x")).toMatchObject({ kind: "date", beforeDue: null, afterDue: "2026-12-01" });
  });
});

describe("summarizeChanges / onlyChangedTasks / describeChange", () => {
  const after = [{ ...TASKS[0], due_date: "2026-11-17" }, TASKS[1], TASKS[2], task("n")];
  const d = diffTasksForPreview(TASKS, after);

  it("種類別の件数と合計", () => {
    expect(summarizeChanges(d)).toEqual({ date: 1, assignee: 0, added: 1, removed: 0, total: 2 });
  });

  it("変更のあるタスクだけに絞る", () => {
    expect(onlyChangedTasks(after, d).map(t => t.id)).toEqual(["a", "n"]);
  });

  it("日程変更は「月/日 → 月/日」で説明する", () => {
    expect(describeChange(d.get("a")!)).toBe("11/10 → 11/17");
    expect(describeChange(d.get("n")!)).toBe("新規追加");
  });
});

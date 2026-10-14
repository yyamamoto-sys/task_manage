import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "../../localData/types";
import {
  createInlineSubmitter, defaultsForGroup, emptyDraft, isDraftDirty, makeSpec, nextTabTarget,
  type GroupAddSpec,
} from "../inlineAdd";
import {
  _resetListInlineAddForTest, registerListInlineAdd, requestListInlineAdd,
} from "../inlineAddRegistry";

const spec = (over: Partial<GroupAddSpec> = {}): GroupAddSpec => ({
  projectId: null, todoId: null, assigneeId: null, status: null, tag: null, sectionId: null, ...over,
});

describe("defaultsForGroup：グループの属性を初期値にする", () => {
  it("PJ別：そのPJ・担当者は空・状態はtodo", () => {
    const d = defaultsForGroup(spec({ projectId: "p1" }));
    expect(d).toEqual({ projectId: "p1", todoIds: [], assigneeIds: [], status: "todo", tags: [], sectionId: null });
  });
  it("PJ未設定グループ：project_idなし・ToDoなし", () => {
    const d = defaultsForGroup(spec());
    expect(d.projectId).toBeNull();
    expect(d.todoIds).toEqual([]);
  });
  it("ToDoグループ：PJなし・そのToDoに紐づく", () => {
    const d = defaultsForGroup(spec({ todoId: "td1" }));
    expect(d.projectId).toBeNull();
    expect(d.todoIds).toEqual(["td1"]);
  });
  it("担当者別：その担当者", () => {
    expect(defaultsForGroup(spec({ assigneeId: "m1" })).assigneeIds).toEqual(["m1"]);
  });
  it("状態別：その状態", () => {
    expect(defaultsForGroup(spec({ status: "on_hold" })).status).toBe("on_hold");
  });
  it("タグ別：そのタグ。タグなしグループはタグなし", () => {
    expect(defaultsForGroup(spec({ tag: "懇親会" })).tags).toEqual(["懇親会"]);
    expect(defaultsForGroup(spec()).tags).toEqual([]);
  });
});

describe("下書き", () => {
  it("空の下書きの担当者は、担当者別グループのときだけそのグループの担当者", () => {
    expect(emptyDraft(spec()).assigneeIds).toEqual([]);
    expect(emptyDraft(spec({ assigneeId: "m1" })).assigneeIds).toEqual(["m1"]);
  });
  it("名前が空白だけなら未保存扱いにしない", () => {
    expect(isDraftDirty({ ...emptyDraft(spec()), name: "  " })).toBe(false);
    expect(isDraftDirty({ ...emptyDraft(spec()), name: "a" })).toBe(true);
  });
});

describe("createInlineSubmitter：登録処理", () => {
  const mk = () => {
    const saved: Task[] = [];
    const saveTask = vi.fn(async (t: Task) => { saved.push(t); });
    const submitter = createInlineSubmitter({ getTasks: () => saved, saveTask, userId: "u1" });
    return { saved, saveTask, submitter };
  };

  it("タスク名が空なら登録しない", async () => {
    const { saveTask, submitter } = mk();
    const r = await submitter.submit({ ...emptyDraft(spec()), name: "   " }, spec());
    expect(r).toEqual({ ok: false, reason: "empty" });
    expect(saveTask).not.toHaveBeenCalled();
  });

  it("グループの属性・担当者・日付を載せたトップレベルのタスクを作る", async () => {
    const { saveTask, submitter } = mk();
    const r = await submitter.submit(
      { name: "A", assigneeIds: ["m1"], startDate: "2026-10-01", dueDate: "2026-10-09" },
      spec({ projectId: "p1", status: "in_progress", tag: "x" }),
    );
    expect(r.ok).toBe(true);
    const t = saveTask.mock.calls[0][0];
    expect(t).toMatchObject({
      name: "A", project_id: "p1", parent_task_id: null, status: "in_progress",
      assignee_member_id: "m1", start_date: "2026-10-01", due_date: "2026-10-09",
      tags: ["x"], updated_by: "u1",
    });
  });

  it("連続入力：2件目の display_order は1件目の次になる", async () => {
    const { saved, submitter } = mk();
    await submitter.submit({ ...emptyDraft(spec()), name: "1" }, spec({ projectId: "p1" }));
    await submitter.submit({ ...emptyDraft(spec()), name: "2" }, spec({ projectId: "p1" }));
    expect(saved.map(t => t.display_order)).toEqual([0, 1]);
  });

  it("開始日が期日より後なら登録しない", async () => {
    const { saveTask, submitter } = mk();
    const r = await submitter.submit(
      { name: "A", assigneeIds: [], startDate: "2026-10-10", dueDate: "2026-10-01" }, spec(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dates");
    expect(saveTask).not.toHaveBeenCalled();
  });

  it("保存中は二重登録しない（Enter連打）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(res => { release = res; });
    const saveTask = vi.fn(async () => { await gate; });
    const submitter = createInlineSubmitter({ getTasks: () => [], saveTask, userId: "u1" });
    const p1 = submitter.submit({ ...emptyDraft(spec()), name: "A" }, spec());
    const r2 = await submitter.submit({ ...emptyDraft(spec()), name: "A" }, spec());
    expect(r2).toEqual({ ok: false, reason: "busy" });
    release();
    expect((await p1).ok).toBe(true);
    expect(saveTask).toHaveBeenCalledTimes(1);
    // 完了後は再び登録できる
    expect((await submitter.submit({ ...emptyDraft(spec()), name: "B" }, spec())).ok).toBe(true);
  });

  it("保存に失敗しても busy が残らない（下書きは呼び出し側が保持する）", async () => {
    const saveTask = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const submitter = createInlineSubmitter({ getTasks: () => [], saveTask, userId: "u1" });
    const r1 = await submitter.submit({ ...emptyDraft(spec()), name: "A" }, spec());
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("error");
    expect((await submitter.submit({ ...emptyDraft(spec()), name: "A" }, spec())).ok).toBe(true);
  });
});

describe("nextTabTarget：Tab は 名前→担当者→開始日→期日", () => {
  it("順方向", () => {
    expect(nextTabTarget("name", false)).toBe("assignee");
    expect(nextTabTarget("assignee", false)).toBe("start");
    expect(nextTabTarget("start", false)).toBe("due");
    expect(nextTabTarget("due", false)).toBe("detail");
    expect(nextTabTarget("detail", false)).toBeNull();
  });
  it("Shift+Tab は逆順。先頭から出るときは null（ブラウザ既定に任せる）", () => {
    expect(nextTabTarget("due", true)).toBe("start");
    expect(nextTabTarget("assignee", true)).toBe("name");
    expect(nextTabTarget("name", true)).toBeNull();
  });
});

describe("FAB→リストの追加行のレジストリ", () => {
  beforeEach(() => _resetListInlineAddForTest());

  it("リストが登録していなければ未処理（＝呼び出し側がモーダルを開く）", () => {
    expect(requestListInlineAdd("p1")).toBe(false);
  });
  it("登録済みなら選択中のPJを渡して処理させる", () => {
    const handler = vi.fn(() => true);
    registerListInlineAdd(handler);
    expect(requestListInlineAdd("p1")).toBe(true);
    expect(handler).toHaveBeenCalledWith("p1");
    expect(requestListInlineAdd(null)).toBe(true);
    expect(handler).toHaveBeenLastCalledWith(null);
  });
  it("ハンドラが false（グループが無い等）なら未処理を返す", () => {
    registerListInlineAdd(() => false);
    expect(requestListInlineAdd(null)).toBe(false);
  });
  it("解除後は未処理。古い解除関数が新しい登録を消さない", () => {
    const un1 = registerListInlineAdd(() => true);
    const un2 = registerListInlineAdd(() => true);
    un1();
    expect(requestListInlineAdd(null)).toBe(true);
    un2();
    expect(requestListInlineAdd(null)).toBe(false);
  });
});

describe("makeSpec：絞り込み中のPJ", () => {
  it("PJ別以外のまとめ方では、サイドバーで選んだPJに作る", () => {
    expect(makeSpec({ assigneeId: "m1" }, "p9").projectId).toBe("p9");
    expect(makeSpec({ status: "done" }, "p9").projectId).toBe("p9");
    expect(makeSpec({ tag: "x" }, "p9").projectId).toBe("p9");
  });
  it("グループ自身のPJがあればそちらが優先。選択が無ければPJなし", () => {
    expect(makeSpec({ projectId: "p1" }, "p9").projectId).toBe("p1");
    expect(makeSpec({}, null).projectId).toBeNull();
  });
});

describe("作った直後にそのグループへ表示される", () => {
  // ListView の groups の条件と同じ判定（PJ別＝project_id（PJ未設定は todo_ids の先頭で分かれる）／担当者別＝assignee_member_id／
  // タグ別＝tags（無ければタグなし）／状態別＝status）
  const belongs = (
    groupBy: "project" | "assignee" | "tag" | "status",
    spec: GroupAddSpec,
    t: Task,
  ): boolean => {
    if (groupBy === "project") {
      if (spec.projectId) return t.project_id === spec.projectId;
      if (t.project_id != null) return false;
      return spec.todoId ? (t.todo_ids ?? [])[0] === spec.todoId : (t.todo_ids ?? []).length === 0;
    }
    if (groupBy === "assignee") return t.assignee_member_id === spec.assigneeId;
    if (groupBy === "tag") return spec.tag ? (t.tags ?? []).includes(spec.tag) : (t.tags ?? []).length === 0;
    return t.status === spec.status;
  };
  const build = async (spec: GroupAddSpec) => {
    const saved: Task[] = [];
    const s = createInlineSubmitter({ getTasks: () => saved, saveTask: async t => { saved.push(t); }, userId: "u1" });
    const r2 = await s.submit({ ...emptyDraft(spec), name: "新規" }, spec);
    expect(r2.ok).toBe(true);
    return saved[0];
  };

  it.each([
    ["project", spec({ projectId: "p1" })],
    ["project", spec()],
    ["project", spec({ todoId: "td1" })],
    ["assignee", spec({ assigneeId: "m1" })],
    ["tag", spec({ tag: "懇親会" })],
    ["tag", spec()],
    ["status", spec({ status: "on_hold" })],
    ["status", spec({ status: "done" })],
  ] as const)("%s グループ", async (groupBy, s) => {
    const t = await build(s);
    expect(belongs(groupBy, s, t)).toBe(true);
  });
});

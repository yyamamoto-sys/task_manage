// 【設計意図・v3.183】資料インプット（会議読み込み）の下書き作成・保存・出力切れ・日付の検査（巡回61回目）。
// 修正前のコード（画面内の実装）では、担当者が先頭のメンバーになる／存在しないIDが保存対象になる／
// 途中失敗の保存済み分が分からず再登録で二重になる／出力切れがJSONの構文エラーになる、が起きていた。

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Project, Task } from "../../localData/types";
import {
  applyMeetingDrafts, buildStatusDrafts, buildTaskDrafts, describeApplyShortfall, resolveDraftAssignee,
  type StatusDraft, type TaskDraft,
} from "../meetingDrafts";
import {
  takeRestorableMeetingDraft, useMeetingImportDraftStore, type MeetingReviewDraft,
} from "../../../stores/meetingImportDraftStore";
import {
  parseMeetingResponse, TRUNCATED_MEETING_MESSAGE, validateAnalysis, type MeetingStatusUpdate, type MeetingTask,
} from "../meetingExtractor";

const members = [
  { id: "m1", short_name: "青木", display_name: "青木 太郎" },
  { id: "m2", short_name: "山本", display_name: "山本 勇気" },
];

describe("担当者の下書き", () => {
  it("名前が無い（null）ときは先頭のメンバーではなく実行者本人", () => {
    expect(resolveDraftAssignee(null, members, "m2")).toBe("m2");
    expect(resolveDraftAssignee("", members, "m2")).toBe("m2");
  });
  it("実行者が表示部署のメンバーに居なければ空", () => {
    expect(resolveDraftAssignee(null, members, "zzz")).toBe("");
  });
  it("名前があって一致しなければ空（先頭に割り当てない）", () => {
    expect(resolveDraftAssignee("鈴木", members, "m2")).toBe("");
  });
  it("短い名前の完全一致を優先し、なければ表示名に含まれるもので探す", () => {
    expect(resolveDraftAssignee("山本", members, "m1")).toBe("m2");
    expect(resolveDraftAssignee("太郎", members, "m2")).toBe("m1");
  });
});

const mt = (over: Partial<MeetingTask> = {}): MeetingTask => ({
  name: "資料作成", assignee_short_name: null, start_date: null, due_date: null,
  project_hint: null, priority: null, source_quote: "q", ...over,
});

describe("新規タスクの下書き", () => {
  it("チェック済み・PJは名前の部分一致・日付は空文字で初期化する", () => {
    const d = buildTaskDrafts(
      [mt({ project_hint: "営業", due_date: "2026-10-30" }), mt({ name: "B" })],
      members, [{ id: "p1", name: "統合営業PJ" }], "m2",
    );
    expect(d.map(x => x.tempId)).toEqual(["task-0", "task-1"]);
    expect(d[0]).toMatchObject({ checked: true, project_id: "p1", due_date: "2026-10-30", start_date: "", assignee_member_id: "m2" });
    expect(d[1].project_id).toBe("");
  });
});

describe("対象PJを1つに絞ったときの新規タスクのPJ（M85）", () => {
  const projects = [{ id: "p1", name: "統合営業PJ" }, { id: "p2", name: "AAS" }];
  it("PJのヒントが無いタスクは、絞ったPJを初期値にする", () => {
    const d = buildTaskDrafts([mt()], members, [projects[0]], "m2", "p1");
    expect(d[0].project_id).toBe("p1");
  });
  it("ヒントが一致するタスクは、ヒントのPJが優先される", () => {
    const d = buildTaskDrafts([mt({ project_hint: "AAS" })], members, projects, "m2", "p1");
    expect(d[0].project_id).toBe("p2");
  });
  it("絞っていない（null）ときは従来どおり空", () => {
    expect(buildTaskDrafts([mt()], members, projects, "m2", null)[0].project_id).toBe("");
    expect(buildTaskDrafts([mt()], members, projects, "m2")[0].project_id).toBe("");
  });
  it("絞ったPJが候補に無ければ使わない", () => {
    expect(buildTaskDrafts([mt()], members, projects, "m2", "ghost")[0].project_id).toBe("");
  });
});

const su = (id: string | null): MeetingStatusUpdate => ({
  task_name_hint: "ヒント", suggested_task_id: id, new_status: "done", reason: "r", source_quote: "q",
});

describe("更新候補の下書き", () => {
  it("送った一覧に無いIDは空にしてチェックも外す", () => {
    const d = buildStatusDrafts([su("t1"), su("ghost"), su(null)], new Set(["t1", "t2"]));
    expect(d.map(x => [x.task_id, x.checked])).toEqual([["t1", true], ["", false], ["", false]]);
  });
});

function fakeTask(id: string, status: Task["status"] = "todo"): Task {
  return { id, name: id, project_id: null, status, is_deleted: false } as unknown as Task;
}
const td = (tempId: string, over: Partial<TaskDraft> = {}): TaskDraft => ({
  tempId, checked: true, name: tempId, assignee_member_id: "m1", start_date: "", due_date: "",
  project_id: "", priority: null, source_quote: "", ...over,
});
const sd = (tempId: string, taskId: string): StatusDraft => ({
  tempId, checked: true, task_id: taskId, task_name_hint: "h", new_status: "done", reason: "", source_quote: "",
});

function makeDeps(opts: { failTaskNamed?: string; tasks?: Task[] } = {}) {
  let n = 0;
  const savedTasks: Task[] = [];
  const savedProjects: Project[] = [];
  return {
    savedTasks, savedProjects,
    deps: {
      saveTask: vi.fn(async (t: Task) => {
        if (opts.failTaskNamed && t.name === opts.failTaskNamed) throw new Error("save failed");
        savedTasks.push(t);
      }),
      saveProject: vi.fn(async (p: Project) => { savedProjects.push(p); }),
      findTask: (id: string) => (opts.tasks ?? []).find(t => t.id === id),
      newId: () => `id-${++n}`,
      now: () => "2026-10-23T00:00:00.000Z",
    },
  };
}
const base = { currentUserId: "me", newProject: { name: "新PJ", color: "#fff" }, createdProjectId: null };

describe("applyMeetingDrafts：途中失敗のときの保存済み分", () => {
  it("全部成功すると件数を返し、エラーは null", async () => {
    const { deps, savedTasks } = makeDeps({ tasks: [fakeTask("t1")] });
    const r = await applyMeetingDrafts({ ...base, taskDrafts: [td("a"), td("b")], statusDrafts: [sd("s1", "t1")] }, deps);
    expect(r).toMatchObject({ created: 2, updated: 1, skipped: 0, error: null });
    expect(savedTasks.map(t => t.name)).toEqual(["a", "b", "t1"]);
  });

  it("3件目で失敗しても止めず、失敗した1件だけを失敗として返す（M87）", async () => {
    const { deps, savedTasks } = makeDeps({ failTaskNamed: "c" });
    const r = await applyMeetingDrafts({ ...base, taskDrafts: [td("a"), td("b"), td("c"), td("d")], statusDrafts: [] }, deps);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.savedTaskTempIds).toEqual(["a", "b", "d"]);
    expect(r.failedTaskTempIds).toEqual(["c"]);
    expect(r.created).toBe(3);
    expect(r.aborted).toBe(false);
    expect(r.unprocessed).toBe(0);
    expect(savedTasks.map(t => t.name)).toEqual(["a", "b", "d"]);
  });

  it("失敗した分だけで再実行すると二重にならない", async () => {
    const first = makeDeps({ failTaskNamed: "c" });
    const drafts = [td("a"), td("b"), td("c"), td("d")];
    const r1 = await applyMeetingDrafts({ ...base, taskDrafts: drafts, statusDrafts: [] }, first.deps);
    const remaining = drafts.filter(d => !r1.savedTaskTempIds.includes(d.tempId));
    expect(remaining.map(d => d.tempId)).toEqual(["c"]);
    const second = makeDeps();
    const r2 = await applyMeetingDrafts({ ...base, taskDrafts: remaining, statusDrafts: [] }, second.deps);
    expect([...first.savedTasks, ...second.savedTasks].map(t => t.name).sort()).toEqual(["a", "b", "c", "d"]);
    expect(r2.error).toBeNull();
  });

  it("連続3件失敗したら残りを中止し、手を付けていない件数を返す（保存は呼ばない）", async () => {
    let calls = 0;
    const deps = {
      saveTask: vi.fn(async () => { calls += 1; throw new Error("Failed to fetch"); }),
      saveProject: vi.fn(async () => {}),
      findTask: () => undefined,
      newId: () => "id",
      now: () => "2026-10-23T00:00:00.000Z",
    };
    const drafts = ["a", "b", "c", "d", "e"].map(n => td(n));
    const r = await applyMeetingDrafts({ ...base, taskDrafts: drafts, statusDrafts: [sd("s1", "t1")] }, deps);
    expect(calls).toBe(3);
    expect(r.aborted).toBe(true);
    expect(r.failedTaskTempIds).toEqual(["a", "b", "c"]);
    expect(r.unprocessed).toBe(3);
    expect(r.created + r.updated).toBe(0);
  });

  it("失敗の間に成功が挟まれば、連続とは数えない", async () => {
    const failing = new Set(["a", "c", "e"]);
    const deps = {
      saveTask: vi.fn(async (t: Task) => { if (failing.has(t.name)) throw new Error("x"); }),
      saveProject: vi.fn(async () => {}),
      findTask: () => undefined,
      newId: () => "id",
      now: () => "2026-10-23T00:00:00.000Z",
    };
    const r = await applyMeetingDrafts(
      { ...base, taskDrafts: ["a", "b", "c", "d", "e", "f"].map(n => td(n)), statusDrafts: [] }, deps);
    expect(r.aborted).toBe(false);
    expect(r.failedTaskTempIds).toEqual(["a", "c", "e"]);
    expect(r.savedTaskTempIds).toEqual(["b", "d", "f"]);
  });

  it("新規PJが作れなかったら、そのPJ向けのタスクは「PJ未設定」で保存せず失敗として残す", async () => {
    const savedTasks: Task[] = [];
    const deps = {
      saveTask: vi.fn(async (t: Task) => { savedTasks.push(t); }),
      saveProject: vi.fn(async () => { throw new Error("project failed"); }),
      findTask: () => undefined,
      newId: () => "id",
      now: () => "2026-10-23T00:00:00.000Z",
    };
    const r = await applyMeetingDrafts(
      { ...base, taskDrafts: [td("a", { project_id: "__new__" }), td("b")], statusDrafts: [] }, deps);
    expect(r.failedTaskTempIds).toEqual(["a"]);
    expect(r.savedTaskTempIds).toEqual(["b"]);
    expect(savedTasks.map(t => t.name)).toEqual(["b"]);
    expect(r.createdProjectId).toBeNull();
  });

  it("更新の保存が失敗しても続行し、失敗の下書きIDを返す", async () => {
    const deps = {
      saveTask: vi.fn(async (t: Task) => { if (t.id === "t1") throw new Error("gate"); }),
      saveProject: vi.fn(async () => {}),
      findTask: (id: string) => fakeTask(id),
      newId: () => "id",
      now: () => "2026-10-23T00:00:00.000Z",
    };
    const r = await applyMeetingDrafts({ ...base, taskDrafts: [], statusDrafts: [sd("s1", "t1"), sd("s2", "t2")] }, deps);
    expect(r.failedStatusTempIds).toEqual(["s1"]);
    expect(r.savedStatusTempIds).toEqual(["s2"]);
    expect(r.updated).toBe(1);
  });

  it("新規PJは1回だけ作り、失敗後の再実行では作成済みのIDを使う", async () => {
    const first = makeDeps({ failTaskNamed: "b" });
    const drafts = [td("a", { project_id: "__new__" }), td("b", { project_id: "__new__" })];
    const r1 = await applyMeetingDrafts({ ...base, taskDrafts: drafts, statusDrafts: [] }, first.deps);
    expect(first.savedProjects).toHaveLength(1);
    expect(r1.createdProjectId).toBe(first.savedProjects[0].id);
    expect(first.savedTasks[0].project_id).toBe(r1.createdProjectId);

    const second = makeDeps();
    const r2 = await applyMeetingDrafts(
      { ...base, createdProjectId: r1.createdProjectId, taskDrafts: [drafts[1]], statusDrafts: [] }, second.deps);
    expect(second.savedProjects).toHaveLength(0);
    expect(second.savedTasks[0].project_id).toBe(r1.createdProjectId);
    expect(r2.error).toBeNull();
  });

  it("更新対象のタスクが見つからないときは数えて返し、止めない", async () => {
    const { deps } = makeDeps({ tasks: [fakeTask("t1")] });
    const r = await applyMeetingDrafts({ ...base, taskDrafts: [], statusDrafts: [sd("s1", "gone"), sd("s2", "t1")] }, deps);
    expect(r).toMatchObject({ updated: 1, skipped: 1, skippedStatusTempIds: ["s1"], savedStatusTempIds: ["s2"], error: null });
  });

  it("担当者が空なら実行者本人にして保存する", async () => {
    const { deps, savedTasks } = makeDeps();
    await applyMeetingDrafts({ ...base, taskDrafts: [td("a", { assignee_member_id: "" })], statusDrafts: [] }, deps);
    expect(savedTasks[0].assignee_member_id).toBe("me");
  });
});

describe("出力切れ（max_tokens）", () => {
  const ok = JSON.stringify({ summary: "s", new_tasks: [], status_updates: [], decisions: [], risks: [] });
  it("途中で切れた返答は、JSONの構文エラーではなく案内を出す", () => {
    expect(() => parseMeetingResponse('{"summary":"s","new_tasks":[{"name"', "max_tokens")).toThrow(TRUNCATED_MEETING_MESSAGE);
  });
  it("通常の返答はそのまま検証済みの形で返す", () => {
    expect(parseMeetingResponse(ok, "end_turn").summary).toBe("s");
    expect(parseMeetingResponse(ok, undefined).summary).toBe("s");
  });
});

describe("開始日が期日より後の組", () => {
  it("開始日を空にして、期日は残す", () => {
    const r = validateAnalysis({
      summary: "s", status_updates: [], decisions: [], risks: [],
      new_tasks: [
        { name: "A", start_date: "2026-10-30", due_date: "2026-10-20" },
        { name: "B", start_date: "2026-10-20", due_date: "2026-10-20" },
        { name: "C", start_date: "2026-10-20", due_date: "2026-10-30" },
      ],
    });
    expect(r.new_tasks.map(t => [t.start_date, t.due_date])).toEqual([
      [null, "2026-10-20"], ["2026-10-20", "2026-10-20"], ["2026-10-20", "2026-10-30"],
    ]);
  });
});

// ===== 画面の配線（Reactレンダリング基盤が無いためソース走査。Section 59：行頭コメント・行末コメントを除く） =====
function read(rel: string): string {
  const src = readFileSync(resolve(__dirname, "../../../..", rel), "utf-8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}
const panel = read("src/components/meeting/MeetingImportPanel.tsx");
const extractor = read("src/lib/ai/meetingExtractor.ts");

describe("資料インプットの画面配線", () => {
  it("解析・登録は処理中の二重起動を止める", () => {
    expect(panel).toMatch(/if \(analyzingRef\.current\) return;\s*analyzingRef\.current = true;/);
    expect(panel).toMatch(/if \(applyingRef\.current\) return;\s*applyingRef\.current = true;/);
    expect(panel).toMatch(/\} finally \{\s*analyzingRef\.current = false;/);
    expect(panel).toMatch(/\} finally \{\s*applyingRef\.current = false;/);
  });
  it("登録は applyMeetingDrafts を通し、失敗時は保存済みの下書きを外す", () => {
    expect(panel).toContain("await applyMeetingDrafts(");
    expect(panel).toMatch(/setTaskDrafts\(prev => prev\.filter\(d => !savedTasks\.has\(d\.tempId\)\)\)/);
    expect(panel).not.toContain("await saveTask(");
  });
  it("下書きの作成は buildTaskDrafts／buildStatusDrafts を通す（先頭メンバーへの既定割り当てを書かない）", () => {
    expect(panel).toContain("buildTaskDrafts(");
    expect(panel).toContain("buildStatusDrafts(");
    expect(panel).not.toContain("members[0]");
  });
  it("読み込み時に30,000字で切らない（整形後の文字数で数える）", () => {
    expect(panel).not.toMatch(/text\.slice\(0, MAX_TRANSCRIPT_CHARS\)/);
    expect(panel).toMatch(/parseTranscript\(trimmed\)\.length/);
  });
  it("抽出は stop_reason を見る関数を通す", () => {
    expect(extractor).toContain("parseMeetingResponse(res.content[0]?.text");
    expect(extractor).toContain('stopReason === "max_tokens"');
  });
});

describe("登録できなかったときの案内文（M87）", () => {
  const o = { created: 0, updated: 0, failedTaskTempIds: [] as string[], failedStatusTempIds: [] as string[], unprocessed: 0, aborted: false };
  it("失敗も未処理も無ければ空", () => {
    expect(describeApplyShortfall({ ...o, created: 3 })).toBe("");
  });
  it("連続失敗では「N件は保存できませんでした／残りM件は未処理です」を出す", () => {
    const msg = describeApplyShortfall({ ...o, created: 2, failedTaskTempIds: ["a", "b", "c"], unprocessed: 4, aborted: true });
    expect(msg).toContain("3件は保存できませんでした");
    expect(msg).toContain("残り4件は未処理です");
    expect(msg).toContain("タスク2件");
  });
  it("未処理が無ければ「残り」は出さない", () => {
    const msg = describeApplyShortfall({ ...o, failedTaskTempIds: ["a"] });
    expect(msg).toContain("1件は保存できませんでした");
    expect(msg).not.toContain("未処理");
  });
});

describe("確認画面の下書きをパネルの外に保持する（M84）", () => {
  const draft = (userId: string): MeetingReviewDraft => ({
    userId,
    analysis: { summary: "s", new_tasks: [], status_updates: [], decisions: [], risks: [] },
    taskDrafts: [td("a")], statusDrafts: [], newProjName: "", newProjColor: "#6366f1", createdProjectId: null,
  });
  it("同じユーザーなら復元できる（タブを切り替えて戻っても失われない）", () => {
    useMeetingImportDraftStore.getState().saveDraft(draft("u1"));
    expect(takeRestorableMeetingDraft("u1")?.taskDrafts.map(d => d.tempId)).toEqual(["a"]);
    expect(takeRestorableMeetingDraft("u1")).not.toBeNull();
  });
  it("別のユーザーの下書きは復元せず、破棄する", () => {
    useMeetingImportDraftStore.getState().saveDraft(draft("u1"));
    expect(takeRestorableMeetingDraft("u2")).toBeNull();
    expect(useMeetingImportDraftStore.getState().draft).toBeNull();
  });
  it("破棄したら復元されない", () => {
    useMeetingImportDraftStore.getState().saveDraft(draft("u1"));
    useMeetingImportDraftStore.getState().clearDraft();
    expect(takeRestorableMeetingDraft("u1")).toBeNull();
  });
});

describe("資料インプットの画面配線（v3.184）", () => {
  it("確認画面の下書きはストアから復元し、編集に追従して写す", () => {
    expect(panel).toContain("takeRestorableMeetingDraft(currentUser.id)");
    expect(panel).toMatch(/useState<Step>\(restored \? "review" : "input"\)/);
    expect(panel).toMatch(/useMeetingImportDraftStore\.getState\(\)\.saveDraft\(/);
  });
  it("未保存編集レジストリに登録し、確認画面・登録中をdirtyにする", () => {
    expect(panel).toMatch(/useUnsavedEditor\(\s*\(step === "review" && hasReviewContent\(taskDrafts, statusDrafts\)\) \|\| step === "applying",/);
  });
  it("ビュー切替では確認を出さない（下書きはストアに残る）。登録中だけは切替でも確認する", () => {
    expect(panel).toMatch(/survivesViewSwitch: step !== "applying"/);
    const layout = readFileSync(resolve(__dirname, "../../../components/layout/MainLayout.tsx"), "utf8");
    expect(layout).toContain("confirmDiscardUnsavedEdits(opts?.storeLost ? undefined : { viewSwitch: true })");
    const dept = layout.slice(layout.indexOf("const handleSelectGroupNav"), layout.indexOf("const handleSelectGroupNav") + 600);
    expect(dept).toContain("{ storeLost: true }");
  });
  it("「やり直す」は確認を通す", () => {
    expect(panel).not.toMatch(/<button onClick=\{handleReset\}/);
    expect(panel).toContain("void requestReset()");
  });
  it("絞った対象PJを新規タスクの初期値として渡す", () => {
    expect(panel).toMatch(/buildTaskDrafts\(result\.new_tasks, members, projects, currentUser\.id, targetPjId\)/);
  });
  it("登録の失敗の案内は describeApplyShortfall を通す", () => {
    expect(panel).toContain("describeApplyShortfall(outcome)");
  });
});

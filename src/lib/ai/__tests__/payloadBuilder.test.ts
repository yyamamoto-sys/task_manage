import { describe, it, expect, afterEach, vi } from "vitest";
import { buildPayload } from "../payloadBuilder";
import type { Member, Project, Task, ToDo, KeyResult, TaskForce } from "../../localData/types";

// ===== フィクスチャヘルパー =====

function makeMember(over: Partial<Member> = {}): Member {
  return {
    id: "m1",
    display_name: "山本",
    short_name: "山本",
    initials: "YY",
    teams_account: "",
    color_bg: "#fff",
    color_text: "#000",
    is_deleted: false,
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "pj-uuid-1",
    name: "PJ1",
    purpose: "目的1",
    contribution_memo: "ここにKR情報が入る可能性がある（AIに渡してはいけない）",
    owner_member_id: "m1",
    owner_member_ids: ["m1"],
    status: "active",
    color_tag: "#000",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    is_deleted: false,
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-uuid-1",
    name: "タスク1",
    project_id: "pj-uuid-1",
    todo_ids: [],
    assignee_member_id: "m1",
    assignee_member_ids: ["m1"],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    completed_at: null,
    ...over,
  };
}

/**
 * オブジェクトを再帰的に走査し、指定キーが現れたら true。
 * ネスト・配列をすべて探索する。
 */
function deepHasKey(obj: unknown, key: string): boolean {
  if (obj === null || obj === undefined) return false;
  if (Array.isArray(obj)) return obj.some(v => deepHasKey(v, key));
  if (typeof obj === "object") {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      if (k === key) return true;
      if (deepHasKey((obj as Record<string, unknown>)[k], key)) return true;
    }
  }
  return false;
}

// ===== テスト =====

describe("buildPayload — AI境界ルール（最重要）", () => {
  it("payload のどこにも contribution_memo が含まれない", () => {
    const { payload } = buildPayload({
      projects: [makeProject({ contribution_memo: "KR1の達成に貢献する" })],
      tasks: [makeTask()],
      members: [makeMember()],
      consultationType: "change",
      consultation: "テスト",
      scope: "all_pj",
    });
    expect(deepHasKey(payload, "contribution_memo")).toBe(false);
  });

  it("通常モード（includeOKR 未指定）では okr_context が含まれない", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [makeTask()],
      members: [makeMember()],
      consultationType: "change",
      consultation: "テスト",
      scope: "all_pj",
    });
    expect(payload.okr_context).toBeUndefined();
    expect(deepHasKey(payload, "okr_context")).toBe(false);
  });

  it("AIProject に pj_purpose は含まれるが、contribution_memo フィールドは作られない", () => {
    const { payload } = buildPayload({
      projects: [makeProject({ purpose: "目的A", contribution_memo: "秘密" })],
      tasks: [],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].pj_purpose).toBe("目的A");
    expect((payload.projects[0] as unknown as Record<string, unknown>).contribution_memo).toBeUndefined();
  });
});

describe("buildPayload — 論理削除・アーカイブの除外", () => {
  it("is_deleted=true の PJ は projects に含まれない", () => {
    const { payload } = buildPayload({
      projects: [
        makeProject({ id: "pj-1", name: "生きている" }),
        makeProject({ id: "pj-2", name: "削除済", is_deleted: true }),
      ],
      tasks: [],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects.map(p => p.pj_name)).toEqual(["生きている"]);
  });

  it("status=archived の PJ は projects に含まれない", () => {
    const { payload } = buildPayload({
      projects: [
        makeProject({ id: "pj-1", name: "active" }),
        makeProject({ id: "pj-2", name: "archived", status: "archived" }),
      ],
      tasks: [],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects.map(p => p.pj_name)).toEqual(["active"]);
  });

  it("is_deleted=true のタスクは AIProject.tasks に含まれない", () => {
    const { payload } = buildPayload({
      projects: [makeProject({ id: "pj-1" })],
      tasks: [
        makeTask({ id: "t1", name: "生", project_id: "pj-1" }),
        makeTask({ id: "t2", name: "削", project_id: "pj-1", is_deleted: true }),
      ],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].tasks.map(t => t.task_name)).toEqual(["生"]);
  });
});

describe("buildPayload — shortId と shortIdMap", () => {
  it("PJ の shortId は pj_001 形式（3桁ゼロ埋め）", () => {
    const { payload, shortIdMap } = buildPayload({
      projects: [
        makeProject({ id: "uuid-A", name: "A" }),
        makeProject({ id: "uuid-B", name: "B" }),
      ],
      tasks: [],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects.map(p => p.pj_id)).toEqual(["pj_001", "pj_002"]);
    expect(shortIdMap.get("pj_001")).toBe("uuid-A");
    expect(shortIdMap.get("pj_002")).toBe("uuid-B");
  });

  it("タスクカウンタは PJ をまたいでグローバル連番（衝突なし）", () => {
    const { payload, shortIdMap } = buildPayload({
      projects: [
        makeProject({ id: "pj-1", name: "PJ1" }),
        makeProject({ id: "pj-2", name: "PJ2" }),
      ],
      tasks: [
        makeTask({ id: "t-A", name: "A", project_id: "pj-1" }),
        makeTask({ id: "t-B", name: "B", project_id: "pj-1" }),
        makeTask({ id: "t-C", name: "C", project_id: "pj-2" }),
      ],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    const allTaskIds = payload.projects.flatMap(p => p.tasks.map(t => t.task_id));
    expect(allTaskIds).toEqual(["task_001", "task_002", "task_003"]);
    expect(shortIdMap.get("task_001")).toBe("t-A");
    expect(shortIdMap.get("task_003")).toBe("t-C");
  });
});

describe("buildPayload — コメントのサニタイズ", () => {
  it("ネットワークパスを含むコメントが [ファイルパス省略] に置換される", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [makeTask({ comment: "\\\\Fs02\\bumon\\資料.xlsx 参照" })],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].tasks[0].comment).toBe("[ファイルパス省略] 参照");
  });

  it("null コメントは空文字に正規化される（Supabase から null が返るケース）", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [makeTask({ comment: null as unknown as string })],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].tasks[0].comment).toBe("");
  });
});

describe("buildPayload — 担当者解決", () => {
  it("該当メンバーがいない場合は assignee は '未担当'", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [makeTask({ assignee_member_id: "m-orphan", assignee_member_ids: ["m-orphan"] })],
      members: [makeMember({ id: "m1" })],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].tasks[0].assignee).toBe("未担当");
  });

  it("複数担当者は short_name を「・」で結合して渡す（旧 単数 assignee_member_id 同期は影響しない）", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [makeTask({
        assignee_member_id: "m1",
        assignee_member_ids: ["m1", "m2", "m3"],
      })],
      members: [
        makeMember({ id: "m1", short_name: "山本" }),
        makeMember({ id: "m2", short_name: "田中" }),
        makeMember({ id: "m3", short_name: "中村" }),
      ],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].tasks[0].assignee).toBe("山本・田中・中村");
  });
});

describe("buildPayload — task_projects（追加プロジェクト）", () => {
  it("task_projects 経由で別PJに紐付くタスクも、そのPJのタスク一覧に含める", () => {
    const { payload } = buildPayload({
      projects: [
        makeProject({ id: "pj-A", name: "PJ A" }),
        makeProject({ id: "pj-B", name: "PJ B" }),
      ],
      tasks: [
        // 主project_id=pj-A のタスクを task_projects 経由で pj-B にも紐付ける
        makeTask({ id: "t-shared", name: "横断タスク", project_id: "pj-A" }),
      ],
      members: [makeMember()],
      taskProjects: [{ task_id: "t-shared", project_id: "pj-B" }],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects).toHaveLength(2);
    const pjA = payload.projects.find(p => p.pj_name === "PJ A")!;
    const pjB = payload.projects.find(p => p.pj_name === "PJ B")!;
    expect(pjA.tasks.map(t => t.task_name)).toContain("横断タスク");
    expect(pjB.tasks.map(t => t.task_name)).toContain("横断タスク");
  });
});

describe("buildPayload — PJ↔TF 双方向リンク（projectTaskForces）", () => {
  it("AIProject.linked_tf_numbers に「TF{krIdx+1}-{番号}」形式のラベル配列が入る", () => {
    const krs: KeyResult[] = [
      { id: "kr-1", objective_id: "o-1", title: "KR1", is_deleted: false },
      { id: "kr-2", objective_id: "o-1", title: "KR2", is_deleted: false },
    ];
    const tfs: TaskForce[] = [
      { id: "tf-A", kr_id: "kr-1", tf_number: "1", name: "TF A", leader_member_id: "m1", is_deleted: false },
      { id: "tf-B", kr_id: "kr-2", tf_number: "3", name: "TF B", leader_member_id: "m1", is_deleted: false },
    ];
    const { payload } = buildPayload({
      projects: [makeProject({ id: "pj-1", name: "PJ One" })],
      tasks: [],
      members: [makeMember()],
      projectTaskForces: [
        { project_id: "pj-1", tf_id: "tf-A" },
        { project_id: "pj-1", tf_id: "tf-B" },
      ],
      keyResults: krs,
      taskForces: tfs,
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].linked_tf_numbers).toEqual(["TF1-1", "TF2-3"]);
  });

  it("OKRコンテキスト有効時：AITaskForce.linked_pj_names に対応PJ名が入る", () => {
    const krs: KeyResult[] = [
      { id: "kr-1", objective_id: "o-1", title: "KR1", is_deleted: false },
    ];
    const tfs: TaskForce[] = [
      { id: "tf-A", kr_id: "kr-1", tf_number: "1", name: "TF A", leader_member_id: "m1", is_deleted: false },
    ];
    const { payload } = buildPayload({
      projects: [
        makeProject({ id: "pj-1", name: "PJ One" }),
        makeProject({ id: "pj-2", name: "PJ Two" }),
      ],
      tasks: [],
      members: [makeMember()],
      projectTaskForces: [
        { project_id: "pj-1", tf_id: "tf-A" },
        { project_id: "pj-2", tf_id: "tf-A" },
      ],
      keyResults: krs,
      taskForces: tfs,
      includeOKR: true,
      currentObjective: { id: "o-1", title: "今期Objective", period: "2026" },
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.okr_context!.key_results[0].task_forces[0].linked_pj_names).toEqual(["PJ One", "PJ Two"]);
  });

  it("projectTaskForces が空なら linked_tf_numbers / linked_pj_names も空配列", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [],
      members: [makeMember()],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].linked_tf_numbers).toEqual([]);
  });
});

describe("buildPayload — Project.member_ids（オーナー以外の関与者）", () => {
  it("pj_members に member_ids が short_name で展開される", () => {
    const { payload } = buildPayload({
      projects: [makeProject({ owner_member_ids: ["m1"], member_ids: ["m2", "m3"] })],
      tasks: [],
      members: [
        makeMember({ id: "m1", short_name: "山本" }),
        makeMember({ id: "m2", short_name: "田中" }),
        makeMember({ id: "m3", short_name: "中村" }),
      ],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    expect(payload.projects[0].pj_owners).toEqual(["山本"]);
    expect(payload.projects[0].pj_members).toEqual(["田中", "中村"]);
  });
});

describe("buildPayload — member_workload は複数担当者を正しくカウントする", () => {
  it("assignee_member_ids に自分が含まれるタスクをすべて自分の負荷に積む", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [
        makeTask({ id: "t1", assignee_member_id: "m1", assignee_member_ids: ["m1", "m2"], status: "in_progress", estimated_hours: 4 }),
        makeTask({ id: "t2", assignee_member_id: "m2", assignee_member_ids: ["m2"],       status: "todo",        estimated_hours: 2 }),
      ],
      members: [
        makeMember({ id: "m1", short_name: "山本" }),
        makeMember({ id: "m2", short_name: "田中" }),
      ],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    const m1 = payload.context.member_workload.find(w => w.short_name === "山本")!;
    const m2 = payload.context.member_workload.find(w => w.short_name === "田中")!;
    // m1 は t1 のみ担当（共同）。m2 は t1+t2 両方担当（合算）
    expect(m1.in_progress_count).toBe(1);
    expect(m1.todo_count).toBe(0);
    expect(m2.in_progress_count).toBe(1);
    expect(m2.todo_count).toBe(1);
  });
});

describe("buildPayload — 会計四半期判定", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1月は 1Q（四半期境界の境）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T09:00:00+09:00"));
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [],
      consultationType: "change", consultation: "x", scope: "all_pj",
    });
    expect(payload.context.quarters.current_quarter).toBe("1Q");
    expect(payload.context.quarters.current_quarter_end).toBe("2026-03-31");
    expect(payload.context.quarters.next_quarter).toBe("2Q");
  });

  it("12月は 4Q、next_quarter は翌年 1Q", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T09:00:00+09:00"));
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [],
      consultationType: "change", consultation: "x", scope: "all_pj",
    });
    expect(payload.context.quarters.current_quarter).toBe("4Q");
    expect(payload.context.quarters.next_quarter).toBe("1Q");
    expect(payload.context.quarters.next_quarter_start).toBe("2027-01-01");
    expect(payload.context.quarters.next_quarter_end).toBe("2027-03-31");
  });

  it("会計年度は 1/1〜12/31", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T09:00:00+09:00"));
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [],
      consultationType: "change", consultation: "x", scope: "all_pj",
    });
    expect(payload.context.fiscal_year.start).toBe("2026-01-01");
    expect(payload.context.fiscal_year.end).toBe("2026-12-31");
    expect(payload.context.fiscal_year.first_half_end).toBe("2026-06-30");
    expect(payload.context.fiscal_year.second_half_start).toBe("2026-07-01");
  });
});

describe("buildPayload — メンバー工数集計", () => {
  it("done のタスクは active 集計に含めない", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [
        makeTask({ id: "t1", status: "todo", assignee_member_id: "m1" }),
        makeTask({ id: "t2", status: "in_progress", assignee_member_id: "m1" }),
        makeTask({ id: "t3", status: "done", assignee_member_id: "m1" }),
      ],
      members: [makeMember({ id: "m1" })],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    const wl = payload.context.member_workload[0];
    expect(wl.todo_count).toBe(1);
    expect(wl.in_progress_count).toBe(1);
  });

  it("estimated_hours=null のタスクは合計に含めない、tasks_without_estimate でカウント", () => {
    const { payload } = buildPayload({
      projects: [makeProject()],
      tasks: [
        makeTask({ id: "t1", status: "todo", estimated_hours: 4, assignee_member_id: "m1" }),
        makeTask({ id: "t2", status: "todo", estimated_hours: null, assignee_member_id: "m1" }),
        makeTask({ id: "t3", status: "todo", estimated_hours: 2, assignee_member_id: "m1" }),
      ],
      members: [makeMember({ id: "m1" })],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    const wl = payload.context.member_workload[0];
    expect(wl.total_estimated_hours).toBe(6);
    expect(wl.tasks_with_estimate).toBe(2);
    expect(wl.tasks_without_estimate).toBe(1);
  });
});

describe("buildPayload — OKRモード（ラボ機能例外）", () => {
  it("includeOKR=true なら okr_context に Objective/KR/TF が含まれる", () => {
    const objective = { id: "o-uuid", title: "2026年度O", period: "2026年度" };
    const krs: KeyResult[] = [
      { id: "kr-uuid-1", objective_id: "o-uuid", title: "KR1", is_deleted: false },
    ];
    const tfs: TaskForce[] = [
      { id: "tf-uuid-1", kr_id: "kr-uuid-1", tf_number: "1", name: "TF1", leader_member_id: "m1", is_deleted: false },
    ];

    const { payload } = buildPayload({
      projects: [],
      tasks: [],
      members: [makeMember({ id: "m1", short_name: "山本" })],
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
      includeOKR: true,
      currentObjective: objective,
      keyResults: krs,
      taskForces: tfs,
    });
    expect(payload.okr_context).toBeDefined();
    expect(payload.okr_context!.title).toBe("2026年度O");
    expect(payload.okr_context!.key_results).toHaveLength(1);
    expect(payload.okr_context!.key_results[0].task_forces[0].leader).toBe("山本");
  });

  it("includeOKR=true でも is_deleted の KR/TF は含めない", () => {
    const krs: KeyResult[] = [
      { id: "kr-1", objective_id: "o-1", title: "KR1", is_deleted: false },
      { id: "kr-2", objective_id: "o-1", title: "KR2削除", is_deleted: true },
    ];
    const tfs: TaskForce[] = [
      { id: "tf-1", kr_id: "kr-1", tf_number: "1", name: "TF1", leader_member_id: "m1", is_deleted: false },
      { id: "tf-2", kr_id: "kr-1", tf_number: "2", name: "TF2削除", leader_member_id: "m1", is_deleted: true },
    ];
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [makeMember({ id: "m1" })],
      consultationType: "change", consultation: "x", scope: "all_pj",
      includeOKR: true,
      currentObjective: { id: "o-1", title: "O", period: "2026年度" },
      keyResults: krs,
      taskForces: tfs,
    });
    expect(payload.okr_context!.key_results).toHaveLength(1);
    expect(payload.okr_context!.key_results[0].task_forces).toHaveLength(1);
    expect(payload.okr_context!.key_results[0].task_forces[0].name).toBe("TF1");
  });
});

describe("buildPayload — ToDo 仮想PJ化は廃止された（UI から todo 編集を撤廃）", () => {
  it("project_id=null + todo_ids 付きタスクはペイロードに含まれない", () => {
    const todos: ToDo[] = [
      { id: "td-1", tf_id: "tf-1", title: "ToDo本文", due_date: null, memo: "", is_deleted: false },
    ];
    const { payload } = buildPayload({
      projects: [],
      tasks: [makeTask({ id: "t-1", name: "実作業", project_id: null, todo_ids: ["td-1"] })],
      members: [makeMember()],
      todos,
      consultationType: "change",
      consultation: "x",
      scope: "all_pj",
    });
    // 主project_id=null のタスクは PJ に紐付かないため AI ペイロードから除外される
    expect(payload.projects).toHaveLength(0);
  });
});

describe("buildPayload — retry_hint", () => {
  it("retryHint が指定されたら payload.retry_hint に入る", () => {
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [],
      consultationType: "change", consultation: "x", scope: "all_pj",
      retryHint: "前回は壊れたJSONだった",
    });
    expect(payload.retry_hint).toBe("前回は壊れたJSONだった");
  });

  it("retryHint なしなら retry_hint フィールド自体が存在しない", () => {
    const { payload } = buildPayload({
      projects: [], tasks: [], members: [],
      consultationType: "change", consultation: "x", scope: "all_pj",
    });
    expect("retry_hint" in payload).toBe(false);
  });
});

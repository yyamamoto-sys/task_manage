// src/lib/ai/payloadBuilder.ts
//
// 【設計意図】
// AI相談用ペイロードを構築するモジュール。
// - UUIDをショートIDに変換してトークンを節約する
// - contribution_memoを除外する（KR情報の漏洩防止）
// - sanitizeComment()を必ず適用する
// - shortIdMapを返し、applyProposalでの逆引きに使う
//
// ❌ このモジュール以外の場所でAI用ペイロードを組み立てないこと（CLAUDE.md Section 2）

import type {
  Project, Task, Member, ToDo,
  KeyResult, TaskForce,
  AIProject, AITask, MemberWorkload, AIOKR,
  ConsultationType,
} from "../localData/types";
import { sanitizeComment } from "./sanitize";

// ===== 型定義 =====

interface FiscalCalendar {
  today: string;
  today_formatted: string;
  this_week_end: string;   // 今週末（日曜）
  next_week_start: string; // 来週月曜
  next_week_end: string;   // 来週末（日曜）
  this_month_end: string;  // 今月末
  /** 今日から今月末までの平日（月〜金）の日数 */
  remaining_weekdays_this_month: number;
  fiscal_year: { start: string; end: string; first_half_end: string; second_half_start: string };
  quarters: {
    definition: string;
    current_quarter: string;
    current_quarter_end: string;
    next_quarter: string;
    next_quarter_start: string;
    next_quarter_end: string;
  };
}

export interface AIConsultationPayload {
  context: FiscalCalendar & {
    target_deadline: string | null;
    member_workload: MemberWorkload[];
  };
  consultation_type: ConsultationType;
  consultation: string;
  scope: "related_pj" | "all_pj" | "member_tasks";
  projects: AIProject[];
  /** OKRモード有効時のみ存在する。現在期のObjective/KR/TF構造 */
  okr_context?: AIOKR;
  retry_hint?: string;
}

export interface BuildPayloadResult {
  payload: AIConsultationPayload;
  /** key: "task_001" / "pj_001" → value: UUID。applyProposalでの逆引きに使う */
  shortIdMap: Map<string, string>;
}

// ===== ショートID生成 =====

function makeShortId(prefix: string, index: number): string {
  return `${prefix}_${String(index + 1).padStart(3, "0")}`;
}

// ===== 会計カレンダー（1月〜12月の暦年）=====
// CLAUDE.md Section 6-14 参照

function buildFiscalCalendar(today: Date): FiscalCalendar {
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-12

  const currentQ = month <= 3 ? "1Q" : month <= 6 ? "2Q" : month <= 9 ? "3Q" : "4Q";
  const qEnds: Record<string, string> = {
    "1Q": `${year}-03-31`, "2Q": `${year}-06-30`,
    "3Q": `${year}-09-30`, "4Q": `${year}-12-31`,
  };
  const qStarts: Record<string, string> = {
    "1Q": `${year}-01-01`, "2Q": `${year}-04-01`,
    "3Q": `${year}-07-01`, "4Q": `${year}-10-01`,
  };
  const nextQMap: Record<string, string> = {
    "1Q": "2Q", "2Q": "3Q", "3Q": "4Q", "4Q": "1Q",
  };
  const nextQ = nextQMap[currentQ];
  const nextQYear = nextQ === "1Q" ? year + 1 : year;
  const nextQStart = nextQ === "1Q" ? `${nextQYear}-01-01` : qStarts[nextQ];
  const nextQEnd = nextQ === "1Q" ? `${nextQYear}-03-31` : qEnds[nextQ];

  const todayStr = fmt(today);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const formatted = `${year}年${month}月${today.getDate()}日（${weekdays[today.getDay()]}）`;

  // 今週末（日曜）と来週の範囲
  const dayOfWeek = today.getDay(); // 0=日, 1=月
  const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const thisWeekEnd = new Date(today); thisWeekEnd.setDate(today.getDate() + daysToSunday);
  const nextWeekStart = new Date(thisWeekEnd); nextWeekStart.setDate(thisWeekEnd.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  // 今月末と残り平日数（今日〜月末、月〜金）
  const thisMonthEnd = new Date(year, today.getMonth() + 1, 0);
  let remainingWeekdays = 0;
  for (let d = new Date(today); d <= thisMonthEnd; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remainingWeekdays++;
  }

  return {
    today: todayStr,
    today_formatted: formatted,
    this_week_end: fmt(thisWeekEnd),
    next_week_start: fmt(nextWeekStart),
    next_week_end: fmt(nextWeekEnd),
    this_month_end: fmt(thisMonthEnd),
    remaining_weekdays_this_month: remainingWeekdays,
    fiscal_year: {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      first_half_end: `${year}-06-30`,
      second_half_start: `${year}-07-01`,
    },
    quarters: {
      definition: "1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月",
      current_quarter: currentQ,
      current_quarter_end: qEnds[currentQ],
      next_quarter: nextQ,
      next_quarter_start: nextQStart,
      next_quarter_end: nextQEnd,
    },
  };
}

// ===== メンバー工数集計 =====

function buildMemberWorkload(members: Member[], tasks: Task[]): MemberWorkload[] {
  return members
    .filter(m => !m.is_deleted)
    .map(m => {
      const myTasks = tasks.filter(t => !t.is_deleted && t.assignee_member_id === m.id);
      const active = myTasks.filter(t => t.status !== "done");
      const withEstimate = active.filter(t => t.estimated_hours != null);
      const withoutEstimate = active.filter(t => t.estimated_hours == null);
      // 工数入力済みタスクのみ合計する（未入力を0とみなさない）
      const totalHours = withEstimate.length > 0
        ? withEstimate.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0)
        : null;
      return {
        member_id: m.id,
        short_name: m.short_name,
        todo_count: active.filter(t => t.status === "todo").length,
        in_progress_count: active.filter(t => t.status === "in_progress").length,
        total_estimated_hours: totalHours,
        tasks_with_estimate: withEstimate.length,
        tasks_without_estimate: withoutEstimate.length,
      };
    });
}

// ===== メインのビルド関数 =====

interface BuildOptions {
  projects: Project[];
  tasks: Task[];
  members: Member[];
  /** ToDoリスト（project_id=nullのタスクをToDo単位でグループ化するために使用） */
  todos?: ToDo[];
  consultationType: ConsultationType;
  consultation: string;
  scope: AIConsultationPayload["scope"];
  targetDeadline?: string | null;
  retryHint?: string;
  /** OKRモード：trueの場合はOKR構造をペイロードに含める */
  includeOKR?: boolean;
  /** 現在期のObjective（AppDataContextのobjective） */
  currentObjective?: { id: string; title: string; period: string } | null;
  keyResults?: KeyResult[];
  taskForces?: TaskForce[];
}

/**
 * AI相談用ペイロードを構築する。
 *
 * @returns payload（APIに送る）と shortIdMap（applyProposalでUUIDを逆引きするために保持）
 */
export function buildPayload(opts: BuildOptions): BuildPayloadResult {
  const today = new Date();
  const shortIdMap = new Map<string, string>();

  const activePJs = opts.projects.filter(p => !p.is_deleted && p.status !== "archived");
  const activeTasks = opts.tasks.filter(t => !t.is_deleted);

  // タスクのショートIDはPJをまたいでグローバルに連番にする
  // （shortIdMap.sizeを使うとPJ分のエントリが混入してキーが衝突するため専用カウンターを使う）
  let taskCounter = 0;

  const aiProjects: AIProject[] = activePJs.map((pj, pjIdx) => {
    const pjShortId = makeShortId("pj", pjIdx);
    shortIdMap.set(pjShortId, pj.id);

    const pjTasks = activeTasks.filter(t => t.project_id === pj.id);
    const aiTasks: AITask[] = pjTasks.map((task) => {
      const taskShortId = makeShortId("task", taskCounter);
      taskCounter++;
      shortIdMap.set(taskShortId, task.id);

      const assignee = opts.members.find(m => m.id === task.assignee_member_id);
      return {
        task_id: taskShortId,
        task_name: task.name,
        assignee: assignee?.short_name ?? "未担当",
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
        estimated_hours: task.estimated_hours,
        // ❌ contribution_memoは含めない。sanitizeComment()を必ず適用する
        // task.comment は Supabase から null が返ることがあるため空文字にフォールバック
        comment: sanitizeComment(task.comment ?? ""),
        // completed_atはYYYY-MM-DD形式の日付部分のみ渡す（時刻は不要）
        completed_at: task.completed_at ? task.completed_at.slice(0, 10) : null,
      };
    });

    const pjOwners = (pj.owner_member_ids ?? [])
      .map(id => opts.members.find(m => m.id === id)?.short_name)
      .filter((n): n is string => !!n);

    return {
      pj_id: pjShortId,
      pj_name: pj.name,
      pj_purpose: pj.purpose,
      pj_status: pj.status,
      pj_end_date: pj.end_date ?? null,
      pj_owners: pjOwners,
      pj_progress: {
        total: pjTasks.length,
        done: pjTasks.filter(t => t.status === "done").length,
        in_progress: pjTasks.filter(t => t.status === "in_progress").length,
        todo: pjTasks.filter(t => t.status === "todo").length,
      },
      tasks: aiTasks,
    };
  });

  // ===== ToDo系タスク（project_id=null）をToDo単位で仮想プロジェクトとして追加 =====
  // OKR境界ルール（CLAUDE.md Section 2）：TF情報は渡さない。ToDoのtitleのみpurposeとして使う。
  const activeTodos = (opts.todos ?? []).filter(td => !td.is_deleted);
  const todoOnlyTasks = activeTasks.filter(t => t.project_id == null && t.todo_id != null);

  // todo_id ごとにタスクをグループ化
  const tasksByTodo = new Map<string, Task[]>();
  for (const task of todoOnlyTasks) {
    const tid = task.todo_id!;
    if (!tasksByTodo.has(tid)) tasksByTodo.set(tid, []);
    tasksByTodo.get(tid)!.push(task);
  }

  for (const [todoId, tasks] of tasksByTodo) {
    const todo = activeTodos.find(td => td.id === todoId);
    if (!todo) continue;

    // ToDo をプロジェクトIDとしてマップに登録
    const virtualPjShortId = makeShortId("pj", aiProjects.length);
    shortIdMap.set(virtualPjShortId, todoId); // applyProposalではpj_idは使わないが整合性のため登録

    const aiTasks: AITask[] = tasks.map((task) => {
      const taskShortId = makeShortId("task", taskCounter);
      taskCounter++;
      shortIdMap.set(taskShortId, task.id);
      const assignee = opts.members.find(m => m.id === task.assignee_member_id);
      return {
        task_id: taskShortId,
        task_name: task.name,
        assignee: assignee?.short_name ?? "未担当",
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
        estimated_hours: task.estimated_hours,
        comment: sanitizeComment(task.comment ?? ""),
        completed_at: task.completed_at ? task.completed_at.slice(0, 10) : null,
      };
    });

    aiProjects.push({
      pj_id: virtualPjShortId,
      pj_name: `[ToDo] ${todo.title}`,
      pj_purpose: todo.title,
      pj_status: "active",
      pj_end_date: todo.due_date ?? null,
      pj_owners: [],
      pj_progress: {
        total: tasks.length,
        done: tasks.filter(t => t.status === "done").length,
        in_progress: tasks.filter(t => t.status === "in_progress").length,
        todo: tasks.filter(t => t.status === "todo").length,
      },
      tasks: aiTasks,
    });
  }

  // ===== OKRコンテキスト（includeOKR=trueかつデータがある場合のみ） =====
  let okrContext: AIOKR | undefined;
  if (opts.includeOKR && opts.currentObjective && opts.keyResults && opts.taskForces) {
    const currentObj = opts.currentObjective;
    const activeKRs = opts.keyResults.filter(kr => !kr.is_deleted && kr.objective_id === currentObj.id);
    okrContext = {
      objective_id: makeShortId("o", 0),
      title: currentObj.title,
      period: currentObj.period,
      key_results: activeKRs.map((kr, krIdx) => {
        const activeTFs = opts.taskForces!.filter(tf => !tf.is_deleted && tf.kr_id === kr.id);
        return {
          kr_id: makeShortId("kr", krIdx),
          title: kr.title,
          task_forces: activeTFs.map((tf, tfIdx) => {
            const leader = opts.members.find(m => m.id === tf.leader_member_id);
            return {
              tf_id: makeShortId("tf", tfIdx),
              tf_number: tf.tf_number,
              name: tf.name,
              leader: leader?.short_name ?? "未設定",
            };
          }),
        };
      }),
    };
  }

  const payload: AIConsultationPayload = {
    context: {
      ...buildFiscalCalendar(today),
      target_deadline: opts.targetDeadline ?? null,
      member_workload: buildMemberWorkload(opts.members, opts.tasks),
    },
    consultation_type: opts.consultationType,
    consultation: opts.consultation,
    scope: opts.scope,
    projects: aiProjects,
    ...(okrContext ? { okr_context: okrContext } : {}),
    ...(opts.retryHint ? { retry_hint: opts.retryHint } : {}),
  };

  return { payload, shortIdMap };
}

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

import type { Project, Task, Member, KeyResult, TaskForce, TaskProject, ProjectTaskForce } from "../localData/types";
import { active } from "../localData/localStore";
import type { AIProject, AITask, MemberWorkload, AIOKR, ConsultationType } from "./types";
import { sanitizeComment } from "./sanitize";
import { dateToQuarter, currentQuarter, getMondayAnchors, toDateStr } from "../date";
import { effectiveTfQuarter } from "../okr/tfQuarter";
import { getAssigneeIds } from "../taskMeta";
import { isParentTask } from "../taskHierarchy";
import { computeMemberWorkloadRows } from "../workload/computeWorkload";

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
  /**
   * 今週の月曜から16週分の月曜日リスト（YYYY-MM-DD）。
   * AIが日付の曜日を正確に算出するための基準テーブル。
   * 例：このリストの日付+5=土曜、+6=日曜、+7=翌週月曜。
   */
  monday_anchors: string[];
}

export interface AIConsultationPayload {
  context: FiscalCalendar & {
    target_deadline: string | null;
    member_workload: MemberWorkload[];
    /** 相談を実行している本人。AIはこれを「私／自分／あなた」の参照先として使う */
    current_user: { member_id: string; short_name: string } | null;
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
  const fmt = (d: Date) => toDateStr(d);
  const year = today.getFullYear();
  const currentQ = dateToQuarter(fmt(today)) ?? "1Q";
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
  const formatted = `${year}年${today.getMonth() + 1}月${today.getDate()}日（${weekdays[today.getDay()]}）`;

  // 今週末（日曜）と来週の範囲
  const dayOfWeek = today.getDay(); // 0=日, 1=月
  const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const thisWeekEnd = new Date(today); thisWeekEnd.setDate(today.getDate() + daysToSunday);
  const nextWeekStart = new Date(thisWeekEnd); nextWeekStart.setDate(thisWeekEnd.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  // 今週月曜から16週分の月曜日リスト（AIの曜日計算基準テーブル・date.tsで生成）
  const monday_anchors = getMondayAnchors(today, 16);

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
    monday_anchors,
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
// 集計ロジック本体は src/lib/workload/computeWorkload.ts に共有化済み（ワークロードビューと共通）。
// AIペイロードの出力（MemberWorkload）は変えないため、リッチな行型から必要な6フィールドだけ抜き出す。

function buildMemberWorkload(members: Member[], tasks: Task[]): MemberWorkload[] {
  return computeMemberWorkloadRows(members, tasks).map(row => ({
    member_id: row.member_id,
    short_name: row.short_name,
    todo_count: row.todo_count,
    in_progress_count: row.in_progress_count,
    total_estimated_hours: row.total_estimated_hours,
    tasks_with_estimate: row.tasks_with_estimate,
    tasks_without_estimate: row.tasks_without_estimate,
  }));
}

// ===== メインのビルド関数 =====

interface BuildOptions {
  projects: Project[];
  tasks: Task[];
  members: Member[];
  /** タスク↔PJ の追加紐付け（主project_id 以外の関与PJ）。AI に「PJ X に関わるタスク」を正しく届けるため */
  taskProjects?: TaskProject[];
  /** PJ↔TF の紐付け。AI に PJ→TF→KR の OKR文脈を伝えるため（双方向に展開） */
  projectTaskForces?: ProjectTaskForce[];
  consultationType: ConsultationType;
  consultation: string;
  scope: AIConsultationPayload["scope"];
  targetDeadline?: string | null;
  /** 相談を実行している本人（「私／自分」の参照先）。member_id は実UUID */
  currentMember?: { id: string; short_name: string } | null;
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
  const activeTasks = active(opts.tasks);
  const taskProjects = opts.taskProjects ?? [];
  const projectTaskForces = opts.projectTaskForces ?? [];

  // PJ id → 紐付くTFの番号ラベル（"TF{krIdx+1}-{tf_number}"）配列
  // TF id → 紐付くPJ名 配列
  // 双方向 join。OKR コンテキストが無くてもラベルから AI が読み取れる形にする
  // 今期のTFのみ対象にする（tf.quarter基準。未設定legacyは今期扱い）。
  // 過去/未来Qのラベルを linked_tf_numbers / okr_context に混ぜない。
  const thisQuarter = currentQuarter();
  const tfNumberById = new Map<string, string>();
  if (opts.keyResults && opts.taskForces) {
    for (const tf of opts.taskForces.filter(t => !t.is_deleted && effectiveTfQuarter(t) === thisQuarter)) {
      const krIdx = opts.keyResults.findIndex(k => k.id === tf.kr_id);
      const label = `TF${krIdx >= 0 ? krIdx + 1 : "?"}-${tf.tf_number || "?"}`;
      tfNumberById.set(tf.id, label);
    }
  }
  const pjNameById = new Map(opts.projects.map(p => [p.id, p.name]));
  const linkedTfLabelsByPj = new Map<string, string[]>();
  const linkedPjNamesByTf  = new Map<string, string[]>();
  for (const ptf of projectTaskForces) {
    const tfLabel = tfNumberById.get(ptf.tf_id);
    if (tfLabel) {
      if (!linkedTfLabelsByPj.has(ptf.project_id)) linkedTfLabelsByPj.set(ptf.project_id, []);
      linkedTfLabelsByPj.get(ptf.project_id)!.push(tfLabel);
    }
    const pjName = pjNameById.get(ptf.project_id);
    if (pjName) {
      if (!linkedPjNamesByTf.has(ptf.tf_id)) linkedPjNamesByTf.set(ptf.tf_id, []);
      linkedPjNamesByTf.get(ptf.tf_id)!.push(pjName);
    }
  }

  // タスクのショートIDはPJをまたいでグローバルに連番にする
  // （shortIdMap.sizeを使うとPJ分のエントリが混入してキーが衝突するため専用カウンターを使う）
  let taskCounter = 0;

  // parent_task_name の解決用：全タスクの UUID → name マップ（プロジェクトまたぎで参照できる）
  const taskNameByUuid = new Map(activeTasks.map(t => [t.id, t.name]));

  // 担当者ID（複数可）→ short_name 結合文字列を作る
  const memberById = new Map(opts.members.map(m => [m.id, m]));
  const buildAssigneeLabel = (task: Task): string => {
    const names = getAssigneeIds(task)
      .map(id => memberById.get(id)?.short_name)
      .filter((n): n is string => !!n);
    return names.length > 0 ? names.join("・") : "未担当";
  };

  // PJ ごとに直接紐付くタスクと task_projects 経由のセカンダリタスクを合算
  const secondaryTaskIdsByPj = new Map<string, Set<string>>();
  for (const tp of taskProjects) {
    if (!secondaryTaskIdsByPj.has(tp.project_id)) secondaryTaskIdsByPj.set(tp.project_id, new Set());
    secondaryTaskIdsByPj.get(tp.project_id)!.add(tp.task_id);
  }

  const aiProjects: AIProject[] = activePJs.map((pj, pjIdx) => {
    const pjShortId = makeShortId("pj", pjIdx);
    shortIdMap.set(pjShortId, pj.id);

    const secondaryIds = secondaryTaskIdsByPj.get(pj.id) ?? new Set<string>();
    const pjTasks = activeTasks.filter(t => t.project_id === pj.id || secondaryIds.has(t.id));
    const aiTasks: AITask[] = pjTasks.map((task) => {
      const taskShortId = makeShortId("task", taskCounter);
      taskCounter++;
      shortIdMap.set(taskShortId, task.id);

      return {
        task_id: taskShortId,
        task_name: task.name,
        assignee: buildAssigneeLabel(task),
        status: task.status,
        priority: task.priority,
        start_date: task.start_date ?? null,
        due_date: task.due_date,
        estimated_hours: task.estimated_hours,
        // ❌ contribution_memoは含めない。sanitizeComment()を必ず適用する
        comment: sanitizeComment(task.comment ?? ""),
        // completed_atはYYYY-MM-DD形式の日付部分のみ渡す（時刻は不要）
        completed_at: task.completed_at ? task.completed_at.slice(0, 10) : null,
        parent_task_name: task.parent_task_id ? (taskNameByUuid.get(task.parent_task_id) ?? null) : null,
        tags: task.tags ?? [],
      };
    });

    const pjOwners = (pj.owner_member_ids ?? [])
      .map(id => memberById.get(id)?.short_name)
      .filter((n): n is string => !!n);

    const pjMembers = (pj.member_ids ?? [])
      .map(id => memberById.get(id)?.short_name)
      .filter((n): n is string => !!n);

    return {
      pj_id: pjShortId,
      pj_name: pj.name,
      pj_purpose: pj.purpose,
      pj_status: pj.status,
      pj_start_date: pj.start_date ?? null,
      pj_end_date: pj.end_date ?? null,
      pj_owners: pjOwners,
      pj_members: pjMembers,
      linked_tf_numbers: linkedTfLabelsByPj.get(pj.id) ?? [],
      // pj_progress は葉タスク基準でカウントする（子を持つ親タスクを除外して二重計上を防ぐ）。
      // 親判定は全非削除タスク（activeTasks）に対して行う。tasks（aiTasks）は葉に絞らない。
      // フラットデータでは葉=全タスクなので従来と完全一致する。
      pj_progress: (() => {
        const leafPjTasks = pjTasks.filter(t => !isParentTask(t, activeTasks));
        return {
          total: leafPjTasks.length,
          done: leafPjTasks.filter(t => t.status === "done").length,
          in_progress: leafPjTasks.filter(t => t.status === "in_progress").length,
          todo: leafPjTasks.filter(t => t.status === "todo").length,
          on_hold: leafPjTasks.filter(t => t.status === "on_hold").length,
          cancelled: leafPjTasks.filter(t => t.status === "cancelled").length,
        };
      })(),
      tasks: aiTasks,
    };
  });

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
        // 今期のTFのみ（tf.quarter基準。未設定legacyは今期扱い）
        const activeTFs = opts.taskForces!.filter(tf => !tf.is_deleted && tf.kr_id === kr.id && effectiveTfQuarter(tf) === thisQuarter);
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
              linked_pj_names: linkedPjNamesByTf.get(tf.id) ?? [],
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
      current_user: opts.currentMember
        ? { member_id: opts.currentMember.id, short_name: opts.currentMember.short_name }
        : null,
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

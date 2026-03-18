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
  Project, Task, Member,
  AIProject, AITask, MemberWorkload,
  ConsultationType,
} from "../localData/types";
import { sanitizeComment } from "./sanitize";

// ===== 型定義 =====

interface FiscalCalendar {
  today: string;
  today_formatted: string;
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

  return {
    today: todayStr,
    today_formatted: formatted,
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
      const totalHours = active.some(t => t.estimated_hours != null)
        ? active.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0)
        : null;
      return {
        member_id: m.id,
        short_name: m.short_name,
        todo_count: active.filter(t => t.status === "todo").length,
        in_progress_count: active.filter(t => t.status === "in_progress").length,
        total_estimated_hours: totalHours,
      };
    });
}

// ===== メインのビルド関数 =====

interface BuildOptions {
  projects: Project[];
  tasks: Task[];
  members: Member[];
  consultationType: ConsultationType;
  consultation: string;
  scope: AIConsultationPayload["scope"];
  targetDeadline?: string | null;
  retryHint?: string;
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

  const aiProjects: AIProject[] = activePJs.map((pj, pjIdx) => {
    const pjShortId = makeShortId("pj", pjIdx);
    shortIdMap.set(pjShortId, pj.id);

    const pjTasks = activeTasks.filter(t => t.project_id === pj.id);
    const aiTasks: AITask[] = pjTasks.map((task, taskIdx) => {
      const taskShortId = makeShortId(`task`, shortIdMap.size);
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
        comment: sanitizeComment(task.comment),
      };
    });

    return {
      pj_id: pjShortId,
      pj_name: pj.name,
      // ❌ contribution_memoは含めない（KR情報の漏洩防止）
      pj_purpose: pj.purpose,
      pj_status: pj.status,
      tasks: aiTasks,
    };
  });

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
    ...(opts.retryHint ? { retry_hint: opts.retryHint } : {}),
  };

  return { payload, shortIdMap };
}

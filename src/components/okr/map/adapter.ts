// 本番のデータ（appStore の O・KR・TF・PJ・タスク・メンバーと、PJ↔TF・タスク↔TF の紐づけ）を、
// 地図の画面が読む形（OkrMapCore）に変える。画面には依存しない純粋関数だけを置く。
// 決め方の記録は docs/dev/sections/s91_okr-map-stage1.md。
import type {
  KeyResult,
  Member as AppMember,
  Objective,
  Project,
  ProjectTaskForce,
  Quarter,
  Task as AppTask,
  TaskForce,
  TaskTaskForce,
} from "../../../lib/localData/types";
import { dateToQuarter } from "../../../lib/date";
import { keyResultsInGroup, pickCurrentObjectiveForGroup, taskForcesInGroup } from "../../../lib/okr/deptScope";
import { effectiveTfQuarter, tfsForKr } from "../../../lib/okr/tfQuarter";
import type { OkrMapCore, QuarterInfo } from "./dataset";
import { PERSONAL_PJ, weekStartOf } from "./logic";
import type { Member, OkrItem, Pj, Task, TaskStatus } from "./types";

export interface OkrMapSource {
  objectives: Objective[];
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  projectTaskForces: ProjectTaskForce[];
  taskTaskForces: TaskTaskForce[];
  /** 表示部署に絞ったPJ（selectScopedProjects） */
  projects: Project[];
  /** 表示部署に絞ったタスク（selectScopedTasks） */
  tasks: AppTask[];
  /** 名前の解決に使うので、部署で絞らない全員（s.members） */
  members: AppMember[];
  groupId: string | null;
  viewerId: string;
  /** 今日（YYYY-MM-DD・端末の日付） */
  today: string;
  /** 今の四半期（tfQuarter.ts の currentQuarter()） */
  quarter: Quarter;
}

const RANGE: Record<Quarter, string> = { "1Q": "1月〜3月", "2Q": "4月〜6月", "3Q": "7月〜9月", "4Q": "10月〜12月" };
const PREV: Record<Quarter, Quarter | null> = { "1Q": null, "2Q": "1Q", "3Q": null, "4Q": "3Q" };

/**
 * 本番のタスクの状態を、地図の3つの状態に寄せる。中止は地図から外す（null）。
 * 保留は「まだ終わっていない仕事」として未着手に入れる（再開しうるので、残りから消さない）
 */
export function mapStatus(s: AppTask["status"]): TaskStatus | null {
  switch (s) {
    case "done":
      return "完了";
    case "in_progress":
      return "進行中";
    case "todo":
    case "on_hold":
      return "未着手";
    case "cancelled":
      return null;
  }
}

/** ISO の日時を、端末の日付（YYYY-MM-DD）にする。YYYY-MM-DD だけのときはそのまま */
export function localDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 今の四半期を含む半期（暦年。上期＝1〜6月・下期＝7〜12月） */
export function halfOf(today: string, quarter: Quarter): { name: string; start: string; end: string } {
  const y = today.slice(0, 4);
  const first = quarter === "1Q" || quarter === "2Q";
  return first ? { name: `${y}年 上期`, start: `${y}-01-01`, end: `${y}-06-30` } : { name: `${y}年 下期`, start: `${y}-07-01`, end: `${y}-12-31` };
}

export function buildOkrMapCore(src: OkrMapSource): OkrMapCore {
  const { today, quarter } = src;
  const half = halfOf(today, quarter);
  const objective = pickCurrentObjectiveForGroup(src.objectives, src.groupId);

  // KR番号は所属Objective内の並び順（payloadBuilder.ts の krIndexInObjective と同じ数え方）
  const krs = objective ? keyResultsInGroup(src.keyResults, src.objectives, src.groupId).filter((k) => !k.is_deleted && k.objective_id === objective.id) : [];
  const krNo = new Map(krs.map((k, i) => [k.id, i + 1]));
  const groupTfs = taskForcesInGroup(src.taskForces, src.keyResults, src.objectives, src.groupId).filter((tf) => !tf.is_deleted && krNo.has(tf.kr_id));
  const tfItem = (tf: TaskForce): OkrItem => ({
    id: tf.id,
    kind: "tf",
    parentId: tf.kr_id,
    label: `TF${krNo.get(tf.kr_id)}-${tf.tf_number || "?"}`,
    text: tf.name,
    quarters: [effectiveTfQuarter(tf)],
    leaderId: tf.leader_member_id ?? undefined,
  });
  const head: OkrItem[] = objective
    ? [
        { id: objective.id, kind: "objective", parentId: null, label: "O", text: objective.title },
        ...krs.map((k, i): OkrItem => ({ id: k.id, kind: "kr", parentId: objective.id, label: `KR${i + 1}`, text: k.title })),
      ]
    : [];
  const tfsIn = (q: Quarter) => krs.flatMap((k) => tfsForKr(groupTfs, k.id, q));
  const curTfs = tfsIn(quarter);
  const items = [...head, ...curTfs.map(tfItem)];
  const prevQ = PREV[quarter];
  const prevQuarter = prevQ ? { info: { quarter: prevQ, range: RANGE[prevQ], ended: true }, items: [...head, ...tfsIn(prevQ).map(tfItem)] } : null;

  const curTfIds = new Set(curTfs.map((t) => t.id));
  const tfById = new Map(groupTfs.map((t) => [t.id, t]));
  const ptfByPj = new Map<string, string[]>();
  for (const l of src.projectTaskForces) if (tfById.has(l.tf_id)) ptfByPj.set(l.project_id, [...(ptfByPj.get(l.project_id) ?? []), l.tf_id]);
  const ttfByTask = new Map<string, string[]>();
  for (const l of src.taskTaskForces) if (tfById.has(l.tf_id)) ttfByTask.set(l.task_id, [...(ttfByTask.get(l.task_id) ?? []), l.tf_id]);

  const projects = src.projects.filter((p) => !p.is_deleted);
  const pjIds = new Set(projects.map((p) => p.id));
  const pjs: Pj[] = projects.map((p) => ({ id: p.id, name: p.name, tfIds: (ptfByPj.get(p.id) ?? []).filter((id) => curTfIds.has(id)) }));

  // 親子のあるタスクは末端だけを数える（Section 88 の集計と同じ。親と子を両方数えると二重になる）
  const live = src.tasks.filter((t) => !t.is_deleted && t.status !== "cancelled");
  const parentIds = new Set(live.map((t) => t.parent_task_id).filter((x): x is string => !!x));
  const krsAt = (tfIds: string[], date: string): string[] => {
    const q = dateToQuarter(date);
    return [...new Set(tfIds.map((id) => tfById.get(id)).filter((tf): tf is TaskForce => !!tf && effectiveTfQuarter(tf) === q).map((tf) => tf.kr_id))];
  };

  const tasks: Task[] = [];
  for (const t of live) {
    if (parentIds.has(t.id)) continue;
    const status = mapStatus(t.status);
    if (!status) continue;
    // 表示部署に無いPJのタスク（招待先の別部署のPJなど）は、この部署の地図に載せない
    if (t.project_id && !pjIds.has(t.project_id)) continue;
    const pjId = t.project_id ?? PERSONAL_PJ;
    const updated =
      (status === "完了" ? localDateOf(t.completed_at) : null) ?? localDateOf(t.updated_at) ?? localDateOf(t.created_at) ?? today;
    const direct = ttfByTask.get(t.id) ?? [];
    const task: Task = { id: t.id, pjId, title: t.name, assigneeId: t.assignee_member_id, due: t.due_date || null, status, updated };
    const assignees = [...new Set([t.assignee_member_id, ...(t.assignee_member_ids ?? [])].filter((x): x is string => !!x))];
    if (assignees.length > 1) task.assigneeIds = assignees;
    const directNow = direct.filter((id) => curTfIds.has(id));
    if (directNow.length > 0) task.tfIds = directNow;
    // 完了した仕事は「完了した時点のつながり」を記録として持つ（後の四半期にTF構成が変わっても図から落ちない）
    if (status === "完了") task.doneKrIds = krsAt([...(pjId === PERSONAL_PJ ? [] : (ptfByPj.get(pjId) ?? [])), ...direct], updated);
    tasks.push(task);
  }

  const members: Member[] = src.members.map((m) => ({ id: m.id, name: m.display_name, role: "メンバー", color: m.color_bg }));
  const info: QuarterInfo = { quarter, range: RANGE[quarter], ended: false };

  return {
    groupId: src.groupId,
    today,
    weekStart: weekStartOf(today),
    periodName: half.name,
    periodStart: half.start,
    periodEnd: half.end,
    currentQuarter: info,
    prevQuarter,
    members,
    items,
    pjs,
    tasks,
    viewerId: src.viewerId,
    objectiveWhy: objective?.background?.trim() || objective?.purpose?.trim() || "",
  };
}

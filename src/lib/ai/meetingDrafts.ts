// src/lib/ai/meetingDrafts.ts
//
// 【設計意図・v3.183】資料インプット（会議読み込み）の「AIの抽出結果→確認画面の下書き」と
// 「下書き→保存」を、画面（MeetingImportPanel）から切り出した純粋ロジック。
// 画面側はレンダリング基盤が無くテストできないため、次の3点をここで固定して単体テストする。
//   1. 担当者：AIが名前を返さない／一致しないとき、先頭のメンバーへ黙って割り当てない
//   2. 既存タスクの更新候補：AIが返したIDが送った一覧に無ければ、チェックを外して人に選ばせる
//   3. 保存：項目ごとに続行し、保存済み・失敗・未処理を分けて返す（画面は保存済みだけを外し、残りを再登録の対象にする。
//      二重登録を防ぐ）。連続3件失敗したら通信断とみなして残りを中止する（v3.184・M87）
//   4. 対象PJを1つに絞ったときの新規タスクのPJ初期値（v3.184・M85）

import type { Member, Project, Task } from "../localData/types";
import type { MeetingStatusUpdate, MeetingTask } from "./meetingExtractor";

export interface TaskDraft {
  tempId: string;
  checked: boolean;
  name: string;
  assignee_member_id: string;
  start_date: string;
  due_date: string;
  project_id: string;
  priority: "high" | "mid" | "low" | null;
  source_quote: string;
}

export interface StatusDraft {
  tempId: string;
  checked: boolean;
  task_id: string;
  task_name_hint: string;
  new_status: "todo" | "in_progress" | "done" | "on_hold" | "cancelled";
  reason: string;
  source_quote: string;
}

/** 担当者の下書き値。名前が無ければ実行者本人、名前があって一致しなければ空（確認画面で「未設定」と見える） */
export function resolveDraftAssignee(
  assigneeShortName: string | null,
  members: Pick<Member, "id" | "short_name" | "display_name">[],
  currentUserId: string,
): string {
  const name = assigneeShortName?.trim() ?? "";
  if (!name) return members.some(m => m.id === currentUserId) ? currentUserId : "";
  const hit = members.find(m => m.short_name === name) ?? members.find(m => m.display_name.includes(name));
  return hit?.id ?? "";
}

/**
 * @param defaultProjectId 対象PJを1つに絞って読み込んだときのそのPJ（v3.184・M85）。PJのヒントが無い新規タスクの初期値になる
 *   （確認画面で変更できる）。候補（projects）に無いIDは使わない
 */
export function buildTaskDrafts(
  newTasks: MeetingTask[],
  members: Pick<Member, "id" | "short_name" | "display_name">[],
  projects: { id: string; name: string }[],
  currentUserId: string,
  defaultProjectId: string | null = null,
): TaskDraft[] {
  const fallbackProjectId = defaultProjectId && projects.some(p => p.id === defaultProjectId) ? defaultProjectId : "";
  return newTasks.map((t, i) => ({
    tempId: `task-${i}`,
    checked: true,
    name: t.name,
    assignee_member_id: resolveDraftAssignee(t.assignee_short_name, members, currentUserId),
    start_date: t.start_date ?? "",
    due_date: t.due_date ?? "",
    project_id: t.project_hint?.trim()
      ? (projects.find(p => p.name.includes(t.project_hint as string))?.id ?? "")
      : fallbackProjectId,
    priority: t.priority,
    source_quote: t.source_quote,
  }));
}

/** 更新候補の下書き。AIが返したIDが、送ったタスク一覧に無ければ空にしてチェックも外す（存在しないIDを黙って保存対象にしない） */
export function buildStatusDrafts(updates: MeetingStatusUpdate[], sentTaskIds: ReadonlySet<string>): StatusDraft[] {
  return updates.map((u, i) => {
    const taskId = u.suggested_task_id && sentTaskIds.has(u.suggested_task_id) ? u.suggested_task_id : "";
    return {
      tempId: `status-${i}`,
      checked: taskId !== "",
      task_id: taskId,
      task_name_hint: u.task_name_hint,
      new_status: u.new_status,
      reason: u.reason,
      source_quote: u.source_quote,
    };
  });
}

// ===== 保存 =====

export interface MeetingApplyDeps {
  saveTask: (task: Task) => Promise<void>;
  saveProject: (project: Project) => Promise<void>;
  /** 既存タスクの現在の状態（削除済み・見つからないものは undefined） */
  findTask: (id: string) => Task | undefined;
  onProgress?: (current: number, total: number, label: string) => void;
  newId?: () => string;
  now?: () => string;
}

export interface MeetingApplyInput {
  taskDrafts: TaskDraft[];
  statusDrafts: StatusDraft[];
  currentUserId: string;
  newProject: { name: string; color: string };
  /** 前回の試行で作成済みの新規PJ。再試行で同じPJを二重に作らない */
  createdProjectId: string | null;
}

/** 連続でこの件数だけ保存に失敗したら、通信断などで続けても通らないとみなして残りを中止する（v3.184・M87） */
export const MAX_CONSECUTIVE_SAVE_FAILURES = 3;

export interface MeetingApplyOutcome {
  created: number;
  updated: number;
  /** 対象のタスクが見つからず更新できなかった件数 */
  skipped: number;
  savedTaskTempIds: string[];
  savedStatusTempIds: string[];
  skippedStatusTempIds: string[];
  /** 保存を試みて失敗した下書き（新規PJが作れず保存できなかったタスクを含む）。画面には残して再試行の対象にする */
  failedTaskTempIds: string[];
  failedStatusTempIds: string[];
  /** 連続失敗で中止したため、手を付けていない件数。画面には残して再試行の対象にする */
  unprocessed: number;
  /** 連続失敗で残りを中止した */
  aborted: boolean;
  createdProjectId: string | null;
  /** 最初の失敗の例外。null＝1件も失敗しなかった */
  error: unknown | null;
}

export async function applyMeetingDrafts(input: MeetingApplyInput, deps: MeetingApplyDeps): Promise<MeetingApplyOutcome> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const progress = deps.onProgress ?? (() => {});

  const tasksToCreate = input.taskDrafts.filter(d => d.checked && d.name.trim());
  const statusToApply = input.statusDrafts.filter(d => d.checked && d.task_id);
  const needNewProject = tasksToCreate.some(d => d.project_id === "__new__") && input.createdProjectId === null;
  const total = Math.max(1, (needNewProject ? 1 : 0) + tasksToCreate.length + statusToApply.length);

  const out: MeetingApplyOutcome = {
    created: 0, updated: 0, skipped: 0,
    savedTaskTempIds: [], savedStatusTempIds: [], skippedStatusTempIds: [],
    failedTaskTempIds: [], failedStatusTempIds: [], unprocessed: 0, aborted: false,
    createdProjectId: input.createdProjectId, error: null,
  };
  let step = 0;
  let consecutiveFailures = 0;
  progress(0, total, total === 1 && tasksToCreate.length + statusToApply.length === 0 ? "完了処理…" : "登録処理を開始しています…");

  // 失敗は項目ごとに記録して続行する。連続で失敗が続いたら通信断とみなして、以降は手を付けない
  const noteFailure = (e: unknown) => {
    out.error ??= e;
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_SAVE_FAILURES) out.aborted = true;
  };

  if (needNewProject) {
    progress(step, total, "新規プロジェクトを作成中…");
    try {
      const ts = now();
      const id = newId();
      await deps.saveProject({
        id,
        name: input.newProject.name.trim() || "新規プロジェクト",
        purpose: "",
        contribution_memo: "",
        owner_member_id: input.currentUserId,
        owner_member_ids: [input.currentUserId],
        status: "active",
        color_tag: input.newProject.color,
        start_date: "",
        end_date: "",
        is_deleted: false,
        created_at: ts,
        updated_at: ts,
        updated_by: input.currentUserId,
      });
      out.createdProjectId = id;
      consecutiveFailures = 0;
    } catch (e) {
      noteFailure(e);
    }
    step += 1;
    progress(step, total, "新規プロジェクトを作成中…");
  }

  for (let i = 0; i < tasksToCreate.length; i++) {
    const d = tasksToCreate[i];
    if (out.aborted) { out.unprocessed += 1; continue; }
    progress(step, total, `タスクを追加中… (${i + 1}/${tasksToCreate.length})`);
    if (d.project_id === "__new__" && out.createdProjectId === null) {
      // 新規PJが作れていないのに保存すると「PJ未設定」で登録されてしまう。保存せず失敗として残す
      out.failedTaskTempIds.push(d.tempId);
    } else {
      try {
        const ts = now();
        const assignee = d.assignee_member_id || input.currentUserId;
        await deps.saveTask({
          id: newId(),
          name: d.name.trim(),
          project_id: d.project_id === "__new__" ? out.createdProjectId : (d.project_id || null),
          todo_ids: [],
          assignee_member_id: assignee,
          assignee_member_ids: [assignee],
          status: "todo",
          priority: d.priority,
          start_date: d.start_date || null,
          due_date: d.due_date || null,
          estimated_hours: null,
          comment: d.source_quote ? `資料メモ：「${d.source_quote}」` : "",
          is_deleted: false,
          created_at: ts,
          updated_at: ts,
          updated_by: input.currentUserId,
        });
        out.created += 1;
        out.savedTaskTempIds.push(d.tempId);
        consecutiveFailures = 0;
      } catch (e) {
        out.failedTaskTempIds.push(d.tempId);
        noteFailure(e);
      }
    }
    step += 1;
    progress(step, total, `タスクを追加中… (${i + 1}/${tasksToCreate.length})`);
  }

  for (let i = 0; i < statusToApply.length; i++) {
    const d = statusToApply[i];
    if (out.aborted) { out.unprocessed += 1; continue; }
    progress(step, total, `ステータスを更新中… (${i + 1}/${statusToApply.length})`);
    const existing = deps.findTask(d.task_id);
    if (!existing) {
      out.skipped += 1;
      out.skippedStatusTempIds.push(d.tempId);
    } else {
      try {
        // updated_at は触らない（CLAUDE.md Section 5）
        await deps.saveTask({ ...existing, status: d.new_status, updated_by: input.currentUserId });
        out.updated += 1;
        out.savedStatusTempIds.push(d.tempId);
        consecutiveFailures = 0;
      } catch (e) {
        out.failedStatusTempIds.push(d.tempId);
        noteFailure(e);
      }
    }
    step += 1;
    progress(step, total, `ステータスを更新中… (${i + 1}/${statusToApply.length})`);
  }
  return out;
}

/** 登録が一部または全部できなかったときの案内文（先頭の原因は呼び出し側が付ける）。失敗が無ければ空 */
export function describeApplyShortfall(o: Pick<MeetingApplyOutcome,
  "created" | "updated" | "failedTaskTempIds" | "failedStatusTempIds" | "unprocessed" | "aborted">): string {
  const failed = o.failedTaskTempIds.length + o.failedStatusTempIds.length;
  if (failed === 0 && o.unprocessed === 0) return "";
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed}件は保存できませんでした`);
  if (o.unprocessed > 0) parts.push(`残り${o.unprocessed}件は未処理です（保存の失敗が続いたため中止しました。通信を確認してください）`);
  const done = o.created + o.updated;
  const note = done > 0
    ? `（登録済みの分：タスク${o.created}件・更新${o.updated}件は画面から外しました。残りだけをもう一度登録できます）`
    : "（画面の内容は残してあります。もう一度登録できます）";
  return `${parts.join("／")}${note}`;
}

// src/lib/ai/applyProposal.ts
//
// 【設計意図】
// UIProposalをDBに反映する関数群。
// CLAUDE.md Section 6-10のDB操作ルールに従う：
// - date_change / assignee → needs_confirmationを返す（DBは触らない）
// - risk / no_tasks / deadline_risk → タスクのcommentに追記
// - scope_reduce / pause → 論理削除（is_deleted=true）
// - milestone → errorを返す
//
// ❌ 物理削除は絶対に行わない（CLAUDE.md Section 4参照）
//
// 【v3.71で choke point 統一】以前はこのファイルが `supabase.from(...)` を直接呼んでおり、
// `appStore.saveTask`/`saveProject` を経由しなかった（実ユーザーでもゲストでも同じ）。その結果
// B1（依存ゲート）・B3（自動リスケ連鎖）・B4（ベースライン捕捉）がAI提案の反映にだけ効かない
// という食い違いがあった（CLAUDE.md Section 3-6参照）。v3.71で `useAppStore.getState()` の
// アクション（saveTask/saveProject/deleteTask/restoreTask/deleteProject/restoreProject）経由に
// 統一し、ゲスト分岐も appStore 側の既存の isGuestMode() 分岐にそのまま乗るようにした
// （旧 guestApplyStore.ts は撤去。読み取りも常に store state を見るため、実ユーザー/ゲストの
// 分岐が完全に無くなった）。
//
// 【部分失敗の方針（v3.71で決定）】複数タスク・複数PJを対象にする提案（date_change/assignee/
// scope_reduce/pause/add_task/add_project）は、1件ずつ choke point を通すため、B1ゲートや
// 楽観ロック競合で一部だけ弾かれる可能性がある。書き込み自体がトランザクションではない
// （元々そうだった。DBに複数UPDATEを順番に投げる設計）ため、「1件失敗したら全体をエラー
// 扱いにする」と、実際には他のN件は既にDBに書き込まれているのに利用者には「失敗した」
// としか伝わらない・Undo手段も残らない、という食い違いが起きる。そのため各項目を
// try/catchで包み、成功した分はUndoSnapshotに積み、失敗した分は理由（formatErrorForUser経由）
// を集めて `warning` として success 結果に添える（全滅時のみ type:"error"）。

import { useAppStore } from "../../stores/appStore";
import type { Task, Project } from "../localData/types";
import type { UIProposal } from "./proposalMapper";
import type { UndoSnapshot, UndoOperation } from "../../hooks/useUndoStack";
import { formatErrorForUser } from "../errorMessage";
import { toDate, addDays, toDateStr } from "../date";

// ===== 型定義 =====

export type ApplyResult =
  | { type: "success"; snapshot: UndoSnapshot; warning?: string }
  | { type: "needs_confirmation"; dialog: ConfirmationDialog }
  | { type: "error"; message: string };

// ===== UndoSnapshot生成ヘルパー =====

/**
 * ランダムなUUIDを生成する（crypto.randomUUID が使えない環境向けのフォールバック付き）
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * add_project で新規PJの color_tag に使う固定パレット（1色を採用）。
 * ConsultationPanel の PROJECT_COLORS と同系統の値。
 */
const DEFAULT_PROJECT_COLOR = "#6366f1";

/**
 * action_typeとタスク数からsnapshotのlabelを生成する
 */
function buildSnapshotLabel(actionType: UIProposal["action_type"], taskCount: number, pjCount: number): string {
  const suffix = taskCount > 0 && pjCount > 0
    ? `(${taskCount}タスク, ${pjCount}PJ)`
    : taskCount > 0
      ? `(${taskCount}タスク)`
      : `(${pjCount}PJ)`;

  switch (actionType) {
    case "date_change":     return `日程変更 ${suffix}`;
    case "assignee":        return `担当者変更 ${suffix}`;
    case "risk":            return `リスク追記 ${suffix}`;
    case "no_tasks":        return `タスクなし追記 ${suffix}`;
    case "deadline_risk":   return `期限リスク追記 ${suffix}`;
    case "scope_reduce":    return `スコープ縮小 ${suffix}`;
    case "pause":           return `一時停止 ${suffix}`;
    case "add_task":        return `タスク追加 ${suffix}`;
    default:                return `変更 ${suffix}`;
  }
}

/** 失敗リストを「N件は反映できませんでした：理由1; 理由2」の警告文にまとめる。0件ならundefined。 */
function buildWarning(failures: string[]): string | undefined {
  if (failures.length === 0) return undefined;
  return `${failures.length}件は反映できませんでした：${failures.join("; ")}`;
}

export interface ConfirmationDialog {
  proposal_id: string;
  action_type: "date_change" | "assignee" | "scope_reduce" | "pause" | "add_task" | "add_project";
  items: ConfirmationItem[];
  /** date_change 用：プロジェクト終了日の変更 */
  pj_end_date_items?: PjEndDateItem[];
  /** date_change 用：一括シフト日数（「全て+N日」ボタン用） */
  shift_days?: number;
  /** scope_reduce / pause 用：削除対象のPJ UUID一覧 */
  target_pj_uuids?: string[];
  /** scope_reduce / pause 用：削除対象のタスク UUID一覧 */
  target_task_uuids?: string[];
  /** add_task 用：新規タスク情報（new_subtask_items がある場合は new_task_items[0] が親タスク） */
  new_task_items?: NewTaskItem[];
  /** add_task 用：親タスク（new_task_items[0]）にぶら下げる子タスク（2階層固定） */
  new_subtask_items?: NewTaskItem[];
  /** add_project 用：作成する新規PJ情報 */
  new_project?: { name: string; purpose: string };
  /** add_project 用：新規PJに紐づく初期タスク（NewTaskItem を流用。project_id は新規PJなので未確定＝空） */
  new_project_task_items?: NewTaskItem[];
}

export interface NewTaskItem {
  temp_id: string;
  task_name: string;
  project_id?: string;
  project_name?: string;
  suggested_assignee_id?: string;
  suggested_assignee_name?: string;
  suggested_start_date?: string;
  suggested_due_date?: string;
  suggested_description?: string;
}

export interface ConfirmationItem {
  task_id: string;     // UUID
  task_name: string;
  current_value: string;
  suggested_value: string;
}

export interface PjEndDateItem {
  pj_id: string;       // UUID
  pj_name: string;
  current_end_date: string | null;
  suggested_end_date: string;
}

// ===== 内部ヘルパー（読み取りは常に appStore の state を見る。実ユーザー/ゲストで分岐しない）=====

function getTaskPreview(uuid: string): { name: string; due_date: string | null; assignee_member_id: string } | null {
  const t = useAppStore.getState().tasks.find(x => x.id === uuid);
  if (!t) return null;
  return { name: t.name, due_date: t.due_date ?? null, assignee_member_id: t.assignee_member_id ?? "" };
}

function getProjectPreview(uuid: string): { name: string; end_date: string | null } | null {
  const p = useAppStore.getState().projects.find(x => x.id === uuid);
  if (!p) return null;
  return { name: p.name, end_date: p.end_date ?? null };
}

/** 有効メンバー一覧（short_name→id解決用。add_task/add_projectの担当者名マッチに使う）。 */
function getActiveMembersForNameResolution(): { id: string; short_name: string }[] {
  return useAppStore.getState().members
    .filter(m => !m.is_deleted)
    .map(m => ({ id: m.id, short_name: m.short_name }));
}

function getMemberShortName(memberId: string): string | null {
  const m = useAppStore.getState().members.find(x => x.id === memberId);
  return m ? m.short_name : null;
}

/**
 * タスクのcommentに追記し、appStore.saveTask（choke point）で保存する。
 * 戻り値：更新前のcomment文字列（Undo用）
 */
async function appendTaskComment(
  taskId: string,
  appendText: string,
  currentUserId: string,
): Promise<string> {
  const timestamp = new Date().toLocaleDateString("ja-JP");
  const task = useAppStore.getState().tasks.find(t => t.id === taskId);
  if (!task) throw new Error("タスクが見つかりません");

  const currentComment = task.comment ?? "";
  const newComment = currentComment
    ? `${currentComment}\n\n[AIアドバイス ${timestamp}]\n${appendText}`
    : `[AIアドバイス ${timestamp}]\n${appendText}`;

  await useAppStore.getState().saveTask({ ...task, comment: newComment, updated_by: currentUserId });
  return currentComment;
}

/**
 * shortIdMap を使って shortId から UUID に変換する。
 */
function resolveUUID(shortId: string, shortIdMap: Map<string, string>): string | null {
  return shortIdMap.get(shortId) ?? null;
}

// ===== add_task / add_project の新規作成ヘルパー =====

interface NewTaskRowFields {
  id: string;
  name: string;
  project_id: string | null;
  parent_task_id?: string | null;
  display_order?: number;
  assignee_member_id: string | null;
  assignee_member_ids: string[];
  start_date: string | null;
  due_date: string | null;
  comment: string | null;
}

async function createTaskRow(
  fields: NewTaskRowFields,
  currentGroupId: string | null | undefined,
  currentUserId: string,
  now: string,
  errorLabel: string,
): Promise<void> {
  const task: Task = {
    id: fields.id,
    name: fields.name,
    project_id: fields.project_id,
    parent_task_id: fields.parent_task_id ?? null,
    display_order: fields.display_order,
    todo_ids: [],
    assignee_member_id: fields.assignee_member_id ?? "",
    assignee_member_ids: fields.assignee_member_ids,
    status: "todo",
    priority: null,
    start_date: fields.start_date,
    due_date: fields.due_date,
    estimated_hours: null,
    comment: fields.comment ?? "",
    is_deleted: false,
    group_id: currentGroupId ?? undefined,
    created_at: now,
    updated_at: now,
    updated_by: currentUserId,
  };
  try {
    await useAppStore.getState().saveTask(task);
  } catch (e) {
    throw new Error(`${errorLabel}: ${formatErrorForUser("", e)}`);
  }
}

async function createProjectRow(
  fields: { id: string; name: string; purpose: string; owner_member_id: string },
  currentGroupId: string | null | undefined,
  currentUserId: string,
  now: string,
): Promise<void> {
  const project: Project = {
    id: fields.id,
    name: fields.name,
    purpose: fields.purpose,
    contribution_memo: "",
    owner_member_id: fields.owner_member_id,
    owner_member_ids: [fields.owner_member_id],
    status: "active",
    color_tag: DEFAULT_PROJECT_COLOR,
    start_date: "",
    end_date: "",
    is_deleted: false,
    group_id: currentGroupId ?? undefined,
    created_at: now,
    updated_at: now,
    updated_by: currentUserId,
  };
  try {
    await useAppStore.getState().saveProject(project);
  } catch (e) {
    throw new Error(`プロジェクト作成エラー: ${formatErrorForUser("", e)}`);
  }
}

// ===== メイン関数 =====

/**
 * UIProposalをDBに反映する。
 * needs_confirmationの場合はConfirmationDialogを返す（DBは触らない）。
 *
 * @param proposal - 反映する提案
 * @param shortIdMap - shortId→UUIDの変換マップ（payloadBuilderが生成）
 * @param currentUserId - 操作者のメンバーID
 * @param currentGroupId - ログイン中ユーザーのグループID（新規タスク/PJに付与）
 */
export async function applyProposal(
  proposal: UIProposal,
  shortIdMap: Map<string, string>,
  currentUserId: string,
  // このパスは add_task/add_project を扱わない（needs_confirmation経由でapplyProposalWithConfirmationへ）
  // ため未使用。呼び出し元との引数構成を揃えるために残す。
  _currentGroupId?: string | null,
): Promise<ApplyResult> {
  const { action_type } = proposal;

  // ===== info: 情報表示のみ（DBへの反映なし）=====
  if (action_type === "info") {
    return { type: "error", message: "情報カードには反映操作はありません" };
  }

  // ===== milestone: 未対応 =====
  if (action_type === "milestone") {
    return { type: "error", message: "マイルストーンは未対応です" };
  }

  // ===== date_change: 確認ダイアログを返す =====
  if (action_type === "date_change") {
    const items: ConfirmationItem[] = [];
    const pjEndDateItems: PjEndDateItem[] = [];

    // タスクの期日変更
    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const task = getTaskPreview(uuid);

      if (!task) continue;

      // shift_days が指定されている場合は現在の期日に日数を加算、なければ suggested_date を使う
      // toDate()+addDays()+toDateStr() を使うことでJSTタイムゾーンのずれを防ぐ
      let suggestedValue = proposal.suggested_date ?? "未定";
      if (proposal.shift_days && task.due_date) {
        const d = toDate(task.due_date);
        if (d) suggestedValue = toDateStr(addDays(d, proposal.shift_days));
      }

      items.push({
        task_id: uuid,
        task_name: task.name ?? shortId,
        current_value: task.due_date ?? "未設定",
        suggested_value: suggestedValue,
      });
    }

    // プロジェクトの終了日変更
    for (const shortId of proposal.target_pj_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const pj = getProjectPreview(uuid);

      if (!pj) continue;

      let suggestedEndDate = proposal.suggested_end_date ?? "";
      if (proposal.shift_days && pj.end_date) {
        const d = toDate(pj.end_date);
        if (d) suggestedEndDate = toDateStr(addDays(d, proposal.shift_days));
      }

      pjEndDateItems.push({
        pj_id: uuid,
        pj_name: pj.name ?? shortId,
        current_end_date: pj.end_date,
        suggested_end_date: suggestedEndDate,
      });
    }

    if (items.length === 0 && pjEndDateItems.length === 0) {
      return { type: "error", message: "対象タスク・プロジェクトが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "date_change",
        items,
        pj_end_date_items: pjEndDateItems.length > 0 ? pjEndDateItems : undefined,
        shift_days: proposal.shift_days,
      },
    };
  }

  // ===== assignee: 確認ダイアログを返す =====
  if (action_type === "assignee") {
    if (!proposal.suggested_assignee) {
      return { type: "error", message: "担当者が指定されていません" };
    }

    const items: ConfirmationItem[] = [];

    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const task = getTaskPreview(uuid);

      if (!task) continue;

      // 現在の担当者名を取得
      let currentAssigneeName = "未担当";
      if (task.assignee_member_id) {
        const shortName = getMemberShortName(task.assignee_member_id);
        if (shortName) currentAssigneeName = shortName;
      }

      items.push({
        task_id: uuid,
        task_name: task.name ?? shortId,
        current_value: currentAssigneeName,
        suggested_value: proposal.suggested_assignee,
      });
    }

    if (items.length === 0) {
      return { type: "error", message: "対象タスクが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "assignee",
        items,
      },
    };
  }

  // ===== risk / no_tasks / deadline_risk: コメントに追記 =====
  if (
    action_type === "risk" ||
    action_type === "no_tasks" ||
    action_type === "deadline_risk"
  ) {
    const operations: UndoOperation[] = [];
    const failures: string[] = [];
    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;
      const taskName = getTaskPreview(uuid)?.name ?? shortId;
      try {
        const oldComment = await appendTaskComment(uuid, proposal.description, currentUserId);
        operations.push({ type: "task_field", taskId: uuid, field: "comment", oldValue: oldComment || null });
      } catch (e) {
        failures.push(formatErrorForUser(taskName, e));
      }
    }
    if (operations.length === 0 && failures.length > 0) {
      return { type: "error", message: formatWithLabel("コメント追記に失敗しました", failures) };
    }
    const snapshot: UndoSnapshot = {
      id: generateId(),
      label: buildSnapshotLabel(action_type, operations.length, 0),
      appliedAt: new Date().toISOString(),
      operations,
    };
    return { type: "success", snapshot, warning: buildWarning(failures) };
  }

  // ===== scope_reduce / pause: 確認ダイアログを返す（CLAUDE.md Section 6-9参照）=====
  // 論理削除は不可逆な大規模操作のため、必ず確認ダイアログを経由する。
  // 実際の論理削除は applyProposalWithConfirmation で実行する。
  if (action_type === "scope_reduce" || action_type === "pause") {
    const taskUuids: string[] = [];
    const pjUuids: string[] = [];
    const items: ConfirmationItem[] = [];

    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const task = getTaskPreview(uuid);

      if (!task) continue;
      taskUuids.push(uuid);
      items.push({
        task_id: uuid,
        task_name: task.name ?? shortId,
        current_value: "有効",
        suggested_value: action_type === "pause" ? "一時停止" : "スコープ縮小（論理削除）",
      });
    }

    for (const shortId of proposal.target_pj_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const pj = getProjectPreview(uuid);

      if (!pj) continue;
      pjUuids.push(uuid);
      items.push({
        task_id: uuid, // PJ UUIDをここに入れる（ConfirmationItemはtask_idフィールドを流用）
        task_name: `[PJ] ${pj.name ?? shortId}`,
        current_value: "有効",
        suggested_value: action_type === "pause" ? "一時停止（配下タスクも含む）" : "スコープ縮小（配下タスクも含む）",
      });
    }

    if (items.length === 0) {
      return { type: "error", message: "対象タスク・プロジェクトが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type,
        items,
        target_pj_uuids: pjUuids,
        target_task_uuids: taskUuids,
      },
    };
  }

  // ===== add_task: 確認ダイアログを返す =====
  if (action_type === "add_task") {
    let projectId: string | undefined;
    let projectName: string | undefined;
    if (proposal.target_pj_ids.length > 0) {
      const pjUuid = resolveUUID(proposal.target_pj_ids[0], shortIdMap);
      if (pjUuid) {
        const pj = getProjectPreview(pjUuid);
        if (pj) { projectId = pjUuid; projectName = pj.name; }
      }
    }

    // 担当者解決用に有効メンバーを一括取得（親タスク＋子タスクの short_name→id 変換に使う）
    const memberRows = getActiveMembersForNameResolution();
    const memberByShortName = new Map<string, { id: string; short_name: string }>();
    for (const m of memberRows) {
      memberByShortName.set(m.short_name, { id: m.id, short_name: m.short_name });
    }

    const parentMatch = proposal.suggested_assignee
      ? memberByShortName.get(proposal.suggested_assignee)
      : undefined;

    const tempId = generateId();

    // new_subtasks がある場合は「親タスク＋子タスク」の階層作成。子タスクの担当も解決する。
    const subtaskItems: NewTaskItem[] = (proposal.new_subtasks ?? [])
      .filter((t) => t.name && t.name.trim())
      .map((t) => {
        const matched = t.suggested_assignee ? memberByShortName.get(t.suggested_assignee) : undefined;
        return {
          temp_id: generateId(),
          task_name: t.name,
          project_id: projectId,
          project_name: projectName,
          suggested_assignee_id: matched?.id,
          suggested_assignee_name: matched?.short_name ?? t.suggested_assignee,
          suggested_start_date: t.suggested_start_date,
          suggested_due_date: t.suggested_due_date,
          suggested_description: t.suggested_description,
        };
      });

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "add_task",
        items: [],
        new_task_items: [{
          temp_id: tempId,
          task_name: proposal.title,
          project_id: projectId,
          project_name: projectName,
          suggested_assignee_id: parentMatch?.id,
          suggested_assignee_name: parentMatch?.short_name ?? proposal.suggested_assignee,
          suggested_start_date: proposal.suggested_start_date,
          suggested_due_date: proposal.suggested_date,
        }],
        new_subtask_items: subtaskItems.length > 0 ? subtaskItems : undefined,
      },
    };
  }

  // ===== add_project: 新規PJ作成の確認ダイアログを返す =====
  if (action_type === "add_project") {
    // members を short_name → id で解決するため一括取得（new_project_tasks の担当者解決用）
    const memberRows = getActiveMembersForNameResolution();
    const memberByShortName = new Map<string, { id: string; short_name: string }>();
    for (const m of memberRows) {
      memberByShortName.set(m.short_name, { id: m.id, short_name: m.short_name });
    }

    const taskItems: NewTaskItem[] = (proposal.new_project_tasks ?? [])
      .filter((t) => t.name && t.name.trim())
      .map((t) => {
        const matched = t.suggested_assignee
          ? memberByShortName.get(t.suggested_assignee)
          : undefined;
        return {
          temp_id: generateId(),
          task_name: t.name,
          // project_id は新規PJなので未確定（applyProposalWithConfirmation で採番後に紐づける）
          project_id: undefined,
          suggested_assignee_id: matched?.id,
          suggested_assignee_name: matched?.short_name ?? t.suggested_assignee,
          suggested_start_date: t.suggested_start_date,
          suggested_due_date: t.suggested_due_date,
          suggested_description: t.suggested_description,
        };
      });

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "add_project",
        items: [],
        new_project: { name: proposal.title, purpose: proposal.description },
        new_project_task_items: taskItems,
      },
    };
  }

  return { type: "error", message: "未対応のアクションタイプです" };
}

/** 全滅時のエラーメッセージ組み立て（prefix + 個々の失敗理由） */
function formatWithLabel(prefix: string, failures: string[]): string {
  return `${prefix}：${failures.join("; ")}`;
}

/**
 * 確認ダイアログでユーザーが内容を確認・調整した後にDBへ反映する。
 * CLAUDE.md Section 6-11に従い、shortIdMapは引数に含めない（confirmedValuesのキーはUUID）。
 *
 * @param dialog - applyProposalが返したConfirmationDialog
 * @param confirmedValues - key: UUID, value: 新しい値（日付またはメンバーID）
 * @param currentUserId - 操作者のメンバーID
 * @param currentGroupId - ログイン中ユーザーのグループID（新規タスク/PJに付与）
 */
export async function applyProposalWithConfirmation(
  dialog: ConfirmationDialog,
  confirmedValues: Record<string, string>,
  currentUserId: string,
  currentGroupId?: string | null,
): Promise<ApplyResult> {
  try {
    const now = new Date().toISOString();

    if (dialog.action_type === "date_change") {
      const operations: UndoOperation[] = [];
      const failures: string[] = [];

      // タスクの期日更新
      for (const item of dialog.items) {
        const newDate = confirmedValues[item.task_id];
        if (!newDate) continue;

        const task = useAppStore.getState().tasks.find(t => t.id === item.task_id);
        if (!task) continue;
        const oldDueDate = task.due_date ?? null;

        try {
          // saveTask（choke point）を通すため、due_date変更を受けてB3（自動リスケ連鎖）が
          // 自動的に発火する（後続タスクを押した場合は既存の「N件のタスクの日付を自動調整
          // しました」トースト＋Undoがそのまま出る。CLAUDE.md Section 3-6参照）。
          await useAppStore.getState().saveTask({ ...task, due_date: newDate, updated_by: currentUserId });
        } catch (e) {
          // B1ゲート（先行タスク未完了で完了にできない等）や楽観ロック競合はここで弾かれる。
          // 書き込みはトランザクションではないため、他の項目には影響させず続行する
          // （ファイル冒頭コメントの「部分失敗の方針」参照）。
          failures.push(formatErrorForUser(item.task_name, e));
          continue;
        }
        operations.push({ type: "task_field", taskId: item.task_id, field: "due_date", oldValue: oldDueDate });
      }

      // プロジェクト終了日の更新
      for (const pjItem of dialog.pj_end_date_items ?? []) {
        const newEndDate = confirmedValues[pjItem.pj_id];
        if (!newEndDate) continue;

        const pj = useAppStore.getState().projects.find(p => p.id === pjItem.pj_id);
        if (!pj) continue;
        const oldEndDate = pj.end_date ?? null;

        try {
          await useAppStore.getState().saveProject({ ...pj, end_date: newEndDate, updated_by: currentUserId });
        } catch (e) {
          failures.push(formatErrorForUser(pjItem.pj_name, e));
          continue;
        }
        operations.push({ type: "pj_field", pjId: pjItem.pj_id, field: "end_date", oldValue: oldEndDate });
      }

      if (operations.length === 0 && failures.length > 0) {
        return { type: "error", message: formatWithLabel("日程変更に失敗しました", failures) };
      }

      const taskCount = operations.filter(o => o.type === "task_field").length;
      const pjCount = operations.filter(o => o.type === "pj_field").length;
      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel("date_change", taskCount, pjCount),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot, warning: buildWarning(failures) };
    }

    if (dialog.action_type === "assignee") {
      const operations: UndoOperation[] = [];
      const failures: string[] = [];
      for (const item of dialog.items) {
        const newAssigneeId = confirmedValues[item.task_id];
        if (!newAssigneeId) continue;

        const task = useAppStore.getState().tasks.find(t => t.id === item.task_id);
        if (!task) continue;
        const oldAssigneeId = task.assignee_member_id ?? null;
        const oldAssigneeIds = task.assignee_member_ids ?? [];

        try {
          await useAppStore.getState().saveTask({
            ...task,
            assignee_member_id: newAssigneeId,
            assignee_member_ids: [newAssigneeId],
            updated_by: currentUserId,
          });
        } catch (e) {
          failures.push(formatErrorForUser(item.task_name, e));
          continue;
        }
        operations.push({ type: "task_field", taskId: item.task_id, field: "assignee_member_id", oldValue: oldAssigneeId });
        operations.push({ type: "task_field", taskId: item.task_id, field: "assignee_member_ids", oldValue: oldAssigneeIds });
      }
      if (operations.length === 0 && failures.length > 0) {
        return { type: "error", message: formatWithLabel("担当者変更に失敗しました", failures) };
      }
      const snapshot: UndoSnapshot = {
        id: generateId(),
        // 【既存挙動を維持】assigneeは1タスクにつき2件のoperationを積む（assignee_member_id/
        // assignee_member_ids）ため、operations.lengthはタスク数の2倍になる（移行前から同じ）。
        label: buildSnapshotLabel("assignee", operations.length, 0),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot, warning: buildWarning(failures) };
    }

    // ===== scope_reduce / pause: 論理削除 =====
    if (
      dialog.action_type === "scope_reduce" ||
      dialog.action_type === "pause"
    ) {
      const operations: UndoOperation[] = [];
      const failures: string[] = [];

      // 個別タスクの論理削除
      for (const taskUuid of dialog.target_task_uuids ?? []) {
        const taskName = useAppStore.getState().tasks.find(t => t.id === taskUuid)?.name ?? taskUuid;
        try {
          await useAppStore.getState().deleteTask(taskUuid, currentUserId);
        } catch (e) {
          failures.push(formatErrorForUser(taskName, e));
          continue;
        }
        operations.push({ type: "task_restore", taskId: taskUuid });
      }

      // PJおよび配下タスクの論理削除（配下タスク→PJ本体の順。既存の直接UPDATE版と同じ順序）
      for (const pjUuid of dialog.target_pj_uuids ?? []) {
        const pjName = useAppStore.getState().projects.find(p => p.id === pjUuid)?.name ?? pjUuid;
        const childTasks = useAppStore.getState().tasks.filter(t => t.project_id === pjUuid && !t.is_deleted);
        let childFailed = false;
        for (const t of childTasks) {
          try {
            await useAppStore.getState().deleteTask(t.id, currentUserId);
          } catch (e) {
            failures.push(formatErrorForUser(`${pjName} / ${t.name}`, e));
            childFailed = true;
          }
        }
        try {
          await useAppStore.getState().deleteProject(pjUuid, currentUserId);
        } catch (e) {
          failures.push(formatErrorForUser(pjName, e));
          continue;
        }
        // 配下タスクの一部が弾かれていても、PJ本体の削除自体は成功しているため
        // pj_restore を積む（Undoで復元すればタスクも一緒に戻る。restoreTaskは
        // is_deleted=trueの行だけを対象にするため、弾かれて元々is_deleted=falseの
        // タスクには影響しない）。
        void childFailed;
        operations.push({ type: "pj_restore", pjId: pjUuid });
      }

      if (operations.length === 0 && failures.length > 0) {
        return { type: "error", message: formatWithLabel("削除に失敗しました", failures) };
      }

      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel(
          dialog.action_type,
          (dialog.target_task_uuids ?? []).length,
          (dialog.target_pj_uuids ?? []).length,
        ),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot, warning: buildWarning(failures) };
    }

    // ===== add_task: タスク新規作成（new_subtask_items があれば 親＋子の階層作成）=====
    if (dialog.action_type === "add_task") {
      const operations: UndoOperation[] = [];
      const failures: string[] = [];
      const subtaskItems = dialog.new_subtask_items ?? [];
      const hasHierarchy = subtaskItems.length > 0;

      let addedCount = 0;
      let parentId: string | null = null;
      let parentProjectId: string | null = null;

      // 親（または単体）タスクを作成。new_task_items[0] を親として扱う。
      // 親の作成に失敗したら子はぶら下げる先が無いため全体を中断する。
      for (const item of dialog.new_task_items ?? []) {
        const name = (confirmedValues[`${item.temp_id}_name`] ?? item.task_name).trim();
        if (!name) continue;
        const assigneeIdsStr = confirmedValues[`${item.temp_id}_assignee_ids`] ?? "";
        const assigneeIdList = assigneeIdsStr ? assigneeIdsStr.split(",").filter(Boolean) : [];
        const assigneeId = assigneeIdList[0] ?? null;
        const startDate = confirmedValues[`${item.temp_id}_start_date`] || null;
        const dueDate = confirmedValues[`${item.temp_id}_due_date`] || null;

        const newId = generateId();
        try {
          await createTaskRow(
            {
              id: newId,
              name,
              project_id: item.project_id ?? null,
              assignee_member_id: assigneeId,
              assignee_member_ids: assigneeIdList,
              start_date: startDate,
              due_date: dueDate,
              comment: confirmedValues[`${item.temp_id}_description`] || null,
            },
            currentGroupId, currentUserId, now, "タスク作成エラー",
          );
        } catch (e) {
          return { type: "error", message: formatErrorForUser("", e) };
        }
        operations.push({ type: "task_delete", taskId: newId });
        addedCount++;
        if (parentId === null) { parentId = newId; parentProjectId = item.project_id ?? null; }
      }

      // 子タスクを作成（親に parent_task_id でぶら下げ・project_id は親に揃える）。
      // 個々の子の作成失敗は他の子の作成を止めない（部分失敗の方針）。
      if (hasHierarchy && parentId) {
        let order = 0;
        for (const sub of subtaskItems) {
          const name = (confirmedValues[`${sub.temp_id}_name`] ?? sub.task_name).trim();
          if (!name) continue;
          const subIdsStr = confirmedValues[`${sub.temp_id}_assignee_ids`] ?? "";
          const subIdList = subIdsStr ? subIdsStr.split(",").filter(Boolean) : [];
          const assigneeId = subIdList[0] ?? null;
          const startDate = confirmedValues[`${sub.temp_id}_start_date`] || null;
          const dueDate = confirmedValues[`${sub.temp_id}_due_date`] || null;

          const childId = generateId();
          try {
            await createTaskRow(
              {
                id: childId,
                name,
                project_id: parentProjectId,
                parent_task_id: parentId,
                display_order: order,
                assignee_member_id: assigneeId,
                assignee_member_ids: subIdList,
                start_date: startDate,
                due_date: dueDate,
                comment: confirmedValues[`${sub.temp_id}_description`] || null,
              },
              currentGroupId, currentUserId, now, `子タスク作成エラー (${name})`,
            );
          } catch (e) {
            failures.push(formatErrorForUser(name, e));
            order++;
            continue;
          }
          operations.push({ type: "task_delete", taskId: childId });
          addedCount++;
          order++;
        }
      }

      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: hasHierarchy ? `タスク階層化 (${addedCount}件)` : `タスク追加 (${addedCount}件)`,
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot, warning: buildWarning(failures) };
    }

    // ===== add_project: 新規PJ作成（PJ insert → 初期タスク insert） =====
    // ConsultationPanel.handleCreateSave の projects insert 項目に合わせて必要列を網羅する。
    if (dialog.action_type === "add_project") {
      const operations: UndoOperation[] = [];
      const failures: string[] = [];

      const projectId = generateId();
      const projectName = (confirmedValues["project_name"] ?? dialog.new_project?.name ?? "").trim();
      if (!projectName) {
        return { type: "error", message: "プロジェクト名が入力されていません" };
      }
      const projectPurpose = (confirmedValues["project_purpose"] ?? dialog.new_project?.purpose ?? "").trim();

      // PJ本体の作成に失敗したら初期タスクの紐づけ先が無いため全体を中断する。
      try {
        await createProjectRow(
          { id: projectId, name: projectName, purpose: projectPurpose, owner_member_id: currentUserId },
          currentGroupId, currentUserId, now,
        );
      } catch (e) {
        return { type: "error", message: formatErrorForUser("", e) };
      }
      operations.push({ type: "pj_delete", pjId: projectId });

      // 初期タスクを作成（add_task と同じ命名規則で confirmedValues から取得）。
      // 個々のタスクの作成失敗は他の初期タスクの作成を止めない（部分失敗の方針）。
      let taskCount = 0;
      for (const item of dialog.new_project_task_items ?? []) {
        const name = (confirmedValues[`${item.temp_id}_name`] ?? item.task_name).trim();
        if (!name) continue;
        const pjTaskIdsStr = confirmedValues[`${item.temp_id}_assignee_ids`] ?? "";
        const pjTaskIdList = pjTaskIdsStr ? pjTaskIdsStr.split(",").filter(Boolean) : [];
        const assigneeId = pjTaskIdList[0] ?? null;
        const startDate = confirmedValues[`${item.temp_id}_start_date`] || null;
        const dueDate = confirmedValues[`${item.temp_id}_due_date`] || null;

        const newTaskId = generateId();
        try {
          await createTaskRow(
            {
              id: newTaskId,
              name,
              project_id: projectId,
              assignee_member_id: assigneeId,
              assignee_member_ids: pjTaskIdList,
              start_date: startDate,
              due_date: dueDate,
              comment: confirmedValues[`${item.temp_id}_description`] || null,
            },
            currentGroupId, currentUserId, now, `初期タスク作成エラー (${name})`,
          );
        } catch (e) {
          failures.push(formatErrorForUser(name, e));
          continue;
        }
        taskCount++;
      }

      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: `PJ作成 (${taskCount}タスク)`,
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot, warning: buildWarning(failures) };
    }

    return { type: "error", message: "未対応のアクションタイプです" };
  } catch (e) {
    return {
      type: "error",
      message: formatErrorForUser("反映処理に失敗しました", e),
    };
  }
}

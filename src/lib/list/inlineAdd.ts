// src/lib/list/inlineAdd.ts
//
// 【設計意図】
// リストビューの各グループ末尾の「＋ タスクを追加」行（その場追加）の純粋ロジック。
// グループの属性（PJ・担当者・状態・タグ・ToDo）を初期値にし、作った直後にそのグループへ
// 表示される値にする。保存は prepareNewTask（QuickAddTaskModal と共通）＋ saveTask。

import type { ProjectSection, Task } from "../localData/types";
import { UNSECTIONED_KEY } from "../section/sections";
import { prepareNewTask, validateTaskDateRange } from "../task/newTask";

/** 下書きのキー `<まとめ方>:<見出し>§<グループID>` の区切り（ListView の bk と同じ） */
export const SECTION_KEY_SEPARATOR = "§";

/** グループに入る条件。ListView の groups の各要素が持つ。 */
export interface GroupAddSpec {
  /** PJ別のPJ。PJ未設定・ToDo・担当者別等では null */
  projectId: string | null;
  /** PJ別のうち「[ToDo] …」グループのToDo */
  todoId: string | null;
  /** 担当者別のそのグループの担当者 */
  assigneeId: string | null;
  /** 状態別のそのグループの状態 */
  status: Task["status"] | null;
  /** タグ別のそのタグ（「タグなし」は null） */
  tag: string | null;
  /** PJ内のグループ（PJ別の中のグループ見出し。未分類は null。v3.149） */
  sectionId: string | null;
}

export interface GroupDefaults {
  projectId: string | null;
  todoIds: string[];
  assigneeIds: string[];
  status: Task["status"];
  tags: string[];
  sectionId: string | null;
}

/**
 * グループの追加条件を組み立てる。サイドバーでPJを選んで絞り込み中は、PJ別以外のまとめ方
 * （担当者別・状態別・タグ別）でもそのPJに作る（作らないと絞り込みで見えなくなるため）。
 */
export function makeSpec(partial: Partial<GroupAddSpec>, selectedProjectId: string | null = null): GroupAddSpec {
  return {
    projectId: partial.projectId ?? selectedProjectId,
    todoId: partial.todoId ?? null,
    assigneeId: partial.assigneeId ?? null,
    status: partial.status ?? null,
    tag: partial.tag ?? null,
    sectionId: partial.sectionId ?? null,
  };
}

export function defaultsForGroup(spec: GroupAddSpec): GroupDefaults {
  return {
    projectId: spec.projectId,
    todoIds: spec.todoId ? [spec.todoId] : [],
    assigneeIds: spec.assigneeId ? [spec.assigneeId] : [],
    status: spec.status ?? "todo",
    tags: spec.tag ? [spec.tag] : [],
    sectionId: spec.sectionId,
  };
}

export interface InlineDraft {
  name: string;
  assigneeIds: string[];
  startDate: string;
  dueDate: string;
}

/**
 * 担当者の初期値は自分（QuickAddTaskModal の既定と同じ。ゲストは __guest__ の自分）。担当者別グループのときだけ
 * そのグループの担当者に固定。
 * WHY：空欄だと作ったタスクがダッシュボードの「自分」やサイドバーの「自分」絞り込みに出ず、
 * 利用者が「追加できなくなった」と感じた（2026-10-15 報告）。
 */
export function emptyDraft(spec: GroupAddSpec, currentUserId: string): InlineDraft {
  return { name: "", assigneeIds: [spec.assigneeId ?? currentUserId], startDate: "", dueDate: "" };
}

/** 未保存の入力があるか。名前が空白だけなら未保存扱いにしない（登録できないため）。 */
export function isDraftDirty(draft: InlineDraft): boolean {
  return draft.name.trim() !== "";
}

export type SubmitResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "empty" | "busy" | "dates" | "error"; message?: string; error?: unknown };

interface SubmitterDeps {
  getTasks: () => Task[];
  saveTask: (task: Task) => Promise<void>;
  userId: string;
}

/** 保存中は二重登録しない登録処理。busy はこのインスタンス内だけの状態。 */
export function createInlineSubmitter(deps: SubmitterDeps) {
  let busy = false;
  return {
    async submit(draft: InlineDraft, spec: GroupAddSpec): Promise<SubmitResult> {
      if (busy) return { ok: false, reason: "busy" };
      if (!draft.name.trim()) return { ok: false, reason: "empty" };
      const dateError = validateTaskDateRange(draft.startDate, draft.dueDate);
      if (dateError) return { ok: false, reason: "dates", message: dateError };
      busy = true;
      try {
        const d = defaultsForGroup(spec);
        const task = prepareNewTask({
          name: draft.name,
          projectId: d.projectId,
          parentId: null,
          todoIds: d.todoIds,
          assigneeIds: draft.assigneeIds,
          status: d.status,
          priority: null,
          startDate: draft.startDate,
          dueDate: draft.dueDate,
          comment: "",
          sectionId: d.sectionId,
          tags: d.tags,
          updatedBy: deps.userId,
        }, deps.getTasks());
        await deps.saveTask(task);
        return { ok: true, task };
      } catch (error) {
        return { ok: false, reason: "error", error };
      } finally {
        busy = false;
      }
    },
  };
}

export type AddSlot = "name" | "assignee" | "start" | "due" | "detail";
const TAB_ORDER: AddSlot[] = ["name", "assignee", "start", "due", "detail"];

/** Tab で次に移る欄。端から出るときは null（ブラウザ既定に任せる）。 */
export function nextTabTarget(current: AddSlot, shift: boolean): AddSlot | null {
  const i = TAB_ORDER.indexOf(current);
  const next = TAB_ORDER[i + (shift ? -1 : 1)];
  return next ?? null;
}

export interface OrphanDraftResult {
  drafts: Record<string, InlineDraft>;
  /** 付け替え先に既に別の入力があり、残せなかった下書きの名前（利用者へ知らせる） */
  droppedNames: string[];
  changed: boolean;
}

/**
 * 削除されたグループ宛ての下書きを「未分類」へ付け替える（M75・Section 77）。
 * 下書きのキーは `<まとめ方>:<見出し>§<グループID>`。グループが削除された（is_deleted、または一覧から消えた）のに
 * 行が戻ってこないと、名前入りの下書きが見えないまま未保存扱いで残り続ける。
 * 付け替え先は、そのPJにまだグループがあれば「未分類」ブロック（`§__unsectioned__`）、無ければグループ無しの行（接頭辞だけ）。
 * 空の下書きは付け替えず捨てる（未保存扱いにならないため）。付け替え先に名前入りの下書きが既にあれば、そちらを優先し
 * 捨てる側の名前を droppedNames で返す。
 */
export function reassignOrphanDrafts(
  drafts: Record<string, InlineDraft>,
  sections: ProjectSection[],
): OrphanDraftResult {
  const live = new Set(sections.filter(s => !s.is_deleted).map(s => s.id));
  const byId = new Map(sections.map(s => [s.id, s]));
  const next: Record<string, InlineDraft> = { ...drafts };
  const droppedNames: string[] = [];
  let changed = false;
  for (const [key, draft] of Object.entries(drafts)) {
    const i = key.indexOf(SECTION_KEY_SEPARATOR);
    if (i < 0) continue;
    const sectionId = key.slice(i + 1);
    if (sectionId === UNSECTIONED_KEY || live.has(sectionId)) continue;
    const prefix = key.slice(0, i);
    const projectId = byId.get(sectionId)?.project_id;
    const projectHasSections = projectId ? sections.some(s => s.project_id === projectId && !s.is_deleted) : true;
    const targetKey = projectHasSections ? `${prefix}${SECTION_KEY_SEPARATOR}${UNSECTIONED_KEY}` : prefix;
    delete next[key];
    changed = true;
    if (!isDraftDirty(draft)) continue;
    const existing = next[targetKey];
    if (existing && isDraftDirty(existing)) { droppedNames.push(draft.name.trim()); continue; }
    next[targetKey] = draft;
  }
  return { drafts: changed ? next : drafts, droppedNames, changed };
}

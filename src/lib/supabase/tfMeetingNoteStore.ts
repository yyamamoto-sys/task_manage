// src/lib/supabase/tfMeetingNoteStore.ts
//
// 【設計意図】
// tf_meeting_notes テーブルへのCRUD。TF会議ノート（OneNoteの内容をアプリ化したもの）。
// TF × 週（月曜起点）で1レコード。前週のノートから内容を「下書き」として引き継いで
// 次週分を作成できる（carried_from_note_id）。
// 詳細設計：docs/okr-cycle-design.md（Phase A）

import { supabase } from "./client";

export type TfNoteStatus = "draft" | "ready";

export interface TfMeetingNote {
  id: string;
  tf_id: string;
  week_start: string;            // YYYY-MM-DD（月曜）
  target_definition: string;     // 必達の定義
  eval_criteria: string;         // 評価観点
  hypotheses: string;            // ① 先週動かした前提・仮説
  facts: string;                 // ② 実際に起きたこと（事実・反応）
  next_actions: string;          // ③ 次にやる一手（判断）
  progress_pct: number | null;   // ④ 現在のプロセス状態（%）
  progress_reason: string;       // ④ その理由
  todo_status: string;           // ToDo / タスクの状況メモ
  status: TfNoteStatus;
  carried_from_note_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

/** 編集可能なフィールドだけの型（保存時に渡す） */
export type TfNoteFields = Pick<
  TfMeetingNote,
  "target_definition" | "eval_criteria" | "hypotheses" | "facts" |
  "next_actions" | "progress_pct" | "progress_reason" | "todo_status" | "status"
>;

const COLS = "*";

/** 指定TFのノートを週の新しい順に取得（最大52件 ≒ 1年分）。 */
export async function fetchTfMeetingNotes(tfId: string): Promise<TfMeetingNote[]> {
  const { data, error } = await supabase
    .from("tf_meeting_notes")
    .select(COLS)
    .eq("tf_id", tfId)
    .eq("is_deleted", false)
    .order("week_start", { ascending: false })
    .limit(52);
  if (error) throw error;
  return (data ?? []) as TfMeetingNote[];
}

/** 指定TF×週のノートを1件取得（なければ null）。 */
export async function fetchTfMeetingNote(tfId: string, weekStart: string): Promise<TfMeetingNote | null> {
  const { data, error } = await supabase
    .from("tf_meeting_notes")
    .select(COLS)
    .eq("tf_id", tfId)
    .eq("week_start", weekStart)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as TfMeetingNote | null;
}

/** 指定TFの、指定週より前の最新ノートを取得（引き継ぎ元の候補）。 */
export async function fetchPrevTfMeetingNote(tfId: string, weekStart: string): Promise<TfMeetingNote | null> {
  const { data, error } = await supabase
    .from("tf_meeting_notes")
    .select(COLS)
    .eq("tf_id", tfId)
    .eq("is_deleted", false)
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as TfMeetingNote | null;
}

/** 新規ノートを作成。carried_from_note_id を渡すと引き継ぎ元を記録する。 */
export async function insertTfMeetingNote(
  tfId: string,
  weekStart: string,
  fields: TfNoteFields,
  createdBy: string,
  carriedFromNoteId: string | null = null,
): Promise<TfMeetingNote> {
  const { data, error } = await supabase
    .from("tf_meeting_notes")
    .insert({
      tf_id: tfId,
      week_start: weekStart,
      ...fields,
      carried_from_note_id: carriedFromNoteId,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as TfMeetingNote;
}

/** 既存ノートを更新。 */
export async function updateTfMeetingNote(
  id: string,
  fields: Partial<TfNoteFields>,
  updatedBy: string,
): Promise<TfMeetingNote> {
  const { data, error } = await supabase
    .from("tf_meeting_notes")
    .update({ ...fields, updated_by: updatedBy })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw error;
  return data as TfMeetingNote;
}

/** 論理削除。 */
export async function softDeleteTfMeetingNote(id: string, deletedBy: string): Promise<void> {
  const { error } = await supabase
    .from("tf_meeting_notes")
    .update({ is_deleted: true, updated_by: deletedBy })
    .eq("id", id);
  if (error) throw error;
}

/**
 * 前週ノートから「下書き」として引き継ぐ初期フィールドを作る。
 * - 必達定義・評価観点・次の一手・現在の状態(%)・理由・ToDo状況：そのままコピー
 * - ① 先週動かした前提・仮説：前週の「③ 次にやる一手」を素材として差し込む（編集前提）
 * - ② 実際に起きたこと：空（毎週新規）
 * - status：draft で開始
 */
export function carriedFieldsFrom(prev: TfMeetingNote): TfNoteFields {
  return {
    target_definition: prev.target_definition,
    eval_criteria: prev.eval_criteria,
    hypotheses: prev.next_actions
      ? `（前週の「次にやる一手」から引き継ぎ。実際に動かしたものに直してください）\n${prev.next_actions}`
      : "",
    facts: "",
    next_actions: prev.next_actions,
    progress_pct: prev.progress_pct,
    progress_reason: prev.progress_reason,
    todo_status: prev.todo_status,
    status: "draft",
  };
}

/** 空のノートフィールド（前週ノートがない場合の初期値）。 */
export function emptyTfNoteFields(): TfNoteFields {
  return {
    target_definition: "",
    eval_criteria: "",
    hypotheses: "",
    facts: "",
    next_actions: "",
    progress_pct: null,
    progress_reason: "",
    todo_status: "",
    status: "draft",
  };
}

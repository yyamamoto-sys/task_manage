// src/lib/supabase/krMeetingNoteStore.ts
//
// 【設計意図】
// 会議ノート（OKR循環ワークフロー Phase A）。OneNote の運用に合わせ、ノートは KR×週で1件
// （kr_meeting_notes）、その配下に TF ごとのエントリ（kr_note_tf_entries）を持つ。
// 前週の同じKRのノートから内容を「下書き」として引き継いで次週分を作成できる。
// 詳細設計：docs/okr-cycle-design.md（Phase A）

import { supabase } from "./client";

export type KrNoteStatus = "draft" | "ready";

/** TFエントリの編集可能フィールド */
export interface KrNoteEntryFields {
  tf_theme: string;          // TFの説明・その期のテーマ（OneNoteの「★1Q＝…」）
  target_definition: string; // 必達の定義
  eval_criteria: string;     // 評価観点
  hypotheses: string;        // ① 先週動かした前提・仮説
  facts: string;             // ② 実際に起きたこと（事実・反応）
  next_actions: string;      // ③ 次にやる一手（判断）
  progress_pct: number | null; // ④ 現在のプロセス状態（%）
  progress_reason: string;   // ④ その理由
  todo: string;              // ▶ TODO（その時期のToDo）
}

export interface KrNoteTfEntry extends KrNoteEntryFields {
  id: string;
  note_id: string;
  tf_id: string;
  created_at: string;
  updated_at: string;
}

export interface KrMeetingNote {
  id: string;
  kr_id: string;
  week_start: string;        // YYYY-MM-DD（月曜）
  status: KrNoteStatus;
  carried_from_note_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

export interface KrMeetingNoteFull extends KrMeetingNote {
  entries: KrNoteTfEntry[];
}

const NOTE_COLS = "*";
const ENTRY_COLS = "*";

/** 指定KRのノートを週の新しい順に取得（最大52件 ≒ 1年分。エントリは含まない）。 */
export async function fetchKrMeetingNotesList(krId: string): Promise<KrMeetingNote[]> {
  const { data, error } = await supabase
    .from("kr_meeting_notes")
    .select(NOTE_COLS)
    .eq("kr_id", krId)
    .eq("is_deleted", false)
    .order("week_start", { ascending: false })
    .limit(52);
  if (error) throw error;
  return (data ?? []) as KrMeetingNote[];
}

async function fetchEntriesForNote(noteId: string): Promise<KrNoteTfEntry[]> {
  const { data, error } = await supabase
    .from("kr_note_tf_entries")
    .select(ENTRY_COLS)
    .eq("note_id", noteId);
  if (error) throw error;
  return (data ?? []) as KrNoteTfEntry[];
}

/** 指定KR×週のノート（エントリ込み）を取得。なければ null。 */
export async function fetchKrMeetingNote(krId: string, weekStart: string): Promise<KrMeetingNoteFull | null> {
  const { data, error } = await supabase
    .from("kr_meeting_notes")
    .select(NOTE_COLS)
    .eq("kr_id", krId)
    .eq("week_start", weekStart)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  const note = (data?.[0] ?? null) as KrMeetingNote | null;
  if (!note) return null;
  const entries = await fetchEntriesForNote(note.id);
  return { ...note, entries };
}

/** ノートIDからエントリ込みで取得（引き継ぎ元の取得などに使用）。 */
export async function fetchKrMeetingNoteById(noteId: string): Promise<KrMeetingNoteFull | null> {
  const { data, error } = await supabase
    .from("kr_meeting_notes")
    .select(NOTE_COLS)
    .eq("id", noteId)
    .limit(1);
  if (error) throw error;
  const note = (data?.[0] ?? null) as KrMeetingNote | null;
  if (!note) return null;
  const entries = await fetchEntriesForNote(note.id);
  return { ...note, entries };
}

export interface SaveKrNoteInput {
  krId: string;
  weekStart: string;
  status: KrNoteStatus;
  carriedFromNoteId: string | null;
  /** TFごとのエントリ。tf_id をキーに upsert する */
  entries: ({ tf_id: string } & KrNoteEntryFields)[];
}

/** ノート（親）とTFエントリ（子）をまとめて保存（新規 or 更新）。保存後の最新を返す。 */
export async function saveKrMeetingNote(input: SaveKrNoteInput, userId: string): Promise<KrMeetingNoteFull> {
  const { krId, weekStart, status, carriedFromNoteId, entries } = input;

  // 親ノートの有無を確認
  const { data: existingRows, error: e1 } = await supabase
    .from("kr_meeting_notes")
    .select("id")
    .eq("kr_id", krId)
    .eq("week_start", weekStart)
    .eq("is_deleted", false)
    .limit(1);
  if (e1) throw e1;

  let noteId: string;
  if (existingRows && existingRows.length > 0) {
    noteId = (existingRows[0] as { id: string }).id;
    const { error: e2 } = await supabase
      .from("kr_meeting_notes")
      .update({ status, updated_by: userId })
      .eq("id", noteId);
    if (e2) throw e2;
  } else {
    const { data: inserted, error: e3 } = await supabase
      .from("kr_meeting_notes")
      .insert({ kr_id: krId, week_start: weekStart, status, carried_from_note_id: carriedFromNoteId, created_by: userId, updated_by: userId })
      .select("id")
      .single();
    if (e3) throw e3;
    noteId = (inserted as { id: string }).id;
  }

  // 子エントリを upsert（onConflict: note_id,tf_id）
  if (entries.length > 0) {
    const rows = entries.map(e => ({
      note_id: noteId,
      tf_id: e.tf_id,
      tf_theme: e.tf_theme,
      target_definition: e.target_definition,
      eval_criteria: e.eval_criteria,
      hypotheses: e.hypotheses,
      facts: e.facts,
      next_actions: e.next_actions,
      progress_pct: e.progress_pct,
      progress_reason: e.progress_reason,
      todo: e.todo,
    }));
    const { error: e4 } = await supabase
      .from("kr_note_tf_entries")
      .upsert(rows, { onConflict: "note_id,tf_id" });
    if (e4) throw e4;
  }

  const full = await fetchKrMeetingNoteById(noteId);
  if (!full) throw new Error("保存後のノート取得に失敗しました");
  return full;
}

/** 論理削除（親のみ。子は ON DELETE CASCADE ではなく残るが is_deleted の親なので参照されない）。 */
export async function softDeleteKrMeetingNote(noteId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("kr_meeting_notes")
    .update({ is_deleted: true, updated_by: userId })
    .eq("id", noteId);
  if (error) throw error;
}

// ===== ヘルパー =====

export function emptyEntryFields(): KrNoteEntryFields {
  return {
    tf_theme: "", target_definition: "", eval_criteria: "",
    hypotheses: "", facts: "", next_actions: "",
    progress_pct: null, progress_reason: "", todo: "",
  };
}

/**
 * 前週ノートのTFエントリから「下書き」として引き継ぐフィールドを作る。
 * - TF説明・必達定義・評価観点・次の一手・現在の状態(%)・理由・TODO：そのままコピー
 * - ① 先週動かした前提・仮説：前週の「③ 次にやる一手」を素材として差し込む（編集前提）
 * - ② 実際に起きたこと：空（毎週新規）
 * 戻り値：tf_id → 引き継ぎ後フィールド の Map
 */
export function carriedEntriesFrom(prev: KrMeetingNoteFull): Map<string, KrNoteEntryFields> {
  const map = new Map<string, KrNoteEntryFields>();
  for (const e of prev.entries) {
    map.set(e.tf_id, {
      tf_theme: e.tf_theme,
      target_definition: e.target_definition,
      eval_criteria: e.eval_criteria,
      hypotheses: e.next_actions
        ? `（前週の「次にやる一手」から引き継ぎ。実際に動かしたものに直してください）\n${e.next_actions}`
        : "",
      facts: "",
      next_actions: e.next_actions,
      progress_pct: e.progress_pct,
      progress_reason: e.progress_reason,
      todo: e.todo,
    });
  }
  return map;
}

// src/lib/supabase/krMeetingNoteStore.ts
//
// 【設計意図】
// 会議ノート（OKR循環ワークフロー Phase A）。OneNote の運用に合わせ、ノートは KR×週で1件
// （kr_meeting_notes）、その配下に TF ごとのエントリ（kr_note_tf_entries）を持つ。
// 前週の同じKRのノートから内容を「下書き」として引き継いで次週分を作成できる。
// 詳細設計：docs/okr-cycle-design.md（Phase A）

import { supabase } from "./client";

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
  carried_from_note_id: string | null;
  /** 前回からの引き継ぎメモ（前週確定レポートの要点＋最新③分析の示唆、自動生成・編集可） */
  carry_memo: string;
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

/** 指定KR×TFのエントリを、週の新しい順に取得（最大 limit 件。分析の入力に使う）。 */
export async function fetchTfEntryHistory(krId: string, tfId: string, limit = 8): Promise<(KrNoteTfEntry & { week_start: string })[]> {
  const notes = await fetchKrMeetingNotesList(krId); // 新しい週順
  if (notes.length === 0) return [];
  const idToWeek = new Map(notes.map(n => [n.id, n.week_start]));
  const { data, error } = await supabase
    .from("kr_note_tf_entries")
    .select(ENTRY_COLS)
    .in("note_id", notes.map(n => n.id))
    .eq("tf_id", tfId);
  if (error) throw error;
  const rows = (data ?? []) as KrNoteTfEntry[];
  return rows
    .map(e => ({ ...e, week_start: idToWeek.get(e.note_id) ?? "" }))
    .filter(e => e.week_start)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
    .slice(0, limit);
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
  carriedFromNoteId: string | null;
  /** 前回からの引き継ぎメモ（自動生成・編集可） */
  carryMemo: string;
  /** TFごとのエントリ。tf_id をキーに upsert する */
  entries: ({ tf_id: string } & KrNoteEntryFields)[];
}

/** ノート（親）とTFエントリ（子）をまとめて保存（新規 or 更新）。保存後の最新を返す。 */
export async function saveKrMeetingNote(input: SaveKrNoteInput, userId: string): Promise<KrMeetingNoteFull> {
  const { krId, weekStart, carriedFromNoteId, carryMemo, entries } = input;

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
      .update({ carry_memo: carryMemo, updated_by: userId })
      .eq("id", noteId);
    if (e2) throw e2;
  } else {
    const { data: inserted, error: e3 } = await supabase
      .from("kr_meeting_notes")
      .insert({ kr_id: krId, week_start: weekStart, carried_from_note_id: carriedFromNoteId, carry_memo: carryMemo, created_by: userId, updated_by: userId })
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

// ===== 前回からの引き継ぎメモ（④③→①） =====

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** マークダウン中の "## <name>" セクション本文を返す（無ければ null）。複数候補に対応。 */
function extractMdSection(md: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s|^#\\s|\\Z)`, "im");
    const m = re.exec(md);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

export interface BuildCarryMemoInput {
  prevReport?: { content: string; created_at: string; week_start: string; mode: string } | null;
  latestAnalysis?: { content: string; created_at: string } | null;
}

/**
 * 「前回からの引き継ぎメモ」のマークダウンを生成する。
 * - 前週の確定レポート（HTML）→ プレーンテキストに変換して要点として入れる
 * - 最新のAI分析（マークダウン）→「次の一手」「レポート作成のための要点」を抽出（無ければ末尾を要約）
 */
export function buildCarryMemo(input: BuildCarryMemoInput): string {
  const parts: string[] = [];
  parts.push("## 前回からの引き継ぎメモ");
  parts.push("_前週の確定レポートの要点と、最新のAI分析の示唆を自動で入れています。今週の議論で各TF欄に反映してから、本欄は編集／削除してください。_");

  const r = input.prevReport;
  if (r && r.content) {
    const text = stripHtml(r.content);
    const snippet = text.length > 900 ? text.slice(0, 900).replace(/\s+$/, "") + "…" : text;
    parts.push("");
    parts.push(`### 前回の確定レポート（${r.week_start} ${r.mode}）の要点`);
    parts.push(snippet);
  }

  const a = input.latestAnalysis;
  if (a && a.content) {
    const next = extractMdSection(a.content, ["次の一手（来週・次月へ）", "次の一手", "気になる点・リスク"]);
    const tips = extractMdSection(a.content, ["レポート作成のための要点"]);
    const date = a.created_at.slice(0, 10);
    parts.push("");
    parts.push(`### 最新のAI分析（${date}）からの示唆`);
    if (next) { parts.push("**次の一手**"); parts.push(next); }
    if (tips) { parts.push(""); parts.push("**レポート用の要点**"); parts.push(tips); }
    if (!next && !tips) {
      const tail = a.content.length > 700 ? a.content.slice(-700) : a.content;
      parts.push(tail);
    }
  }

  if (parts.length <= 2) return ""; // 何も無いなら空に
  return parts.join("\n").trim();
}

/**
 * 前週ノートのTFエントリから「下書き」として引き継ぐフィールドを作る。
 * - TF説明・必達定義・評価観点（クォーターを通して変わりにくい上3項目）：そのままコピー
 * - ① 先週動かした前提・仮説／② 実際に起きたこと／③ 次にやる一手／④ 現在の状態(%)・理由／
 *   ▶ TODO（週次で新たに記入する下5項目）：空にする。前週の内容は UI 側で
 *   `PrevRef`（参照表示・編集不可）として各欄の直上に表示される
 * 戻り値：tf_id → 引き継ぎ後フィールド の Map
 */
export function carriedEntriesFrom(prev: KrMeetingNoteFull): Map<string, KrNoteEntryFields> {
  // 引き継ぐのは「クォーターを通して変わりにくい」上3項目のみ。
  // 下5項目（hypotheses / facts / next_actions / progress_pct / progress_reason / todo）は
  // 週次で新たに記入する。前週の内容は UI 側で「参照表示（編集不可）」として見える
  const map = new Map<string, KrNoteEntryFields>();
  for (const e of prev.entries) {
    map.set(e.tf_id, {
      tf_theme: e.tf_theme,
      target_definition: e.target_definition,
      eval_criteria: e.eval_criteria,
      hypotheses: "",
      facts: "",
      next_actions: "",
      progress_pct: null,
      progress_reason: "",
      todo: "",
    });
  }
  return map;
}

// src/lib/supabase/krReportStore.ts
//
// 【設計意図】
// kr_reports テーブルへのCRUD。KRレポートを AI下書き（draft）→ 人が確認・手修正 → 確定（finalized）
// の流れで扱う。KR×週×モードで1件（最新を上書き）。localStorage から移行。
// 詳細設計：docs/okr-cycle-design.md（Phase C）

import { supabase } from "./client";

export type KrReportStatus = "draft" | "finalized";

export interface KrReport {
  id: string;
  kr_id: string;
  week_start: string;        // YYYY-MM-DD（月曜）
  mode: string;              // "checkin" / "win_session" 等
  content: string;           // 本文（HTML）
  status: KrReportStatus;
  created_by: string;
  finalized_by: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

/** 指定KRで、指定週（不問なら省略）以前の最新の「確定済み」レポートを取得（なければ null）。前週から引き継ぐメモの素材に使う。 */
export async function fetchLatestFinalizedKrReport(krId: string, beforeWeekStart?: string): Promise<KrReport | null> {
  let q = supabase
    .from("kr_reports")
    .select("*")
    .eq("kr_id", krId)
    .eq("status", "finalized")
    .eq("is_deleted", false)
    .order("week_start", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (beforeWeekStart) q = q.lte("week_start", beforeWeekStart);
  const { data, error } = await q;
  if (error) throw error;
  return (data?.[0] ?? null) as KrReport | null;
}

/** 指定KR×週×モードのレポートを1件取得（なければ null）。 */
export async function fetchKrReport(krId: string, weekStart: string, mode: string): Promise<KrReport | null> {
  const { data, error } = await supabase
    .from("kr_reports")
    .select("*")
    .eq("kr_id", krId)
    .eq("week_start", weekStart)
    .eq("mode", mode)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as KrReport | null;
}

/**
 * AI下書きを保存（新規 or 既存の content を上書き）。status は draft に戻す（再生成したため）。
 * 戻り値は保存後のレコード。
 */
export async function saveKrReportDraft(krId: string, weekStart: string, mode: string, content: string, userId: string): Promise<KrReport> {
  const existing = await fetchKrReport(krId, weekStart, mode);
  if (existing) {
    const { data, error } = await supabase
      .from("kr_reports")
      .update({ content, status: "draft", finalized_by: null, finalized_at: null, updated_by: userId })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as KrReport;
  }
  const { data, error } = await supabase
    .from("kr_reports")
    .insert({ kr_id: krId, week_start: weekStart, mode, content, status: "draft", created_by: userId, updated_by: userId })
    .select("*")
    .single();
  if (error) throw error;
  return data as KrReport;
}

/** 人が手修正した本文で更新（status は据え置き＝確定済みなら確定のまま）。 */
export async function updateKrReportContent(id: string, content: string, userId: string): Promise<KrReport> {
  const { data, error } = await supabase
    .from("kr_reports")
    .update({ content, updated_by: userId })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KrReport;
}

/** レポートを確定する（status=finalized、確定者・確定日時を記録）。 */
export async function finalizeKrReport(id: string, userId: string): Promise<KrReport> {
  const { data, error } = await supabase
    .from("kr_reports")
    .update({ status: "finalized", finalized_by: userId, finalized_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KrReport;
}

/** 確定を取り消して下書きに戻す。 */
export async function unfinalizeKrReport(id: string, userId: string): Promise<KrReport> {
  const { data, error } = await supabase
    .from("kr_reports")
    .update({ status: "draft", finalized_by: null, finalized_at: null, updated_by: userId })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as KrReport;
}

/** 論理削除。 */
export async function softDeleteKrReport(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("kr_reports")
    .update({ is_deleted: true, updated_by: userId })
    .eq("id", id);
  if (error) throw error;
}

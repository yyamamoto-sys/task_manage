// src/lib/supabase/okrAnalysisStore.ts
//
// 【設計意図】
// okr_analyses テーブルへのCRUD。KR単位のAI分析結果を履歴として蓄積し、過去に遡って読める／
// 人が手修正できる／レポート作成の素材にする（OKR循環ワークフロー Phase B / ③分析結果）。
// 詳細設計：docs/okr-cycle-design.md（Phase B）

import { supabase } from "./client";

export interface OkrAnalysis {
  id: string;
  kr_id: string;
  content: string;
  edited: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

/** 指定KRの分析を新しい順に取得（全件・過去分も残す）。 */
export async function fetchOkrAnalyses(krId: string): Promise<OkrAnalysis[]> {
  const { data, error } = await supabase
    .from("okr_analyses")
    .select("*")
    .eq("kr_id", krId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OkrAnalysis[];
}

/** 指定KRの最新の分析を1件取得（レポート作成の素材などに使う）。なければ null。 */
export async function fetchLatestOkrAnalysis(krId: string): Promise<OkrAnalysis | null> {
  const rows = await fetchOkrAnalyses(krId);
  return rows[0] ?? null;
}

/** 新しい分析結果を保存する（AI生成直後 or 手書き）。 */
export async function insertOkrAnalysis(krId: string, content: string, createdBy: string, edited = false): Promise<OkrAnalysis> {
  const { data, error } = await supabase
    .from("okr_analyses")
    .insert({ kr_id: krId, content, edited, created_by: createdBy, updated_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as OkrAnalysis;
}

/** 既存の分析結果を更新（人が手修正したら edited=true にする）。 */
export async function updateOkrAnalysis(id: string, content: string, updatedBy: string): Promise<OkrAnalysis> {
  const { data, error } = await supabase
    .from("okr_analyses")
    .update({ content, edited: true, updated_by: updatedBy })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as OkrAnalysis;
}

/** 論理削除。 */
export async function softDeleteOkrAnalysis(id: string, deletedBy: string): Promise<void> {
  const { error } = await supabase
    .from("okr_analyses")
    .update({ is_deleted: true, updated_by: deletedBy })
    .eq("id", id);
  if (error) throw error;
}

// src/lib/supabase/okrTfAnalysisStore.ts
//
// 【設計意図】
// okr_tf_analyses テーブルへのCRUD。TF単位のAI分析結果を履歴として蓄積し、過去に遡って読める／
// 人が手修正できるようにする（OKR循環ワークフロー Phase B / ③分析結果）。
// 詳細設計：docs/okr-cycle-design.md（Phase B）

import { supabase } from "./client";

export interface OkrTfAnalysis {
  id: string;
  tf_id: string;
  content: string;
  edited: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

/** 指定TFの分析を新しい順に取得（全件・過去分も残す）。 */
export async function fetchOkrTfAnalyses(tfId: string): Promise<OkrTfAnalysis[]> {
  const { data, error } = await supabase
    .from("okr_tf_analyses")
    .select("*")
    .eq("tf_id", tfId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OkrTfAnalysis[];
}

/** 新しい分析結果を保存する（AI生成直後 or 手書き）。 */
export async function insertOkrTfAnalysis(tfId: string, content: string, createdBy: string, edited = false): Promise<OkrTfAnalysis> {
  const { data, error } = await supabase
    .from("okr_tf_analyses")
    .insert({ tf_id: tfId, content, edited, created_by: createdBy, updated_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as OkrTfAnalysis;
}

/** 既存の分析結果を更新（人が手修正したら edited=true にする）。 */
export async function updateOkrTfAnalysis(id: string, content: string, updatedBy: string): Promise<OkrTfAnalysis> {
  const { data, error } = await supabase
    .from("okr_tf_analyses")
    .update({ content, edited: true, updated_by: updatedBy })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as OkrTfAnalysis;
}

/** 論理削除。 */
export async function softDeleteOkrTfAnalysis(id: string, deletedBy: string): Promise<void> {
  const { error } = await supabase
    .from("okr_tf_analyses")
    .update({ is_deleted: true, updated_by: deletedBy })
    .eq("id", id);
  if (error) throw error;
}

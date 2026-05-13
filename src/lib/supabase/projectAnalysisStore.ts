// src/lib/supabase/projectAnalysisStore.ts
//
// 【設計意図】
// project_analyses テーブルへのCRUD。PJごとのAI分析結果を全メンバーで共有するため
// localStorage ではなく Supabase に保存する。履歴は 1PJ につき最新 2 件まで保持し、
// 新規保存時に古い分を削除する。レコードは作成後に変更しない（updated_at なし）。

import { supabase } from "./client";

const MAX_HISTORY = 2;

export interface ProjectAnalysisRecord {
  id: string;
  project_id: string;
  content: string;
  created_by: string;
  created_at: string;
}

/** 指定PJのAI分析を新しい順に最大2件取得する。 */
export async function fetchProjectAnalyses(projectId: string): Promise<ProjectAnalysisRecord[]> {
  const { data, error } = await supabase
    .from("project_analyses")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);
  if (error) throw error;
  return (data ?? []) as ProjectAnalysisRecord[];
}

/**
 * 新しい分析結果を保存し、そのPJの履歴を最新2件に整える（古い分を削除）。
 * 削除に失敗してもメイン処理（保存）は成功扱いにする（履歴の刈り込みは補助的）。
 */
export async function insertProjectAnalysis(
  projectId: string,
  content: string,
  createdBy: string,
): Promise<ProjectAnalysisRecord> {
  const { data, error } = await supabase
    .from("project_analyses")
    .insert({ project_id: projectId, content, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;
  const inserted = data as ProjectAnalysisRecord;

  // 最新 MAX_HISTORY 件を超える古いレコードを削除
  try {
    const { data: all } = await supabase
      .from("project_analyses")
      .select("id, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    const stale = (all ?? []).slice(MAX_HISTORY).map(r => (r as { id: string }).id);
    if (stale.length > 0) {
      await supabase.from("project_analyses").delete().in("id", stale);
    }
  } catch (e) {
    console.warn("古いPJ分析の削除に失敗（保存自体は成功）:", e);
  }

  return inserted;
}

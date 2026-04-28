// src/lib/supabase/krSessionStore.ts
//
// 【設計意図】
// kr_sessions / kr_declarations テーブルへのCRUD操作。
// KRセッション機能（チェックイン・ウィンセッション）専用。

import { supabase } from "./client";

// ===== 型定義 =====

export interface KrSession {
  id: string;
  kr_id: string;
  week_start: string;       // YYYY-MM-DD（月曜日）
  session_type: "checkin" | "win_session";
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  learnings: string;
  external_changes: string;
  transcript: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

export interface KrDeclaration {
  id: string;
  session_id: string;
  member_id: string;
  content: string;
  due_date: string | null;
  result_status: "achieved" | "partial" | "not_achieved" | null;
  result_note: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

// ===== 取得 =====

export async function fetchKrSessions(krId: string): Promise<KrSession[]> {
  const { data, error } = await supabase
    .from("kr_sessions")
    .select("*")
    .eq("kr_id", krId)
    .eq("is_deleted", false)
    .order("week_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as KrSession[];
}

export async function fetchLatestCheckinSession(krId: string): Promise<KrSession | null> {
  const { data, error } = await supabase
    .from("kr_sessions")
    .select("*")
    .eq("kr_id", krId)
    .eq("session_type", "checkin")
    .eq("is_deleted", false)
    .order("week_start", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as KrSession | null;
}

export async function fetchKrDeclarations(sessionId: string): Promise<KrDeclaration[]> {
  const { data, error } = await supabase
    .from("kr_declarations")
    .select("*")
    .eq("session_id", sessionId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KrDeclaration[];
}

// ===== 作成 =====

export async function insertKrSession(
  session: Omit<KrSession, "id" | "created_at" | "updated_at" | "is_deleted">,
): Promise<KrSession> {
  const { data, error } = await supabase
    .from("kr_sessions")
    .insert(session)
    .select()
    .single();
  if (error) throw error;
  return data as KrSession;
}

export async function insertKrDeclaration(
  declaration: Omit<KrDeclaration, "id" | "created_at" | "updated_at" | "is_deleted">,
): Promise<KrDeclaration> {
  const { data, error } = await supabase
    .from("kr_declarations")
    .insert(declaration)
    .select()
    .single();
  if (error) throw error;
  return data as KrDeclaration;
}

// ===== 更新（ウィンセッションで宣言結果を書き込む） =====

export async function updateKrDeclarationResult(
  id: string,
  result_status: "achieved" | "partial" | "not_achieved",
  result_note: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from("kr_declarations")
    .update({
      result_status,
      result_note,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq("id", id);
  if (error) throw error;
}

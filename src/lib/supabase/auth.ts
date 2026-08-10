// src/lib/supabase/auth.ts
import { supabase } from "./client";
import type { Session } from "@supabase/supabase-js";

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * 【alreadyRegistered について（プロジェクト招待フローで利用・2026-08-10追加）】
 * Supabase Auth は「メール確認」が有効な環境では、既に登録済みのメールで signUp() しても
 * メール列挙（enumeration）対策としてエラーを投げずに成功のように振る舞う。この場合
 * `data.user.identities` が空配列になる（新規登録なら1件以上のidentityを含む）ため、
 * これを見て判別する。メール確認が無効な環境では従来どおりエラーが投げられる
 * （LoginScreen.tsx のメッセージ文字列マッチはこちらのケース用）。
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ needsConfirmation: boolean; alreadyRegistered: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const alreadyRegistered = !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
  return { needsConfirmation: !data.session, alreadyRegistered };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAuthEmail(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return data.subscription;
}

// src/lib/supabase/guestAiAuth.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）の通常操作（サンプル閲覧）はSupabaseに一切接続しない設計を崩さない
// （CLAUDE.md Section 23）。ただしAI機能（Edge Function "ai-consult"）は有効なSupabase Auth
// JWTを要求するため、AIを初めて使うときだけ signInAnonymously() で匿名セッションを遅延生成する。
// この関数を呼ばない限りゲストは一切Supabaseに接続しないままなので、「ゲストの通常操作は
// Supabaseに一切接続しない」という前提は崩れない。
//
// supabase/client.ts の Proxy は "auth" プロパティを一切インターセプトしない
// （assertGuestBlockedの対象外）ため、ここでの getSession()/signInAnonymously() 呼び出し
// 自体はゲストモードでもブロックされない。

import { supabase } from "./client";

let inFlight: Promise<void> | null = null;

/**
 * すでに（匿名含む）セッションがあれば何もしない。無ければ signInAnonymously() で作る。
 * 複数箇所から同時に呼ばれても signInAnonymously() は1回だけ実行する。
 */
export async function ensureGuestAiSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  if (!inFlight) {
    inFlight = supabase.auth.signInAnonymously()
      .then(({ error }) => {
        if (error) throw error;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

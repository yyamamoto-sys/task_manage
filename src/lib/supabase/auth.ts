// src/lib/supabase/auth.ts
import { supabase } from "./client";
import type { Session, AuthChangeEvent } from "@supabase/supabase-js";
import { buildResetRedirectUrl, classifyResetMailError, sessionArgsFromLink, type ResetMailOutcome } from "../account/recoveryFlow";
import { initialAuthLink } from "../account/initialAuthLink";
import { decodeJwtSub } from "../account/recoveryFlow";
import { writeRecoveryMarker, clearRecoveryMarker } from "../account/recoveryMarker";

let passwordLoginInFlight = false;
/** パスワードでのログイン中か（その SIGNED_IN では「再設定待ち」の印で再設定画面を強制しない）。 */
export function isPasswordLoginInFlight(): boolean {
  return passwordLoginInFlight;
}

export async function signIn(email: string, password: string): Promise<void> {
  passwordLoginInFlight = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // 正しいパスワードを知っている＝再設定の必要は無い（古いパスワードでログインし直しても抜けられるように）
    clearRecoveryMarker();
  } finally {
    passwordLoginInFlight = false;
  }
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

/** サーバーへ通信せずこの端末のセッションだけを破棄する（signOut が通信エラーで失敗したときの退避）。 */
export async function signOutLocal(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}

export type InitialLinkOutcome =
  | { kind: "none" }
  | { kind: "applied"; userId: string; isRecovery: boolean }
  | { kind: "failed"; error: unknown; isRecovery: boolean };

let initialLinkPending: Promise<InitialLinkOutcome> | null = null;

/**
 * メールのリンクで戻ってきたトークンを setSession で取り込む（detectSessionInUrl を切っているため自前）。
 * type=recovery 以外（サインアップ確認・招待・マジックリンク・メール変更）も同じく取り込み、
 * 通常のログインとして扱う。StrictMode の二重実行に備え、結果は1度だけ作って使い回す。
 */
export function applyInitialAuthLink(): Promise<InitialLinkOutcome> {
  if (!initialLinkPending) {
    initialLinkPending = (async (): Promise<InitialLinkOutcome> => {
      const link = initialAuthLink;
      if (link.kind !== "session") return { kind: "none" };
      try {
        if (link.isRecovery) {
          // 🔴 setSession の前に印を書く。setSession の SIGNED_IN は BroadcastChannel で他タブへ届くため、
          // 印がまだ無いと他タブが再設定前にアプリへ入れてしまう。JWT は検証しなくてよい（印は「強制する側」
          // にしか働かず、偽造しても害が無い）。デコードできなければ setSession せず無効リンク扱い。
          const sub = decodeJwtSub(link.accessToken);
          if (!sub) return { kind: "failed", error: new Error("invalid recovery token"), isRecovery: true };
          writeRecoveryMarker(sub);
        }
        const { data, error } = await supabase.auth.setSession(sessionArgsFromLink(link));
        if (error || !data.session) {
          // 取り込みに失敗したら、先に書いた印を消す（ログイン中に期限切れの再設定リンクを開いたとき、
          // 既存のセッションと印が一致して再設定画面を強制してしまうのを防ぐ）。
          if (link.isRecovery) clearRecoveryMarker();
          return { kind: "failed", error, isRecovery: link.isRecovery };
        }
        return { kind: "applied", userId: data.session.user.id, isRecovery: link.isRecovery };
      } catch (error) {
        if (link.isRecovery) clearRecoveryMarker();
        return { kind: "failed", error, isRecovery: link.isRecovery };
      }
    })();
  }
  return initialLinkPending;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAuthEmail(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/** 第2引数の event は省略して受けてよい（既存の呼び出し元は session だけを使う）。 */
export function onAuthStateChange(callback: (session: Session | null, event: AuthChangeEvent) => void) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
  return data.subscription;
}

/**
 * パスワード再設定のメールを送る。登録の有無で結果を変えない（Supabase はメール列挙対策で
 * 未登録でも成功を返す）。呼び出し側は "sent" のとき常に同じ文言を出すこと。
 */
export async function requestPasswordResetMail(email: string): Promise<ResetMailOutcome> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: buildResetRedirectUrl(window.location),
  });
  return classifyResetMailError(error);
}

/** ログイン中（再設定リンクで入った場合を含む）のパスワードを変更する。失敗は throw。 */
export async function updateOwnPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

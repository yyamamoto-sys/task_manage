// src/lib/supabase/clientErrorStore.ts
//
// 利用者の画面のエラー記録（v3.129・migrations/20261001c_notify_v2_client_errors.sql）。
// 書き込みは RPC log_client_error のみ（本人は DB 側が current_member_id() で決める）。
// 読み・解決は super_admin のみ（RLS）。一覧は件数を絞る（.limit）ため fetchAllRows の対象外（Section 61 の例外）。

import { supabase } from "./client";
import type { ClientErrorPayload } from "../errors/clientErrorLog";
import { matchNewErrors } from "../errors/errorCopyText";
import { isGuestMode } from "../guestMode";

export const CLIENT_ERROR_LIST_LIMIT = 200;

export interface ClientErrorLog {
  id: number;
  fingerprint: string;
  source: "report" | "boundary" | "window" | "promise";
  message: string;
  code: string | null;
  context: string | null;
  stack: string | null;
  route: string | null;
  screen: string | null;
  app_version: string | null;
  user_agent: string | null;
  member_id: string | null;
  first_seen: string;
  last_seen: string;
  count: number;
  reporter_count: number;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ClientErrorReporter {
  member_id: string;
  first_seen: string;
  last_seen: string;
  count: number;
}

export async function logClientError(payload: ClientErrorPayload): Promise<void> {
  const { error } = await supabase.rpc("log_client_error", payload);
  if (error) throw error;
}

/** ログイン済みの登録メンバーだけが記録できる。未ログイン・匿名（ゲストのAI用セッション）は送らない */
export async function canLogClientError(): Promise<boolean> {
  if (isGuestMode()) return false;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return !!user && user.is_anonymous !== true;
}

export async function fetchClientErrorLogs(opts: { unresolvedOnly: boolean }): Promise<ClientErrorLog[]> {
  const base = supabase
    .from("client_error_logs")
    .select("id, fingerprint, source, message, code, context, stack, route, screen, app_version, user_agent, member_id, first_seen, last_seen, count, reporter_count, resolved_at, resolved_by")
    .order("last_seen", { ascending: false })
    .limit(CLIENT_ERROR_LIST_LIMIT);
  const { data, error } = await (opts.unresolvedOnly ? base.is("resolved_at", null) : base);
  if (error) throw error;
  return (data ?? []) as ClientErrorLog[];
}

export async function fetchClientErrorReporters(errorId: number): Promise<ClientErrorReporter[]> {
  const { data, error } = await supabase
    .from("client_error_reporters")
    .select("member_id, first_seen, last_seen, count")
    .eq("error_id", errorId)
    .order("last_seen", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ClientErrorReporter[];
}

export async function resolveClientErrors(ids: number[], resolved: boolean): Promise<number> {
  const { data, error } = await supabase.rpc("resolve_client_errors", { p_ids: ids, p_resolved: resolved });
  if (error) throw error;
  return Number(data ?? 0);
}

export const NEW_ERROR_COPY_LIMIT = 50;

/** 自分宛ての未読の client_error 通知の作成時刻（新規エラーの特定に使う。v3.151） */
export async function fetchUnreadClientErrorNotifiedAt(memberId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("in_app_notifications")
    .select("created_at")
    .eq("member_id", memberId)
    .eq("kind", "client_error")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(NEW_ERROR_COPY_LIMIT);
  if (error) throw error;
  return (data ?? []).map(r => (r as { created_at: string }).created_at);
}

export type NewClientError = Omit<ClientErrorLog, "member_id" | "resolved_by" | "fingerprint"> & { last_notified_at: string | null };

/**
 * 未読通知の created_at の一覧そのもので絞る（範囲＋件数上限だと、古い未読の後に通知されたエラーが
 * 上限を超えたとき古い未読のエラーが抜ける）。timestamptz の等値比較なので文字列の書式差は影響しない。
 */
export async function fetchClientErrorsNotifiedAt(times: string[]): Promise<NewClientError[]> {
  if (times.length === 0) return [];
  const { data, error } = await supabase
    .from("client_error_logs")
    .select("id, source, message, code, context, stack, route, screen, app_version, user_agent, first_seen, last_seen, count, reporter_count, resolved_at, last_notified_at")
    .in("last_notified_at", times)
    .order("last_seen", { ascending: false })
    .limit(NEW_ERROR_COPY_LIMIT * 4);
  if (error) throw error;
  return (data ?? []) as NewClientError[];
}

/** 新規（未読の通知に対応する）エラー。突き合わせは時刻の一致（matchNewErrors）で最終確認する */
export async function fetchNewClientErrors(memberId: string): Promise<NewClientError[]> {
  const times = await fetchUnreadClientErrorNotifiedAt(memberId);
  return matchNewErrors(times, await fetchClientErrorsNotifiedAt(times));
}

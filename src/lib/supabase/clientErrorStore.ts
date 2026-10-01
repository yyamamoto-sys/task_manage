// src/lib/supabase/clientErrorStore.ts
//
// 利用者の画面のエラー記録（v3.129・migrations/20261001c_notify_v2_client_errors.sql）。
// 書き込みは RPC log_client_error のみ（本人は DB 側が current_member_id() で決める）。
// 読み・解決は super_admin のみ（RLS）。一覧は件数を絞る（.limit）ため fetchAllRows の対象外（Section 61 の例外）。

import { supabase } from "./client";
import type { ClientErrorPayload } from "../errors/clientErrorLog";
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

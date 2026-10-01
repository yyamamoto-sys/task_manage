// src/lib/supabase/adminMessageStore.ts
//
// 管理者からのお知らせ（v3.131・migrations/20261001e_admin_messages.sql・CLAUDE.md Section 68）。
// 送信・既読・確認・送信履歴・宛先の状況はすべて RPC（宛先の範囲は DB が強制する）。
// 受信者が自分の宛先行とお知らせ本文を読むのは RLS（本人の行・自分宛てのお知らせだけ）。
// 一覧は件数を絞る（.limit）ため fetchAllRows の対象外（Section 61 の例外）。

import { supabase } from "./client";
import { buildInvokeErrorMessage } from "../ai/edgeFunctionError";
import type { AdminMessageTarget } from "../../../supabase/functions/_shared/adminMessageLogic.ts";

export const SENT_LIST_LIMIT = 50;
export const PINNED_LIMIT = 5;

export interface AdminMessageCandidate {
  member_id: string;
  display_name: string;
  group_id: string | null;
  group_ids: string[] | null;
  group_name: string | null;
  in_home_group: boolean;
}

export interface SentAdminMessage {
  id: number;
  sender_id: string;
  sender_name: string;
  subject: string;
  body: string;
  target_kind: "all" | "group" | "members";
  target_group_id: string | null;
  requires_ack: boolean;
  due_date: string | null;
  created_at: string;
  recipient_count: number;
  read_count: number;
  ack_count: number;
  push_succeeded: number | null;
}

export interface AdminMessageRecipientStatus {
  member_id: string;
  display_name: string;
  group_name: string | null;
  delivered_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  reminded_at: string | null;
}

/** 受信者から見たお知らせ（自分の宛先行＋本文） */
export interface ReceivedAdminMessage {
  message_id: number;
  read_at: string | null;
  acknowledged_at: string | null;
  subject: string;
  body: string;
  sender_name: string;
  requires_ack: boolean;
  due_date: string | null;
  created_at: string;
}

export async function fetchAdminMessageCandidates(): Promise<AdminMessageCandidate[]> {
  const { data, error } = await supabase.rpc("admin_message_candidates");
  if (error) throw error;
  return (data ?? []) as AdminMessageCandidate[];
}

export async function sendAdminMessage(input: {
  subject: string; body: string; target: AdminMessageTarget; requiresAck: boolean; dueDate: string | null;
}): Promise<{ messageId: number; recipientCount: number }> {
  const { data, error } = await supabase.rpc("send_admin_message", {
    p_subject: input.subject,
    p_body: input.body,
    p_target: input.target.kind,
    p_group_id: input.target.kind === "group" ? input.target.groupId : null,
    p_member_ids: input.target.kind === "members" ? input.target.memberIds : null,
    p_requires_ack: input.requiresAck,
    p_due_date: input.requiresAck ? input.dueDate : null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { message_id: number; recipient_count: number } | undefined;
  if (!row) throw new Error("送信結果を受け取れませんでした");
  return { messageId: Number(row.message_id), recipientCount: Number(row.recipient_count) };
}

/** Windows通知の即時送信（宛先は DB に記録済みのもの。送信者本人のお知らせだけ） */
export async function dispatchAdminMessagePush(messageId: number): Promise<{ succeeded: number }> {
  const { data, error, response } = await supabase.functions.invoke("push-reminders", {
    body: { mode: "admin_message", messageId },
  });
  if (error) throw new Error(await buildInvokeErrorMessage(data, error, response));
  return { succeeded: Number((data as { succeeded?: number } | null)?.succeeded ?? 0) };
}

export async function listSentAdminMessages(): Promise<SentAdminMessage[]> {
  const { data, error } = await supabase.rpc("list_sent_admin_messages", { p_limit: SENT_LIST_LIMIT });
  if (error) throw error;
  return (data ?? []) as SentAdminMessage[];
}

export async function fetchAdminMessageStatus(messageId: number): Promise<AdminMessageRecipientStatus[]> {
  const { data, error } = await supabase.rpc("admin_message_status", { p_message_id: messageId });
  if (error) throw error;
  return (data ?? []) as AdminMessageRecipientStatus[];
}

interface RecipientRow {
  message_id: number;
  read_at: string | null;
  acknowledged_at: string | null;
  admin_messages: {
    subject: string; body: string; sender_name: string; requires_ack: boolean; due_date: string | null; created_at: string;
  } | null;
}

const RECEIVED_SELECT = "message_id, read_at, acknowledged_at, admin_messages(subject, body, sender_name, requires_ack, due_date, created_at)";

function toReceived(rows: RecipientRow[]): ReceivedAdminMessage[] {
  return rows.flatMap(r => r.admin_messages ? [{
    message_id: Number(r.message_id), read_at: r.read_at, acknowledged_at: r.acknowledged_at, ...r.admin_messages,
  }] : []);
}

export async function fetchReceivedAdminMessages(memberId: string, messageIds: number[]): Promise<ReceivedAdminMessage[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("admin_message_recipients")
    .select(RECEIVED_SELECT)
    .eq("member_id", memberId)
    .in("message_id", messageIds)
    .limit(messageIds.length);
  if (error) throw error;
  return toReceived((data ?? []) as unknown as RecipientRow[]);
}

/** 「確認しました」がまだのお知らせ（ベルの上に固定表示する）。確認ボタンありのものだけ */
export async function fetchPendingAckMessages(memberId: string): Promise<ReceivedAdminMessage[]> {
  const { data, error } = await supabase
    .from("admin_message_recipients")
    .select(`${RECEIVED_SELECT.replace("admin_messages(", "admin_messages!inner(")}`)
    .eq("member_id", memberId)
    .is("acknowledged_at", null)
    .eq("admin_messages.requires_ack", true)
    .order("message_id", { ascending: false })
    .limit(PINNED_LIMIT);
  if (error) throw error;
  return toReceived((data ?? []) as unknown as RecipientRow[]);
}

export async function markAdminMessageRead(messageId: number): Promise<void> {
  const { error } = await supabase.rpc("mark_admin_message_read", { p_message_id: messageId });
  if (error) throw error;
}

export async function acknowledgeAdminMessage(messageId: number): Promise<string> {
  const { data, error } = await supabase.rpc("acknowledge_admin_message", { p_message_id: messageId });
  if (error) throw error;
  return String(data ?? new Date().toISOString());
}

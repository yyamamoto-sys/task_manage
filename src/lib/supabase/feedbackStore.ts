// src/lib/supabase/feedbackStore.ts
//
// アプリ内フィードバック（v3.157・migrations/20261015b_app_feedback.sql・CLAUDE.md Section 82）。
// 書き込みはすべて RPC（送信者は DB が current_member_id() で決める）。
// 管理者（super_admin）は表を RLS で読む。一覧は件数を絞る（.limit）ため fetchAllRows の対象外（Section 61 の例外）。
// 本人が読めるのは RPC list_my_feedback（admin_memo・スナップショットは返さない）だけ。

import { supabase } from "./client";
import { isGuestMode } from "../guestMode";
import type { FeedbackKind, FeedbackSnapshotState, FeedbackStatus } from "../feedback/constants";
import {
  FEEDBACK_ADMIN_LIST_LIMIT, FEEDBACK_ALL_KINDS, FEEDBACK_COPY_LIMIT, FEEDBACK_SNAPSHOT_VERSION, FEEDBACK_STATUSES,
  isFeedbackKind, isFeedbackStatus,
} from "../feedback/constants";
import { parseSubmitResult, type FeedbackSubmitResult } from "../feedback/limit";
import type { FeedbackSnapshot } from "../feedback/snapshot";

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  comment: string;
  screen: string | null;
  route: string | null;
  appVersion: string;
  /** 送信時の表示部署（DB が本人のアクセス範囲か確かめ、範囲外ならホーム部署にする） */
  groupId: string | null;
  /** null なら状況を付けない（state が off／too_large） */
  snapshot: FeedbackSnapshot | null;
  snapshotState: Extract<FeedbackSnapshotState, "attached" | "off" | "too_large">;
}

/** ゲスト（サンプル閲覧）は Supabase に接続しない設計（Section 23）なので送れない。呼び出し側も入口を出さない */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackSubmitResult> {
  if (isGuestMode()) throw new Error("サンプル閲覧中はご意見を送れません");
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_kind: input.kind,
    p_comment: input.comment,
    p_screen: input.screen,
    p_route: input.route,
    p_app_version: input.appVersion,
    p_group_id: input.groupId,
    p_snapshot: input.snapshot,
    p_snapshot_state: input.snapshotState,
    p_snapshot_version: input.snapshot ? FEEDBACK_SNAPSHOT_VERSION : null,
  });
  if (error) throw error;
  return parseSubmitResult(data);
}

export interface MyFeedback {
  id: number;
  created_at: string;
  kind: FeedbackKind;
  comment: string;
  status: FeedbackStatus;
  status_changed_at: string | null;
  reply_text: string | null;
}

export async function listMyFeedback(): Promise<MyFeedback[]> {
  if (isGuestMode()) return [];
  const { data, error } = await supabase.rpc("list_my_feedback");
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    created_at: String(r.created_at),
    kind: isFeedbackKind(r.kind) ? r.kind : "unspecified",
    comment: String(r.comment ?? ""),
    status: isFeedbackStatus(r.status) ? r.status : "new",
    status_changed_at: typeof r.status_changed_at === "string" ? r.status_changed_at : null,
    reply_text: typeof r.reply_text === "string" ? r.reply_text : null,
  }));
}

/** 管理ページの一覧の1行（スナップショットは重いので別取得） */
export interface AdminFeedbackRow {
  id: number;
  member_id: string;
  group_id: string | null;
  kind: FeedbackKind;
  comment: string;
  screen: string | null;
  route: string | null;
  app_version: string | null;
  snapshot_state: FeedbackSnapshotState;
  status: FeedbackStatus;
  admin_memo: string | null;
  status_changed_at: string | null;
  created_at: string;
}

const LIST_COLUMNS = "id, member_id, group_id, kind, comment, screen, route, app_version, snapshot_state, status, admin_memo, status_changed_at, created_at";

export async function fetchAdminFeedback(opts: { statuses: readonly FeedbackStatus[] | null; kind: FeedbackKind | null }): Promise<AdminFeedbackRow[]> {
  // 絞り込みなしは「すべての値」で絞る（同じ意味）。.limit を同じ式に置くため1本の式にしている（rowLimitScan.test の流儀）
  const { data, error } = await supabase
    .from("app_feedback")
    .select(LIST_COLUMNS)
    .in("status", [...(opts.statuses ?? FEEDBACK_STATUSES)])
    .in("kind", opts.kind ? [opts.kind] : [...FEEDBACK_ALL_KINDS])
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_ADMIN_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []) as AdminFeedbackRow[];
}

export interface AdminFeedbackSnapshot {
  id: number;
  snapshot: FeedbackSnapshot | null;
}

/** 指定したご意見のスナップショットだけを取る（詳細を開いたとき・コピーするとき）。件数は FEEDBACK_COPY_LIMIT まで */
export async function fetchFeedbackSnapshots(ids: readonly number[]): Promise<AdminFeedbackSnapshot[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("app_feedback")
    .select("id, snapshot")
    .in("id", ids.slice(0, FEEDBACK_COPY_LIMIT))
    .limit(FEEDBACK_COPY_LIMIT);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: number; snapshot: FeedbackSnapshot | null }>).map((r) => ({ id: Number(r.id), snapshot: r.snapshot ?? null }));
}

export async function updateFeedbackStatus(id: number, status: FeedbackStatus): Promise<void> {
  const { error } = await supabase.rpc("update_feedback_status", { p_id: id, p_status: status });
  if (error) throw error;
}

/** 空欄は null を送る（Section 5：解除は undefined でなく null） */
export async function updateFeedbackMemo(id: number, memo: string | null): Promise<void> {
  const { error } = await supabase.rpc("update_feedback_memo", { p_id: id, p_memo: memo });
  if (error) throw error;
}

// src/lib/supabase/personalOkrStore.ts
//
// 【設計意図】
// 個人OKR層（personal_krs / personal_kr_months / personal_kr_weeks /
// personal_kr_week_tasks / personal_kr_memos）への低レベルCRUD。
// migrations/20260807b_add_personal_okr.sql・docs/dev/okr-redesign-plan.md 参照。
// store.ts と同じ流儀（saveWithLock経由の楽観ロック・is_deletedによる論理削除・
// 素のupsert/insert/delete関数群）に合わせる。AppDataContext/コンポーネントから
// 直接呼ばず、専用ストア経由で呼ぶこと（store.tsと同じ注意書き）。
//
// 【呼び出し元について・ダウンロード最小化（CLAUDE.md Section 19）】
// このファイルはどこからもimportされていない（appStore.ts の load()/fetchCriticalData()/
// fetchOkrData() には一切組み込まない）。OKRモードを開かない人にこのテーブル群への
// クエリを一切発生させないため。個人OKRビュー（Phase 1 Step B以降で実装）は、appStoreとは
// 別の専用ストア（quarterPlanStore.tsと同じ「OKRモードを開いたときにだけ読む」位置づけ）
// からこのファイルの関数を呼ぶこと。
//
// 【zustandを使わずflatな関数群にした理由】
// store.ts自体もOKRコア階層（objectives/key_results/task_forces/todos）等の各テーブルに
// 個別のzustandストアを持たない（1段上のappStore.tsがstore.tsの関数を呼んで状態を持つ）。
// personalOkrStoreも同じ構造に合わせ、「低レベルCRUD＝flat関数群（このファイル）」と
// 「状態の保持・reactivity＝1段上の専用ストア（画面実装のPhase 1 Step Bで新設）」を分離する。
// Step Aは画面を作らないため、1段上のストアは今回新設しない。
//
// 【null値の送信ルール（CLAUDE.md）】
// 列を空にする（クリアする）保存では undefined ではなく null を送ること。postgrest-js は
// JSON.stringify で body を組み立てるため、undefined のキーはペイロードから消え、その列は
// UPDATE対象から抜け落ちる（「解除が反映されない」無反応バグの実例あり）。この規約は特に
// band_override / band_override_by / band_override_at・self_rating・goal_state 等
// 「一度入れた値を後から消せる」列で重要。呼び出し側（Step B以降のUI）がこれらの列を
// クリアするときは必ず null を渡すこと（本ファイルの upsert 関数は受け取った値をそのまま
// 送るだけで undefined→null 変換は行わない＝呼び出し側の責務。upsertTaskForce等の
// 既存パターンと同じ）。

import { supabase } from "./client";
import { saveWithLock } from "./store";
import type {
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalKrMemo,
} from "../localData/types";

// ===== PersonalKr（個人四半期KR） =====

export async function fetchPersonalKrs(): Promise<PersonalKr[]> {
  const { data, error } = await supabase
    .from("personal_krs")
    .select("*")
    .eq("is_deleted", false)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as PersonalKr[];
}

export async function upsertPersonalKr(kr: PersonalKr, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("personal_krs", kr, expectedUpdatedAt);
}

export async function softDeletePersonalKr(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("personal_krs")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== PersonalKrMonth（個人月次計画） =====

export async function fetchPersonalKrMonths(personalKrId: string): Promise<PersonalKrMonth[]> {
  const { data, error } = await supabase
    .from("personal_kr_months")
    .select("*")
    .eq("personal_kr_id", personalKrId)
    .eq("is_deleted", false)
    .order("month_index");
  if (error) throw error;
  return (data ?? []) as PersonalKrMonth[];
}

export async function upsertPersonalKrMonth(month: PersonalKrMonth, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("personal_kr_months", month, expectedUpdatedAt);
}

export async function softDeletePersonalKrMonth(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("personal_kr_months")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== PersonalKrWeek（★週の目標状態） =====

export async function fetchPersonalKrWeeks(personalKrId: string): Promise<PersonalKrWeek[]> {
  const { data, error } = await supabase
    .from("personal_kr_weeks")
    .select("*")
    .eq("personal_kr_id", personalKrId)
    .eq("is_deleted", false)
    .order("month", { ascending: true })
    .order("week_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersonalKrWeek[];
}

export async function upsertPersonalKrWeek(week: PersonalKrWeek, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("personal_kr_weeks", week, expectedUpdatedAt);
}

export async function softDeletePersonalKrWeek(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("personal_kr_weeks")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== PersonalKrWeekTask（週とタスクの紐づけ・多対多） =====
// task_task_forces / task_projects 等と同型の中間テーブル。物理delete/insertで扱う
// （判断理由はmigrations/20260807b_add_personal_okr.sqlの冒頭コメント参照）。

export async function fetchPersonalKrWeekTasks(weekId: string): Promise<PersonalKrWeekTask[]> {
  const { data, error } = await supabase
    .from("personal_kr_week_tasks")
    .select("*")
    .eq("week_id", weekId);
  if (error) throw error;
  return (data ?? []) as PersonalKrWeekTask[];
}

export async function insertPersonalKrWeekTask(link: PersonalKrWeekTask) {
  const { error } = await supabase.from("personal_kr_week_tasks").insert(link);
  if (error) throw error;
}

export async function deletePersonalKrWeekTask(weekId: string, taskId: string) {
  const { error } = await supabase.from("personal_kr_week_tasks")
    .delete().eq("week_id", weekId).eq("task_id", taskId);
  if (error) throw error;
}

// ===== PersonalKrMemo（KRごとのメモ・追記型） =====

export async function fetchPersonalKrMemos(personalKrId: string): Promise<PersonalKrMemo[]> {
  const { data, error } = await supabase
    .from("personal_kr_memos")
    .select("*")
    .eq("personal_kr_id", personalKrId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PersonalKrMemo[];
}

export async function upsertPersonalKrMemo(memo: PersonalKrMemo, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("personal_kr_memos", memo, expectedUpdatedAt);
}

export async function softDeletePersonalKrMemo(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("personal_kr_memos")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

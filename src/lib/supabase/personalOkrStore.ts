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
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalKrMemo, PersonalKrOutlook,
  PersonalKrReviewDraft,
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

// ===== PersonalKrOutlook（AI解析の結果とキャッシュ・履歴として積む。Phase 3後半） =====
// 🔴 UPDATEしない・upsertしない（migrations/20260811_add_personal_kr_outlooks.sql冒頭コメント
// 参照。updated_atトリガーも貼られていないテーブルのため、saveWithLockは使わずINSERT専用にする）。

/** このKR・この月の最新の解析結果を1件だけ取得する（無ければnull）。
 *  §5-2「input_fingerprintが前回と一致したら再解析しない」判定の比較対象になる。 */
export async function fetchLatestPersonalKrOutlook(
  personalKrId: string,
  month: string,
): Promise<PersonalKrOutlook | null> {
  const { data, error } = await supabase
    .from("personal_kr_outlooks")
    .select("*")
    .eq("personal_kr_id", personalKrId)
    .eq("month", month)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PersonalKrOutlook | null;
}

/** 新しい解析結果を履歴として1件追加する（UPDATEは行わない）。 */
export async function insertPersonalKrOutlook(outlook: PersonalKrOutlook): Promise<void> {
  const { error } = await supabase.from("personal_kr_outlooks").insert(outlook);
  if (error) throw error;
}

// ===== PersonalKrReviewDraft（月末の振り返り下書き・Phase 4） =====
// 🔴 personal_kr_outlooksと違い、AI生成（insert）とは別に「人の編集」だけを直近行に対して
// UPDATEする経路を持つ（migrations/20260820_add_personal_kr_review_drafts.sql冒頭コメント
// 参照。updated_atトリガーは貼られていないため、edited_atはコードから明示的に書く）。

/** このKR・この月の最新の下書きを1件だけ取得する（無ければnull）。
 *  reviewDraftRunner.tsの「input_fingerprintが前回と一致したら再生成しない」判定の
 *  比較対象になる。 */
export async function fetchLatestPersonalKrReviewDraft(
  personalKrId: string,
  month: string,
): Promise<PersonalKrReviewDraft | null> {
  const { data, error } = await supabase
    .from("personal_kr_review_drafts")
    .select("*")
    .eq("personal_kr_id", personalKrId)
    .eq("month", month)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PersonalKrReviewDraft | null;
}

/** AI生成の新しい下書きを履歴として1件追加する（UPDATEは行わない）。 */
export async function insertPersonalKrReviewDraft(draft: PersonalKrReviewDraft): Promise<void> {
  const { error } = await supabase.from("personal_kr_review_drafts").insert(draft);
  if (error) throw error;
}

/** 🔴 人の編集だけは直近行のedited_text/edited_atをUPDATEする（AI生成のinsertとは別経路）。 */
export async function updatePersonalKrReviewDraftEdit(
  id: string,
  editedText: string,
  editedAt: string,
): Promise<void> {
  const { error } = await supabase.from("personal_kr_review_drafts")
    .update({ edited_text: editedText, edited_at: editedAt })
    .eq("id", id);
  if (error) throw error;
}

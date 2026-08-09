// src/lib/supabase/quarterPlanStore.ts
//
// 【設計意図】
// クォーター計画（KrQuarterPlanPanel）の保存・取得。
// 2026-08-07（v3.38）に Phase 1（localStorage）から Supabase（kr_quarter_plans テーブル）へ
// 移行した。migrations/20260807c_add_kr_quarter_plans.sql・docs/dev/okr-redesign-plan.md §9 参照。
// インターフェース（QuarterPlan/ProposedTFの型・loadQuarterPlan/saveQuarterPlan/
// deleteQuarterPlanという名前）は変えず、実装のみを差し替えた。呼び出し側
// （KrQuarterPlanPanel.tsx）の変更は「同期→非同期になった」ことへの対応のみ。
//
// 【「保存」は常に1本のアクティブ計画を上書きする】
// (kr_id, quarter) につきアクティブ（is_deleted=false）な行は最大1件という制約をDB側
// （部分UNIQUE索引）で持つ。保存前に既存のアクティブ行を探し、あれば同じidを再利用して
// saveWithLock（楽観ロック）で更新、無ければ新しいidでINSERTする。これによりチーム内の
// 同時編集も他の全テーブルと同じ楽観ロックで検出できる（元のlocalStorage実装には無かった
// 安全性で、部署スコープ化した以上必要になったもの。migrationファイル冒頭コメント参照）。
//
// 【テーブルが無い環境でのエラー表示（CLAUDE.md Section 22）】
// このファイルはエラーを黒く握りつぶさない。テーブル未適用（マイグレ未適用）の環境では
// Supabaseから42P0x系のPostgrestErrorがそのまま呼び出し元に伝播する。呼び出し元
// （KrQuarterPlanPanel.tsx）は formatErrorForUser で表示する——「機能を静かに無効化する」
// のではなく「エラーとして分かるように見せる」という設計判断（Section 22の
// 「黙って無効化しない」の考え方に倣う）。

import { supabase } from "./client";
import { saveWithLock } from "./store";
import { LS_KEY } from "../localData/localStore";

// ===== 型定義（変更なし） =====

export interface ProposedTF {
  tempId: string;            // クライアント側管理用UUID（保存には不要）
  tf_number: number;
  action: "継続" | "変更" | "廃止" | "新設";
  name: string;
  objective: string;
  rationale: string;
  leader_suggestion: string | null;
  key_todos: string[];
  success_criteria: string;
  risk: string | null;
}

export interface QuarterPlan {
  id: string;
  kr_id: string;
  quarter: string;           // "2026-3Q"
  status: "draft" | "finalized";
  summary: string;
  tfs: ProposedTF[];
  overall_risk: string | null;
  saved_at: string;          // ISO string（kr_quarter_plans.updated_at）
}

// DBの生の行（saveWithLockが受け取る形。id/updated_atを含む）
interface QuarterPlanRow {
  id: string;
  kr_id: string;
  quarter: string;
  status: "draft" | "finalized";
  summary: string;
  tfs: ProposedTF[];
  overall_risk: string | null;
  is_deleted: boolean;
  updated_at: string;
  updated_by: string;
}

function rowToPlan(row: QuarterPlanRow): QuarterPlan {
  return {
    id: row.id,
    kr_id: row.kr_id,
    quarter: row.quarter,
    status: row.status,
    summary: row.summary,
    tfs: row.tfs,
    overall_risk: row.overall_risk,
    saved_at: row.updated_at,
  };
}

// ===== Supabase 操作 =====

async function fetchActiveRow(krId: string, quarter: string): Promise<QuarterPlanRow | null> {
  const { data, error } = await supabase
    .from("kr_quarter_plans")
    .select("*")
    .eq("kr_id", krId)
    .eq("quarter", quarter)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return (data as QuarterPlanRow | null) ?? null;
}

export async function loadQuarterPlan(krId: string, quarter: string): Promise<QuarterPlan | null> {
  const row = await fetchActiveRow(krId, quarter);
  return row ? rowToPlan(row) : null;
}

export async function saveQuarterPlan(
  plan: Omit<QuarterPlan, "id" | "saved_at">,
  updatedBy: string,
): Promise<QuarterPlan> {
  const existing = await fetchActiveRow(plan.kr_id, plan.quarter);
  const id = existing?.id ?? crypto.randomUUID();
  const row: QuarterPlanRow = {
    id,
    kr_id: plan.kr_id,
    quarter: plan.quarter,
    status: plan.status,
    summary: plan.summary,
    tfs: plan.tfs,
    overall_risk: plan.overall_risk,
    is_deleted: false,
    updated_at: existing?.updated_at ?? "",
    updated_by: updatedBy,
  };
  const newUpdatedAt = await saveWithLock("kr_quarter_plans", row, existing?.updated_at);
  return rowToPlan({ ...row, updated_at: newUpdatedAt });
}

export async function deleteQuarterPlan(krId: string, quarter: string, deletedBy: string): Promise<void> {
  const existing = await fetchActiveRow(krId, quarter);
  if (!existing) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("kr_quarter_plans")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now, updated_by: deletedBy })
    .eq("id", existing.id);
  if (error) throw error;
}

// ===== localStorage の旧データ（Phase 1）の一度だけの移行 =====
//
// 【localStorageに残っている既存データを黙って捨てない】
// Phase 1時代にこのブラウザで保存された下書きがある場合、Supabase移行後もそのまま
// localStorageには残り続ける（自動では消えない・自動では移行しない）。呼び出し側
// （KrQuarterPlanPanel.tsx）がこの2関数で「ローカルにこのKR・クォーターの下書きが
// 残っている」ことを検知し、明示的な操作（ボタン）でSupabaseへ移す、または
// このブラウザから消すかを人に選ばせる。自動移行にしない理由：他ブラウザ・他端末の
// 誰かが既にSupabase側に計画を保存している可能性があり、古いローカル下書きで無条件に
// 上書きすると実害があるため（Human in the loop）。

const legacyPlanKey = LS_KEY.quarterPlan;

/** Phase 1（localStorage）時代の下書きが、このブラウザに残っていれば返す。読み取りのみ。 */
export function loadLegacyLocalQuarterPlan(krId: string, quarter: string): QuarterPlan | null {
  try {
    const raw = localStorage.getItem(legacyPlanKey(krId, quarter));
    return raw ? (JSON.parse(raw) as QuarterPlan) : null;
  } catch {
    return null;
  }
}

/** 移行完了後（またはユーザーが「このブラウザから削除」を選んだ後）に呼ぶ。localStorageのみを消す。 */
export function clearLegacyLocalQuarterPlan(krId: string, quarter: string): void {
  localStorage.removeItem(legacyPlanKey(krId, quarter));
}

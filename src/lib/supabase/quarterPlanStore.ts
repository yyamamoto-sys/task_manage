// src/lib/supabase/quarterPlanStore.ts
//
// 【設計意図】
// クォーター計画の保存・取得。
// Phase 1: localStorageで実装（IT部門のSupabase承認後にDB移行予定）。
// Supabase移行時はこのファイルのみを差し替える。インターフェースは変えない。
//
// Supabase移行時のテーブル定義は:
//   docs/migrations/20260601_quarter_plans.sql を参照。

import { LS_KEY } from "../localData/localStore";

// ===== 型定義 =====

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
  saved_at: string;          // ISO string
}

// ===== localStorage キー =====

const planKey = LS_KEY.quarterPlan;

// ===== 操作関数 =====

export function loadQuarterPlan(krId: string, quarter: string): QuarterPlan | null {
  try {
    const raw = localStorage.getItem(planKey(krId, quarter));
    return raw ? (JSON.parse(raw) as QuarterPlan) : null;
  } catch {
    return null;
  }
}

export function saveQuarterPlan(
  plan: Omit<QuarterPlan, "id" | "saved_at">,
): QuarterPlan {
  const saved: QuarterPlan = {
    ...plan,
    id: crypto.randomUUID(),
    saved_at: new Date().toISOString(),
  };
  localStorage.setItem(planKey(plan.kr_id, plan.quarter), JSON.stringify(saved));
  return saved;
}

export function finalizeQuarterPlan(krId: string, quarter: string): QuarterPlan | null {
  const plan = loadQuarterPlan(krId, quarter);
  if (!plan) return null;
  const finalized: QuarterPlan = { ...plan, status: "finalized", saved_at: new Date().toISOString() };
  localStorage.setItem(planKey(krId, quarter), JSON.stringify(finalized));
  return finalized;
}

export function deleteQuarterPlan(krId: string, quarter: string): void {
  localStorage.removeItem(planKey(krId, quarter));
}

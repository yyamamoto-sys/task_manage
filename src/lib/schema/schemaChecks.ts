// src/lib/schema/schemaChecks.ts
//
// 【設計意図】
// マイグレーション適用漏れを起動時に検知する仕組みの「検査項目の一覧」。
// 2026-08-06、v2.74（20260721_add_task_status_hold_cancelled.sql）が本番に未適用のまま
// 約2週間気づかれず、「保留」「中止」ステータスの保存が全経路で失敗し続けた事故を受けて
// 新設した（CLAUDE.md Section 22参照）。
//
// 【なぜSQL側に検査内容をハードコードしないか】
// 検査項目をマイグレーションSQLの中に埋め込むと、項目を追加するたびに新しい
// マイグレーションが必要になり、この仕組み自体が形骸化する。ここ（TS側の配列）に
// 1行足すだけで新しい検査項目を追加できるようにする。実際のDBへの問い合わせは
// checkSchemaHealth.ts が汎用RPC（check_schema_health）にこの配列をそのまま渡して行う。
//
// 【運用ルール】新しいマイグレーションを追加したら、このファイルに検査項目を1行足す
// （CLAUDE.md Section 22のグランドルール）。「静かに壊れると困るもの」を優先して入れる
// ——これは全マイグレーションの網羅を目的にしていない。

export type SchemaCheckKind = "table" | "column" | "check_contains" | "function";

interface SchemaCheckCommon {
  /** RPC往復でこの項目を一意に識別するID。SCHEMA_HEALTH_CHECKS内で重複禁止。 */
  id: string;
  /** 管理者向け警告バナーに表示する日本語ラベル（何が欠けているか）。 */
  label: string;
  /** この項目を満たすはずのマイグレーションファイル名（supabase/migrations/ 配下）。
   *  実在することを __tests__/schemaChecks.test.ts が機械的に検証する。 */
  migration: string;
}

export type SchemaCheckDescriptor =
  | (SchemaCheckCommon & { kind: "table"; table: string })
  | (SchemaCheckCommon & { kind: "column"; table: string; column: string })
  | (SchemaCheckCommon & { kind: "check_contains"; table: string; needle: string })
  | (SchemaCheckCommon & { kind: "function"; name: string });

/**
 * 【初期投入】2026-08-06の監査対象になった項目。これで全マイグレーションを網羅する
 * 意味ではなく、「静かに壊れると困る」ものを優先して入れている。
 */
export const SCHEMA_HEALTH_CHECKS: SchemaCheckDescriptor[] = [
  {
    id: "task_dependencies_table",
    kind: "table",
    table: "task_dependencies",
    label: "タスク依存関係（先行/後続）テーブルが見つかりません",
    migration: "20260717_add_task_dependencies.sql",
  },
  {
    id: "tasks_baseline_start_date_column",
    kind: "column",
    table: "tasks",
    column: "baseline_start_date",
    label: "タスクのベースライン開始日列が見つかりません",
    migration: "20260717b_add_task_baseline.sql",
  },
  {
    id: "tasks_baseline_due_date_column",
    kind: "column",
    table: "tasks",
    column: "baseline_due_date",
    label: "タスクのベースライン期日列が見つかりません",
    migration: "20260717b_add_task_baseline.sql",
  },
  {
    id: "tasks_status_check_on_hold",
    kind: "check_contains",
    table: "tasks",
    needle: "on_hold",
    label: "タスクステータスのCHECK制約に「保留(on_hold)」が含まれていません（2026-08-06の実際の事故）",
    migration: "20260721_add_task_status_hold_cancelled.sql",
  },
  {
    id: "tasks_status_check_cancelled",
    kind: "check_contains",
    table: "tasks",
    needle: "cancelled",
    label: "タスクステータスのCHECK制約に「中止(cancelled)」が含まれていません",
    migration: "20260721_add_task_status_hold_cancelled.sql",
  },
  {
    id: "fn_is_system_bootstrapped",
    kind: "function",
    name: "is_system_bootstrapped",
    label: "初回セットアップ判定関数（is_system_bootstrapped）が見つかりません",
    migration: "20260722_add_onboarding_bootstrap.sql",
  },
  {
    id: "fn_bootstrap_first_group_and_member",
    kind: "function",
    name: "bootstrap_first_group_and_member",
    label: "初回セットアップ実行関数（bootstrap_first_group_and_member）が見つかりません",
    migration: "20260722_add_onboarding_bootstrap.sql",
  },
  {
    id: "members_group_ids_column",
    kind: "column",
    table: "members",
    column: "group_ids",
    label: "メンバーの複数部署アクセス列（group_ids）が見つかりません",
    migration: "20260722b_add_multi_department_access.sql",
  },
  {
    id: "projects_group_ids_column",
    kind: "column",
    table: "projects",
    column: "group_ids",
    label: "プロジェクトの複数部署アクセス列（group_ids）が見つかりません",
    migration: "20260722b_add_multi_department_access.sql",
  },
  {
    id: "tasks_group_ids_column",
    kind: "column",
    table: "tasks",
    column: "group_ids",
    label: "タスクの複数部署アクセス列（group_ids）が見つかりません",
    migration: "20260722b_add_multi_department_access.sql",
  },
  {
    id: "objectives_group_id_column",
    kind: "column",
    table: "objectives",
    column: "group_id",
    label: "Objectiveの部署列（group_id）が見つかりません",
    migration: "20260723b_add_objective_group_id.sql",
  },
  {
    id: "key_results_group_id_column",
    kind: "column",
    table: "key_results",
    column: "group_id",
    label: "KRの部署列（group_id）が見つかりません",
    migration: "20260724_scope_okr_core_tables.sql",
  },
  {
    id: "loading_tips_table",
    kind: "table",
    table: "loading_tips",
    label: "ローディングのヒントテーブル（loading_tips）が見つかりません",
    migration: "20260727_add_loading_tips.sql",
  },
  {
    id: "member_widget_layouts_table",
    kind: "table",
    table: "member_widget_layouts",
    label: "マイページのウィジェットレイアウトテーブル（member_widget_layouts）が見つかりません",
    migration: "20260727b_add_member_widget_layouts.sql",
  },
  {
    id: "ai_usage_logs_is_guest_column",
    kind: "column",
    table: "ai_usage_logs",
    column: "is_guest",
    label: "AI使用量ログのゲスト印列（is_guest）が見つかりません",
    migration: "20260807_add_guest_ai_quota.sql",
  },
  {
    id: "guest_ai_usage_daily_table",
    kind: "table",
    table: "guest_ai_usage_daily",
    label: "ゲストAI利用回数（ブラウザ別）テーブルが見つかりません",
    migration: "20260807_add_guest_ai_quota.sql",
  },
  {
    id: "guest_ai_usage_global_daily_table",
    kind: "table",
    table: "guest_ai_usage_global_daily",
    label: "ゲストAI利用回数（全体）テーブルが見つかりません",
    migration: "20260807_add_guest_ai_quota.sql",
  },
  {
    id: "fn_consume_guest_ai_quota",
    kind: "function",
    name: "consume_guest_ai_quota",
    label: "ゲストAI利用回数の原子的カウントアップ関数（consume_guest_ai_quota）が見つかりません",
    migration: "20260807_add_guest_ai_quota.sql",
  },
  {
    id: "personal_krs_table",
    kind: "table",
    table: "personal_krs",
    label: "個人OKR：個人四半期KRテーブル（personal_krs）が見つかりません",
    migration: "20260807b_add_personal_okr.sql",
  },
  {
    id: "personal_kr_months_table",
    kind: "table",
    table: "personal_kr_months",
    label: "個人OKR：個人月次計画テーブル（personal_kr_months）が見つかりません",
    migration: "20260807b_add_personal_okr.sql",
  },
  {
    id: "personal_kr_weeks_table",
    kind: "table",
    table: "personal_kr_weeks",
    label: "個人OKR：週の目標状態テーブル（personal_kr_weeks）が見つかりません",
    migration: "20260807b_add_personal_okr.sql",
  },
  {
    id: "personal_kr_week_tasks_table",
    kind: "table",
    table: "personal_kr_week_tasks",
    label: "個人OKR：週とタスクの紐づけテーブル（personal_kr_week_tasks）が見つかりません",
    migration: "20260807b_add_personal_okr.sql",
  },
  {
    id: "personal_kr_memos_table",
    kind: "table",
    table: "personal_kr_memos",
    label: "個人OKR：KRごとのメモテーブル（personal_kr_memos）が見つかりません",
    migration: "20260807b_add_personal_okr.sql",
  },
  {
    id: "personal_kr_outlooks_table",
    kind: "table",
    table: "personal_kr_outlooks",
    label: "個人OKR：AI解析の結果とキャッシュテーブル（personal_kr_outlooks）が見つかりません",
    migration: "20260811_add_personal_kr_outlooks.sql",
  },
  {
    id: "kr_quarter_plans_table",
    kind: "table",
    table: "kr_quarter_plans",
    label: "クォーター計画テーブル（kr_quarter_plans）が見つかりません",
    migration: "20260807c_add_kr_quarter_plans.sql",
  },
  {
    id: "groups_is_invite_group_column",
    kind: "column",
    table: "groups",
    column: "is_invite_group",
    label: "プロジェクト招待：部署の招待用フラグ列（groups.is_invite_group）が見つかりません",
    migration: "20260810_add_project_invites.sql",
  },
  {
    id: "project_invites_table",
    kind: "table",
    table: "project_invites",
    label: "プロジェクト招待テーブル（project_invites）が見つかりません",
    migration: "20260810_add_project_invites.sql",
  },
  {
    id: "fn_create_project_invite",
    kind: "function",
    name: "create_project_invite",
    label: "プロジェクト招待：発行関数（create_project_invite）が見つかりません",
    migration: "20260810_add_project_invites.sql",
  },
  {
    id: "fn_accept_project_invite",
    kind: "function",
    name: "accept_project_invite",
    label: "プロジェクト招待：受諾関数（accept_project_invite）が見つかりません",
    migration: "20260810_add_project_invites.sql",
  },
  {
    id: "fn_revoke_project_invite",
    kind: "function",
    name: "revoke_project_invite",
    label: "プロジェクト招待：取り消し関数（revoke_project_invite）が見つかりません",
    migration: "20260810b_add_revoke_project_invite.sql",
  },
  {
    id: "fn_visible_invite_group_ids",
    kind: "function",
    name: "visible_invite_group_ids",
    label: "プロジェクト招待：招待された人の可視性拡張関数（visible_invite_group_ids）が見つかりません",
    migration: "20260810c_extend_members_visibility_for_invites.sql",
  },
  // 【2026-08-18・v3.75】20260818_harden_invite_related_rls.sql で新設した3関数。
  // 🔴 guard_member_privilege_columns（本文だけ差し替え）はここに追加しない
  // （kind:"function"はpg_procに同名関数が存在するかしか見ないため、本文差し替え系の
  // 適用漏れは検知できない。CLAUDE.md Section 33参照）。
  {
    id: "fn_verify_project_group_ids",
    kind: "function",
    name: "verify_project_group_ids",
    label: "プロジェクト招待：projects.group_idsのガードトリガー関数（verify_project_group_ids）が見つかりません",
    migration: "20260818_harden_invite_related_rls.sql",
  },
  {
    id: "fn_project_normal_group_ids",
    kind: "function",
    name: "project_normal_group_ids",
    label: "プロジェクト招待：招待用部署を除いたPJの通常部署を返す関数（project_normal_group_ids）が見つかりません",
    migration: "20260818_harden_invite_related_rls.sql",
  },
  {
    id: "fn_visible_project_member_ids",
    kind: "function",
    name: "visible_project_member_ids",
    label: "プロジェクト招待：招待受諾者からPJ参加者全員を見せる可視性拡張関数（visible_project_member_ids）が見つかりません",
    migration: "20260818_harden_invite_related_rls.sql",
  },
];

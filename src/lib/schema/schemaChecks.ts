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
];

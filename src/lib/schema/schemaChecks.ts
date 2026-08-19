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

export type SchemaCheckKind =
  | "table"
  | "column"
  | "check_contains"
  | "function"
  | "function_body_contains"
  | "column_type";

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
  | (SchemaCheckCommon & { kind: "function"; name: string })
  // 【2026-08-19・v3.80で追加】関数の名前・引数を変えず本文（中身）だけを差し替える
  // マイグレーション向け。kind:"function" は pg_proc に同名関数が存在するかしか見ないため、
  // この種のマイグレーションは未適用でも「存在する」と判定され続けてしまう（CLAUDE.md
  // Section 22・25 Phase 5・33参照）。needle には pg_get_functiondef() で取得する関数定義
  // 全文（本文を含む）に対して position() で部分一致検査を行う（LIKEではないため
  // needle内の"_"等はワイルドカードとして解釈されない）。
  | (SchemaCheckCommon & { kind: "function_body_contains"; name: string; needle: string })
  // 【2026-08-19・v3.80で追加】列は存在するが宣言と実際の型がずれている事故
  // （2026-08-18、projects.owner_member_idsの実DBがuuid[]のまま宣言のtext[]からずれて
  // いたためv3.75の適用が2回失敗した）向け。udtには`information_schema.columns.udt_name`
  // の内部表記（配列型は"_text"／"_uuid"のように先頭にアンダースコアが付く）を渡す。
  | (SchemaCheckCommon & { kind: "column_type"; table: string; column: string; udt: string });

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
  // 【2026-08-19・v3.80】本文差し替え型マイグレーションの検知（kind:"function_body_contains"）。
  // 20260806_add_schema_health_check.sql（check_schema_health本体）は
  // 20260819_add_schema_health_function_body_check.sql で新kindに対応済み。
  {
    // accept_project_invite() の既存メンバー分岐（Section 25 Phase 5）で新設された
    // 冪等性ガード。「既にこの招待用部署をgroup_idsに持っていれば何もしない」という
    // このマイグレーションの核心（招待の2回目受諾を安全にする）そのものであり、
    // 挙動を変えずにリファクタしても消えない（消せばSection 25 Phase 5の冪等性要件が
    // 壊れる）。変数名・コメント文言は使わず、実行される式そのものを目印にした。
    id: "accept_project_invite_existing_member_branch",
    kind: "function_body_contains",
    name: "accept_project_invite",
    needle: "v_invite.invite_group_id = ANY(COALESCE(v_existing_group_ids, '{}'::text[]))",
    label: "プロジェクト招待：既存メンバーが招待を受諾したときの兼務付与（accept_project_invite内）が適用されていません",
    migration: "20260812_accept_invite_for_existing_member.sql",
  },
  {
    // guard_member_privilege_columns() のフェーズ4（email＝ログイン中の利用者とmembers行を
    // 結びつける同一性判定キーの保護。Section 33）。「NEW.email := old_email」という差し戻し
    // 自体がこの保護の実効部分で、これが無いと他人の行のemailを書き換えてなりすませる穴が
    // 残る。同名の代入式は関数内の他の場所には出現しない（is_admin/group_id等は別の変数名）
    // ため、将来この関数がリファクタされても、この保護ロジック自体を消さない限り生き残る。
    id: "guard_member_privilege_columns_email_protection",
    kind: "function_body_contains",
    name: "guard_member_privilege_columns",
    needle: "NEW.email := old_email;",
    label: "権限昇格ガード：members.emailの保護（guard_member_privilege_columns内）が適用されていません",
    migration: "20260818_harden_invite_related_rls.sql",
  },
  // 【2026-08-19・v3.80】列の型そのものが宣言とずれる事故の再発防止（kind:"column_type"）。
  // 2026-08-18、projects.owner_member_idsの実DBがuuid[]のままだった（宣言は最初から
  // text[]）ことが原因でv3.75の適用が「UNION types text and uuid cannot be matched」で
  // 2回失敗した。kind:"column"（列の存在有無）ではこの種の「列はあるが型が違う」を
  // 検知できないため、visible_project_member_ids()がUNIONする3列全てをtext[]（udt_name
  // では配列の内部表記"_text"）で登録する（1列だけ守っても次に別の列が同じ理由で
  // ずれたら同じ事故が起きるため）。
  {
    id: "projects_owner_member_ids_type_text_array",
    kind: "column_type",
    table: "projects",
    column: "owner_member_ids",
    udt: "_text",
    label: "プロジェクトの複数オーナー列（projects.owner_member_ids）の型がtext[]ではありません",
    migration: "20260819b_fix_owner_member_ids_type.sql",
  },
  {
    id: "projects_member_ids_type_text_array",
    kind: "column_type",
    table: "projects",
    column: "member_ids",
    udt: "_text",
    label: "プロジェクトの関与者列（projects.member_ids）の型がtext[]ではありません",
    migration: "20260515_add_project_member_ids.sql",
  },
  {
    id: "tasks_assignee_member_ids_type_text_array",
    kind: "column_type",
    table: "tasks",
    column: "assignee_member_ids",
    udt: "_text",
    label: "タスクの複数担当者列（tasks.assignee_member_ids）の型がtext[]ではありません",
    migration: "20260420_add_task_assignee_member_ids.sql",
  },
  // 【2026-08-19・v3.81】visible_project_member_ids()の本文差し替え（性能改善。
  // CLAUDE.md Section 33のfn_visible_project_member_ids（kind:"function"）は関数の
  // 存在有無しか見ないため、20260818時点の重い実装のまま残っていても検知できない。
  // 【needle選定・統括レビューで訂正】当初は`JOIN accessible_projects ap ON ap.id = t.project_id`
  // を選んでいたが、統括の指摘どおりエイリアス名（ap）を変えるだけのリファクタで
  // 検知が壊れる脆さがあった。`accessible_projects AS MATERIALIZED`に選び直した。
  // 単なる命名ではなく、この最適化の**性能特性そのもの**を担う構文
  // （PostgreSQLの「非再帰CTEは参照が1回だけかつvolatile関数を含まなければ既定で
  // インライン展開する」という挙動を明示的に禁止するディレクティブ。これが無いと
  // ctx/accessible_projectsが展開され、v3.80で実測・確定した「行ごとに関数が
  // 再評価される」問題が関数内部で再発する）であり、これが消える＝再検証が必要な
  // 変更、という対応が取れる。旧実装（20260818時点）にはCTE自体が存在しないため
  // この文字列は登場しない。
  {
    id: "visible_project_member_ids_optimized_body",
    kind: "function_body_contains",
    name: "visible_project_member_ids",
    needle: "accessible_projects AS MATERIALIZED",
    label: "プロジェクト招待：visible_project_member_ids()の性能改善（走査回数の削減）が適用されていません",
    migration: "20260819d_optimize_visible_project_member_ids.sql",
  },
];

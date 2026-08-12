// src/lib/localData/localStore.ts
//
// 【設計意図】
// localStorage キーをこのファイルに一元化する。
// - 静的キー: KEYS 定数
// - エンティティID毎の動的キー: LS_KEY ビルダー
// - 構造変更に備えてスキーマバージョン管理（migrateLocalStorage）を持つ
//
// データの読み書きは AppDataContext → Supabase を経由する。
// 例外的に localStorage を直接使うのは「デバイスごとの UI 設定」「ログイン補助」のみ。

/**
 * 論理削除されていない要素のみを返すヘルパー。
 * 各コンポーネントで `.filter(x => !x.is_deleted)` を書き散らすと、
 * 仕様変更（例：削除条件の追加）に追従漏れが必ず出るため一箇所に集約する。
 *
 * 通常は AppDataContext がサーバ側でフィルタ済みだが、楽観的更新中の
 * setState 直後など「is_deleted=true の行が一時的に手元にある」場面で
 * UI から確実に外すために使う。
 */
export function active<T extends { is_deleted?: boolean }>(items: T[] | null | undefined): T[] {
  if (!items) return [];
  return items.filter(x => !x.is_deleted);
}

// ===== 静的キー定義 =====

const KEYS = {
  // 認証・セットアップ
  WIZARD_COMPLETED:    "wizard_completed",
  CURRENT_USER:        "current_user",
  // テーマ
  THEME:               "theme",
  // 言語（i18n）
  LANG:                "lang",
  /** EN切替時の「英語UIは一部の画面のみ対応」吹き出しを表示済みか（一度見せたら以後出さない） */
  LANG_PARTIAL_NOTICE_SEEN: "lang_partial_notice_seen",
  // メインレイアウト
  VIEW_MODE:           "plan_app_view",
  APP_MODE:            "plan_app_mode",
  SIDEBAR_COLLAPSED:   "sidebar_collapsed",
  CONSULT_PANEL_WIDTH: "consultation_panel_width",
  /** AI相談パネルの「次の相談候補」折りたたみ開閉状態 */
  CONSULT_FOLLOWUP_OPEN: "consult_followup_open",
  /** OKR個人ビューのAIパネル（PersonalOkrAiPanel。ConsultationPanelと同じ型）の幅（v3.52） */
  OKR_AI_PANEL_WIDTH: "okr_ai_panel_width",
  OKR_ACTIVE_TOOL:     "okr_active_tool",
  /**
   * OKRモードの初回ゲート（紹介ポップアップ＋データ読み込みの承認。v3.39）を
   * 承認済みか（"1"）。承認して記憶＝Human in the loop パターン③。
   * chunkSizeGate.ts の「承認して記憶」はコードチャンクのDLを対象にするのに対し、
   * このキーはOKRモード専用データのフェッチを対象にする（別のゲート・別のキー）。
   */
  OKR_MODE_INTRO_APPROVED: "okr_mode_intro_approved",
  /** サイドバーで「自分が参加しているPJのみ表示」の状態 */
  SIDEBAR_MY_PROJECTS_ONLY: "sidebar_my_projects_only",
  /** サイドバーで「完了・アーカイブ済みPJも表示」の状態（既定OFF。v3.50・2026-08-11）。
   *  v3.49の「アーカイブ済みPJも表示」（sidebar_show_archived_projects）を置き換え。
   *  v3.49はリリース当日中の是正のため実使用者はいない想定で、旧キーからの値の引き継ぎは
   *  行わない（新キー名で改めて既定OFFから始まる。CLAUDE.md Section 4参照）。 */
  SIDEBAR_SHOW_COMPLETED_ARCHIVED: "sidebar_show_completed_archived_projects",
  /** サイドバーの「プロジェクト」「OKRタスク」セクションの開閉状態。
   *  SIDEBAR_OKR_OPEN：v3.54で「OKRタスク」セクション自体の描画を停止した（山本さんの指示。
   *  復帰手順は src/components/layout/ARCHIVED.md 参照）。キー自体・保存値は削除しない
   *  （描画経路を切るだけの方式のため）。 */
  SIDEBAR_PJ_OPEN:     "sidebar_pj_open",
  SIDEBAR_OKR_OPEN:    "sidebar_okr_open",
  // 管理画面
  ADMIN_LAST_TAB:      "admin_last_tab",
  ADMIN_FONT_SIZE:     "admin_font_size",
  // ガント
  GANTT_CENTER_DATE:   "gantt_center_date",
  GANTT_ZOOM:          "gantt_zoom",
  GANTT_SORT:          "gantt_sort",
  GANTT_LABEL_WIDTH:   "gantt_label_width",
  GANTT_SHOW_DEPS:     "gantt_show_deps",
  GANTT_SHOW_BASELINE: "gantt_show_baseline",
  GANTT_HIDE_DONE:     "gantt_hide_done",
  GANTT_SHOW_CRITICAL: "gantt_show_critical",
  GANTT_SHOW_OVERLOAD: "gantt_show_overload",
  // リスト
  LIST_VIEW_SETTINGS:  "list_view_settings",
  // ダッシュボード
  REMINDER_DAYS:       "reminder_days",
  STAGNANT_DAYS:       "stagnant_days_threshold",
  // カレンダー（ラボ機能）
  /** 月／週の表示モード切替（刷新第2弾④） */
  CAL_VIEW_MODE:       "cal_view_mode",
  /** 週末（土日）セルを淡くするトグル（刷新第2弾⑥・既定OFF） */
  CAL_DIM_WEEKENDS:    "cal_dim_weekends",
  // ローディング画面のヒント
  /**
   * DB（loading_tips）から取得したヒントのキャッシュ。
   * ローディング画面は「DBを読んでいる最中」に出るためDBの値が間に合わない。
   * 前回起動時にキャッシュした内容を表示に使う（無ければ組み込みの既定値）。
   */
  LOADING_TIPS_CACHE:  "loading_tips_cache",
  // エラー履歴
  ERROR_HISTORY:       "app:error_history",
  // ゲスト（サンプル閲覧）のAI利用回数の表示専用カウンタ（v3.31・詳細はguestAiQuotaCounter.ts）
  GUEST_AI_USAGE_TODAY: "guest_ai_usage_today",
  // スキーマバージョン管理（内部用）
  SCHEMA_VERSION:      "app:ls_schema_version",
  /**
   * プロジェクト招待：メール確認が完了するまでの間、この端末に一時保持する保留中の招待
   * （src/lib/projectInvite/pendingInvite.ts）。signUp()直後（メール確認要否に関わらず）に
   * 保存し、accept_project_invite()の呼び出しに成功したら必ず消す。パスワードは含めない。
   */
  PENDING_PROJECT_INVITE: "pending_project_invite",
} as const;

// ===== エンティティ ID 毎の動的キービルダー =====
//
// 命名規則: keyName(args...) で string を返す
// 既存ストアの値を壊さないため、過去に使われていたフォーマットをそのまま継承する。
// 構造変更時は migrateLocalStorage で旧キーをクリーンアップする。

export const LS_KEY = {
  /** AI 相談履歴（ユーザーごとに保存） */
  consultationHistory: (userId: string) => `consultation_history_v1_${userId}`,
  /** KR なぜなぜサマリ（KR ごとに保存） */
  krWhySummary:        (krId: string) => `okr_why_${krId}`,
  /** クォーター計画（KR × クォーター ごとに保存）。
   *  【2026-08-07】Supabase（kr_quarter_plans）へ移行済み（v3.38）。このキーは
   *  Phase 1時代の旧データをこのブラウザから一度だけ読み取り・移行するためだけに残す
   *  （quarterPlanStore.ts の loadLegacyLocalQuarterPlan/clearLegacyLocalQuarterPlan）。
   *  新しい保存はこのキーに対して行わない。 */
  quarterPlan:         (krId: string, quarter: string) => `okr_qplan_${krId}_${quarter}`,
  /** 期限のブラウザ通知：当日に通知済みのタスクID（ユーザーごと・二重通知防止） */
  deadlineNotified:    (userId: string) => `deadline_notified_v1_${userId}`,
  /**
   * 閾値超えチャンクのダウンロード確認「承認して記憶」フラグ（チャンク名ごと）。
   * 保存するのは真偽値のみ（データ本体は保存しない）。lib/chunkSizeGate.ts 参照（v3.19）。
   */
  chunkDownloadApproved: (chunkName: string) => `chunk_dl_approved_${chunkName}`,
} as const;

export { KEYS };

// ===== スキーマバージョン管理 =====

/**
 * 現在のスキーマバージョン。
 * localStorage に保存するデータ構造を破壊的に変更する時にインクリメントする。
 */
const CURRENT_SCHEMA_VERSION = "1";

/**
 * 【設計意図】
 * アプリ起動時に呼び出し、保存済みバージョンと現行バージョンを比較する。
 * 不一致なら migrate-* 関数を順次走らせて旧キーを除去・新形式に変換する。
 *
 * バージョンを上げる時の追加方法:
 *   1. CURRENT_SCHEMA_VERSION を新しい値に変更
 *   2. 下の switch に旧バージョンからの遷移処理を追加
 *   3. removeKeysByPrefix 等で不要キーを削除する
 */
export function migrateLocalStorage(): void {
  try {
    const stored = localStorage.getItem(KEYS.SCHEMA_VERSION);
    if (stored === CURRENT_SCHEMA_VERSION) return;

    // 初回起動 or 旧バージョンからの移行
    // 将来のマイグレーション例:
    //   if (stored === null || stored === "0") {
    //     // v0 → v1: 旧キー "list_settings" を "list_view_settings" にリネーム
    //     const old = localStorage.getItem("list_settings");
    //     if (old) { localStorage.setItem(KEYS.LIST_VIEW_SETTINGS, old); localStorage.removeItem("list_settings"); }
    //   }

    localStorage.setItem(KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  } catch {
    // localStorage 利用不可 / 容量不足は無視（機能継続）
  }
}

// ===== 前回ユーザーの記憶 =====

export function getCurrentUser(): { id: string } | null {
  const id = localStorage.getItem(KEYS.CURRENT_USER);
  return id ? { id } : null;
}

export function setCurrentUser(memberId: string): void {
  localStorage.setItem(KEYS.CURRENT_USER, memberId);
}

export function clearCurrentUser(): void {
  localStorage.removeItem(KEYS.CURRENT_USER);
}

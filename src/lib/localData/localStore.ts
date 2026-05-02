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
  // メインレイアウト
  VIEW_MODE:           "plan_app_view",
  APP_MODE:            "plan_app_mode",
  SIDEBAR_COLLAPSED:   "sidebar_collapsed",
  CONSULT_PANEL_WIDTH: "consultation_panel_width",
  OKR_ACTIVE_TOOL:     "okr_active_tool",
  /** サイドバーで「自分が参加しているPJのみ表示」の状態 */
  SIDEBAR_MY_PROJECTS_ONLY: "sidebar_my_projects_only",
  // 管理画面
  ADMIN_LAST_TAB:      "admin_last_tab",
  ADMIN_FONT_SIZE:     "admin_font_size",
  // ガント
  GANTT_CENTER_DATE:   "gantt_center_date",
  GANTT_ZOOM:          "gantt_zoom",
  GANTT_SORT:          "gantt_sort",
  GANTT_LABEL_WIDTH:   "gantt_label_width",
  // リスト
  LIST_VIEW_SETTINGS:  "list_view_settings",
  // ダッシュボード
  REMINDER_DAYS:       "reminder_days",
  STAGNANT_DAYS:       "stagnant_days_threshold",
  // エラー履歴
  ERROR_HISTORY:       "app:error_history",
  // スキーマバージョン管理（内部用）
  SCHEMA_VERSION:      "app:ls_schema_version",
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
  /** KR レポート（KR × モード ごとに保存） */
  krReport:            (krId: string, mode: string) => `okr_report_${krId}_${mode}`,
  /** クォーター計画（KR × クォーター ごとに保存。Phase 1 用 localStorage） */
  quarterPlan:         (krId: string, quarter: string) => `okr_qplan_${krId}_${quarter}`,
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

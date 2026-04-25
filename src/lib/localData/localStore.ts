// src/lib/localData/localStore.ts
//
// 【設計意図】
// Supabase移行済みのため、このファイルは最小限の役割のみ持つ。
//
// 残している理由：
// - KEYS.WIZARD_COMPLETED: セットアップ完了フラグ（デバイスごとの設定なのでlocalStorageが適切）
// - getCurrentUser / setCurrentUser: 前回ログインユーザーのID記憶（利便性のため）
//
// データの読み書きはすべて AppDataContext → Supabase を経由すること。

// ===== キー定義 =====

const KEYS = {
  // 認証・セットアップ
  WIZARD_COMPLETED: "wizard_completed",
  CURRENT_USER:     "current_user",
  // テーマ
  THEME:            "theme",
  // 管理画面
  ADMIN_LAST_TAB:   "admin_last_tab",
  ADMIN_FONT_SIZE:  "admin_font_size",
  // ガント
  GANTT_CENTER_DATE: "gantt_center_date",
  // リスト
  LIST_VIEW_SETTINGS: "list_view_settings",
  // ダッシュボード
  REMINDER_DAYS:    "reminder_days",
  // エラー履歴
  ERROR_HISTORY:    "app:error_history",
} as const;

export { KEYS };

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

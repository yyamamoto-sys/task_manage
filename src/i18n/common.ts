// src/i18n/common.ts
//
// 【設計意図】
// 複数モジュールで共通に使う文言（アプリ名・汎用ボタン等）の辞書。
// モジュール固有の文言は各モジュールの辞書ファイル（例：src/i18n/auth.ts）に置く。

export const commonJa = {
  "common.app.name": "グループ計画管理",
  "common.button.cancel": "キャンセル",
  "common.button.save": "保存",
  "common.button.close": "閉じる",
  "common.loading": "読み込み中...",
} as const;

export const commonEn: Record<keyof typeof commonJa, string> = {
  "common.app.name": "Group Plan Manager",
  "common.button.cancel": "Cancel",
  "common.button.save": "Save",
  "common.button.close": "Close",
  "common.loading": "Loading...",
};

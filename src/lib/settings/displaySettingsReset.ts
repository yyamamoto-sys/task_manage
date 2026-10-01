// src/lib/settings/displaySettingsReset.ts
//
// 【設計意図・v3.127】
// 設定ページ「困ったとき」の「表示の設定を初期化」で消す localStorage キーの一覧。
// 🔴 ホワイトリスト方式：消してよい「表示の好み」だけを列挙する。プレフィックス一致や
// 「KEYS 全部」のような消し方はしない（Supabase の認証トークン sb-*・AI相談履歴・
// 期限通知の二重防止・各種の承認記憶まで巻き込んで消す事故を防ぐため）。
// 新しい表示設定のキーを足したら、ここにも足すこと（CLAUDE.md Section 65）。
//
// テーマ（KEYS.THEME）と言語（KEYS.LANG）は意図的に残す：設定ページの「表示」で
// いつでも切り替えられ、表示崩れの原因にならない。英語で使っている人の言語を
// 初期化で日本語に戻すと、直後の画面が読めなくなるため。

import { KEYS } from "../localData/localStore";

export const DISPLAY_SETTING_KEYS: readonly string[] = [
  KEYS.SIDEBAR_COLLAPSED,
  KEYS.SIDEBAR_WIDTH,
  KEYS.SIDEBAR_PJ_OPEN,
  KEYS.SIDEBAR_OKR_OPEN,
  KEYS.SIDEBAR_MISC_OPEN,
  KEYS.SIDEBAR_MY_PROJECTS_ONLY,
  KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED,
  KEYS.CONSULT_PANEL_WIDTH,
  KEYS.CONSULT_FOLLOWUP_OPEN,
  KEYS.OKR_AI_PANEL_WIDTH,
  KEYS.TASK_SIDE_PANEL_WIDTH,
  KEYS.ADMIN_LAST_TAB,
  KEYS.ADMIN_FONT_SIZE,
  KEYS.GANTT_CENTER_DATE,
  KEYS.GANTT_ZOOM,
  KEYS.GANTT_SORT,
  KEYS.GANTT_LABEL_WIDTH,
  KEYS.GANTT_SHOW_DEPS,
  KEYS.GANTT_SHOW_BASELINE,
  KEYS.GANTT_HIDE_DONE,
  KEYS.GANTT_SHOW_CRITICAL,
  KEYS.GANTT_SHOW_OVERLOAD,
  KEYS.LIST_VIEW_SETTINGS,
  KEYS.REMINDER_DAYS,
  KEYS.STAGNANT_DAYS,
  KEYS.CAL_VIEW_MODE,
  KEYS.CAL_DIM_WEEKENDS,
];

/** 現在 localStorage にあるキーのうち、初期化で消す対象だけを返す（ホワイトリストとの積）。 */
export function selectDisplayKeysToRemove(existingKeys: readonly string[]): string[] {
  const allow = new Set(DISPLAY_SETTING_KEYS);
  return existingKeys.filter(k => allow.has(k));
}

export function resetDisplaySettings(storage: Storage): string[] {
  const existing: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) existing.push(k);
  }
  const targets = selectDisplayKeysToRemove(existing);
  for (const k of targets) storage.removeItem(k);
  return targets;
}

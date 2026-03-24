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
  WIZARD_COMPLETED: "wizard_completed",
  CURRENT_USER: "current_user", // 前回ログインしたmember_id
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

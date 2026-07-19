// src/lib/dangerZoneConfirm.ts
//
// 【設計意図】
// Danger Zone（common/DangerZone.tsx）の「対象名を再入力しないと削除ボタンが有効にならない」
// ガードの判定ロジック。UIから切り離した純粋関数にすることでユニットテスト可能にする。

/**
 * 入力文字列が対象名と完全一致するか判定する（前後の空白のみトリムして許容）。
 * 対象名が空文字の場合は常に不一致（ガードを無効化する用途では requireNameMatch 自体を渡さない）。
 */
export function isNameConfirmed(typed: string, expectedName: string): boolean {
  const expected = expectedName.trim();
  if (expected === "") return false;
  return typed.trim() === expected;
}

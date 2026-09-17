// src/lib/history/undoWarning.ts
//
// 【設計意図】
// Undo実行前の警告判定（CLAUDE.md Section 57「同じ項目がその後さらに変更されている
// 場合は警告してから実行する」）を純粋関数に切り出す。ChangeHistorySection.tsx から呼ぶ。

import type { EntityChangeLog } from "../localData/types";

/**
 * target（元に戻したい履歴エントリ）が記録しているフィールドのいずれかが、
 * target より後の時刻に変更された別のエントリで再び触られていれば true を返す。
 * diff が空（create等）のときは対象フィールドが無いため常に false。
 */
export function hasLaterConflictingChange(
  target: Pick<EntityChangeLog, "changed_at" | "diff">,
  allEntries: Pick<EntityChangeLog, "changed_at" | "diff">[],
): boolean {
  const fields = Object.keys(target.diff);
  if (fields.length === 0) return false;
  return allEntries.some(e => {
    if (e.changed_at <= target.changed_at) return false;
    return fields.some(f => f in e.diff);
  });
}

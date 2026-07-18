// src/lib/selectionRange.ts
// Shift+クリック範囲選択の純粋ロジック。ガント（GanttView）とリスト（ListView）の
// キーボード/修飾キー選択ショートカットで共有する（元はganttUtils.tsにあったロジックをここへ集約）。

/**
 * 表示順配列上でアンカー（直近クリック/選択した行・タスク）〜ターゲットの間のidを
 * 両端含めて返す（純粋関数）。アンカーが無い、またはどちらかが表示順配列に見当たらない
 * （フィルタ変更等で画面外になった）場合はターゲット単体を返す＝単一選択扱いにフォールバックする。
 */
export function computeRangeSelection(orderedIds: string[], anchorId: string | null, targetId: string): string[] {
  const anchorIdx = anchorId != null ? orderedIds.indexOf(anchorId) : -1;
  const targetIdx = orderedIds.indexOf(targetId);
  if (anchorIdx < 0 || targetIdx < 0) return [targetId];
  const [from, to] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
  return orderedIds.slice(from, to + 1);
}

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

/**
 * チェックボックスのクリック1回分の選択更新（純粋関数）。行クリックの Shift 範囲選択と同じ規則：
 * - Shift：アンカー〜クリック先を表示順で選択に「追加」する（アンカーが無ければクリック先をアンカーにする）
 * - Shift なし：toggle（呼び出し側が渡す、親子連動つきのトグル）で1件を切り替え、クリック先を新しいアンカーにする
 */
export function applyCheckboxClick(
  prev: Set<string>,
  orderedIds: string[],
  anchorId: string | null,
  targetId: string,
  shiftKey: boolean,
  toggle: (prev: Set<string>, id: string) => Set<string>,
): { next: Set<string>; anchor: string } {
  if (shiftKey) {
    const next = new Set(prev);
    computeRangeSelection(orderedIds, anchorId, targetId).forEach(id => next.add(id));
    return { next, anchor: anchorId ?? targetId };
  }
  return { next: toggle(prev, targetId), anchor: targetId };
}

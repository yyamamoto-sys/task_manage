import { confirmDialog } from "../dialog";

/**
 * 選択済みだが今は画面に見えていない（フィルタ・折りたたみ・PJ切替・完了を隠す・保留中止の非表示）タスクの
 * 件数（M77・M80）。一括操作はこれらも対象に含めるので、実行前の確認で件数を明示する。
 * visibleIds が無い（呼び出し側が表示範囲を渡さない）ときは 0＝従来どおり確認なし。
 */
export function countHiddenTargets(targetIds: Iterable<string>, visibleIds: readonly string[] | undefined): number {
  if (!visibleIds) return 0;
  const visible = new Set(visibleIds);
  let n = 0;
  for (const id of targetIds) if (!visible.has(id)) n++;
  return n;
}

export function hiddenIncludedNote(hidden: number): string {
  return `うち、今は表示されていない ${hidden} 件も含みます。`;
}

/** 確認文に見えない件数の注記を足す（0件なら文面は変えない） */
export function withHiddenNote(message: string, hidden: number): string {
  return hidden > 0 ? `${message}\n${hiddenIncludedNote(hidden)}` : message;
}

/** 見えない対象を含むときだけ実行前の確認を出す。0件なら確認なしで true（従来どおり） */
export async function confirmHiddenIncluded(message: string, hidden: number): Promise<boolean> {
  if (hidden <= 0) return true;
  return confirmDialog(withHiddenNote(message, hidden), { tone: "neutral", confirmLabel: "実行する" });
}

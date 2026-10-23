import { showToast } from "../../components/common/Toast";

/** 「元に戻す」やドラッグ確定の保存群を待つ。失敗は saveTask 側がトーストで知らせ済みなので、
 *  ここでは個別に出さず（二重表示を避ける）、例外も伝えない（未処理の Promise 拒否を残さない）。
 *  failureMessage を渡したときだけ、失敗があれば件数入りで1回だけ知らせる。 */
export async function settleSaves(promises: Promise<unknown>[], failureMessage?: (failed: number) => string): Promise<number> {
  const results = await Promise.allSettled(promises);
  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0 && failureMessage) showToast(failureMessage(failed), "error");
  return failed;
}

export const undoFailureMessage = (failed: number): string => `${failed}件は元に戻せませんでした`;

/** まとめて操作の「元に戻す」用。失敗があれば「N件は元に戻せませんでした」を1回だけ出す */
export function settleUndoSaves(promises: Promise<unknown>[]): Promise<number> {
  return settleSaves(promises, undoFailureMessage);
}

/** ガントのバーのドラッグ確定など単発の保存用。失敗の表示は saveTask に任せ、拒否だけ握る */
export async function settleSingleSave(promise: Promise<unknown>): Promise<void> {
  await settleSaves([promise]);
}

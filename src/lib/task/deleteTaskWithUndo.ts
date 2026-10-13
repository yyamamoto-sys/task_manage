import { useAppStore } from "../../stores/appStore";
import { showToast } from "../../components/common/Toast";

/** タスク1件の削除＋「元に戻す」トースト（Ctrl+Z も効く）。確認ダイアログは呼び出し側で出す。
 *  削除に失敗したら例外を伝え、トーストは出さない。 */
export async function deleteTaskWithUndo(taskId: string, taskName: string, userId: string): Promise<void> {
  const { deleteTask, restoreTask } = useAppStore.getState();
  await deleteTask(taskId, userId);
  showToast(`「${taskName}」を削除しました`, "info", {
    label: "元に戻す",
    isUndo: true,
    onClick: () => { restoreTask(taskId, userId); },
  });
}

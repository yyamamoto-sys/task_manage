# モジュール A（計画ビュー）：タスク編集・追加

> タスクの追加／編集／詳細パネル。2階層（親＝大タスク / 子＝小タスク）固定。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「A 計画ビュー」。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `TaskEditModal.tsx` | タスク編集（常時編集可・約600msデバウンスで自動保存） |
| `QuickAddTaskModal.tsx` | FAB/リストから素早く追加。`defaultProjectId`（選択中PJを初期値）・開始日/メモ・最上位作成時は**子タスク一括入力** |
| `TaskSidePanel.tsx` | リストの行選択で開くサイドパネル |

## 改修・バグ探しの注意点
- 保存は `appStore.saveTask`（→ `upsertTask` が `todo_ids`→`todo_id` 変換・楽観ロック）。
- 親子は `parent_task_id`（DB列・migration 20260527）。子は `project_id` を親に揃える・`display_order` で並ぶ。
- `assignee_member_ids`（複数担当）と互換の `assignee_member_id`（単数）の両方を持つ。表示は `lib/taskMeta.getAssigneeIds`。
- React Hooks順の罠：早期 `return null` を hooks より前に置かない（過去に画面真っ白の不具合）。

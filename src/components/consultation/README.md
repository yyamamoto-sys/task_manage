# モジュール B：AI相談（consultation）

> チャットでAIに相談し、提案カード→確認→**反映**でPJ/タスクを登録・変更する。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md) の「B AI相談」。

## 役割
- マルチターンのAI相談（5モード）。提案カードの表示・反映（apply）・Undo。
- PJ作成（add_project：複数ターンのヒアリング）／タスク階層化（add_task＋new_subtasks）。
- 相談履歴（localStorage・read-only表示）。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `ConsultationPanel.tsx` | 相談パネル本体。相談/会議の2モード切替・送信・履歴 |
| `ProposalCard.tsx` | 提案カード。`reflect`ボタン→`applyProposal` |
| `ConfirmationDialogModal.tsx` | date_change/assignee/add_task/add_project の確認・編集 |
| `SessionHistoryPanel.tsx` | 相談履歴（read-only。AI回答本文＋follow-upを表示） |
| `ChatHistory.tsx` / `FollowUpButtons.tsx` / `GanttPreviewPanel.tsx` | 会話表示 / 次候補 / ガントで比較（A計画ビューを再利用＝例外依存） |
| ロジック（`src/lib/ai/`） | `payloadBuilder` `systemPrompt` `responseParser` `proposalMapper` `applyProposal` `inferConsultationType` `sessionManager` `undoApply` `chatHistoryStorage` |
| 状態 | `src/hooks/useAIConsultation.ts`（唯一の呼び出し口）・`src/stores/consultSessionStore.ts`・`src/hooks/useUndoStack.ts` |

## 依存（下向き）
AI基盤（`invokeAI`/`apiClient`）・データ基盤（`appStore`/`supabase`）・共通UI。例外：A 計画ビュー（GanttPreview）。

## 改修・バグ探しの注意点
- **AIの挙動は `lib/ai/systemPrompt.ts` が正本**（プロンプト）。提案の型は `responseParser.ts`。
- **反映の実体は `lib/ai/applyProposal.ts`**。ここは `supabase` を直接 insert/update するため、
  **DBの実カラム名で書く**こと（例：`todo_id`〔単数〕。UI型の `todo_ids` を送ると列エラー）。
- 反映成功後は `ConsultationPanel` の `onApplied` が `appStore.reload()` を呼ぶ（画面反映はそこ経由）。
- 相談履歴・会話はDBに保存しない（localStorage/React state）。

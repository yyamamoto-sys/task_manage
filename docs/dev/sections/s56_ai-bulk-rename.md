## 56. AI相談から一括リネーム・一括ステータス変更ができるようにする（v3.110・2026-09-17）

### 背景

利用者がAI相談で「『第2回』と名前がついているものはすべて『第3回』に変更したい」と依頼したところ、
AIは対象タスクを正しく見つけた上で「このアクションはタスク名の一括リネームには対応していないため、
各タスクを個別に編集いただく必要があります」と返した。**提案を見つける力はあるのに、実行する手段が
無かった**のが原因。`action_type` に `bulk_rename`（タスク名の一括置換）と `bulk_status`（ステータスの
一括変更）を追加した。

### 🔴 最重要の設計判断：AIには「置換ルール」だけを返させる

**AIに変更後のタスク名を1件ずつ書かせない。** AIに複数タスクの新しい名前を個別に生成させると、
書き間違い・勝手な要約・全角半角の揺れが必ず混入する。代わりに `find`（置換前の文字列）と
`replace`（置換後の文字列）という「置換ルール」だけをAIに返させ、実際の新しい名前は
**アプリ側が `replaceInName()`（`src/lib/project/duplicateSelectedTasks.ts`。単純な部分文字列
一致＝`split/join`で、正規表現ではない）で機械的に算出する**。これにより「AIが見つけた対象」と
「実際に書き込む文字列」が構造的にずれない。既存のタスク複製機能（v3.57）で実績のある関数を
そのまま再利用しており、新しい置換ロジックは発明していない。

```jsonc
// bulk_rename
{
  "action_type": "bulk_rename",
  "find": "第2回",
  "replace": "第3回",
  "target_task_ids": ["task_001", "task_008"],
  "needs_confirmation": true
}

// bulk_status
{
  "action_type": "bulk_status",
  "new_status": "done", // todo | in_progress | done | on_hold | cancelled
  "target_task_ids": ["task_001", "task_008"],
  "needs_confirmation": true
}
```

### 安全装置（`src/lib/ai/bulkEditPlan.ts` の純粋関数に切り出してテスト）

1. **対象が50件を超える場合は警告**（`overLimit`）：実行は妨げず、確認ダイアログに
   「対象が◯件と多数です」という警告バナーを出すだけ（`BULK_WARNING_THRESHOLD = 50`）。
2. **置換後に名前が空文字（trim後）になるタスクは自動的に除外**（`bulk_rename`のみ。
   「findを消すだけ」の指示で名前が消える事故を防ぐ）。
3. **置換しても名前が変わらないタスクは自動的に除外**（`bulk_rename`のみ。findを含まない
   タスクがAIの誤判定で混ざった場合の保険）。
4. **除外があれば件数と理由を確認ダイアログに表示**（`buildBulkExclusionSummary()`。
   「3件を対象から自動的に除外しました（置換後に名前が空になる：1件／置換しても変化なし：2件）」）。
   `bulk_status` は自動除外を行わない（ステータスが既に同じでも実害が無いため、除外は
   利用者がチェックボックスで判断すればよい）。

### 確認フロー（`date_change`・`assignee`と同じ流儀）

両方とも `applyProposal()` は `needs_confirmation` を返す（即時反映しない）。
`ConfirmationDialogModal.tsx` に「変更前 → 変更後」の一覧を表示し、**1件ずつチェックボックスで
除外できる**（既定は全部オン）。既存の `ConfirmationDialog.items`（`ConfirmationItem[]`）を
そのまま流用し、`bulk_rename`/`bulk_status` では次の意味で読み替えている：
`current_value`＝変更前（名前 or ステータスラベル）、`suggested_value`＝変更後（置換後の名前 or
変更後ステータスのラベル）。`scope_reduce`/`pause` が PJ の UUID を `task_id` フィールドに
流用しているのと同じ、このファイル既存の「型を増やさず流用する」流儀に倣った。
`bulk_status` は `TASK_STATUS_LABEL`（`src/lib/taskMeta.ts`）でラベル表示する。

チェックボックスの状態は `confirmedValues[task_id]`（`"1"`=対象に含める／それ以外=除外）に
持たせている。`applyProposalWithConfirmation()` はこの値を見て、チェックが付いた項目だけ
`appStore.saveTask`（choke point）を呼ぶ。

### 反映・Undo・部分失敗

- 保存は必ず `useAppStore.getState().saveTask`（choke point。Section 6-10）経由。
  `bulk_rename`は`name`フィールド、`bulk_status`は`status`フィールドを書き換える
  （`status`を`done`にする分岐は`saveTask`側の`completed_at`自動セットにそのまま乗る）。
- **Undoは新しいコードを書いていない。** 既存の`UndoOperation`（`type: "task_field"`）は
  `field`が任意の文字列・`oldValue`が`unknown`という汎用設計のため、`field: "name"` /
  `field: "status"` をそのまま積むだけで`undoApply.ts`の既存の汎用フィールド復元が動く。
- 1件ずつ`try/catch`で包み、失敗した項目だけ理由を集めて`warning`に添える
  （既存の「部分失敗の方針」・`Promise.allSettled`相当の考え方をそのまま踏襲。1件の失敗で
  全体を止めない）。

### AIへの機能認識（Section 17遵守）

- `src/lib/ai/systemPrompt.ts` の `RESPONSE_FORMAT`（全consultation_type共通）に
  `bulk_rename`/`bulk_status`の仕様と使用例を追加した。
- `src/lib/ai/uiGuide.ts` の `FEATURE_LIST_SECTION`（AIの機能認識の正本）に
  「タスク名の一括変更」「ステータスの一括変更」を追記した。これを更新し忘れると、
  今回の元クレームと同じ「対応していません」という誤答が再発する。
- ボタンラベルは新設していない（既存の`BTN_APPLY`「反映する」／`BTN_APPLY_CONFIRMED`
  「確定して反映」をそのまま使う）。

### date_certaintyの扱い

`bulk_rename`/`bulk_status`は日付を一切扱わないため、`add_task`/`add_project`と同じく
`proposalMapper.ts`の`canApply`判定で`date_certainty`（既定"unknown"）による非活性化の
対象外にした（Section 6-8の例外リストに追加）。

---

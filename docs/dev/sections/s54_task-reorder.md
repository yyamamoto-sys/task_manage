## 54. タスクの並び替えを楽にする2機能：親子選択・番号順ソート（v3.108・2026-09-17）

山本さんの依頼：「親タスクに番号を振っているが昇順にならず、親タスクを選択して手動で並び替えている。親タスクを選択したら子タスクも全部選択できると並び替えが楽になる」。山本さんの判断で親子選択・名前順ソートの両方を実装した。

### 機能①：親タスクを選択すると子タスクも選択される

- **純粋関数**：`src/lib/task/selectionWithChildren.ts`。`addTaskWithChildren(selectedIds, taskId, allTasks)`／`removeTaskWithChildren(selectedIds, taskId, allTasks)`／`toggleTaskWithChildren(selectedIds, taskId, allTasks)`（トグルの唯一の判断＝既に選択中なら子ごと解除・未選択なら子ごと追加）。階層は最大2階層（親→子。孫は存在しない）のため、`parent_task_id === taskId` の直下の子（論理削除済みは除外）だけを見れば足りる。
- **choke pointは3画面ともすでに共有されていた「1件をトグルする関数」1つ**：`ListView.tsx`の`toggleSelect`・`KanbanView.tsx`の`toggleSelect`・`GanttView.tsx`の`toggleTaskSelection`。いずれも中身を`setSelectedIds(prev => toggleTaskWithChildren(prev, id, allTasks/tasks))`に差し替えるだけで済んだ（新しい選択の仕組みは発明していない）。この3関数はチェックボックス（ListView）・Ctrl/Cmd+クリック（3画面共通）の両方から呼ばれる唯一の入口のため、これで3画面とも自動的に親子選択が効く。
  - GanttViewのみ、`toggleTaskSelection`の定義が元々`allTasks`（useMemo）より前にあったため、`allTasks`定義の直後（`taskById`の後）へ定義ごと移動した（依存関係を成立させるため。ロジック自体は変更していない）。
- **子を個別に付け外しするのは自由**：`toggleTaskWithChildren`を子タスクのidで呼ぶと、その子自身には子（孫）が居ないため、その子1件だけが増減し、親の選択状態には一切触れない。これにより「親子とも選択済みの状態から子だけ1件外す」操作がそのまま成立する。
- **Shift+クリック範囲選択・チェックボックスの「全選択」は対象外**：範囲選択は既存の`computeRangeSelection`のまま変更していない（親クリックのケースのみ子連れにする、という依頼の範囲を超えないため）。全選択は元々表示中の全タスク（子も含む）を選ぶため、cascadeが無くても結果は変わらない。

### 機能②：タスク名の番号で並べ替える（ListViewのみ）

- **純粋関数**：`src/lib/task/nameOrder.ts`。
  - `extractLeadingNumber(name)`：全角数字を半角に正規化してから`/\d+/`で最初に現れる数値を取り出す（"第2回"のように数字の前に文字があっても拾える）。見つからなければ`null`。
  - `sortTasksByNameNumber(tasks)`：`extractLeadingNumber`の値で数値比較する自然順ソート（1→2→10。文字列比較なら1→10→2になる問題を回避）。`null`（番号なし）は常に末尾。数値が同じ・番号なし同士は元の相対順序を維持する安定ソート（`index`を比較キーに含めて安定性を保証）。
  - `computeNameOrderAssignments(targetTasks, allTasks)`：並べ替えの範囲を決める本体。兄弟グループの単位は「同じ`parent_task_id`・同じ`project_id`」（`src/lib/dragReorder.ts`の`isSibling`と同じ定義。既存のドラッグ並べ替えと矛盾しない範囲にした）。対象タスクが1件でもあるグループだけを、対象タスクは名前の番号順で並べ、対象外（フィルタ等で今は見えていない）の「隠れた兄弟」は既存の`display_order`順のまま対象タスクの後ろに温存する（`computeSiblingReorderIds`の「隠れた兄弟は元の相対順序を保つ」という既存の考え方をそのまま踏襲）。対象タスクが1件も無いグループには一切触れない（結果のMapにキーを含めない）。
- **並べ替えの範囲をどう決めたか**：ボタンの対象は「今ListViewで表示中のタスク」（`filteredTasks`）。トップレベルタスクは`project_id`ごとの兄弟グループ、子タスクは`parent_task_id`ごとの兄弟グループとして別々に並べ替えられる。これにより「親タスク同士を並べ替えるときは子を連れて動く」を実現している——正確には、子は親とは別グループ（`parent_task_id`が違う）のため親の並べ替えに一切巻き込まれず、描画側の既存ロジック（親の直下に子をネストして表示する`buildRows`）がそのまま「親の下に子が続く」順序を保つ。同じ親を持つ子同士も、その親の子だけの兄弟グループとして同じロジックで名前順に並べ替えられる。**PJを選択中はそのPJの兄弟グループにしか対象タスクが無いため、自然とそのPJの範囲だけに効果が限定される**（グローバルに全PJを巻き込む心配がない）。
- **UI**：ListViewツールバー1段目、「⠿ 並べ替え」ボタンの隣に「🔢 番号順に並べる」ボタンを常設。押すと`confirmDialog()`（`window.confirm`ではない）で「並び順を変更します。この変更は全員の画面に反映されます。」／confirmLabel「並べ替える」を確認する。**`tone`は既定の`"danger"`のまま**（破壊的ではないが全員に影響するため慎重側に倒す。依頼どおり）。
- **保存・Undo**：`appStore.saveTask`（choke point）を1件ずつ`Promise.all`で呼ぶ（`useBulkTaskActions.ts`と同じ流儀。トランザクションにはしない）。変更が無ければ「並び順の変更はありませんでした」とだけ表示し保存しない。成功時は「N件のタスクの並び順を変更しました」＋Undoトースト。**Undoは`useAppStore.getState().tasks`から取った「Undo時点の最新タスク」に旧`display_order`だけを適用する**（古いスナップショット全体を保存すると楽観ロックと衝突するため。`useBulkTaskActions.ts`と全く同じ理由・同じ書き方）。実行後、`sortKey`が`"manual"`でなければ`"manual"`に切り替える（既存の「⠿ 並べ替え」ボタンと同じ振る舞い）。

### 3画面すべてで親子選択が効くことの保証

`src/lib/task/__tests__/selectionWithChildren.test.ts`が純粋関数自体の正しさ（親選択で子が加わる／親解除で子が外れる／子の個別付け外しが親に影響しない）を担保する。**ワイヤリング自体（3画面がこの純粋関数を実際に呼んでいること）はコードレビューで確認**：`ListView.tsx`／`KanbanView.tsx`／`GanttView.tsx`のそれぞれの選択トグル関数の中身が`toggleTaskWithChildren`を呼ぶ1行に統一されていることを直接確認した（3ファイルとも新しいテストファイルは追加していない。理由：Reactコンポーネントの選択state配線自体を検証するレンダリングテスト基盤がこのリポジトリに無いため、既存の`useBulkTaskActions`等と同様、ロジック本体のテストとコードレビューで担保する方針を踏襲した）。

### 未検証の点

- 実機（ブラウザ）での動作確認は行っていない（`npx tsc --noEmit`・`npx vitest run`のみ）。特に、GanttViewの`toggleTaskSelection`定義位置の変更後もCtrl/Cmd+クリック・Shift+クリック・複数選択ドラッグシフト等の既存機能が壊れていないことは、コードレビュー（依存関係・呼び出し元の一致）でのみ確認済み。
- 「番号順に並べる」ボタンをPJが複数あるグローバル表示（PJ未選択）で押した場合の挙動（各PJが独立して並べ替えられる想定）は、単体テスト（`computeNameOrderAssignments`）でのみ確認しており、実際のListView UI上での見え方は未確認。

---

<!-- VERCEL BEST PRACTICES START -->
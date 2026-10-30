## 88. タスクの親子を任意の深さにする：Phase A（表示）＋A'（下回り）（v3.195・2026-10-30）

親子2段固定を撤廃し、任意の深さにする改修の第1段。**この版では深いデータを作る手段はまだ無い**（親にできるのは最上位のタスクだけ・子を持つタスクは子にできない、という操作側の制約は据え置き）。表示・集計・複製・移動が3段以上のデータを正しく扱えるようにした下地。呼び名は「親タスク／子タスク」のまま（孫以下も「子タスク」）。`MIN_CLIENT_VERSION` は据え置き（上げるのは操作側を開ける Phase B）。

### 唯一の実装（`src/lib/taskHierarchy.ts`）
- 子のマップ `buildChildrenMap`／祖先列 `ancestorsOf`（直近の親が先頭）／子孫列 `descendantsOf`（幅優先）／深さ `taskDepthOf`／循環判定 `wouldCreateParentCycle`・`hasParentCycle`。**すべて循環に強く、上限 `MAX_TASK_DEPTH`（32）で打ち切る**（DB トリガーの上限と同じ）。
- 木順の並べ替え `orderTasksAsTree(tasks, sortTops, sortKids)`：深さ優先で `{task, depth, childCount}` を返す。親が集合に居ないタスクは最上位扱い。循環などで辿れないタスクは末尾に最上位として足す（落とさない）。兄弟の並び規則（`orderSiblingsWithDependencies` 等）は呼び出し側が渡す＝従来の並びを保つ。
- 集計 `computeRollups`（非公開）が1パス・再帰で全親の派生値を出す。**進捗は「末端（子を持たない）タスクの完了数／末端の総数」**（中間の親は数えない）。状態は子の実効状態から再帰して派生。期間は末端の開始の最小・終了の最大（`buildEffectiveDatesMap`）。2段の木では従来と完全に同じ結果。
- インデントは `indentLevelOf(depth)`（`MAX_INDENT_LEVEL`＝8で頭打ち）。

### 画面
- リスト（ListView.buildRows）：PJ別は木順で N 段、折りたたみは「祖先のどれかが閉じていたら隠す」。担当別・状態別（フラット）は並びを変えず、同じグループ内の祖先の段数をインデントにする。
- ガント（GanttView／ganttUtils）：行は `orderTasksAsTree`。折りたたみは `hasCollapsedAncestor`（祖先を辿る）に一本化。**子を持つ行は深さに関係なく親のバー（期間は末端から巻き上げ）、末端だけが細い子のバー**。行の高さ・行数は変えていない（Section 80 の左右ずれ防止・共有行モデルはそのまま）。
- 「↳」は深さぶん（`parentArrowPrefix`）。モバイルガント・人別ビューで使う。

### 下回り
- `selectionWithChildren`・`projectMove`・`sections.followParentSection`：子孫全体を対象に。PJ移動は「祖先に選択が居ないタスク」を起点に、その子孫を連れて動かす（子だけ選んだ場合は親から外れて最上位になり、その子孫は連れて動く）。
- 複製・PJ引き継ぎの保存：`saveTasksInDepthOrder`（`src/lib/task/saveInDepthOrder.ts`）が深さの浅い波ごとに直列で保存（同じ波は並列）。親の保存が失敗した子は親なしに落とす（FK 制約対応・従来と同じ方式）。
- 親の自動完了（appStore.saveTask）：親の保存が同じ判定で最上位まで1段ずつ伝わる。親をたどると自分に戻る循環データでは伝播しない（status 往復の無限ループ防止）。
- AI：`parent_task_name` に加え、3段以上のタスクだけ `parent_task_path`（「A > B」）を足す。プロンプトは変えていない。
- 循環防止：`useTaskDragReorder` が祖先全体を辿って判定（操作の許可範囲は広げていない）。

### DB（マイグレーション `20261030_task_parent_cycle_guard.sql`・山本さんが手動適用）
- `idx_tasks_parent`（`tasks(parent_task_id)` の部分索引）と、`prevent_task_parent_cycle()`＋`trg_tasks_parent_cycle`（BEFORE INSERT OR UPDATE OF parent_task_id）。再帰 CTE で新しい親から祖先を辿り、自分が出たら RAISE（上限32段・SECURITY DEFINER・`search_path=''`・スキーマ修飾）。**未適用でもアプリは今まで通り動く**。
- 既存のグループ連動トリガー（`cascade_task_section_to_children`）は、子の更新でも発火するため孫以下へも自然に伝わる（DB 側は変更不要）。
- schemaChecks には関数の検査だけを足した（索引は `check_schema_health` に索引の kind が無いため対象外）。

### Phase B に持ち越し
親にできる範囲（最上位のみ）・子持ちを子にできない制約（`parentTaskCandidates`／`eligibleChildTasks`／`useTaskDragReorder` の2段ガード）・「＋子タスク」を最上位だけに出す条件・DnD の深い階層への入れ子・`MIN_CLIENT_VERSION` の引き上げ。


---

## Phase B：編集操作（v3.196・2026-10-30）

Phase A で持ち越した2段の制約をすべて外し、任意の深さの親子を**作れる**ようにした。呼び名は「親タスク／子タスク」のまま（孫以下も子タスク）。**`MIN_CLIENT_VERSION` を 3.196 に引き上げた**（古い画面は孫以下を表示・集計できず、親子を壊す操作をしうるため）。DB の循環拒否トリガー（`20261030_task_parent_cycle_guard.sql`）は本番適用済みが前提。

### 親にできる範囲（`taskHierarchy.parentTaskCandidates`）
同じPJの非削除タスクのうち、**自分と自分の子孫以外のすべて**。子持ちも親にできる／子持ちを別の子にもできる（子孫ごと移る）。木順で返し、パス表示は `taskPathLabel`（「A > B > C」）。`eligibleChildTasks`（親側から子を複数選ぶ UI の候補）は撤去した。

### 編集面（TaskSidePanel／TaskEditModal／QuickAddTaskModal）
- 「単独／子／親」の3択と親側の子ピッカーを廃止し、**「親タスク」欄1つ**。選択肢は `lib/task/parentOptions.ts` の `buildParentOptions` に集約（パスで表示・検索。なし＝最上位）。いまの親が候補に居ない旧データ（他PJの親）は末尾に足して欄が空に見えないようにする。
- 子を持つタスクは「子タスク N件（親を変えると子タスクごと移ります）」＋直下の子のチップ（× で外す＝即時保存・従来どおり）。
- **PJを変えたら、別PJの親は外す**（親は同じPJの中から選ぶ）。候補のPJは「親が決まっていればその親のPJ、無ければフォームのPJ」。
- 明示保存（s44/s48）：親欄は `parent_task_id` の1項目で、`computeFormDirty` の対象のまま（変更なし）。中間の段のタスクを開いても `buildSidebarFormFromTask`／`buildFormFromTask` は実際の親IDを持つので、保存しても親は外れない（テストで固定）。
- 追加モーダルの「子タスク（1行1つ）」一括入力は、親を選んでいても出す（2階層固定の撤廃）。

### ドラッグ（リスト・ガント左列）
- どの深さの行でも中央40%＝その行の子、上下30%＝並べ替え。ガントも同じ（`allowNest` を常に true）。
- **ドラッグ中のタスク（複数選択なら選択すべて）と、その子孫の行へは落とせない**：`onDragOver` で `preventDefault` しない（禁止カーソル）。処理側でも `wouldCreateParentCycle`／`computeMultiReorder` が拒否し、トーストを出す（DB の拒否 23514 は `formatErrorForUser` が「親子が循環するため設定できません」にする）。
- `computeMultiReorder`：動かすのは「祖先に選択が居ないタスク」。子孫は選択の有無を問わず連れて動く。旧2段のエラー3種（子持ちは子にできない／子だけ選んで最上位へ・別の親へは移せない）は廃止（子だけ選んだ場合も、落とした位置へ子孫ごと移る）。
- PJが変わる移動（行・PJ見出し・グループ見出しへのドロップ）では、子孫の `project_id` を揃え `section_id` を外す（`useTaskDragReorder.carryProjectToDescendants`。単独ドロップは親の保存の後に最新のストアから引いて保存）。
- nest ドロップは親の末尾（`nextDisplayOrder`）へ置く。

### 「＋子タスク」
リストは全行に出す。ガントは行の下端（ホバー時・「＋」の右）に「↳ 子」（`GanttView.handleAddChildTask`。折りたたまれていれば開き、名前を上書き入力できる状態で作る）。どちらも `position:absolute` ＝行の高さは変えない（s80）。

### Tab／Shift+Tab（リスト・PJ別表示のみ・`lib/task/indentOutdent.ts`）
- 対象＝チェック選択（あれば）、無ければ注目中の1件。**祖先と子孫が両方あれば祖先側だけ**。
- Tab＝表示順で直前の同じ親の兄弟（対象に含まれないもの）の最後の子に。最上位どうしは同じPJ・同じグループの兄弟だけ（別グループの下へ入るとグループが変わるため）。兄弟が居なければ何もしない（トーストで知らせ、Tab は奪う）。親が折りたたまれていれば開く。
- Shift+Tab＝親の直後（祖父の子の並びに差し込み、並びを振り直す）。複数選択で同じ親の兄弟は、親の直後に表示順のまま並ぶ。最上位は動かさない。
- 発火条件は `shouldIgnoreSingleKey`（入力欄・IME・モーダル・Ctrl/Alt/Meta）に加え、**フォーカスがボタン・リンク上のときは奪わない**（キーボードでのフォーカス移動を壊さない）。`onIndent` を渡すのはリストだけ（カンバン・ガントの Tab は触らない）。
- 保存・Undo は `useTaskDragReorder.applyPatches`（複数ドラッグと共通）：最新のタスクに patch を重ね、「元に戻す」トースト（`isUndo:true`＝Ctrl+Z でも戻る）。編集履歴（s57）は `parent_task_id` の変更として記録される（`display_order` は記録対象外のまま）。
- ショートカット一覧（ja／en）に Tab／Shift+Tab とドラッグの2行を追加（s85）。

### AI
- add_task に **`parent_task`**（既存タスクのIDまたは名前）。ID（`task_001` 等）は shortIdMap、名前は同PJ優先で完全一致。**同名が複数・見つからないときは作らずにエラー**（黙って最上位に作ると意図と違う場所に増える）。PJは親に揃え、親の子の末尾（`nextDisplayOrder`）に作る。確認ダイアログは「「A > B > C」の子として作成」と表示。1提案で作るのは従来どおり「親＋直下の子」まで（さらに下の段は提案を分けて parent_task で指定）。
- systemPrompt：2階層固定の文言を「何段でも」に、JSON スキーマに parent_task を追加、`parent_task_path` の説明を1行追加、「サブタスク」を「子タスク」に統一。他の文言は変えていない。uiGuide の `FEATURE_LIST_SECTION`（親子の行）を更新（s17）。

### 保存回数（深い木）
親の自動完了は1段ごとに親を1回保存する再帰（Phase A）。子の status が変わらない限り伝播しないので、深さ d の木でも最悪 d 回の直列保存で、各段で状態が変わらなければそこで止まる。上限は `MAX_TASK_DEPTH`（32）。複製・引き継ぎは深さの波ごとに並列（Phase A の `saveTasksInDepthOrder`）。Tab／Shift+Tab・複数ドラッグは独立した patch を並列保存（子孫には触れない）。

### ゲスト用サンプル・お知らせツアー
ゲスト用サンプルに3段の例（新システム要件定義 > 画面要件のヒアリング > 部署ごとの聞き取り／結果の取りまとめ）を追加。**お知らせツアー（s83）には載せない**：既存の運用は新機能ごとに `data-tour-id` を足した専用ステップ定義を書く形で、公開範囲もまず管理者のみ。この機能は「ドラッグ・Tab・＋子タスク」と画面が散らばるため、リリースノート（利用者向け・v3.196）での周知にとどめた。必要なら山本さんの判断でツアー化する。

### 実機で見てほしい点（描画テスト基盤が無いため）
- ドラッグの中央ドロップの枠線・禁止カーソル（自分の子孫の行）、深い行へのドロップ。ガント左列も同様。
- Tab／Shift+Tab の見た目（行がどこへ動くか・折りたたまれた親が開くか・トースト・Ctrl+Z）。複数選択での動き。
- 編集面の親欄：パス表示と検索、3段目のタスクを開いて保存しても親が外れないこと、PJ変更で親が外れること。
- ガントの「↳ 子」ボタンの位置（「＋」と重ならないか）。

### テスト
`src/lib/task/__tests__/taskTreeEdit.test.ts`（Tab／Shift+Tab・複数・Undo の prev・親欄の選択肢・中間段の親の保持・循環の文言・配線の走査。配線の走査は `onIndent` の受け渡しを外すと赤くなることを確認済み＝s59）／`bulkSelectionOps.test.ts`（N 段の複数並べ替え・循環・祖先だけ動く）／`taskHierarchy.test.ts`（候補の範囲・パス）／`applyProposal.test.ts`（深い親・同名・不在）。

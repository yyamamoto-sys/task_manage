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

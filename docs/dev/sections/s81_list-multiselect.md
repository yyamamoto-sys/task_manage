## 81. リストの複数選択まわりの操作：Shift範囲選択・PJ移動・まとめてドラッグ・日程ずらし・グループ見出しのドラッグ（v3.156・2026-10-15）

利用者フィードバック5点への対応。DB・RLS・Edge Function の変更なし（マイグレーションなし・`MIN_CLIENT_VERSION` は上げない）。

### 1. チェックボックスの Shift＋クリック（リストのPC・モバイルのカード）
- チェックボックスの `onChange` ではなく `onClick`（MouseEvent）で判定する（`onChange` は `shiftKey` を持たない）。入口は ListView の `handleCheckboxClick` 1つ。判定は純関数 `applyCheckboxClick`（`selectionRange.ts`）：Shift＝アンカー〜クリック先を表示順（`visibleOrderedTaskIds`）で選択に追加（行の Shift＋クリックと同じ・アンカーは変えない）／通常＝`toggleTaskWithChildren`（親子連動・Section 54）でトグルしてアンカー更新。Shift＋クリックの文字選択は `onMouseDown` で抑止。
- カンバン・ガントにはチェックボックスが無い（Ctrl／Cmd＋クリック・Shift＋クリックはカード／バーのクリックで既存）ため変更なし。

### 2. 選んだタスクをまとめて別のPJへ移す（一括操作バーの「📁 プロジェクトを移す…」。リスト・カンバン共有）
- 対象決定は `planProjectMove`（`src/lib/task/projectMove.ts`）：
  - **親（最上位）を選ぶと、子は選択の有無を問わず親に連れて移る**（削除済みは連れない）。PJが同じタスクは対象外。
  - **子だけを選び親を選んでいない場合は、その子を親から外して移動先の最上位にする**（子だけ別PJに居る状態を作らない・親は動かさない）。確認ダイアログに「親から外れる N 件」を出す。親が見当たらない（削除済み）子も同じ扱い。
  - 動く全タスクで `section_id: null`。`task_projects`（追加PJ）は触らない。最上位に動くタスクの `display_order` は移動先の最上位の末尾から表示順に採番。
- `useBulkTaskActions.bulkMoveToProject`：`confirmDialog`（`tone: "neutral"`・「N件（子タスクM件を含む）を『◯◯』へ移します」）→ `saveTask`（`Promise.all`）→ Undo トースト（Undo 時点の最新タスクに旧 `project_id`・`section_id`・`parent_task_id`・`display_order` を当て直す）。移動先ピッカーは `buildProjectTargetOptions`（アーカイブ除外）を `CustomSelect` で出す（Portal・`pointerEvents` は `CustomSelect` 側＝Section 51）。候補は `selectScopedProjects`（表示部署のPJ。サイドバーの「自分のみ」等の絞り込みには影響されない）。

### 3. 選んだタスクをまとめてドラッグで並べ替え（リスト）
- 選択が2件以上で、選択中の行をドラッグしたとき、`handleTaskDrop` が `handleMultiTaskDrop`（`useTaskDragReorder`）へ回す。採番・拒否は純関数 `computeMultiReorder`（`multiReorder.ts`）：
  - **ドロップ先と同じ兄弟グループ（同じ parent・project）へ全部入れる**。選択順ではなく表示順のまま。ドロップ先の `section_id`（最上位のとき）に揃う。
  - 選んだ親の子は親に連れて動く（PJが変わるなら子の `project_id` も揃える）。親と一緒に選んだ子は単独の移動に数えない。
  - **拒否（理由をトーストで表示）**：子だけを選んで最上位／別の親へ出す・子を持つタスクを子にする・別の親の子を子として入れる。同じ親の子同士の並べ替えは通す。ドロップ先が選択中の行・選択中の親の子の場合は何もしない。
  - nest（行の中央に落とす）：ドロップ先の最上位タスクの子の末尾へ（子を持たないタスクだけ）。
- 保存は `saveTask`（Promise.all。保存直前に最新タスクを引く＝親を先・連れた子を後にして DB トリガー／`normalizeTaskSection` の整合に乗せる）。Undo あり（旧 `display_order`・`parent_task_id`・`project_id`・`section_id`）。
- 見出し（PJ・グループ）への複数ドロップは対象外：「行の上か下にドロップしてください」と案内して何もしない（見出しへは1件ずつ）。

### 4. 選んだタスクの日程をまとめてずらす（一括操作バーの「📅 日程をずらす」。リスト・カンバン）
- `BulkMoveShiftControls` の日数入力（`parseShiftDays`：整数・0不可・±3650まで・全角可）→ `useBulkTaskActions.bulkShift` → `bulkShiftTasks`（`runBulkShift`：B3の自動リスケ・Undo・トーストは既存のまま）。ずらせない件数（期日なし・完了／中止＝`computeBulkMoveShifts` の既存ルール）は事前にトーストで知らせ、ずらせるものが0件なら何もせず理由を表示する。営業日ではなく暦日（ガントと同じ）。

### 5. グループ見出しのドラッグ（リストのPJ別表示）
- 見出し左の ⠿（`SectionHeaderContent` の `sectionDrag`。つかみからだけドラッグが始まる＝タスクのドラッグとは別の `draggingSection` state）をドラッグ→同じPJの別のグループ見出しへ落とすと順番が入れ替わる（`computeSectionDropOrder`：下へは相手の位置・上へは相手の前・「未分類」へは先頭）。保存は `useSectionActions.reorderSections` → `reorderProjectSections`（`saveProjectSection` への委譲）。「未分類」はドラッグ不可（⠿を出さない）。別PJの見出しへは落とせない。⋮の「上へ・下へ」は残す（キーボード代替）。
- **ドラッグ中の表示（v3.166・リスト・ガント共通。部品は `section/SectionDropIndicator.tsx`・文言は純関数 `describeSectionDrop`＝`lib/section/describeSectionDrop.ts`）**：つかんだ見出しは薄く（opacity 0.45＋ブランドの薄色）して名前の横に「移動中」バッジ／カーソルに追従する「📁 名前 を移動」の札（v3.167で `SectionDragGhost.tsx`。下記）／ビューのヘッダー直下に1行の案内（Esc でやめる）／落とす先の見出しに行幅いっぱい3px のブランド色の線を「入る側（上／下）」へ重ね描きし、札「『相手』の前／後に入ります」「先頭に入ります」を添える。線・札は absolute の重ね描きで**行の高さを変えない**（ガントの見出し行26px固定＝Section 80）。ガントはラベル列とバー列の両方の見出し行に線を引く（バー列は札なし）。別PJ・自分自身・順番が変わらない位置は線・札なし。
- **方式（v3.167）：HTML5 DnD をやめて Pointer Events**（Windows の Chrome は native drag 中にホイールでスクロールできないため）。共通フック `hooks/useSectionPointerDrag.ts` をリスト・ガントが使う（コピペしない）：⠿ の `onPointerDown`（主ボタン）→ 4px 超で開始 → window の `pointermove` で `document.elementFromPoint` → 見出し行の `data-section-drop-key`／`data-section-key`／`data-section-project` で判定 → `pointerup` で確定（`computeSectionDropOrder`→`reorderSections`）。**ホイールは止めない（`setPointerCapture` 不使用）**。スクロールしたら（capture の `scroll`）最後のカーソル座標で再判定。**端の自動スクロール**：スクロール領域の上下端から 48px 以内で rAF（端に近いほど速く最大16px/フレーム。純関数 `lib/section/sectionAutoScroll.ts`）。リストは表のスクロール領域、ガントは判定をラベル列の領域・スクロールを右のバー列（左は既存の同期）。中止＝Esc・`pointercancel`・ウィンドウ blur。ドラッグ中は body に `user-select:none`・`cursor:grabbing`（終了で必ず復元）。ドラッグが成立した直後の click は1回だけ握りつぶす（ガントの行の折りたたみ誤発火防止）。ドラッグが始まらなかった押下はクリックに影響しない。札は `createPortal(document.body)`・`pointerEvents:none`・`position:fixed`・z-index＝`TOUR_Z.bubble - 1`（`floatingPanelContract.test` の除外に理由つきで登録）。配線は `ganttSectionReorderWiring.test.ts`（HTML5 属性が見出しに残らない・両画面がフックを使う・`setPointerCapture`／wheel 抑止が無い）。

### 付随
- ショートカット一覧（リスト）・`uiGuide.ts` の `FEATURE_LIST_SECTION`・`docs/guides/02_modes/tasks.md`・`08_spec.md` に追記。
- ゲストは `saveTask` 等のメモリ分岐にそのまま乗る（Section 23）。`canGuestEdit` の判定は一括バーの既存操作と同じ（バーにガードを足していない）。
- 描画テスト基盤が無いため、配線は `bulkOpsWiring.test.ts`（コメント除去のソース走査。Section 59。わざと壊して赤・戻して緑を確認）、ロジックは `bulkSelectionOps.test.ts`。ドラッグ・Shift＋クリックの実操作は実機確認が要る。

### 追記（v3.160・2026-10-15）：ガントにも同じチェックボックスと一括操作バー
- **左ラベル列の3種のタスク行（PJ別・ToDo別・人別）にチェックボックス**（`GanttRowCheckbox`・13px固定幅・`data-gantt-row-checkbox`）。入口は `GanttView.handleCheckboxClick` 1つ：`applyCheckboxClick`（リストと同じ純関数）＋`toggleTaskWithChildren`＋表示順 `visibleOrderedTaskIds`（ganttRows 由来）。選択 state は既存の `selectedTaskIds` を共有（Ctrl／Cmd＋クリック・Shift＋クリック・選択バーの複数ドラッグシフトと同じ集合・同じアンカー）。onMouseDown／onClick は stopPropagation（行クリック＝詳細を開く・⠿ のドラッグとは別要素）。
- **見出し行（PJ・グループ・ToDo・人別）にはチェックボックスなし**（リストにも PJ単位の全選択は無く、全選択はヘッダー1つ＝ガントは従来の Ctrl／Cmd＋A）。モバイル（GanttMobileView）と AI提案プレビュー（`isPreview`＝`onCheckboxClick` を渡さない）は対象外。
- **一括操作バーは共有部品 `BulkActionBar`（`task/BulkActionBar.tsx`）に集約**。リスト・カンバン・ガントが同じ部品と `useBulkTaskActions` を使う（リスト／カンバンに二重にあった JSX を削除。状態ボタンはリスト3種・カンバン／ガント5種）。ガントはヘッダーとガント本体の間に挿入（右下の FAB・bottomStack と重ならず、左右の列は同じ flex 親の中で同じだけ縮むので Section 80 の行ずれは起きない）。旧「N件選択中」インジケータは廃止（バーが件数と解除を持つ）。
- **折りたたまれて見えない選択済みタスクも一括操作の対象に含まれる**（カンバンのような表示外の自動除外はしない＝親を選んで畳むのは普通の操作のため）。件数はバーに出る。
- 配線は `ganttCheckboxWiring.test.ts`（コメント除去のソース走査・わざと壊して赤を確認）、バー共有は `bulkOpsWiring.test.ts`。左右の行が揃ったままか・Shift＋クリックの実操作は実機確認が要る。

---

---

### 追記（v3.181・2026-10-23）：見えていない選択を含む一括操作の確認（M77・M80）／ダッシュボードKPI（M79）

- `useBulkTaskActions` の第6引数 `visibleIdsRef`（ガント＝`visibleOrderedTaskIds`・リスト＝`visibleOrderedTaskIdsRef`・カンバン＝`orderedTaskIds`）と選択の差を `lib/task/hiddenSelection.ts` で数える。**見えない選択を含むときだけ**、ステータス・優先度・担当者・日程ずらしは実行前の確認（`うち、今は表示されていない N 件も含みます`）を出し、削除・PJ移動は既存の確認文に追記、複製は `DuplicateTasksModal` の注記（`visibleTaskIds`）。0件なら従来どおり確認なし。
- 対象は変えていない（見えない選択も従来どおり対象）。リスト・カンバンはフィルタ・PJ切替で見えなくなった選択を従来どおり選択から外す。確認が効くのは折りたたみ（リスト・ガント）・カンバンの「完了を隠す」「保留・中止を表示しない」・ガントのフィルタ。
- ダッシュボードのKPI「進行中」「今週の完了率」は `lib/dashboardKpi.ts`（葉タスク基準＝子を持つ親は数えない。期限超過・PJ進捗と同じ）。
- `hiddenSelection.test.ts`・`dashboardKpi.test.ts`。

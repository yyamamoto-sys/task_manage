## 45. `TaskSidePanel`：タスク切替時の保存失敗で編集内容が消える不具合の修正（必須・v3.88・2026-08-20）

v3.87のリリース確認で発覚：`TaskSidePanel.tsx`のタスク切替useEffect（Section 44参照）で、利用者が「保存して移動する」を選んだのに`saveTask`が失敗した場合、`catch`でtoastを出すだけでそのまま新タスクへの切替（`setSidebarForm(nextForm)`等）まで進んでしまい、旧タスクの編集内容（`sidebarForm`・baseline）を失っていた。「自動保存されているか分からず不安」というクレームへの対応の趣旨（編集が失われないと確信できること）と正面から矛盾するため、v3.88で以下のとおり修正した。

### 修正内容

- **保存に失敗したら切替を中止する。** `catch`ブロックで`onSwitchFailed(prevTask.id)`（後述）を呼んだ上で`return`し、`setSidebarForm`等の新タスクへの切替処理を一切実行しない。`sidebarForm`／`baselineFormRef`／`formTaskRef`は旧タスクの値のまま保持される（dirtyな内容は消えない）。
- **失敗は永続的なエラー帯で表示する。** `setSaveStatus("error")`／`setSaveError(formatErrorForUser(...))`を呼ぶことで、既存の`{saveStatus === "error" && saveError && (...)}`帯（Section 15の流儀）がそのまま表示される。トーストのように数秒で消えることはない。
- **選択状態のずれ対策：`onSwitchFailed`コールバックを新設（必須prop）。** 呼び出し元（`GanttView`/`KanbanView`/`ListView`）は行クリック時に自分の選択state（`editingTaskId`/`selectedTaskId`）を即座に新タスクへ進める設計のため、切替失敗後もそのままだと「パネルは旧タスクを表示し続けるのに、呼び出し元の選択状態は新タスクのまま」というズレが生じる。これを避けるため、`TaskSidePanel`の`Props`に`onSwitchFailed: (previousTaskId: string) => void`を**必須**で追加し、3つの呼び出し元すべてで`id => set(Editing|Selected)TaskId(id)`（選択を旧タスクへ戻す）を実装した。必須にしたのは、省略された場合にこのズレが静かに再発するのを防ぐため。
- **自己ループ防止のガード。** `onSwitchFailed`によって`taskId`が旧タスクIDへ戻ると、useEffectの依存配列`[taskId]`が再度変化し、同じuseEffectがもう一度発火する。この2回目の発火は「実質的には切替が起きていない（旧タスクへ戻っただけ）」ため、`if (taskId === formTaskRef.current?.id) return;`という早期returnをuseEffectの先頭に追加し、無意味な再ダイアログ表示や状態の再設定を防いでいる。

### `ConfirmModal`の背景クリック挙動の再確認結果（統括の依頼に対する回答）

`ConfirmModal.tsx`にEscapeキーで閉じる仕組みは無い（`keydown`リスナー自体が存在しない）ことを確認した。**ただし背景クリックは`onClick={() => handleClose(false)}`により必ず`cancel`（`false`）扱いで閉じる。** これ自体はconfirmDialogの全19+箇所で以前からの仕様であり、`tone="danger"`の削除確認等では`false`＝「キャンセル（削除しない）」という安全側の意味に一致しているため問題は無かった。

しかし、v3.87で新設したタスク切替の確認ダイアログだけは、`confirmLabel="保存して移動する"`（true）／`cancelLabel="破棄して移動する"`（false）という割り当てだったため、**背景を誤ってクリックすると「破棄して移動する」が無言で選ばれてしまう**危険な組み合わせになっていた（Escapeでの事故ではなく、背景クリックでの事故）。v3.88でこの1箇所のみ`tone="danger"`・`confirmLabel="破棄して移動する"`・`cancelLabel="保存してから移動する"`に入れ替え、背景クリック（＝`cancel`）が常に安全側（保存してから移動する）に倒れるようにした。他の4箇所の新設confirmDialog（Section 44参照：モーダル/パネルの閉じる確認2箇所・2-5の上書き確認2箇所）は、`cancel`側が元々「何もしない（安全）」を意味する設計だったため対象外（問題なし）。

### 監査結果：他に編集消失経路が無いか

- **`TaskEditModal.tsx`に同種の経路は無い。** `handleClose`は「dirtyなら確認し、確認が取れたら（＝discardの意思表示があったら）discardしてから閉じる」という設計で、閉じる直前に暗黙の保存を試みる分岐が無い（保存を試みるのは明示的な`handleSave`だけで、これは閉じる操作を伴わない）。よって「保存を試みて失敗したのに閉じてしまう」という経路自体が存在しない。`TaskSidePanel.tsx`の`handleClose`（✕ボタン）も同型で問題なし。
- **タスクの削除（`handleDelete`。両ファイル）は対象外。** 削除は編集中のフォーム内容ごとタスク自体を消す操作のため、未保存の編集が残っていても「削除で消える」ことは仕様上の前提であり、今回の対象（保存を試みて失敗したのに黙って進む）には該当しない。
- **ゲストモードは対象外。** `TaskEditModal.tsx`/`TaskSidePanel.tsx`はいずれも`isGuest`判定を持たず、保存は常に`appStore.saveTask`を経由する。ゲストの場合`saveTask`はDB書き込みをスキップしメモリ上の状態だけを即時更新する設計（CLAUDE.md該当箇所参照）で、例外を投げる経路が無いため、今回の「保存失敗」分岐がゲストで発生することはない。
- **PJの切替（フォーム内の`project_id`変更）は対象外。** これは`sidebarForm`/`form`内の1フィールド変更であり、保存ボタン／Enter/Ctrl+Enterで保存されるまでは他の変更と同様にdirty追跡の対象になるだけで、独立した「切替」動作ではない。
- **見つかった別の潜在リスク（v3.88時点では未対応・報告のみ。→v3.89で対応した。Section 46参照）：`viewMode`（一覧／カンバン／ガント）を切り替えると、`MainLayout.tsx`が`key={viewMode}`の条件レンダーで前のビューを丸ごとアンマウントする。** `TaskSidePanel`はunmount時に何も保存・警告しないため、`viewMode`切替時に未保存の編集があると無警告で失われる。これは明示保存化（v3.87）以前の600msデバウンス自動保存の時代から存在した経路（デバウンス発火前にアンマウントされれば同様に失われていた）だが、当時は「編集を止めてから600ms以内」という短い窓でしか起きなかったのに対し、明示保存化によって編集してから保存ボタンを押すまでの間ずっと窓が開いたままになり、実際に踏む確率が上がっている。対応には`viewMode`切替のトリガー元（`MainLayout.tsx`のナビゲーション）まで含めた設計判断が要るため、v3.88の対応範囲には含めなかった。

### 機械チェックへの影響

既存の`src/components/task/__tests__/explicitSaveNoDebounce.test.ts`はデバウンス自動保存の再発検知が目的であり、今回の修正（保存失敗時の切替中止）は別種の不具合のため対象外。新規の機械チェックは追加していない（今回の修正はコンポーネント間のコールバック配線が主体で、ソース走査による固定に馴染む単純な文字列パターンが無いため）。

---

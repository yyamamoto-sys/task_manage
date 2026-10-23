## 85. キーボードショートカットの追加（v3.162・2026-10-15）

山本さんの方針は「不都合・弊害のないものはすべて実装」。ブラウザ予約のキー（Ctrl+N/T/W/D/F/P/L/R）・インデント（Ctrl+]／[）・I（自分に割当）など1キーで担当・期限・優先度を書き換えるもの・ガントの依存関係キーは**入れない**（誤爆でデータが変わる／親子制約）。DB・RLS・Edge Function の変更なし（マイグレーションなし・`MIN_CLIENT_VERSION` は上げない）。

### 追加したキー

| キー | 効く画面 | 動き |
|---|---|---|
| `?`（Shift+/） | 全画面（PC） | ショートカット一覧を開閉（`e.key === "?"` で判定。リストの `/`＝検索とは別） |
| `N` | 計画モード全画面（PC） | 新規タスク（右下の＋「タスクを追加」と同じ `setIsQuickAddOpen(true)`） |
| `J` / `↓` | リスト・カンバン・ガント | 次のタスクへ「注目」（枠線）を移す。`↓` は注目中のタスクがあるときだけ（ページのスクロールを奪わない） |
| `K` / `↑` | 同上 | 前のタスクへ。`↑` も注目中のみ |
| `Enter` | 同上 | 注目中のタスクの詳細を開く（ボタン・role=button・チェックボックスにフォーカスがあるときは奪わない＝二重に開かない） |
| `E` | 同上 | 注目中のタスクを完了↔未完了。Undoトースト付き（Ctrl+Z で戻る） |
| `A` / `D` | 同上 | 詳細を開き担当者欄／終了日欄にフォーカス（開くだけ。データは変えない） |
| `Esc` | 同上 | 注目を外す（既存のチェック選択の解除と同じ押下） |

既存（Ctrl+K・Ctrl+Z・Ctrl+A・Esc・`/`・ガントの T・+・-・Enter・詳細の Ctrl+Enter／Enter）は挙動不変。一覧（`ShortcutsPanel`）には既存で漏れていた リストの `/`・詳細の Ctrl+Enter／Enter・パレット内 ↑↓Enter Esc も掲載した（ja／en）。

### 設計

- **判定は `src/lib/shortcuts/keys.ts` の1か所**：`shouldIgnoreSingleKey(e, {activeElement, modalOpen})`＝IME変換中（isComposing／key==="Process"／keyCode 229）・入力欄（text系input・textarea・select・contenteditable。チェックボックス等は入力扱いにしない）・Ctrl/Alt/Meta併用・他ハンドラ処理済み・モーダル表示中（`autoUpdate.isModalOpen`＝role=dialog／aria-modal／`inset: 0` の独自モーダル。コマンドパレット・クイック追加・FABメニューの暗幕も含む）で発火しない。**新しい単キーは必ずこれを通す。** 既存3画面（Ctrl+A・Esc・`/`）の重複判定は挙動を変えないため置き換えていない。モバイル・詳細／編集モーダル表示中は各画面が `enabled`／`blocked` で止める（リストの既存ガードと同じ条件）。
- **「注目」は選択（チェック）と別概念**：`stores/taskFocusStore.ts`（`focusedTaskId` 1つ）。見た目は `lib/shortcuts/taskFocusDom.ts` が `<style id="amp-task-focus-style">` を1つだけ置いて `[data-task-focus-id="…"]` に `outline` を当てる（メモ化された行コンポーネントを再描画させない。`!important`＝ガントのバーの既存 outline に勝つ）。行（リスト `<tr>`）・カード（カンバン）・ガントの左ラベル3種とバーに `data-task-focus-id`。移動後に `scrollIntoView({block:"nearest",inline:"nearest"})`。
- **移動順**：リスト＝`visibleOrderedTaskIds`（折りたたみ・フィルタ反映済み）／カンバン＝`computeKanbanOrderedIds`（列ごと上→下、列末で次の列、完了を隠している間は完了列を飛ばす）／ガント＝`visibleOrderedTaskIds`（`ganttRows` 由来）。表示から消えた（絞り込み等）注目は自動で外す。ビューを離れたら外す（AIプレビューのガント＝`enabled:false` は片付けに触らない）。
- **E は `lib/shortcuts/toggleDone.ts`**：`saveTask`（楽観更新・realtime・変更履歴の既存経路）＋`isUndo:true` の「元に戻す」トースト（`lastUndoStore` に登録され Ctrl+Z で戻る。`useBulkTaskActions.bulkUpdateStatus` と同じ形）。完了→`todo`・それ以外→`done`。**子タスクを持つ親は切り替えない**（状態は子の完了状況で決まる＝`rollupStatus`。案内トーストだけ）。中止（cancelled）・ゲストの編集不可（`canGuestEdit`）は何もしない。
- **A／D の移動先**：`TaskSidePanel` の担当者欄（`<div data-shortcut-field="assignee">`）・終了日欄（`data-shortcut-field="due"`）。`focusDetailField` がパネルの描画を待って（rAF最大40フレーム）フォーカス。欄が無ければ詳細が開くだけ。
- **不具合修正**：`ConsultationPanel` の Ctrl+Z が入力欄でも AI提案の取り消しを実行してしまうのを、`shouldRunConsultUndo`（入力欄では false）で止め、ブラウザ標準の文字の取り消しに任せる。

### 機械チェック・テスト
`src/lib/shortcuts/__tests__/`：`keys.test.ts`（IME・入力中・修飾キー・モーダル・J/K 移動順・カンバンの列またぎ／完了を隠す／保留列・`shouldRunConsultUndo`）／`toggleDone.test.ts`（saveTask経路・Undoトースト・実 `showToast` で Ctrl+Z 用ストアに登録・親／中止／失敗）／`shortcutWiring.test.ts`（コメント除去のソース走査＝Section 59：3画面がフックを呼ぶ・`data-task-focus-id`・MainLayout が共通判定を通す・ConsultationPanel が直書きしない・`data-shortcut-field`）。**ConsultationPanel の修正は、修正前のソース（HEAD）に対して配線テストが赤、`shouldRunConsultUndo` の入力欄判定を外すと動作テストが赤になることを確認済み。**

### 留意
- 描画テスト基盤が無いため、枠線の見え方・スクロール・A／D のフォーカス・`N`／`?` の実際の発火は実機確認が要る。
- 詳細パネル（サイドパネル）を開いている間は単キーが止まる（既存のリストと同じ条件）。閉じてから J/K を続ける。

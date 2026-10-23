## 46. グランドルール：明示保存の画面は、自分がアンマウントされうる経路すべてに対して未保存の警告を持つ（必須・v3.89・2026-08-20）

v3.88のリリース確認で「`viewMode`切替時に`TaskSidePanel`が無警告でアンマウントされ、未保存の編集が消える」経路が見つかった（Section 45参照）。これはv3.87の明示保存化によって「編集してから保存ボタンを押すまで」の無防備な時間が実質無制限に延びたことで、発生確率が跳ね上がった経路であり、「保存されたか分からず不安」というクレームへの対応が**別経路で無言の編集消失を増やしている**状態だった。次回の課題として先送りにせず、v3.89で対応した。

### 仕組み：未保存編集レジストリ（`src/lib/editing/unsavedEditorRegistry.ts`）

アンマウントの瞬間に非同期の確認ダイアログを出すのは構造的に無理（Reactのアンマウントは同期的で、確認を待って中断できない）なため、「未保存の編集を持っている編集画面が今あるか」を**アンマウントされる前に**問い合わせられる仕組みを新設した。

- **zustandではなく独立モジュールにした。** zustandストア（`appStore.ts`）はSupabaseと同期する「アプリの業務データ」を持つ場所であり、ここで扱うのは「今この瞬間dirtyな編集フォームが画面上に存在するか」という一過性のUI信号（Reactの再レンダリングを一切必要としない）。`src/lib/lastUndoStore.ts`（Undoの直前アクション）・`src/lib/errorReporter.ts`（CustomEventベースのエラー通知）と同じ「モジュール変数＋登録／解除関数」の流儀に合わせた。
- **id→dirty判定関数（getter）のMapとして持つ、pull型の設計。** MainLayoutは`graphEditTaskId`/`calendarEditTaskId`/`myPageEditTaskId`/`aiEditTaskId`の4つの`TaskEditModal`インスタンスを同時に持ちうるため、単一のboolean値では表現できない。「変更のたびにregistryへpushする」のではなく、登録時に渡した関数を問い合わせ時に毎回呼び出して評価するpull型にすることで、値の同期漏れ（更新し忘れ）が起きない。
- **`TaskEditModal.tsx`/`TaskSidePanel.tsx`は`useId()`で払い出した安定なidをマウント時に`registerUnsavedEditor(id, getter)`で登録し、アンマウント時（`useEffect`のクリーンアップ）に必ず`unregisterUnsavedEditor(id)`で解除する。** getterは`isDirtyRef.current`を読むだけの薄い関数にし、`isDirtyRef.current = isDirty;`をレンダーのたびに更新することで、effectをisDirty変化のたびに再実行せずに常に最新の値を反映する（このファイル既存の「refをレンダーのたびに更新する」パターンを踏襲）。
- **`confirmDiscardUnsavedEdits()`（レジストリと同じファイルからexport）が「未保存の編集があるか確認し、あれば確認ダイアログを出す」を1箇所に集約する。** 無ければ何もせず`true`（＝進んでよい）。安全側のデフォルト＝背景クリック（`ConfirmModal`は背景クリックで必ず`cancel`扱いになる。Section 45参照）が「このまま編集を続ける」（＝切り替えない）になるよう、`tone="danger"`・`confirmLabel`="破棄して切り替える"・`cancelLabel`="このまま編集を続ける"にしている（v3.88のタスク切替確認と同じ考え方）。

### `MainLayout.tsx`：画面遷移の前に確認するガード（`guardedNavigate`）

`viewMode`/`appMode`/部署（`currentGroupId`）の切替は「`closeLabViews()` → 状態を変える」という複数ステップの複合操作であり、それぞれの呼び出し元（`navSetViewMode`・`setAppMode`・`handleSelectGroupNav`・JSX内の複数の`onClick`/`onNavigate`等）が独立に確認を挟むと、1回のクリックで確認ダイアログが2回以上出てしまう（`closeLabViews`分＋`viewMode`/`appMode`変更分）。そのため「未保存かどうかの確認」は`guardedNavigate`という1つの関数だけに集約し、`closeLabViews`・`setViewMode`・`setAppMode`・`handleSelectGroupNav`自体は一切確認を挟まない「素」の関数のままにしてある。JSX側の実際の画面遷移の起点（下記10箇所）だけを`void guardedNavigate(() => { ...元の処理... })`で包む。

- 複合操作の内側でさらに別の複合操作を呼ぶ場合（例：`navSetViewMode`が`closeLabViews`と`setViewMode`の両方を呼ぶ）の二重確認は、「今まさにユーザーの確認を得て実行中である」ことを示す簡易フラグ（`navigationConfirmedRef`）で防ぐ。JSは単一スレッドでこれらの呼び出しは全て同期的にネストするため、単純なbooleanで十分安全に機能する。
- ガードを適用した10箇所：`navSetViewMode`・`handleToggleAppMode`（2分岐）・`handleSelectGroupNav`・OKRモード紹介の`onApprove`・`onNavigate`・`onSelectProject`+`setAppMode`の組み合わせ（モバイル/PC各1）・`onSwitchView`+`setAppMode`の組み合わせ（モバイル/PC各1）・NAV_ITEMSの直接`onClick`（モバイル1箇所。`Sidebar`コンポーネント内の同名の`onClick`は`guardedNavigate`のスコープ外のため対象外＝そちらは`setViewMode`propが既に`navSetViewMode`＝ガード済みの関数を指しているため二重に包む必要が無い）。
- `handleSelectGroupNav`・`navSetViewMode`は「実質的な切替が無いなら確認しない」判定を持つ（`id === currentGroupId`等）。ただし`navSetViewMode`は`v === viewMode`のときも確認を省略しない（`closeLabViews()`が「ラボ系ビューを閉じて元の一覧へ戻る」役割も兼ねているため、安全に無視してよい条件を精密に見極めるより、多少の余分な確認ダイアログを許容する方が、ラボ系ビューを閉じる操作を誤って無効化するリスクより安全と判断した）。

### `App.tsx`：ログアウト（ゲストモードの終了と同じ経路）

`handleLogout`は`window.location.reload()`で全状態を破棄する。ここに未保存の編集があると無警告で失われるため、`signOut()`を呼ぶ前に`confirmDiscardUnsavedEdits()`で確認するようにした（`signOut()`より前に確認することで、ネットワーク断等で`signOut`自体が失敗した場合に無駄な確認をさせない）。ゲストモードの終了も同じ`handleLogout`を経由するため、追加の分岐は不要だった。

### 確認した経路・対象外にした経路（理由込み）

- **表示プロジェクトの切替（`handleSelectProject`/`selectedProjectId`）：対象外（安全と確認済み）。** `selectScopedTasks`/`selectScopedProjects`は`selectedProjectId`ではなく`currentGroupId`でしかフィルタしない。`ListView`/`GanttView`/`KanbanView`側にも「`selectedProject`が変わったら選択中タスクをクリアする」処理は無い。よってプロジェクト表示を切り替えても`TaskSidePanel`は開いたままのタスクを表示し続け、アンマウントされない（コードを読んで確認済み。推測ではない）。
- **サイドバーの表示部署の切替（`currentGroupId`）：対象。ガード追加。** `selectScopedTasks`は表示部署（`currentGroupId`）でフィルタする（v3.139から全ユーザー。Section 71）。編集中のタスクが切替先の部署に属さない場合、部署切替で`allTasks`から消え`selectedTask`が`undefined`になり、`TaskSidePanel`がレンダーされなくなる＝実質アンマウント。レジストリは「誰のどのタスクが引っかかるか」までは判定しない単純な設計のため、全ユーザー一律にガードする。
- **計画モード⇄OKRモードの切替（`appMode`）：対象。ガード追加。** `appMode==="okr"`は`OkrDashboardView`のみを描画し、`viewMode`系のビュー（`key={viewMode}`）を完全にアンマウントする。
- **ログアウト・ゲストモードの終了：対象。ガード追加。** 上記参照。
- **管理画面・ガイド・ラボ系ビュー（カレンダー／グラフ／マイページ／体制図）をツールバーから開く操作：v3.90で対応済み（Section 47参照）。** v3.89時点では次の課題としていたが、先送りせず同一バージョン内で対応した。

### 再発防止：新しいグランドルール

**明示保存の画面（CLAUDE.md Section 44）を新設・変更するときは、以下を必ず確認すること：**

- [ ] この編集画面は、呼び出し元の都合で予告なくアンマウントされうるか？（`key`変更・条件レンダーの分岐変更・親の状態リセット等）
- [ ] されうるなら、マウント時に`registerUnsavedEditor()`・アンマウント時に`unregisterUnsavedEditor()`を対で呼んでいるか？（`src/lib/editing/unsavedEditorRegistry.ts`）
- [ ] このアンマウントを引き起こす操作（画面遷移・ナビゲーション）は、実行前に`confirmDiscardUnsavedEdits()`（またはそれを内包する`guardedNavigate`等の1箇所の choke point）を経由しているか？
- [ ] 二重確認（同じ操作で確認ダイアログが2回以上出る）が起きないか？　複合操作（複数の状態変更をまとめて行う関数）を作るときは、確認は最も外側の呼び出し1箇所だけに集約し、内側の個別関数は確認を持たない「素」の関数のままにすること。

### テスト

`src/lib/editing/__tests__/unsavedEditorRegistry.test.ts`（新規12件）：登録/解除の対称性（解除漏れがあると誤検知し続けることの確認）・pull型（getterが呼び出し時に評価されること）・`confirmDiscardUnsavedEdits`の安全側デフォルト（`confirmDialog`をモックして検証。vitest.config.tsの test環境は`node`のため`window`に触れない設計にした）を固定している。**（2026-08-20・v3.90で訂正）** 「機械チェックは新設していない」としていたが、v3.90でコンポーネント間の配線（どの画面遷移がガードを経由するか）自体をソース走査で固定する機械チェックを追加できた。詳細はSection 47参照。

---

### v3.180：AI下書きモーダルの閉じる確認（M62）

個人OKRのAI下書き3モーダル（振り返り・全体の振り返り・計画）は、編集の有無に加えて「下書きがあり反映先へ未反映」でも閉じる前に確認する（`lib/personalOkr/draftCloseGuard.ts`）。生成直後で未編集でも、AI課金済みの下書きを確認なしで捨てない。反映した時点の内容を覚え、以後の編集は再びdirtyになる。詳細＝`docs/dev/sections/s24_personal-okr.md`のv3.180。

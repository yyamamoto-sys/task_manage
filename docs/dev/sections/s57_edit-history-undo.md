## 57. タスク・PJの編集履歴とUndo（v3.111・2026-09-17）

利用者の要望：「Excelのように、いつ誰が何を編集したかの編集履歴を確認し、ユーザーが
自身でUndoできるようにしてほしい」。山本さんの決定：**記録対象＝タスク＋プロジェクト
／表示＝タスク単位から始める／保持＝90日／Undoの権限＝管理者は全部・一般は自分の変更
のみ**。

### 新テーブル `entity_change_logs`（`supabase/migrations/20260917b_add_entity_change_logs.sql`。⚠️山本さんが手動適用）

Section 7に既にある `admin_change_logs` は**コード上一度も読み書きされていない死蔵
テーブル**（`grep -rn "admin_change_logs" src` で0件）だったため、流用せず新設した。
90日経過削除はpg_cronで自動化（`20260501_admin_logs_cleanup.sql`と同型）。RLSは
SELECTのみ部署スコープ（`group_id = ANY(current_member_group_ids()) OR
current_member_is_super_admin()`。Section 39のグランドルールに従い`(SELECT ...)`で
包んでInitPlan化）、INSERT/UPDATEはauthenticatedに許可する（後述のとおり、この機能の
安全弁はRLSではなくappStore側のtry/catchとUI側の権限判定に置いている）。

### 🔴 `display_order`をあえて記録対象から除外した理由

タスク・PJの並べ替え（ドラッグ＆ドロップ・「番号順に並べる」等）は`display_order`を
毎回更新するため、これを記録対象に含めると**並べ替えのたびに数十件の履歴が生まれ、
本当に見たい変更（名前・ステータス・担当者等）が埋もれる**。`updated_at`/`updated_by`
（保存のたびに必ず変わり無意味）・`created_at`/`group_id`/`group_ids`（業務上の
「変更」ではない）・`baseline_start_date`/`baseline_due_date`/`finalized_mentions`
（内部管理用）も同じ理由で除外した。差分計算は`src/lib/history/changeDiff.ts`の
`computeTaskDiff`/`computeProjectDiff`（純粋関数）がホワイトリスト方式
（`TASK_TRACKED_FIELDS`/`PROJECT_TRACKED_FIELDS`）で行う。配列
（`assignee_member_ids`/`todo_ids`）は`taskEditPayload.ts`の`computeFormDirty`と
同じ考え方で順序を無視した集合比較にする（並び替え自体は「変更」として記録したい
内容ではないため）。

### 🔴🔴 記録の失敗を保存の失敗にしない理由

履歴機能はタスク・PJの保存という主機能に対する**付随機能**である。もし
`entity_change_logs`へのINSERTが失敗したとき（マイグレーション未適用・ネットワーク
エラー等）に保存自体を失敗扱いにすると、履歴機能のバグや適用漏れが本来無関係な
タスク編集を全滅させてしまう——これは2026-08-12に実際に起きた「upsertTask全滅事故」
（CLAUDE.md Section 22の教訓）と同型のリスクである。そのため`appStore.ts`の
`recordEntityChangeLog()`は例外を一切外へ投げず、失敗は`console.warn`に留める。
呼び出し元（`saveTask`/`saveProject`/`deleteTask`/`restoreTask`/`deleteProject`/
`restoreProject`）は`void recordEntityChangeLog(...)`として結果を待たずに呼ぶ
（awaitしない）。これにより、`entity_change_logs`が未適用のdev環境でも保存自体は
今までどおり成功する（テーブル未適用の状態でレビューし、保存が壊れないことを
確認済み。「未検証である点」参照）。

### Undo：4つのactionで戻し方が異なる

- `action="update"`：`diff`の`before`の値だけを含むオブジェクトを`saveTask`/
  `saveProject`に渡し、その項目だけを元に戻す（他の項目には触らない）。
- `action="delete"`：`restoreTask`/`restoreProject`を呼んで復元する。
- `action="restore"`：`deleteTask`/`deleteProject`を呼んで再度削除する。
- `action="create"`：Undoボタンを出さない。作成時は`diff`が常に空（下記参照）で
  「戻す先の値」が無いため、作成自体を取り消したい場合は削除操作を使えばよいと判断した。

**同じ項目がその後さらに変更されている場合の警告**は
`src/lib/history/undoWarning.ts`の`hasLaterConflictingChange()`（純粋関数）が
「対象の履歴より後の時刻に、同じフィールドを触っている別の履歴があるか」を判定し、
`confirmDialog()`で「この項目はその後も変更されています。戻しますか？」を確認して
から実行する。

**Undo自体もsaveTask/saveProject/deleteTask/restoreTask経由**のため、Undoの操作も
また新しい履歴として記録される（意図した挙動。CLAUDE.md本文の指示どおり）。

### 🔴 Undoの権限判定が「事故防止であってセキュリティではない」理由

`src/lib/history/undoPermission.ts`の`canUndoEntityChangeLog()`は「管理者
（`is_admin`/`is_super_admin`）は全員の変更を、一般メンバーは自分の変更だけを」
Undoできると判定するが、これは**UI側の判定のみ**でありDB側（RLS）では強制していない。
理由：タスク・PJの編集自体は部署内の全員に既に許可されているため、他人の変更を
Undoする代わりに同じ内容へ直接編集し直せば全く同じ結果を作れる（他人の変更を
「戻す」ことと「新しい値で上書きする」ことの間に、権限上の実質的な差が無い）。
この判定は「誰かの変更を思わず戻してしまう」という**誤操作を減らすための道しるべ**
であり、悪意ある操作を防ぐものではない。この理由は`undoPermission.ts`本体の
コメントにも明記した。

### 新規：`src/lib/history/`（純粋関数）

- `changeDiff.ts`：`computeTaskDiff`/`computeProjectDiff`（対象フィールド限定・
  配列は集合比較・null/undefinedを同一視）。
- `fieldLabels.ts`：`fieldLabel()`（項目名の日本語化）・`formatChangeValue()`
  （値の読みやすい表示。ステータス・優先度・担当者IDの名前変換を含む）。
- `undoWarning.ts`：`hasLaterConflictingChange()`。
- `undoPermission.ts`：`canUndoEntityChangeLog()`。

### UI：`src/components/history/ChangeHistorySection.tsx`（共通コンポーネント）

新しいモーダルは作らず、`TaskEditModal.tsx`・`TaskSidePanel.tsx`・
`ProjectSettingsModal.tsx`の3画面の本文（スクロール領域）内に埋め込む1セクション
として実装した。直近20件（`.limit(20)`。PostgRESTの1000行上限対策）。
テーブル未適用・取得失敗はエラーを出さず「まだ履歴はありません」と表示する
（管理者向けの`SchemaHealthBanner`とは違い、一般メンバーも見る画面のため、
機能不全の説明は不要と判断した）。ゲストは`fetchEntityChangeLogs`を呼ばず
常に空表示にする（CLAUDE.md Section 23。Supabaseに一切接続しない設計を崩さない）。

### やらないこと（今回のスコープ外）

- OKR系（Objective/KR/TF/ToDo）・メンバー・グループ等、タスク・PJ以外のエンティティ
  への拡張。
- 表示のPJ単位（一覧）化・部署横断の変更履歴ビュー（依頼は「タスク単位から始める」
  ため見送った）。

### 🔴 RLSのINSERT/UPDATEも部署スコープで絞る（2026-09-17・統括レビューで是正）

実装当初、INSERTは`WITH CHECK (true)`、UPDATEは`USING (true) / WITH CHECK (true)`で
`authenticated`全員に開いていた（「undone_atの誤更新は実害が小さい」という判断）。
統括のレビューでSELECTと同じ部署スコープへ揃えた。

**実害が小さいことと、開けておく理由があることは別である。** 見えない履歴を書き換えられる
状態をわざわざ残す理由が無い。**v3.109（PJ編集権限）で「UIだけの制限は防御にならない」ことが
実際に分かったばかり**であり、DB側で絞れるものはDB側で絞る。

---

---

### v3.181：一括操作・まとめてドラッグの「元に戻す」の失敗を握る（M74・M78）

- `lib/task/settleSaves.ts`：`settleUndoSaves`（`Promise.allSettled` で待ち、失敗があれば「N件は元に戻せませんでした」を1回だけ。個々の失敗は `saveTask` 側のトースト）・`settleSingleSave`（単発の保存の拒否だけ握る）。`useBulkTaskActions` の元に戻す5箇所（ステータス・優先度・担当者・削除の復元・PJ移動）と `useTaskDragReorder.handleMultiTaskDrop` が使う。
- `GanttView` のバーのドラッグ確定（リサイズ・単体移動・範囲作成）の `saveTask` は `settleSingleSave` 経由。**未処理の Promise 拒否を残さない＝`client_error_logs` に残らない。**
- Undo の成功表示は従来どおり「押した瞬間」に出る（保存の完了を待って出し直すことはしない）。
- `settleSaves.test.ts`・`settleSavesWiring.test.ts`（修正前のコードで赤を確認）。

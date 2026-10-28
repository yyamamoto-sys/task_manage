## 34. 招待された人の体験3件の修正（v3.76・2026-08-18）

2026-08-18に山本さんが実機で未登録の方を「羅針盤フォーラム」PJへ招待して踏んだ3件。RLS・招待の仕組み自体は正しく機能していることを確認済みで、以下は純粋にフロント側の問題だった。

### 件1：参加の確認ダイアログが削除ボタンの見た目になっていた

`src/lib/dialog.ts`の`confirmDialog(message: string)`がメッセージしか受け取らず、`ConfirmModal.tsx`が常に削除用の見た目（赤・ゴミ箱🗑・「削除する」）で固定されていたため、招待を受諾する確認（「参加しますか？」）にまで削除の見た目が出ていた。

- `confirmDialog(message, opts?)`に`opts: { tone?: "danger" | "neutral"; confirmLabel?: string }`を追加した（`src/lib/dialog.ts`）。`ConfirmModal.tsx`は`resolveDialogVisual(type, tone)`でアイコン・配色を決める（`alertDialog`の見た目＝warningは無変更）。
- 🔴 **`tone`の既定値は`"danger"`のまま据え置いた。** 呼び出し箇所は19（うち大半は削除・取り消し・解除の破壊的操作）あり、既定を変えると拾い漏れた呼び出しが「削除ボタンが無害に見える」という悪い方向の回帰になるため。**非破壊の確認を新しく追加するときは、呼び出し側が必ず`{ tone: "neutral" }`を明示すること。**
- `tone: "neutral"`にした箇所（読んで破壊的でないと判断した4箇所のみ。他15箇所は削除・取り消し・解除のため据え置き）：`App.tsx`の招待受諾確認（本件の本体。ラベル「参加する」＝`auth.invite.member.submit`を再利用）／`ProjectSettingsModal.tsx`のPJ状態変更（完了・アーカイブ・差し戻し＝データを消さない）／`AdminView.tsx`のTFクォーター解除・TFクォーター移動（TF自体は削除されない）。招待の取り消し（`AdminView.tsx`／`ProjectSettingsModal.tsx`の2箇所）はアクセス権を無効化する操作のため据え置いた。タブ切替時の「未保存の変更が失われます」警告（`AdminView.tsx:234`）・ゲストのサンプルリセット（`MainLayout.tsx`）も、現在の編集内容を失わせるため据え置いた。

### 件2：受諾後もURLに`?invite=`が残り、リロードのたびに参加確認が再表示される

`stripInviteParamFromUrl()`（`src/lib/projectInvite/loggedInInviteFlow.ts`。Section 25 Phase 5）は、既存メンバーがログイン済みでURLの招待コードを拾い直す経路（`App.tsx`の③）でのみ使われており、**未ログインからの新規登録経路（`LoginScreen`→`App.tsx`の②`pendingProjectInvite`自動受諾）では一度も呼ばれていなかった。** 受諾成功後に`window.location.reload()`してもURLに`?invite=<code>`が残ったままのため、reload後に③が同じコードを拾い直して確認ダイアログを再表示し、`accept_project_invite()`を再実行して「既に使用されています」エラーになっていた。

- ②の3分岐（メール不一致・成功・失敗）全てで、既存の`stripInviteParamFromUrl()`を再利用して`window.history.replaceState()`でURLから`?invite=`を外すようにした（`App.tsx`）。新しい処理は書いていない。
- 成功時はreloadの**前**に外す（reload後はURLを読み直すため、reload前に書き換える必要がある）。

### 件3：招待されたPJがサイドバーに出ない

**【v3.188で前提が変わった】トグルはPJ一覧を絞らなくなり、下の空状態メッセージ・「全件に切り替える」ボタンは撤去した（一般則と初期値は、各ビューが空に見えるのを避ける目的で残している）。以下は v3.76 当時の記録。**

サイドバーのPJ一覧「自分／全件」トグルの既定が「自分」で、招待受諾者はまだ担当タスクを持たないため0件になり、「自分が担当するタスクを持つPJはまだありません」と出てPJ自体は見えているのに一覧に現れなかった。

- 🔴 **「招待受諾者かどうか」で分岐するコードは書いていない。** Section 25 Phase 4の`filterInviteGroupsForSidebar()`（「フィルタ結果が0件なら除外前のリストを返す」という一般則）と同じ流儀で、**一般則1つ**で解いた：`src/lib/layout/sidebarMineOnlyDefault.ts`の`resolveInitialSidebarMineOnly(storedPreference, mineCount, allCount)`が「未設定（初回表示）・自分0件・全件1件以上なら『全件』を初期値にする」を判定する。**これなら招待受諾者だけでなく「まだ自分のタスクが1件も無い新入社員」も同じ理屈で救われる。**
- `MainLayout.tsx`の`mineOnly`の`useState`初期化関数から呼ぶだけ（初期化関数は初回マウント時にしか実行されないため、以後ユーザーが明示的に切り替えた選択を上書きすることはない。localStorageに選択済みの値（`KEYS.SIDEBAR_MY_PROJECTS_ONLY`が`"0"`/`"1"`）があれば常にそちらを優先する）。
- 空状態のメッセージ（`layout.sidebar.noMineProjects1`/`2`）に「「全件」に切り替える」ボタン（`layout.sidebar.switchToAllProjects`）を追加し、既存の`onToggleMineOnly`をそのまま呼ぶ（新しい切替経路は作っていない）。
- 回帰テストは`src/lib/layout/__tests__/sidebarMineOnlyDefault.test.ts`（自分0件／全件0件・自分0件／全件2件・自分3件／全件5件・明示的に切り替えた後の2ケース）。

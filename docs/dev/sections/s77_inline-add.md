## 77. リストの中でその場でタスクを追加する（v3.147・2026-10-14）

ポップアップ（QuickAddTaskModal）を開かずに、リスト（PC表）の各グループの一番下でタスクを追加できる。FABの「＋ タスクを追加」は、v3.153 から**リストを開いていても常にポップアップ**（下の「FAB」参照）。

### 仕様（山本さんと合意済み）

- **位置**：各グループ末尾の「＋ タスクを追加」（`ListInlineAddRow`）。押すと行が入力欄（タスク名・担当者・開始日・期日）になる。折りたたまれたグループには出さない。モバイル（カード表示）には出さない（Tab/キーボード前提の行編集がカードに合わないため。モバイルは今までどおりFABのポップアップ）。
- **グループの属性が初期値**（`lib/list/inlineAdd.ts`の`makeSpec`／`defaultsForGroup`。ListView の groups の各要素が `add: GroupAddSpec` を持つ）：PJ別＝そのPJ（「プロジェクト未設定」はPJなし）／ToDoグループ＝そのToDoに紐づく／担当者別＝その担当者／状態別＝その状態／タグ別＝そのタグ（「タグなし」はタグなし）。担当者の初期値は**自分**（v3.153。`emptyDraft(spec, currentUserId)`。ゲストは `__guest__`＝QuickAddTaskModal の既定と同じ）で、担当者別グループのときだけそのグループの担当者。空欄だと作ったタスクがダッシュボード・サイドバーの「自分」絞り込みに出ず、利用者が「追加できなくなった」と感じた（2026-10-15 報告）ため。🔴 **担当者別グループでは担当者を固定**（変えると作った直後にそのグループに表示されないため。行にはアバターだけを出す）。サイドバーでPJを絞り込み中は、PJ別以外のまとめ方（担当者別・状態別・タグ別）でもそのPJに作る（作らないと絞り込みで見えなくなる）。
- **操作**：タスク名で Enter→登録→同じグループの一番下に次の空の行→名前欄にフォーカス（連続入力）。Tab は 名前→担当者→開始日→期日→「詳細を入れて追加」（DOM上は担当者列が先頭のため、行の keydown で自前に移す。担当者候補のポップオーバー（Portal）由来のイベントは扱わない）。Esc（名前欄）または行末の✕でやめる。名前が空なら登録しない。保存中は `createInlineSubmitter` の busy ガードで二重登録しない（保存中の名前欄は readOnly）。IME 変換確定の Enter は無視。日付の入力は既存の `InlineEditDate`（押すか Enter で選ぶ）。担当者は `InlineEditAssignee`（候補は表示部署のメンバー＋PJ参加者。Section 71 と同じ規則）。
- **作成処理は共通**：新設 `lib/task/newTask.ts` の `prepareNewTask`／`nextDisplayOrder`／`validateTaskDateRange`。QuickAddTaskModal もここを通す（親のPJ追従・display_order の採番・finalized_mentions）。保存は `saveTask`（group_id＝表示部署・変更履歴・ゲストのメモリ保存・B1ゲートはストア側）。親タスクなしのトップレベルとして作る。開始日が期日より後なら、リスト・モーダルとも追加せずトースト（モーダルはこれまで min/max 属性だけだった）。ゲストは `canGuestEdit(isGuest,"task")` が偽なら行を出さない。
- **FAB（v3.153で変更）**：PC側FABの「＋ タスクを追加」は常にポップアップ（`setIsQuickAddOpen(true)`）。以前（v3.147〜v3.152）はリストを開いていると追加行へ移したが、仕様変更で撤去した（`inlineAddRegistry`・ListView の `fabAddRef`・登録 effect は削除済み。`inlineAddWiring.test.ts` が「FAB はポップアップのみ・レジストリが無い」をコメント除去のソース走査で固定）。追加行の端の「詳細を入れて追加」は QuickAddTaskModal を開く（名前・担当者・日付・状態・ToDo・タグを引き継ぐ。`defaultName`／`defaultAssigneeId`／`defaultStartDate`／`defaultTags` を追加）。
- **絞り込み中に見えないタスク**：作成前に id を控え、描画後に絞り込み後のタスクに含まれなければ「追加しました（今の絞り込みでは表示されません）」（`useListInlineAdd`）。
- **並べ替え**：追加行は常にグループの一番下（行の並びの最後に描画するだけで、sortKey に左右されない）。

### Esc・未保存確認の判断（Section 46 の対象にするか）

- **Esc は確認なしで破棄**する（入力は名前1行＋日付・担当者で、Esc は利用者の明示的な意思表示。確認を挟むと連続入力のテンポを壊す）。
- **画面を離れる経路は Section 46 の対象**にした：名前が入った下書きがあるとき、`useListInlineAdd` が `registerUnsavedEditor` に登録し、`guardedNavigate`（ビュー切替・部署切替・OKRモード切替・ラボ・管理画面）と `handleLogout` で「保存していない変更があります」の確認が出る。理由：Enter を押さずにほかの画面へ切り替えると無言で消えるため（編集画面の明示保存と同じ種類の事故）。名前が空白だけの下書きは未保存扱いにしない。まとめ方・フィルタの切替では ListView は消えず、下書きはグループごとに残る（グループが一時的に無くなると描画されないが保持される）。

### 機械チェック・テスト

`src/lib/task/__tests__/newTask.test.ts`・`src/lib/list/__tests__/inlineAdd.test.ts`（グループ別の初期値・作成直後にそのグループへ表示される条件・連続入力の採番・二重登録・日付検証・Tab順・FABレジストリ）・`src/components/list/__tests__/inlineAddWiring.test.ts`（ソース走査：FABの分岐はPC側だけ・処理されなければポップアップ・追加行はPC表のみ・未保存編集レジストリ登録・IME。コメント行を除いて走査し、条件を外すと赤くなることを確認済み）。`finalizedMentionsAllPaths.test.ts` は新規登録が `prepareNewTask` 経由で finalized_mentions を確定することを検査するよう更新。

### 未対応・留意

- 描画テスト基盤が無いため、追加行の実際の操作（Tab順・フォーカス・スクロール・ポップオーバー）は実機確認が要る。
- 追加行の「優先度」「工数」列（詳細表示）は空欄のまま（その場追加は4項目のみ）。
- `MIN_CLIENT_VERSION` は上げない（DB・RLS・Edge Function・localStorage の形式は変更なし）。マイグレーションなし。

### v3.148：独立レビュー指摘の修正（realtime の正しさ）

「チーム全員で同時にタスクを登録すると、他の人の変更がリロードするまで反映されない」という要望を受けて、v3.146 の差分反映の穴を塞いだ。

- **間引きで捨てない**（`createResyncRunner`）：間隔（30秒）内に呼ばれた分は、間隔が明けた時点で1回だけ後追い実行する。アンマウントで `cancel()`。
- **load() の取得中の差分**：取得中に届いた realtime 差分はキュー（上限2000・超えたら追従 load を1回予約）に溜め、`set()` による丸ごと置き換え（Phase 1・Phase 2 それぞれ）の直後に順に再適用する。古さ判定を通るので、取得結果より古い差分は捨てられる。
- **購読が張られるまでの取りこぼし**：初回 load の開始から購読有効までの間の変更は、最初の SUBSCRIBED（`onFirstSubscribed`）で `fetchChangesSince`（`updated_at >= 起点−2分`、中間表は `created_at`）の小さな問い合わせで埋める。**全件 load を二重に走らせると起動時の通信が倍になる**ため採らなかった（購読を先に張って load を待たせる案も起動を遅らせるため不採用）。限界：中間表（task_projects 等）の「解除」（DELETE）はこの窓の中では拾えない。失敗したら間引いた全件再取得に切り替える。切断を経ての最初の接続は `onResync`（全件）が埋めるので重ねない。
- **見える範囲が変わる変更は全件再取得を要求**（`shouldResyncOnRemoteChange`・要求先は `setRemoteResyncRequester` で App.tsx の resync ランナー）：tasks/projects の DELETE・手元に無い id の UPDATE・projects の UPDATE で `group_id`／`group_ids`／`member_ids`／`owner_member_id(s)` が手元と変わったとき。INSERT は通常の新規行なので要求しない。
- **UPDATE は既存の行に重ねる**（`{...既存, ...届いた行}`）：realtime の new は TOAST 化された未変更の大きな列（tasks.comment 等）を載せないことがあり、丸ごと置き換えると既存値が消える。キーが無い列は既存値を残し、キーがあって null の列は null にする。tasks/projects の正規化（`normalizeTaskRow`/`normalizeProjectRow`）は**重ねたあとの行**に対して行う（載らなかった配列列を `[]` で埋めてしまわないため）。
- **古さ判定**（`isStaleRemoteUpdate`）：文字列比較をやめ、`Date.parse` の数値比較（`+09:00` と `Z` のように書式が違っても正しく比べる）。**同値のときは後から届いた方を採る**（同じトランザクションの2回 UPDATE）。内容が同じなら配列の参照を変えない（自分の保存のエコーで再描画しない）。既知の限界：同値のエコーが自分の保存中の楽観更新より遅れて届くと、次の更新（より新しい updated_at）のエコーが来るまで一瞬戻って見えうる。
- **見張り `realtime-silent`**（`realtimeEchoWatch.ts`）：自分の保存（`upsertTask`／`upsertProject` の成功）の realtime エコーが10秒以内に届かなければ、セッション中1回だけ `logDiagnostic`（code=`realtime-silent`、context に表・チャンネル状態（`realtimeState.ts`）・経過秒）。エコーが保存の応答より先に届く場合に備え、直近30秒のエコーを覚えて照合する。`DIAGNOSTIC_CODES` に加え code ごとに束ねる。管理画面「エラー」タブに出る＝**利用者の実環境でイベントが届いていないかを知る手がかり**。
- その他：動的 import 失敗のメッセージに入るハッシュ付きファイル名・URL は fingerprint の正規化で束ねる（デプロイごとに別の行にならない）。`PersonalOkrView` のサンプル読み込みの `Promise.all` に catch（`reportError`）。チャンク失敗の文言は「新しい版が公開されたか、通信が不安定です」。`ReloadNoticeBanner` は版の通知とチャンク失敗の通知を別 state で持つ。
- **届かない原因の調査結果（コードで確定できた範囲）**は報告書に記載（本番 DB の照会が必要な点は SQL 案）。購読の対象外の表（groups・objectives・member_tags 等）と `in_app_notifications`（publication 未追加）は今回も触っていない。
- **v3.158：`realtime-silent` の切り分けと自己回復**（`realtimeEchoWatch.ts`）。本番で2人・3回（v3.154・context「表:tasks / チャンネル:SUBSCRIBED / 経過10秒」）届き、記録だけでは ①配信の遅延（Disk IO 逼迫）②SUBSCRIBED のまま実は切れている ③裏タブのタイマーのずれ を区別できなかった。
  - **10秒で即記録しない**：10秒を過ぎたら「遅延」として待ち（`ECHO_TIMEOUT_MS`）、届いた時点または60秒（`ECHO_GIVEUP_MS`）で、セッション中1回だけ記録。context＝`表 / チャンネル / <結果>（経過N秒） / 10秒時点:<visible|hidden> 記録時点:<…> / 待ちN件`。結果は「遅れて届いた」「realtimeでは届かず差分取得で補完」「60秒以内に届かず」の3通り。code は同じ `realtime-silent`（束ね方は変えない）。
  - **保存した時点で hidden のタブは見張らない**（裏タブはタイマーとハートビートが止まり、遅延と区別できない。セッション1回の記録枠も消費しない）。保存後に hidden になった場合は「10秒時点／記録時点」の差で分かる。
  - **自己回復**（記録とは別に、待ちがなくなるまでの波ごとに1回）：10秒＝`catchUpRemoteChanges(Date.now())`（`fetchChangesSince` の差分取得・全件 load はしない・専用の `createResyncRunner` で30秒の最短間隔）。60秒＝購読 effect の世代 `realtimeEpoch` を進めてチャンネルを張り直す（5分に1回まで。最初の SUBSCRIBED の `onFirstSubscribed` が取りこぼしを差分取得で埋める）。要求先は `setEchoRecoveryRequesters`（appStore.ts・`setRemoteResyncRequester` と同じパターン）。**記録がセッション中1回でも、回復の要求は記録後も続く。**
  - **差分取得経由の到着は realtime の到着として数えない**：`handleRemoteChange` が `noteRemoteEcho(…, opts.noResync ? "catchup" : "realtime")`。差分取得の行は先着の記憶（`seen`）にも残さない。
  - **記録の読み方**：①「遅れて届いた（経過10〜60秒）」＝配信の遅延（Disk IO・負荷）。経過秒の分布を見る。②「realtimeでは届かず差分取得で補完」＝接続が実は切れている（SUBSCRIBED のまま）。チャンネル状態が SUBSCRIBED なら疑いが強い。③「60秒以内に届かず」＝差分取得でも埋まらない（保存自体が遅い・差分取得の失敗・RLS で自分に見えない行）。①〜③とも「10秒時点:hidden」なら裏タブの影響（保存後に隠した）を先に疑う。チャンネルが CLOSED／TIMED_OUT／CHANNEL_ERROR なら切断中の保存。

---

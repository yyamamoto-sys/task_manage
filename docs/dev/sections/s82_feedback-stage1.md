## 82. アプリ内フィードバック 段階1（v3.157・2026-10-15）

**設計の正本：[docs/dev/企画提案_アプリ内フィードバック_20261015.md](docs/dev/企画提案_アプリ内フィードバック_20261015.md)。** このセクションは実装の要点と守るルール。段階2（エラー表示の横の「この状況を報告」・ショートカット・DOM の構造・直前のエラー）と段階3（対応済み／見送りの通知と一言返信・集計）は未着手。

利用者の「ここが使いにくい」を、コメント1つ＋そのときの画面の状況つきで10秒で送れるようにし、管理者（super_admin）がそのまま Claude に貼って改修に進める。エラーにならない不満・要望を拾う入口がなかった（エラーは Section 67 で自動収集済み）。

### 山本さんの決定（2026-10-15）
1. スナップショットは**既定オン**（構造データのみ・画像なし・業務データの文字列なし・送信前にプレビュー・本人がオフにできる）。
2. 読めるのは **super_admin のみ**（group_id は保存しておく。部署の管理者への開放は段階3で `app_feedback` に RLS の1ポリシーを足すだけ）。
3. 返信は段階1では**状況表示のみ**（本人の「送った内容」で 新規／対応中／対応済み／見送り が見える。通知・一言返信＝`reply_text` は段階3）。
4. **記名**（送信者は member_id で保存し、管理画面にだけ表示。Claude 用コピーには名前・メールを載せない）。

### 入口と送る側の体験
- 入口は2つ：ベルのパネル上部「💬 ご意見を送る」（「⚙ 通知設定」の隣）と、設定「🛟 困ったとき」の「ご意見・不具合を送る」。どちらも `requestOpenFeedback()`（`src/lib/feedback/capture.ts`・window イベント）を呼ぶだけで、`MainLayout` が受ける。ゲストには出さない（`isGuest` で入口もイベントの購読も無い・`submitFeedback` も先頭で拒否・RPC も匿名を拒否）。
- モーダル `src/components/feedback/FeedbackModal.tsx`：種類は任意の3択チップ（もう一度押すと外れる・未選択は `unspecified`）／コメント1,000字（DB は2,000字）／「画面の状況を付ける」（既定オン）／「送る内容を見る」（人が読む要約＋実際に送る JSON）／注意書き「社外秘・個人情報は書かないでください」／Ctrl・Cmd+Enter で送信（IME 確定は無視）／「送った内容と状況」タブ（`list_my_feedback`・本文・日時・状態だけ）。
- 成功はトースト、失敗は入力を保持したまま永続のエラー帯（Section 45・15）。頻度上限は理由を文言で示す。`throttled`（同一本文の1分以内の再送）は黙って成功として扱う。入力中の離脱・閉じる操作は `useUnsavedEditor`（Section 46）＋確認。
- 🔴 `createPortal(document.body)` の要素なので `pointerEvents:"auto"` を明示（Section 51。`floatingPanelContract.test` が検査）。モーダルは `modalStyles.ts` の契約（Section 21）。

### スナップショット（`src/lib/feedback/snapshot.ts`・許可リスト方式の純関数）
- **入る項目**：画面名（`getClientErrorScreen`）／ビュー・モード・開いているオーバーレイ・設定ページ（ID）／アプリの版／ブラウザ名・メジャー版・OS（UA の要約。全文は送らない）／ウィンドウ幅×高さ・画面の大きさ・devicePixelRatio・拡大率（dpr×100＝ブラウザの拡大と OS の倍率の合算）・PC／モバイル・言語・テーマ／表示部署 ID（名前は送らない）／選択中の PJ・タスクの ID と選択件数（名前は送らない）／リスト＝まとめ方・並び順・向き・密度・絞り込み（状態・優先度・自分のみ・今週・完了を隠す・担当者は all／set だけ・検索は「入力があるか」の真偽）／ガント＝PJ別・人別／1日の幅 px／各トグル／カンバン＝完了を隠す・保留中止の表示・グループ絞り込みの有無／経路（pathname と既知の `open` だけ。クエリ・ハッシュは除く＝招待コード対策）／直近5件のクリック（タグ名・role・`data-tour-id`・N 秒前・座標 px と比）。
- **入らないもの**：画像・タスク名・PJ名・コメント・検索語・メール・表示名・生の UA・DOM の構造・直前のエラー（後二者は段階2）。
- **構築**：`buildFeedbackSnapshot(input)`。形式（列挙値は `^[A-Za-z0-9_:.-]{1,48}$`・ID は `^[A-Za-z0-9_-]{1,64}$`・数値は範囲）に合わない値は黙って落とす。出力に許可していないキー・文字列は現れない（`snapshot.test` が秘密語の不在で固定）。最上位のキーは `SNAPSHOT_TOP_LEVEL_KEYS`＝DB の `submit_feedback` が残すキーと一致（`feedbackMigration.test` が SQL の配列と照合）。
- **材料は画面側が登録する pull 型**：`useSnapshotProvider(id, getter)`（`src/hooks/useSnapshotProvider.ts`・`snapshotContext.ts`。`unsavedEditorRegistry` と同じ作法。インスタンスごとに一意のキー＝AI 提案プレビューのガントが本体の登録を上書き・解除しない）。登録先：MainLayout（mode・view・overlay・isMobile・theme・lang・表示部署 ID・選択 PJ ID）／ListView／GanttView（プレビューは登録しない）／KanbanView／SettingsView（設定ページ）。**スナップショットの構築側は MainLayout・リスト・ガント・カンバンの内部 state・DOM を直接読まない。**
- **クリック履歴**：`src/lib/feedback/clickHistory.ts`。capture フェーズの1リスナー・メモリ上に5件だけ・`AuthenticatedApp`（`App.tsx`）で起動しゲストでは起動しない・キー入力は記録しない・要素の文字・属性値は読まない・プログラムが出したクリック（`isTrusted=false`）とキーボード操作（`detail=0`＝座標なし）は座標を持たせない／無視する。**`data-feedback-ui` を持つ要素の内側（ベルのトリガーとパネル・入口のボタン・モーダル）のクリックは記録しない**（入口を押したクリックが履歴の末尾に混ざらない）。
- **モーダルを開いた瞬間に確定**：入口のイベントを `MainLayout` が受けたその場で `captureFeedbackSnapshot()`（同じクリックの処理の中）→ 確定済みの `capture` をモーダルへ渡す。モーダルは撮り直さない（`feedbackWiring.test` が固定）。
- **16KB 上限**：`finalizeSnapshot` が超えたら null＋`too_large`（本文だけ送る）。DB も整形後16KB・生64KB で同じ判定。通常は数KB。
- **オフ**にすると snapshot は送らず `snapshot_state='off'`（種類・コメント・画面名・版・経路だけが列に入る）。

### DB（`20261015b_app_feedback.sql`・山本さんが dev→prod に手動適用）
- `app_feedback`（member_id・group_id・kind・comment 1〜2,000字・screen・route・app_version・snapshot jsonb・snapshot_version・snapshot_state［attached／off／too_large／purged］・status［new／in_progress／done／wontfix］・admin_memo・status_changed_at／by・reply_text［段階3］・created_at／updated_at）。`update_updated_at()` トリガー。
- **RLS は SELECT のみ（super_admin・`(SELECT public.current_member_is_super_admin())` で包む＝Section 39）。INSERT／UPDATE／DELETE のポリシーは作らない**（書き込みはすべて RPC）。🔴 送信者本人には表を直接読ませない（行の RLS だけでは `admin_memo` を隠せない）→ `list_my_feedback()`。
- RPC（すべて SECURITY DEFINER・`SET search_path=''`・PUBLIC／anon から REVOKE）：`submit_feedback`（本人は `current_member_id()`・匿名／ゲスト／未登録は例外・同じ人のアドバイザリロック→同一本文の1分以内は `throttled`→24時間の件数で `limited_hour`［1時間3件］／`limited_day`［10件］・本文と画面名・経路は `redact_client_error_text`・スナップショットは最上位の許可キーだけ残して `sanitize_feedback_json` で再帰整形［深さ5・40キー・配列10・文字列200字・伏せ字］・表示部署は本人のアクセス範囲だけ採る・super_admin へのアプリ内通知を同じトランザクションで作る）／`update_feedback_status`・`update_feedback_memo`（super_admin 以外は例外）／`list_my_feedback`（admin_memo・スナップショットを返さない）。`cleanup_app_feedback()`・`sanitize_feedback_json` は authenticated にも REVOKE。
- **保持**：`cleanup_app_feedback()` がスナップショットを受信後90日で NULL（`purged`）・対応済み／見送りは状態変更から180日で削除（新規・対応中は消さない）。**pg_cron の登録は別ファイル `20261015c_schedule_app_feedback_cleanup.sql`**（プレースホルダー無し・手で登録）。
- 通知の種類に `feedback` を追加（`in_app_notifications.kind` の CHECK・レジストリ・i18n・`ALL_IN_APP_KINDS`・`schemaChecks.ts`＝Section 67 末尾の手順どおり）。super_admin 向け・アプリ内のみ（Windows は未対応＝v1）・既定オン・クリック先 `/?open=admin-feedback`（`deepLink.ts` に `admin-feedback`）。通知本文は先頭80字＋画面名。
- 確認済み：`current_member_group_ids()` は text[]（schema.sql）。**未確認**：実機の SQL Editor での実行（構文は pglast で検査済み）。

### 管理ページ（設定「アプリの管理」→「💬 ご意見・不具合」・`SettingsPageId` に `feedback`・19値）
- `src/components/admin/FeedbackSection.tsx`：一覧（既定は新規＋対応中・状態と種類で絞り込み・受信日時・種類・画面・版・本文の1行目・メモの有無）／詳細（本文全文・送信者名［この画面だけ］・画面・部署 ID・画面の状況の要約＋JSON）／状態の切替は**即時保存**（途中状態が生まれない＝Section 65）／管理者メモは**保存ボタン**（`useFormSave`・未保存は `onDirtyChange` で Section 46 に乗る）／複数選択して Claude 用にコピー。
- 一覧はスナップショットを取らない（1件最大16KB で重いため）。詳細を開いたとき・コピーするときに必要な分だけ `fetchFeedbackSnapshots`。
- **未適用**（表・RPC が無い）のときは「適用がまだです」を出して一覧は空のまま（`isFeedbackNotAppliedError`・Section 24 Step Q の W2 と同じ方式）。管理者には `SchemaHealthBanner` も出る。
- **Claude 用コピー**：`buildFeedbackCopyText`（`src/lib/feedback/copyText.ts`・errorCopyText.ts と同じ考え方）。依頼文＋項目＋本文（柵は `fenceFor`）＋スナップショットを人が読む形と JSON の両方。🔴 **送信者の ID・名前・メール・管理者メモは載せない**（入力の型に持たせない）。コピー前にも `redactSensitive`。貼り先は Claude のみとする注意書きを依頼文と画面に出す。クリップボードは `src/lib/clipboard.ts`（2段のフォールバック・失敗時は選択済みの textarea）。

### 🔴 ルール：画面の状態をスナップショットに足すとき
- **画面側が `useSnapshotProvider` で登録する getter の返り値に足す**。返してよいのは列挙値・数値・ID・真偽だけ（文字列の業務データ・検索語・名前は返さない）。足したら `snapshot.ts` の許可リスト（`build*Settings` の取り出し）にも足す（足さなければ出力に現れない）。最上位に新しいキーを足すなら **`SNAPSHOT_TOP_LEVEL_KEYS` と DB の `submit_feedback` の許可キー配列の両方**に足す（`feedbackMigration.test` が一致を検査）。
- **入口を足すときは `requestOpenFeedback()` を呼び、入口のボタンに `data-feedback-ui=""` を付ける**（クリック履歴に入れない）。ゲストには出さない。
- ご意見の項目（種類・状態・上限）を変えるときは `src/lib/feedback/constants.ts` と SQL の CHECK・RPC の数値を一緒に直す（`feedbackMigration.test` が照合）。

### テスト
`src/lib/feedback/__tests__/`（snapshot・clickHistory・snapshotContext・browserInfo・copyText・limit・feedbackMigration）と `src/components/feedback/__tests__/feedbackWiring.test.ts`（ソース走査・コメント除去＝Section 59）。**配線とコピー・許可リスト・SQL の文面の10か所をわざと壊して赤くなること、戻して緑になることを確認済み**（feedbackWiring.test 冒頭に記録）。`notificationKinds.test`（8種類・最新の CHECK の照合先を 20261015b に更新）・`settingsPages.test`（19ページ）・`rawMembersUsage.test`（FeedbackSection＝送信者名の解決のみ）を更新。

### 適用の順序（🔴 逆にすると入口から送れず、管理ページが「適用がまだです」になる）
1. `20261015b_app_feedback.sql`（dev → prod。末尾の DO ブロックが全行 OK を例外メッセージで返す）
2. フロントを main へ push（`MIN_CLIENT_VERSION` は上げない＝新しい表・RPC の追加だけ。旧画面には入口が出ないだけで壊れない）
3. 本番で `20261015c_schedule_app_feedback_cleanup.sql`（pg_cron）

### 未対応・留意
- 描画テスト基盤が無いため、入口（ベル・困ったとき）の押下からモーダル・送信・「送った内容」・管理ページの操作・コピーは実機確認が要る。クリック履歴の座標・拡大率の実測値も実機で確認する。
- 表示部署 ID が `grp-invite-<uuid>`（招待用部署）のとき、DB の伏せ字（40字以上の英数字の塊）で `[redacted]` になる。招待受諾者のご意見で部署 ID が読めないだけで、他は影響なし。
- 通知は super_admin 本人が送信した場合も本人に出る（動作確認を兼ねる）。Windows 通知は段階3以降。


---

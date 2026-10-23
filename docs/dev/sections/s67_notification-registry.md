## 67. 通知の種類のレジストリ・管理者向け通知・利用者の画面のエラー記録・右上のベル（v3.129・2026-10-01）

山本さんの要望（2026-10-01）：①super_admin だけに出る通知とそうでない通知を区別したい ②誰かの画面でエラーが出たら super_admin に知らせ、設定の管理セクションで詳細を見たい ③何を通知するかを細かく選びたい ④ベルを右上に常時表示し、未読数を赤いバッジ（99+）で出したい。v3.128（Section 66）の上に載せた。

### 通知の種類のレジストリ（唯一の定義）

`supabase/functions/_shared/notificationKinds.ts`（Deno・DOM 非依存の純粋なファイル）。**Edge Function もフロントもこの1ファイルを読む**（フロントは `src/lib/notifications/notificationKinds.ts` が相対 import して、アイコンと未読バッジの表記だけを足す。表示名・説明は i18n `layout.notifyKind.<id>.label/.desc`）。

| id | 対象 | アプリ内 | Windows | in_app の kind | 旧列 |
|---|---|---|---|---|---|
| deadline_overdue | 全員 | ○（既定オン） | ○（既定オン） | deadline_digest | notify_overdue |
| deadline_due_today | 全員 | ○ | ○ | deadline_digest | notify_due_today |
| mention | 全員 | **非対応**（アプリ内の行を作らない。タブを開いている間のブラウザ通知のみ） | ○ | — | — |
| client_error | **super_admin** | ○ | ○（30分ごとにまとめて） | client_error | — |
| backup_failure／backup_weekly_summary（v3.136） | **super_admin** | ○ | ○ | 同名 | — |

- **判定は `isKindEnabled(prefs, kindId, channel)` の1関数**＝チャネルの全体スイッチ（`inapp_enabled`/`push_enabled`）AND 種類×チャネル（`kind_channels`）AND（期限の2種類のみ）v3.128 の旧列。push-reminders（`_shared/reminderLogic.ts` の `buildDigests`）・メンション（`useMentionNotifications`）・エラーのまとめ通知（`_shared/clientErrorDigest.ts`）がこれを使う。`log_client_error`（SQL）だけは既定値を直書きしており、`notificationKinds.test.ts` がマイグレの文面と照合する。
- **見分け**：`audienceOfInAppKind(kind)`。管理者向けは 🛡「管理者向け」の印と紫（`--color-*-purple`）。

### バックアップ通知（v3.136・設計書 §6.2・フェーズ5.5）

- レジストリに `backup_failure`（💾）・`backup_weekly_summary`（🗂）を登録（super_admin 向け・既定はアプリ内・Windows ともオン）。in_app の kind は同名で、CHECK 制約は 20261001 から許可済み（マイグレ不要）。
- `backup-daily` が partial/failed・backup_finalize の失敗・週次サマリ（JST 月曜）で、super_admin（削除済みを除く）へ `in_app_notifications` を書き、Windows は `sendToSubscriptions`。文面と宛先の判定は `_shared/backupNotice.ts`（`src/lib/reminder/__tests__/backupNotice.test.ts`）。
- 🔴 本文に失敗理由（例外メッセージ）を載せない（理由は `backup_runs.error_message` に伏せ字済みで残る）。通知の失敗はバックアップの成否を左右しない（ログのみ）。クリック先 `/?open=admin-backup`。

### 個人設定の持ち方（既存の値を壊さない移行）

`notification_prefs.kind_channels jsonb NOT NULL DEFAULT '{}'`（`{ "<種類>": { "inapp": bool, "push": bool } }`。キーが無ければレジストリの既定値）。列にしなかったのは、種類を足すたびにマイグレが要らないようにするため。
- マイグレは `notify_overdue`/`notify_due_today` が false の人だけ、その種類を両チャネルともオフで移す（既に値があれば触らない＝冪等）。**旧列は消さず、判定の条件にも残す**（再読み込み前の v3.128 の画面が旧列だけを書き換えても効く）。新画面は種類を変えるたびに旧列も「どちらかのチャネルがオンか」で書き直す（`buildKindChannelPatch`）。
- 設定画面「🔔 通知」の「通知する内容」は種類×チャネルの表。管理者向けの種類は super_admin にだけ出す（`kindsVisibleTo`）。全体スイッチがオフのチャネルの列はチェックできない。送信時刻は既存のまま。

### 利用者の画面のエラー記録

- **拾うもの**：`reportError()`（`app:error`。ErrorBoundary のクラッシュもここを通る）・window の `error`・`unhandledrejection`。`main.tsx` で React の外に取り付ける（`installClientErrorLogging`。ErrorBoundary が App を置き換えた後も拾うため）。開発サーバーでは既定で送らない（`VITE_LOG_CLIENT_ERRORS_IN_DEV=1` で送る）。ゲスト・匿名・未ログインは送らない。
- **送る内容を絞る**：message 500字・stack 2000字・context 200字に切り、メールアドレス・JWT・Bearer トークン・40字以上の英数字の塊を伏せる（画面側 `redactSensitive` と DB 側 `redact_client_error_text` の二重）。`AppError.raw`（入力内容やリクエスト本文を含みうる元のエラー）は送らない。
- **同じエラーは1件**：fingerprint＝種類・コード・正規化したメッセージ（数字・UUID・引用符の中身・クエリを置換）・操作（ErrorBoundary は位置を除く）の FNV-1a 16桁。伏せ字・切り詰めの**後**で計算する。
- **書き込みは RPC `log_client_error` 1本**（SECURITY DEFINER）。本人は `current_member_id()` で決める（引数で他人を名乗れない）。匿名・未登録は例外。🔴 乱用対策：同じ人・同じ fingerprint は1分に1回だけ数える（`throttled`）、1人が1時間に新しく記録できる fingerprint は50件まで（`limited`）。画面側でも同じ fingerprint は1分に1回・1タブ1時間30件まで。
- **読むのは super_admin だけ**（`client_error_logs`/`client_error_reporters` の RLS は SELECT のみ）。解決は `resolve_client_errors`（super_admin 以外は0件）。保持90日（`20261001d_schedule_client_error_cleanup.sql`。プレースホルダー無し・手で登録）。
- 🔴 **無限ループ防止**：記録の RPC が失敗しても `reportError` も再記録もしない（`console.warn` のみ）。記録の準備中に同期的に戻ってきたエラーは拾わない（再入ガード）。送信の Promise は必ず catch する（`unhandledrejection` に戻さない）。

### エラーの届け方

- **アプリ内はすぐ**：`log_client_error` の中で「新しい fingerprint が初めて記録されたとき」「解決済みが再発したとき」に、super_admin 全員（エラー種類のアプリ内がオンの人）の `in_app_notifications` に1件作る。同じ fingerprint は1時間に1回まで、1人の super_admin につき1時間10件まで。クリック先 `/?open=admin-errors`（設定 → 部署の管理 → アプリ設定 → エラー）。
- **Windows は30分ごとにまとめて**：push-reminders の cron 実行のたびに、前回以降に `last_notified_at`（＝新しい fingerprint が初めて記録された、または解決済みが再発した時刻）が更新されたエラーの件数を super_admin（Windows通知オン・エラー種類の Windows オン）へ1回送る。🔴 既知の未解決エラーがただ繰り返しただけ（`last_seen` は進むが `last_notified_at` は進まない）では送らない（独立レビュー指摘・軽。「またこれか」の繰り返し通知にしない）。🔴 **期限リマインドの1人1日1回（reminder_send_log）とは別枠**。どこまで送ったかは `notification_cursors`（service_role のみ）に持ち、送信の成否に関わらず進める（再送しない）。失敗は `reminder_runs` を partial にして `error_summary` に残す。手動実行・dryRun・テストでは送らない。`reminder_runs.error_digest_sent` に届いた購読数。
  - 🔴 **「休日でも送る」ではない**（独立レビュー指摘・軽で訂正）：cron 自体が平日 JST 7:00〜19:30 のみ起動する（`20261001b_schedule_push_reminders.sql`）。土日に起きたエラーは実行されず、月曜7:00の実行が前回からの窓でまとめて拾う。祝日は cron の曜日判定だけで動き休日判定を関知しないため、**平日の祝日は通常どおり送る**（期限リマインドの holiday skip は `runErrorDigest` の後に判定するため、まとめ通知には影響しない）。

### 管理画面「エラー」タブ（`ClientErrorSection.tsx`・super_admin のみ）

一覧（最終発生・回数・発生した人の数・メッセージ・画面・版）／詳細（種類・操作・コード・画面と経路・最初の発生・最後に起きた人・ブラウザ・発生した人の内訳・スタック）／解決済みにする・未解決に戻す／未解決のみ表示。直近200件。

### 右上のベル

- **PC**：画面右上に `position:fixed`（`src/lib/layout/topRightBell.ts`）。AI相談パネルが開いていればその左へ退く（FAB と同じ避け方）。z-index 45（モーダルより下・ビューより上）。サイドバー下部のベルは撤去。
- 🔴 **各ビューのヘッダーは右端に `withBellReserve(元の余白)` を padding-right に入れる**（CSS 変数 `--app-bell-reserve`。PC かつゲスト以外のときだけ MainLayout が値を入れる）。対象：一覧ツールバー・カンバン・ガント・ダッシュボード・ワークロード・OKR・カレンダー・マイページ・体制図・関係性グラフ（右上の操作群）・タスク詳細サイドパネル・設定とガイドの見出し行。**新しい画面を足したら、右上の角に来るヘッダーに `withBellReserve` を入れ、`topRightBell.test.ts` の `HEADER_FILES` に足す**（コメントを除去して走査する。外すと赤くなることを確認済み）。
- 右上に出るカード型のヘルスバナー（Schema/Reminder）は `BELOW_BELL_TOP_PX` に下げた（ベルと重ねない）。右下（ショートカット・FAB）とは縦に離れている。
- **モバイル**：ヘッダーの右側に同じ白い丸ボタン（32px）。モバイルの全画面ラボ表示中は隠れる。
- 未読バッジは `formatBadgeCount`（0 は出さない・100 以上は 99+）。super_admin には一覧に「すべて／🛡 管理者向け」の切替（管理者向けは kind で絞ってサーバーから取る）。
- 🔴 **v3.135（v3.133 の再適用）：バッジはベルのボタンの外（兄弟要素）に置く**（`bellBadgeStyle()`・`src/lib/notifications/bell.ts`）。`globals.css` の `button:not(:disabled) { position: relative; overflow: hidden; }` が全ボタンに付いており、ベルは `border-radius:50%` の円なので、ボタンの子にすると円の外にはみ出した数字が切り取られる（v3.129〜v3.132 の見切れの原因。v3.130 の位置調整では直らなかった）。バッジは幅を固定しない（minWidth のみ・nowrap）。`createPortal` で body 直下へ出す案は採らない（`#root` が `isolation:isolate` のため、body 直下の z45 は #root 内のモーダル z200 より上に描かれ層が崩れる）。`bell.test.ts` がボタンの内側にバッジが無いことを走査する。
- **v3.135（v3.133 の再適用）：未読数の即時更新**：`subscribeInAppNotifications`（`src/lib/supabase/notificationRealtime.ts`）が自分の `in_app_notifications` の INSERT/UPDATE を `member_id=eq.<自分>` で購読し、届いたら取り直す（RLS＝本人の行だけ、が Realtime にも効く。DELETE は購読しない）。要マイグレ `20261002b_in_app_notifications_realtime.sql`（publication への追加）。未適用・接続失敗は `console.warn` のみで、3分ポーリング（延ばさない）で動く。自分の操作の直後は `requestBellRefresh()`（`src/lib/notifications/bellRefresh.ts`・window イベント）。
- **v3.135（v3.133 の再適用）：一覧のタブは `bellTabsFor()`**（一般＝タブ列なし／部署の管理者＝すべて・📣送信済み／super_admin＝すべて・🛡管理者向け・📣送信済み）。送信済みタブの中身は Section 68。

### ベルの「🛡 エラーをコピー」欄（v3.151・super_admin 専用）

山本さんの要望：届いたエラーの通知の内容を、Claude にそのまま貼れる形でボタン1つでコピーしたい。
- **場所**：ベルのパネルの「⚙ 通知設定」の真下（ヘッダー行の下・タブ列の上）。`InAppNotificationBell` が `{isSuperAdmin && <ErrorCopyPanel …/>}` で描画（super_admin 以外には DOM に出ない。`errorCopyText.test.ts` がコメント除去後のソースで検査）。既定は閉じていて、見出しに件数。
- 🔴 **「新規」の定義**：自分宛ての**未読の `client_error` 通知**に対応するエラー。通知の行には fingerprint もエラーの id も無い（url は固定の `/?open=admin-errors`）ため、**通知の `created_at` ＝ `client_error_logs.last_notified_at`** で結ぶ（`log_client_error` は通知の INSERT と `last_notified_at` の UPDATE を同じトランザクションで行い `now()` が同一）。`matchNewErrors`。スキーマ変更なし・マイグレなし。通知を既読にすると一覧から消える（コピーしても既読にはしない）。同じエラーが1時間後に再通知されると `last_notified_at` が進むので、古い通知は結べなくなるが新しい通知で結ばれる。
- **一覧**：チェックボックス・メッセージの1行目・回数・最終発生。初期は全チェック。「すべて選択／解除」。0件は「新しいエラーはありません」。欄の中だけ縦スクロール（最大150px）。取得は未読通知50件・エラー100件まで。
- **取得**：パネルを開いたとき（欄がマウントされたとき）とタブを切り替えたときだけ。世代番号で古い応答を捨てる。effect の依存は `[memberId, tab]` のみ（`t` は ref・Section 69）。読むのは super_admin だけの `client_error_logs`（`member_id` は select しない）。
- **コピー**：`buildErrorCopyText`（`src/lib/errors/errorCopyText.ts`・純粋関数）。Claude への依頼文＋エラーごとの項目＋メッセージ全文・スタック。🔴 **人の情報は入れない**（`member_id`・表示名・メールは載せず、発生した人数だけ）。コピー前にも `redactSensitive` を通す。コードブロックの柵は中身の最長のバッククォート列+1（`fenceFor`）。日時は JST。文面は日本語固定（Claude への依頼文のため。画面ラベルのみ i18n ja/en）。
- 🔴 **コピー文面のメッセージ・context には利用者の入力（タスク名等）が含まれうる**（伏せ字はメール・トークン類のみ）。貼り先は Claude だけにし、他へ共有しない。
- **コピー手段**：`navigator.clipboard` → `execCommand` → 選択済みの textarea の3段（VersionHistoryModal と同じ）。成功はトースト「N件をコピーしました」。
- MIN_CLIENT_VERSION は上げない・マイグレーションなし。

### 🔴 通知の種類を足す手順

1. `supabase/functions/_shared/notificationKinds.ts` の `NOTIFICATION_KINDS` に1件足す（id・audience・supported・defaults・inAppKind）。`NotificationKindId` にも足す。
2. `src/lib/notifications/notificationKinds.ts` の `NOTIFICATION_KIND_ICON` と i18n（`layout.notifyKind.<id>.label/.desc`。ja・en）を足す（`notificationKinds.test.ts` が欠けを検出）。
3. アプリ内通知を作るなら `in_app_notifications.kind` の CHECK 制約に値を足すマイグレを書き、`ALL_IN_APP_KINDS` も足す（テストがマイグレと照合）。`schemaChecks.ts` に `check_contains` を1行。
4. 送る側は必ず `isKindEnabled(prefs, id, channel)` を通す。Windows通知は `_shared/webPush.ts` の `sendToSubscriptions` を使う（Section 66）。SQL から送るなら既定値を直書きすることになるので、テストで照合する。
5. 管理者向けなら audience を `super_admin` にするだけで、設定画面での表示・ベルの印と色・「管理者向け」の絞り込みは自動で付く。

### 適用の順序（🔴 逆にすると新画面の通知設定が「読み込めません」になる）

1. マイグレ `20261001c_notify_v2_client_errors.sql`（dev → prod）
2. `supabase functions deploy push-reminders --no-verify-jwt --project-ref <ref>`（エラーのまとめ通知・種類×チャネルの判定を含む）
3. フロントを main へ（Vercel が再ビルド）
4. 本番で `20261001d_schedule_client_error_cleanup.sql`（90日削除の cron）

`MIN_CLIENT_VERSION` は上げていない（列の追加と CHECK 制約の拡張だけで、旧画面の読み書き・Edge Function の入出力は壊れない。旧画面が旧列だけを書いても判定に効く）。

### 独立レビュー指摘の反映（`feat/notify-v2`・2026-10-01・バージョン番号は v3.129 のまま）

- **【中】`log_client_error` の伏せ字（正規表現）の計算順序**：DECLARE 節では計算せず、会員確認・頻度上限の判定（throttled/limited）が終わったあとに計算する。`regexp_replace` に渡す前に `left(p_x, 上限×2)` で先に切り、さらに全引数の合計 `octet_length` が64KBを超えたら正規表現を一切使わず `'rejected'` を返す（巨大な入力で高コストな正規表現を会員確認の前に何度も回させない）。
- **【中】`redact_client_error_text` の権限**：`REVOKE ALL ... FROM PUBLIC, anon, authenticated`。SECURITY DEFINER の `log_client_error` の中は関数所有者の権限で動くため、呼び出しは引き続きできる。
- **【中】`kind_channels` の `::boolean` キャストをやめる**：壊れた値（CHECK は `jsonb_typeof = 'object'` までしか見ていない）で例外になりうるため、`COALESCE(np.kind_channels #> '{client_error,inapp}', 'true'::jsonb) <> 'false'::jsonb` に変更（キー無し・不正値はオンとして扱う＝既定オンの方針と一致）。TS 側（`isKindEnabled`/`kindChannelSetting`）はもともと `typeof v === "boolean"` で検証済みで安全。
- **【軽】push-reminders のエラーのまとめ通知**：`last_seen` ではなく `last_notified_at`（新規／解決済みからの再発のときだけ更新される列）で前回以降を数える。既知の未解決エラーがただ繰り返しただけでは送らない。「休日でも送る」の表現を訂正（上記「届け方」参照）。
- **【軽】プライバシー**：`reportError` が PostgREST の `details`（"Failing row contains (…)" 等の行データ）を message に足す前の値を `AppError.logMessage` として持たせ、`clientErrorLog` はそちらを記録する（画面表示の `message` は従来どおり details を含む）。`redactSensitive`／`redact_client_error_text` の両方に、32桁以上の16進・`access_token=`／`refresh_token=`／`apikey=` の値・プレフィックス無しの JWT 形式（xxx.yyy.zzz）の伏せ字を追加。
- **【軽】ノイズ除外**：`chrome-extension://`／`moz-extension://` 由来（`isExtensionOrigin`）・`AbortError`・`lazyWithRetry` が扱う「Failed to fetch dynamically imported module」「Importing a module script failed」は記録しない。
- **【軽】`NotificationSettingsSection` の表示ズレ**：種類×チャネルのチェックボックスは `kindChannelChecked`（新設。`kind_channels` AND 旧列）を使う。旧列（`notify_overdue`/`notify_due_today`）がオフなのに表示だけオンのままだった不具合を修正し、`isKindEnabled`（全体スイッチ以外の部分）と一致させた。

---

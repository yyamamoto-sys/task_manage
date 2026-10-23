## 66. 期限リマインド：Windows通知（Web Push）＋アプリ内通知（v3.128・2026-10-01）

**正本は [docs/dev/web-push-reminder-design.md](docs/dev/web-push-reminder-design.md)（rev3。§12 に設計から変えた点）。**
**v3.129 で拡張した部分（通知の種類のレジストリ・種類×チャネルの個人設定・管理者向け通知・エラー記録・右上のベル・通知の種類を足す手順）は Section 67。** 以下の「ベル」「個人設定」の記述は v3.128 時点のもの。
Teams 週次（notify-deadlines）が個人の Teams 接続に依存して黙って止まっていたため、期限の知らせを
「チームへの共有」から「個人へのリマインド」に作り替えた。最優先の非機能要件は **黙って止まらないこと**。

### 仕組み（1日の流れ）

```
pg_cron（平日 JST 7:00〜19:30・30分ごと＝26回）── x-cron-secret ──> Edge Function push-reminders
  ├ reminder_runs に running の行を書く（落ちても「始まって終わっていない」記録が残る）
  ├ 土日・祝日（esm.sh の japanese-holidays）なら「…のためスキップ」を記録して終わる
  ├ 現在の JST を30分に切り捨てたスロット＝送信時刻に選んでいる人だけを抽出（_shared/reminderLogic.ts）
  ├ claim_reminder_sends（INSERT … ON CONFLICT DO NOTHING RETURNING）で「今日まだの人」だけに絞る＝1人1日1回
  ├ ① in_app_notifications に1行（アプリ内通知＝ベル）
  ├ ② push_subscriptions の各ブラウザへ Web Push（_shared/webPush.ts・npm:web-push。410/404 は購読を削除）
  └ reminder_runs を success / partial / failed で閉じる（失敗はステータス別件数だけを error_summary に）
ブラウザ：public/sw.js が受けて通知を出す → クリックで「自分のタスク一覧」（/?open=my-tasks）
```

- **対象**：本人が担当する全部署分のタスク（`assignee_member_ids` 優先・無ければ `assignee_member_id`）。
  status は todo / in_progress のみ。期限超過＝`due_date < 今日`、今日期限＝`due_date = 今日`（JST）。
- **文面**：件数＋最初の1件（期日→作成日時→id の順）。タスク名は40字で切る。PJ名・コメント・担当者名は載せない。
- **Edge Function の起動**：cron（x-cron-secret）／super_admin の JWT（手動・`dryRun`）／本人の JWT＋`test`（自分の購読だけへテスト送信）。
  `--no-verify-jwt` でデプロイする（付け忘れると cron が401）。JWT 呼び出しは1分6回まで。
- 純粋関数（抽出・文面・スロット・休日・送信結果の分類・ページング）は `supabase/functions/_shared/` に置き、
  `src/lib/reminder/__tests__/` から相対 import して vitest で検証する（Deno 依存の無いファイルだけ）。

### 個人設定（設定ページ「🔔 通知」タブ・Section 65）

- `notification_prefs`（members の列にしない。同部署の他人が members を UPDATE できるため）。行が無い人は既定値
  ＝アプリ内オン・Windowsオフ・両種類オン・8:30（`src/lib/reminder/notificationPrefs.ts` と `_shared/reminderLogic.ts` で同じ値を持ち、テストで一致を検査）。
- トグル・時刻は押した時点で保存（明示保存の対象外）。送信時刻は 7:00〜19:00 の30分刻み25件（DB の CHECK 制約と同じ）。
- **Windows通知の許可ダイアログはオンにした瞬間だけ出す。** 購読はブラウザ単位（`register_push_subscription` が同じ endpoint の持ち主を付け替える）。
  オンの人がアプリを開くと `usePushSubscriptionSync` が許可済みのブラウザだけ購読を登録し直す（失効・鍵の変更・SW の更新を吸収）。
- Teams のタブ内（iframe）・非対応ブラウザ・`VITE_VAPID_PUBLIC_KEY` 未設定のときはトグルを無効にして理由を出す。
- 「通知が届かないとき」に Windows の「設定」→「システム」→「通知」でブラウザがオンか・応答不可がオフか、ブラウザを完全に終了していると届かないこと、PC・ブラウザごとの設定であることを載せている。
- **メンション通知**（`useMentionNotifications`）は Windows通知をオンにした人だけ（`push_enabled`。v3.129 からは種類「メンション」の Windows もオンの人＝Section 67）。旧方式B（タブ表示中の期限通知・`useDeadlineNotifications`）は廃止し、ダッシュボードの通知方法 `<select>` は「🔔 通知設定」ボタンに置き換えた。`members.notify_pref` 列は残す（削除は別マイグレ）。

### 送信記録の見方（super_admin）

- 設定 → 部署の管理 → アプリ設定 →「通知」（`ReminderSection.tsx`）：直近30回の実行（平日は30分ごとなので約1営業日分）・Windows通知の登録数・「今すぐ実行（dryRun）」（送らず記録もせず、全員分の文面と送信時刻を表示）。
- **赤バナー**（`ReminderHealthBanner`・判定は `src/lib/reminder/reminderHealth.ts`）：平日、30分以上前の予定スロット（7:00〜19:30）の cron 記録が無い／failed／running のまま。
  **黄**：直近の cron が partial、または Windows通知の失敗率50%以上。取得失敗は「確認できません」を出す。
- 「成功」はプッシュサービスが受け取ったところまで。画面に表示されたかは分からない（本人のテスト送信と既読で補う）。

### 🔴 ルール

- **public/sw.js に fetch ハンドラを書かない。** キャッシュを持つ SW は、デプロイ後も古い画面が出続ける障害を呼ぶ（Section 63 の再読み込み案内とも衝突する）。`/sw.js` は vercel.json で no-store、登録は `updateViaCache:"none"`、install で skipWaiting・activate で clients.claim。
- **通知のクリックで開いているタブを `navigate()` しない。** 再読み込みで保存前の編集が無言で消える。SW は `postMessage` し、アプリ側が `guardedNavigate` で画面を切り替える。
- **pg_cron の登録はテーブルのマイグレに入れない。** シークレットの置き換えが要るため `20261001b_schedule_push_reminders.sql` に分け、最後に本番だけで手で流す（プレースホルダー検査クエリ付き）。
- **新しく通知を送る機能（バックアップ通知等）は `_shared/webPush.ts` の `sendToSubscriptions` を使う。** 送信・失効処理を二重に実装しない（設計書 §6.2・フェーズ5.5）。
- 鍵（VAPID）の秘密鍵は Supabase secrets のみ。公開鍵は Vercel の `VITE_VAPID_PUBLIC_KEY`（ビルド時に埋め込まれる）。**秘密鍵を作り直すと全員の購読が無効になる**ので、再生成は全員への再設定のお願いとセットで行う。

### 適用の順序（🔴 逆にすると新画面が「読み込めません」になる）

1. マイグレ `20261001_web_push_reminders.sql`（dev → prod）
2. VAPID 鍵を生成し、`supabase secrets set --project-ref <ref>` で VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT / REMINDER_CRON_SECRET を設定（dev・prod で別の鍵ペア）
3. `supabase functions deploy push-reminders --no-verify-jwt --project-ref <ref>`
4. Vercel の環境変数 `VITE_VAPID_PUBLIC_KEY`（prod の公開鍵）→ フロントを main へ（Vercel が再ビルド）
5. 実機でテスト通知が届くことを確認してから、本番だけ `20261001b_schedule_push_reminders.sql`（シークレットを置き換えて実行）

**v3.136（2026-10-07）：Teams 週次（notify-deadlines）は撤去済み**（並行運用5営業日の確認後。設計書 §9 フェーズ4・6）。
関数・cron・`group_notification_settings`・管理画面の Webhook 欄・PA テンプレート配布・`TEAMS_WEBHOOK_URL` を削除した。
バックアップ通知の切替（フェーズ5.5）は Section 67「バックアップ通知」。
🔴 `MIN_CLIENT_VERSION` を 3.136 へ上げた（表の DROP で旧画面の「グループ・部署」タブが読み込みエラーを出し、旧画面の管理者にスキーマ警告バナーが出るため）。
`MIN_CLIENT_VERSION` は上げていない（既存の列・RLS・Edge Function の入出力を変えていないため）。

### 独立レビュー対応（feat/web-push ブランチ・2026-10-01・コードはv3.128のまま）

DB適用・デプロイ前のコードレビューで出た指摘6件を反映。列・RLS・Edge Functionの入出力は変えていないため版は上げていない。

- **【中】ログアウト時にこのブラウザの購読を解除**：`App.tsx` の `handleLogout`（唯一の実装。ゲスト終了・AccessDeniedScreen・サイドバー等すべてここを通る）が `signOut()` の前に `cleanupPushSubscriptionOnLogout()`（`src/lib/push/logoutCleanup.ts`）を呼ぶ。中身は `unsubscribeThisBrowser()` → 購読が有ったときだけ `deletePushSubscription()`。失敗しても `console.warn` のみでログアウトは止めない。**signOut()より前に置くのが要点**（DB削除はRLSで本人の行のみ＝セッションが生きている間でないと通らない）。共有PCで前の利用者のタスク名入り通知が出続けるのを防ぐ。
- **【中】push-reminders の送信を並列化**：人ごとに1人ずつawaitしていたループを、同時実行数10人の上限つきで並列化（`supabase/functions/_shared/concurrencyPool.ts` の `runWithConcurrency`。Promise.allSettledベースのワーカープール）。1人の例外が他の人を止めない。claim（1人1日1回・`claim_reminder_sends`）は並列化より前で完結しているため、**送信に失敗した人をその場で再試行することはしない＝「その日は再送しない」仕様は変わらない**（設計書 §6.1・§12）。
- **【軽】sw.js の notificationclick**：開くURLを `new URL(url, self.location.origin)` で解決し、origin が一致しなければ `"/"` を開く（他オリジンへの遷移を防ぐ）。同じ判定を `src/lib/push/notificationClickUrl.ts` に抽出してテストする（sw.jsはクラシックスクリプトのためimport不可＝ロジックを複製）。
- **【軽】push-reminders の祝日判定**：`japanese-holidays` の `isHoliday` が読み込めない場合に黙って「祝日ではない」へフェイルオープンしていたのを `throw` に変更（`_shared/reminderLogic.ts` の `resolveHolidayCheckFn`）。判定日付も `new Date(dateStr+"T00:00:00Z")`（UTC解釈）をローカルゲッターで読む方式から、年月日を直接ローカル構築する方式（`buildJstHolidayDate`）に変更し、実行環境のタイムゾーンに依存しないようにした。
- **【軽】x-cron-secret の比較を定数時間比較に**：`_shared/timingSafeEqual.ts` の `timingSafeEqualString`（長さ違いも含め最後まで比較してから判定）。
- **【軽】未読バッジをタブ表示中も追従**：`public/sw.js` の push ハンドラが通知表示後に開いているクライアントへ `{type:"push-received"}` を `postMessage`。`InAppNotificationBell` が受けて `refreshCount()` を再実行（保険として3分おきの定期再取得も追加）。
- **v3.135（v3.133 の再適用）：Realtime でも即時に取り直す**（Windows通知オフの人・送信直後の本人も遅れない）。詳細は Section 67「右上のベル」。

---

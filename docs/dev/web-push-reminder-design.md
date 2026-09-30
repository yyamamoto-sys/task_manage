# 期限リマインド再設計書（Windows通知＝Web Push ＋ アプリ内通知）

最終更新：2026-09-30 rev1（設計のみ・実装未着手）
関連：[deadline-notifications.md](./deadline-notifications.md)（現行の方式B・D）／[backup-design.md](./backup-design.md)（実行記録とバナーの前例）／CLAUDE.md Section 39・53・58・61

> この文書は、期限通知を「チームへの共有」から「個人へのリマインド」に作り替えるための正本である。
> 実装前に §11 の未決事項を確定させ、実装後は本文書と実物の差分が出た時点でこちらを直す。

---

## 0. 決定事項

| 論点 | 決定 | 決定日 |
|---|---|---|
| 通知の目的 | **個人へのリマインド**（チーム共有ではない） | 09-30 |
| 通知チャネル | **①Windows通知（Web Push）②アプリ内通知** の2つ。**本人が個人設定でそれぞれ独立にオン／オフする**（両方・片方・どちらも無し）。管理者が他人の設定を変える機能は作らない | 09-30 |
| 送信タイミング | **平日（月〜金）の朝 JST 8:30 に1回**。対象タスクが無い人には送らない | 09-30 |
| 表示内容 | **件数＋最初の1件のタスク名**（例「期限超過2件・今日期限1件：◯◯の資料作成 ほか」）。クリックでアプリの自分のタスク一覧を開く | 09-30 |
| 現行 Teams 週次通知 | **新方式の稼働確認まで動かしたまま**（§9 で停止） | 09-30 |
| 新しい外部ライブラリ | 本書の段階では導入しない。§7 の手順で dev 検証してから決める | 09-30 |

### 不採用案

| 案 | 不採用の理由 |
|---|---|
| ① サービスアカウント＋Power Automate | 現行の失敗原因（フロー所有者と Teams 接続が個人に紐づく）を「共用アカウント」へ移すだけ。PA は受信時に202を返すため、投稿失敗は相変わらず無音。サービスアカウントの発行・管理は情シス案件 |
| ② Teams ボット（Bot Framework / Graph） | Azure AD のアプリ登録と管理者同意が必要で情シス必須。主用途がチャネル投稿（チーム共有）であり、個人リマインドという目的とずれる |
| ④ Outlook 予定表（ICS 購読） | 購読した予定表でリマインダーが鳴るかを一次情報で確認できなかった。更新が最大24時間以上遅れるため「今日期限」の通知に使えない |

---

## 1. 背景

現行の方式D（Edge Function `notify-deadlines` → Power Automate → Teams チャネル）は、フロー所有者と投稿用 Teams 接続が山本さん個人に紐づいていた。2026年7月の部署異動で山本さんが投稿先チャネルに入れなくなり、通知は届かなくなった。PA は受信時点で202を返すため、Edge Function 側からは成功に見え、**誰も気づかないまま止まっていた**（CLAUDE.md Section 58 の外部前提チェックリストで「⚠️ 未確認」のままだった項目）。

本設計の最優先の非機能要件は **「黙って止まる」を再発させないこと** である。送信結果を必ずDBに記録し、管理画面で見えるようにする（§3.4・§6）。

🔴 **同じ PA 経路に依存している別機能がある。** `backup-daily` の失敗通知と週次サマリ（`notifyTeams()`・`TEAMS_WEBHOOK_URL`）も同じ Power Automate フローへ送っているため、同時に止まっていると考えられる。管理画面バナー（`BackupHealthBanner`）は生きているが、Teams 通知の代替は本書の範囲外とし、§11 の未決事項に挙げる。

---

## 2. 現状（As-Is・2026-09-30 にコードで確認）

| 項目 | 事実 |
|---|---|
| Service Worker / PWA | **無い。** `public/` は `pdfjs/`（ビルド時コピー・gitignore）のみ。`vite.config.ts` に PWA プラグインは無く、`navigator.serviceWorker` の呼び出しも src に無い |
| `vercel.json` | CSP の `frame-ancestors` ヘッダーだけ。rewrites は無い（`public/sw.js` は `/sw.js` として静的配信される） |
| `members.notify_pref` | `'none' \| 'browser' \| 'teams'` の単一値（`20260529_add_notify_pref.sql`・`types.ts` の `NotifyPref`） |
| 方式B `useDeadlineNotifications` | `notify_pref==='browser'` かつ許可済みのときだけ、**タブを開いている間**30分ごとに判定し `new Notification()` を出す。自分担当・todo/in_progress・`due_date <= 今日`。当日通知済みIDを localStorage に記録 |
| `useMentionNotifications` | **これも `notify_pref==='browser'` で動いている。** `notify_pref` を廃止するとメンション通知も止まる（§4.3 で扱う） |
| 方式D `notify-deadlines` | **`notify_pref` を一切読まない**（全員分を部署別に Teams へ）。Deno 版 `fetchAllRows` を既に持つ（ファイル末尾。src 版と同じ終了条件） |
| 設定UI | `DashboardView` のリマインダーカード（「🔔 自分のリマインダー」・PJ選択中は非表示）のヘッダーに `<select>`：🔕通知なし／🔔ブラウザ通知／💬Teamsまとめ。`browser` を選んだ瞬間に `Notification.requestPermission()`（ユーザー操作起点）。保存は `saveMember()` で members 行全体を更新 |
| M18（既知課題） | 「💬 Teamsまとめ」を選んでも `none` と挙動が同じ（REFACTORING.md。UX判断待ち） |
| 個人設定画面 | **無い。** サイドバー下部の「⚙ 設定」は `AdminView`（管理画面）を開く。個人向けの設定はテーマ切替とリマインダーカードの `<select>` だけ |
| ディープリンク | 招待コード（`?invite=`・`extractInviteCodeFromSearch`）以外にURLから画面を開く仕組みは無い |
| `members` の UPDATE RLS | `members_write_update` は**同じ部署のメンバーなら他人の行も更新できる**。個人設定を members 列に置くと、他人が自分の通知設定を書き換えられる |
| Edge Function のデプロイ | `supabase/config.toml` が無い。cron から呼ぶ関数は `--no-verify-jwt` を付け忘れると401になる（REFACTORING.md I 行） |
| 祝日 | フロントは `japanese-holidays`（依存ゼロ・通信なし）を `src/lib/date/holidays.ts` 経由で利用中 |

---

## 3. 全体構成

```
[ブラウザ]
  個人設定モーダル ──(許可ダイアログ・本人の操作時のみ)──> Notification.requestPermission()
        │                                                  │
        │  navigator.serviceWorker.register('/sw.js')      │
        │  registration.pushManager.subscribe(VAPID公開鍵) ─┘
        ▼
  rpc register_push_subscription(endpoint, p256dh, auth, user_agent)
        ▼
[Supabase DB]  push_subscriptions / notification_prefs / in_app_notifications / reminder_runs
        ▲
  pg_cron（平日 JST 8:30）── net.http_post + x-cron-secret
        ▼
[Edge Function push-reminders]
  対象抽出 → ①in_app_notifications に1行書く  ②Web Push 送信（RFC 8291 暗号化・VAPID 署名）
        │                                            │
        ▼                                            ▼
  reminder_runs に結果を記録            プッシュサービス（Edge=WNS／Chrome=FCM）
                                                     ▼
                                     [ブラウザの Service Worker] push → showNotification
                                                     └─ クリック → /?open=my-tasks
```

### 3.1 Service Worker の配置（Vite）

- **`public/sw.js` を手書きで置く。** Vite は `public/` をそのまま `/sw.js` として配信するため、ビルド設定の変更は要らない。スコープはルート（`/`）になる。
- **`vite-plugin-pwa` 等は入れない。** 目的はプッシュ受信だけで、オフラインキャッシュは不要。
- 🔴 **`fetch` イベントハンドラを書かない。** キャッシュを持つ SW を入れると、デプロイ後も古い画面が出続けるという別の障害を呼び込む（`chunk-sizes.json` を実行時 fetch する仕組みにも影響する）。SW の中身は `push` と `notificationclick` の2ハンドラだけにする。
- `push`：JSON `{ title, body, url, tag }` を受け、`showNotification(title, { body, tag, data: { url } })`。`tag` は `deadline-YYYY-MM-DD`（同日の再送を上書き）。Chrome は `userVisibleOnly: true` 必須のため、受信したら必ず通知を出す。
- `notificationclick`：既存のアプリのウィンドウがあれば `focus()` して `navigate(url)`、無ければ `clients.openWindow(url)`。
- SW の登録は、Windows通知をオンにしたとき、およびオンの人がアプリを開いたとき（購読の再同期のため）に行う。オフの人には登録しない。

### 3.2 「自分のタスク一覧」を開くディープリンク

`/?open=my-tasks` を新設する。`extractInviteCodeFromSearch` と同じ形の純粋関数でクエリを読み、`viewMode='list'`・`mineOnly=true` に切り替えてから `history.replaceState` でクエリを消す（リロードで再発火させない）。未ログインで開かれた場合はログイン後に適用する。

---

## 4. 個人設定の持ち方と UI

### 4.1 設定テーブルを新設する（`members` の列にしない）

```sql
CREATE TABLE notification_prefs (
  member_id        text PRIMARY KEY REFERENCES members(id),
  inapp_enabled    boolean NOT NULL DEFAULT true,   -- アプリ内通知
  push_enabled     boolean NOT NULL DEFAULT false,  -- Windows通知（Web Push）
  notify_overdue   boolean NOT NULL DEFAULT true,   -- 期限超過を含める（§4.4 案B）
  notify_due_today boolean NOT NULL DEFAULT true,   -- 今日期限を含める（§4.4 案B）
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

列を分けて `members` に足す案を採らない理由：①`members_write_update` は同部署の他人も更新できるため「本人だけが変える」を RLS で保証できない、②`saveMember()` は行全体を送るので、管理者のメンバー編集と楽観ロックの競合を起こす、③チャネルや種類が増えるたびに `members` が太る。

行が無い人は既定値（アプリ内＝オン・Windows＝オフ）として扱い、Edge Function 側も同じ既定値を使う。既定値そのものは §11 で確認する。

### 4.2 RLS（Section 39・58 の書き方）

```sql
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_prefs_own ON notification_prefs
  FOR ALL TO authenticated
  USING      ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()))
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()));
```

匿名（ゲスト）は `current_member_id()` が NULL を返すため弾かれる。適用後は Section 58 の手順（`pg_policies` で1テーブル1本・`set local role authenticated` での模擬・匿名JWTでのREST確認）で検証する。

### 4.3 既存の `notify_pref` と方式B・メンション通知の整理

| 対象 | 扱い |
|---|---|
| 方式B（`useDeadlineNotifications`） | **Web Push 稼働後に廃止する。** 残すと朝8:30の Web Push とタブ表示中の30分ごとの通知が二重に出る。アプリ内通知（ベル）がタブ表示中の役割を引き継ぐ |
| `useMentionNotifications` | **ゲートを `notify_pref==='browser'` から `notification_prefs.push_enabled` に付け替えて残す**（Windows通知をオンにした人にだけ、タブ表示中のメンション通知を出す）。メンションの Web Push 化は範囲外 |
| `notify_pref='teams'`（M18） | 選択肢ごと削除する。M18 はこれで解消 |
| `notify_pref` 列 | 移行時に `push_enabled` の初期値へ写さない（購読が無ければ意味が無いため、全員オフから始める）。UI からの書き込みを止めた後、別マイグレで DROP（`schemaChecks.ts` から外すのを同時に行う） |

### 4.4 「自由に変更」の範囲（選択肢）

| 案 | 本人が変えられるもの | 追加コスト |
|---|---|---|
| A | チャネルごとのオン／オフだけ | 最小 |
| **B（推奨）** | A ＋ 通知する種類（期限超過／今日期限） | 小。boolean 2列と抽出時の絞り込みだけ。cron・実行記録の構造は変わらない |
| C | B ＋ 送信時刻（例：8:30／12:00／17:00） | 大。cron を30分ごとに回して時刻で振り分ける必要があり、実行記録も時刻ごとに分かれる。「今日の8:30の実行が無い」を判定するバナー（§6）が複雑になる |

推奨はB。Cは運用してみて要望が出てから検討する（§11）。

### 4.5 設定UIの場所と文言

個人設定画面が存在しないため、**新規に `NotificationSettingsModal` を作り、2か所から開く。**

1. `DashboardView` のリマインダーカード：現在の `<select>` を「🔔 通知設定」ボタンに置き換える（`reminderDays` の `<select>` はそのまま）。
2. アプリ内通知のベルパネル（§5）の右上「⚙ 通知設定」。PJ選択中はリマインダーカードが隠れるため、こちらが常時の入口になる。

モーダルは Section 21（高さ上限）に従う。トグルは押した時点で保存する（タスク編集面ではないため Section 44 の明示保存の対象外。ただし保存失敗はトーストで出す）。

```
通知設定
  平日の朝 8:30 に、期限超過・今日期限のタスクをお知らせします。
  対象のタスクが無い日は届きません。

  [✓] アプリ内通知        アプリを開いたときにベルに表示します
  [ ] Windows通知         アプリを閉じていても、画面右下に通知が出ます
                          （このブラウザでだけ有効です）   [テスト通知を送る]
  通知する内容  [✓] 期限超過   [✓] 今日期限
```

- **許可ダイアログは「Windows通知」をオンにした瞬間だけ出す。** 初回表示・ログイン時に勝手に出さない。
- 拒否済み（`denied`）の場合はトグルをオンにせず、「ブラウザの設定で通知がブロックされています」とアドレスバー左の鍵アイコンからの解除手順を表示する。
- 購読はブラウザ単位のため、「このブラウザでだけ有効」を明記する。別PCのブラウザは、そこで再度オンにする。
- Teams のタブ内（iframe）では通知の許可を求められないため、`window.self !== window.top` のときはトグルを無効にして「ブラウザで開いて設定してください」と出す。
- ゲストモードではモーダル自体を出さない。
- **テスト通知**：`push-reminders` を `mode=test` で呼び、呼び出した本人の購読だけへ「テスト通知です」を送る。結果（成功件数・失敗理由）をトーストで返す。

---

## 5. アプリ内通知

### 5.1 作り方の比較

| | (a) Edge Function がDBに書く（**推奨**） | (b) クライアントで都度計算 |
|---|---|---|
| 内容の一致 | Windows通知と同じ判定・同じ時刻・同じ文面 | 判定コードが2か所（Deno と src）に分かれ、ずれる |
| 「いつ届いたか」「既読」 | DBで持てる。別PCで既読にしても反映される | 持てない（localStorage は端末ごと） |
| 「黙って止まる」の検知 | 実行記録と同じ実行で書くため、止まれば両方止まり、バナーで気づける | cron と無関係に動くため、Web Push が止まっても気づきにくい |
| コスト | テーブル1本・RPC1本 | DB不要 |

推奨は(a)。既存のリマインダーカード（クライアント計算・常時表示）は今の状態を見る場所として残し、アプリ内通知は「その朝に届いたお知らせ」の履歴として役割を分ける。

### 5.2 テーブルとRLS

```sql
CREATE TABLE in_app_notifications (
  id          bigserial PRIMARY KEY,
  member_id   text NOT NULL REFERENCES members(id),
  run_id      bigint REFERENCES reminder_runs(id),
  kind        text NOT NULL CHECK (kind IN ('deadline_digest')),
  title       text NOT NULL,
  body        text NOT NULL,
  url         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX ON in_app_notifications (member_id, created_at DESC);
```

- SELECT は本人の行のみ（§4.2 と同じ式）。INSERT は service_role のみ（ポリシーを作らない）。
- 既読化は UPDATE ポリシーを作らず、`mark_in_app_notifications_read(p_ids bigint[])`（SECURITY DEFINER・`member_id = current_member_id()` の行の `read_at` だけを更新）で行う。本人が本文を書き換えられないようにするため。
- 90日で削除（`cleanup-admin-change-logs` と同型の pg_cron）。

### 5.3 UI

- サイドバー下部の固定行（設定・ユーザー情報の行）にベルと未読件数を置く。パネルは `useFloatingPanel`（Section 51）で開き、直近30件を新しい順に表示する。
- 取得は `.limit(30)` と、未読件数の `select('id', { count: 'exact', head: true })` の2本。一覧を丸ごと読まないため Section 61 の `fetchAllRows` の対象外（`rowLimitScan` の例外規定＝`.limit()` に該当）。
- 取得タイミングはログイン時と、タブが前面に戻ったとき（`visibilitychange`）。Realtime は使わない（1日1回しか増えないため）。
- 行をクリックすると既読化して `url` へ遷移する。「すべて既読」ボタンを置く。

---

## 6. 送信結果の記録と管理者の確認場所

```sql
CREATE TABLE reminder_runs (
  id                    bigserial PRIMARY KEY,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  trigger               text NOT NULL CHECK (trigger IN ('cron','manual','test')),
  triggered_by          text,                 -- manual / test のとき member id
  status                text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  target_members        integer,              -- 対象タスクがあった人数
  inapp_written         integer,
  push_attempted        integer,              -- 送信を試みた購読数
  push_succeeded        integer,
  push_failed           integer,
  subscriptions_removed integer,              -- 410/404 で削除した購読数
  error_summary         text                  -- 失敗の要約（HTTP ステータス別件数など。本文・endpoint は載せない）
);
```

- RLS：SELECT は super-admin のみ、書き込みは service_role のみ（`backup_runs` と同じ流儀）。90日で削除。
- 🔴 **最初に `running` の行を書いてから処理する。** 途中で落ちても「始まったが終わっていない」行が残る。
- **管理画面**：`AdminView` の「アプリ設定」カテゴリ（super-admin 限定）に「通知」タブを新設する（`BackupSection.tsx` と同じ構成）。直近の実行10件・購読数の合計・「今すぐ実行（dryRun）」ボタンを出す。
- **管理画面バナー**：`BackupHealthBanner` と同型の `ReminderHealthBanner` を置く。判定は純粋関数に切り出す。
  - 🔴 赤：直近の平日 8:30（JST）から1時間経っても、その回の `cron` の実行記録が無い、または `failed`。
  - 🟡 黄：直近の cron 実行で `push_failed / push_attempted` が50%以上、または `partial`。
  - 取得失敗時は黙って消さず「通知の状態を確認できません」を出す。
- **記録できる範囲の限界**：プッシュサービスが 201 を返したことまでは記録できるが、利用者の画面に通知が表示されたかは分からない（ブラウザが起動していない・OSの集中モード等）。本人向けには「テスト通知」、組織としてはアプリ内通知の既読率で補う。

---

## 7. Edge Function `push-reminders`

`notify-deadlines` は改修せず、新しい関数として作る（Teams 週次を移行完了まで無改修で動かし、切り戻しを容易にするため）。

### 7.1 認証と起動

| 起動元 | 認証 | 動作 |
|---|---|---|
| pg_cron | `x-cron-secret` = `REMINDER_CRON_SECRET` | 全対象へ送信（`trigger='cron'`） |
| 管理画面「今すぐ実行」 | JWT → `members.is_super_admin` | 同上（`trigger='manual'`）。`?dryRun=1` も受け付ける |
| 個人設定「テスト通知」 | JWT → `members.email` 一致の本人 | 本人の購読だけへ固定文面を送る（`trigger='test'`） |

- デプロイは `supabase functions deploy push-reminders --no-verify-jwt`（`config.toml` が無いため、付け忘れると cron が401になる）。JWT の検証は関数内で `supabase.auth.getUser(token)` を使う（`backup-daily` と同じ）。
- ブラウザから呼ぶため `ALLOWED_ORIGINS` 方式の CORS を持たせ、`Access-Control-Allow-Headers` に `x-cron-secret` を含める（`backup-daily` と同じ）。
- pg_cron：`'30 23 * * 0-4'`（UTC 日〜木の23:30＝JST 月〜金の8:30）。ジョブ名 `push-reminders-weekday`。

### 7.2 対象の抽出

1. tasks：`is_deleted=false`・`status in ('todo','in_progress')`・`due_date <= 今日（JST）`。部署で絞らない（個人リマインドなので、本人が担当するタスクは全部署分を対象にする）。
2. 担当者の展開：`assignee_member_ids` が空でなければそれ、空なら `assignee_member_id`（src の `getAssigneeIds` と同じ）。複数担当なら全員に数える。
3. members：`is_deleted=false`。`notification_prefs` の行が無い人は既定値。両チャネルともオフの人、または対象件数が0の人は除外する。
4. 種類の絞り込み（§4.4 案B）：期限超過＝`due_date < 今日`、今日期限＝`due_date = 今日`。
5. **最初の1件**：`due_date` の昇順 → `created_at` の昇順 → `id` の昇順（同じ入力で常に同じ1件になるよう、最後に主キーで決める）。
6. 文面：`title`＝「タスクの期限」、`body`＝「期限超過2件・今日期限1件：◯◯の資料作成 ほか」（1件だけなら「ほか」を付けない。0件の種類は書かない。タスク名は40字で切る）、`url`＝`/?open=my-tasks`。
7. 一覧取得はすべて `notify-deadlines` 末尾の Deno 版 `fetchAllRows` と同じ実装を使う（総件数到達または空ページで止める。「返ってきた件数 < ページサイズ」で止めない）。

### 7.3 送信

- 購読ごとに送信。`201` は成功として `last_success_at` を更新、`410`/`404` は購読を削除して `subscriptions_removed` に数える、それ以外（`429`・`5xx`・例外）は失敗として `failure_count` を増やし、ステータス別件数を `error_summary` にまとめる。1件の失敗で全体を止めない。
- TTL は12時間（翌朝まで溜まった古い通知が届かないようにする）。
- アプリ内通知の INSERT はプッシュの成否と独立に行う。
- **祝日**：初期実装は月〜金のみで、**祝日にも送る**。祝日を飛ばす場合は、フロントで使っている `japanese-holidays`（通信なし）を Deno から読む案が有力（§11）。
- **dryRun**：`?dryRun=1` はDBへ何も書かず、プッシュも送らず、人ごとの `{ memberId, title, body, subscriptionCount }` を返す。

### 7.4 鍵の保管

| 値 | 置き場所 |
|---|---|
| `VAPID_PRIVATE_KEY` | Supabase secrets（dev・prod で別の鍵ペア） |
| `VAPID_PUBLIC_KEY` | Supabase secrets（署名に使う） |
| `VITE_VAPID_PUBLIC_KEY` | Vercel の環境変数（本番）・`.env.local`（dev）。公開鍵なのでクライアントに埋め込んでよい |
| `VAPID_SUBJECT` | アプリのURL（`https://...`）。`mailto:` にすると個人アドレスがプッシュサービスに渡るため避ける |
| `REMINDER_CRON_SECRET` | Supabase secrets ＋ pg_cron ジョブ本文 |

秘密鍵を作り直すと全員の購読が無効になる。鍵の再生成は「全員に再設定をお願いする」作業とセットで行う。

---

## 8. 購読の登録と外部ライブラリ

### 8.1 購読テーブル

```sql
CREATE TABLE push_subscriptions (
  id              bigserial PRIMARY KEY,
  member_id       text NOT NULL REFERENCES members(id),
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0
);
```

- RLS：SELECT・DELETE は本人の行のみ（§4.2 と同じ式）。INSERT・UPDATE のポリシーは作らない。
- 登録は `register_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)`（SECURITY DEFINER）で行う。同じ endpoint の既存行を消してから本人の行として入れる。共有PCで別の人が同じブラウザを使った場合、`upsert` だと他人の行を UPDATE できず失敗するため。
- Windows通知をオフにしたら、`pushManager` の購読解除とこのブラウザの行の DELETE を両方行う。
- 失効（`pushsubscriptionchange`）は、オンの人がアプリを開くたびに現在の購読とDBを突き合わせ、違えば登録し直すことで吸収する。

### 8.2 ライブラリの選定手順（dev で行う）

候補は `npm:web-push`（Node の crypto 依存。Deno で動かない報告があり、Supabase Edge Runtime での可否は未確認）と `jsr:@negrel/webpush`（Web Crypto のみ・RFC 8291/8292 準拠・採用実績は限定的）。どちらも公式サンプルは無いため、推測で選ばず次の順で決める。

1. dev に検証用の最小関数（固定文面を1件送るだけ）を2本作り、それぞれデプロイする。
2. 判定基準（すべて満たしたものを採る。両方満たせば `npm:web-push` を優先＝利用者が多く不具合情報が見つかりやすい）：
   - `supabase functions deploy` が通り、起動時に例外が出ない
   - **Chrome と Edge の両方**で、タブを閉じた状態で実際に通知が表示される
   - 失効させた購読で `410` を受け取り、ステータスを呼び出し側で読める
   - 1件あたりの CPU 時間が Free プランの上限（2秒）に対して十分小さい（20人分を1回で送れる）
3. 両方とも失敗した場合は、Web Crypto で RFC 8291（aes128gcm）と VAPID（ES256 JWT）を自前実装する案を検討する。実装量が増えるため、その時点で山本さんに判断を仰ぐ。

### 8.3 外部送信の範囲（ブランドコア §4 の観点）

- 送り先はブラウザが決めるプッシュサービス（Edge＝Microsoft WNS、Chrome＝Google FCM）。**Web Push を使う以上、Microsoft と Google への送信は避けられない。**
- 本文（件数・タスク名）は RFC 8291 で暗号化され、中継は読めない。中継に渡るのは endpoint URL・VAPID JWT（`aud`・`exp`・`sub`）・TTL・送信時刻。
- 本文に載せるのはタスク名1件と件数だけ。PJ名・コメント・担当者名は載せない。
- 追加するライブラリは Edge Function 内でだけ使う。npm/jsr の取得はデプロイ時の1回で、実行時に送信先以外へ通信しないことを採用前にソースで確認する（`japanese-holidays` 導入時と同じ確認）。
- 本方式の追加は、内製アプリガバナンスの申告内容（外部送信先）に影響するため、申告書側も更新する。

---

## 9. 移行手順とロールバック

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| 0 | dev でライブラリ選定（§8.2） | 判定基準を満たすライブラリが決まる |
| 1 | dev にマイグレ（4表・RPC2本・RLS）→ `schema.sql`・`schemaChecks.ts` 同期（Section 22）→ Edge Function → フロント | dev で Chrome・Edge とも §10 の検証が通る。dev は cron 未稼働のため手動起動で確認する |
| 2 | prod に同じ順で適用。pg_cron `push-reminders-weekday` を登録。**Teams 週次は止めない** | — |
| 3 | 並行運用（5営業日） | 5営業日すべて `reminder_runs` が `success`、バナーが出ない、山本さんの Chrome・Edge に届く |
| 4 | `cron.unschedule('notify-deadlines-weekly-monday')` | — |
| 5 | 方式B（`useDeadlineNotifications`）とリマインダーカードの `<select>` を削除。`useMentionNotifications` のゲートを付け替え | — |
| 6 | 1か月後：`notify-deadlines` 関数・`group_notification_settings` 表と管理画面の Webhook 欄・PA テンプレート配布（`admin-templates` バケット）・`TEAMS_WEBHOOK_URL` を削除するか判断（§11）。PA フローはフロー所有者が削除する | — |

**ロールバック**：フェーズ3までは `cron.unschedule('push-reminders-weekday')` だけで元に戻る（Teams 週次は無改修で動いている）。フェーズ4以降は、`notify-deadlines` のジョブを `20260702b_reschedule_notify_deadlines_weekly.sql` の本文で登録し直す。ただし PA フローが死んでいる限り Teams 側へ戻しても届かないため、実質的なロールバック先は「Web Push を直す」になる。

---

## 10. 検証計画

Chrome と Edge のそれぞれで、次を確認する。確認は山本さんが実機で行う。

| # | 状態 | 期待 |
|---|---|---|
| 1 | アプリのタブを開いている | 通知が出る。クリックで既存タブが前面に来て自分のタスク一覧になる |
| 2 | タブ・ウィンドウを閉じた（ブラウザのプロセスは常駐） | 通知が出る。クリックで新しいウィンドウが開く |
| 3 | ブラウザを完全に終了（タスクトレイからも終了） | その場では出ない。次にブラウザを起動したとき、TTL（12時間）内なら出る。**この挙動を利用者向けの案内に書く** |
| 4 | 通知をブロック（`denied`） | トグルがオンにならず、解除手順が出る。テスト通知ボタンは押せない |
| 5 | 購読を失効（サイトデータを削除） | 次回送信で `410`/`404` → 購読行が消え、`subscriptions_removed` が1増える。アプリ内通知は届く |
| 6 | Windows通知オフ・アプリ内通知オン | プッシュは来ず、ベルに1件増える |
| 7 | 対象タスクが0件 | 何も届かず、`reminder_runs` の `target_members` に数えられない |
| 8 | 別の人が同じブラウザでログインしてオンにする | 購読の持ち主が後の人に移り、前の人には届かなくなる |
| 9 | 匿名（ゲスト）JWT で4表を REST から読む | 本文が空配列（Section 58 の手順4） |
| 10 | cron を止めた翌朝 | 管理画面に赤バナーが出る |

機械的な検証は、判定の純粋関数（対象抽出・最初の1件・文面・バナー判定・ディープリンク解析）を vitest で押さえる。`reminder_runs` のバナー判定は、修正前（バナー無し）で落ちるテストから書く。

---

## 11. 未決事項（山本さんに判断を仰ぐもの）

1. **既定値**：アプリ内通知＝オン、Windows通知＝オフでよいか（Windows通知はブラウザの許可が要るため、本人に有効化してもらう想定）。
2. **個人で変えられる範囲**：§4.4 の案B（チャネル＋種類）でよいか。送信時刻の個人選択（案C）は見送ってよいか。
3. **祝日**：月〜金なら祝日にも送る、でよいか。祝日を飛ばすなら `japanese-holidays` を Edge Function でも使う。
4. **対象範囲**：本人が担当するタスクを全部署分まとめて数える、でよいか（方式Bは表示中の部署だけだった）。
5. **メンション通知**：Windows通知をオンにした人にだけ、タブ表示中のメンション通知を残す、でよいか。
6. **設定UIの場所**：新規の通知設定モーダルを、リマインダーカードとベルの2か所から開く、でよいか。
7. **Teams 関連の後始末（フェーズ6）**：`notify-deadlines`・`group_notification_settings`・Webhook 欄・PA テンプレート配布を削除するか、将来の再利用に残すか。
8. **バックアップ通知**：`backup-daily` の失敗通知・週次サマリも同じ死んだ PA 経路に送っている。super-admin へのアプリ内通知に切り替えるか、別途扱うか（本書の範囲外）。
9. **利用者への案内**：「ブラウザを完全に終了していると届かない」「PCごと・ブラウザごとに設定が要る」をガイド（docs/guides）に書く担当とタイミング。

# 期限リマインド再設計書（Windows通知＝Web Push ＋ アプリ内通知）

最終更新：2026-10-01 rev3（v3.128 で実装。§12 に設計書から変えた点を記録。適用・デプロイは未実施）
関連：[deadline-notifications.md](./deadline-notifications.md)（現行の方式B・D）／[backup-design.md](./backup-design.md)（実行記録とバナーの前例）／CLAUDE.md Section 39・53・58・61

> この文書は、期限通知を「チームへの共有」から「個人へのリマインド」に作り替えるための正本である。
> §11 に決定事項をまとめてある（rev1の未決事項は全て確定済み）。実装後は本文書と実物の差分が出た時点でこちらを直す。

---

## 0. 決定事項

| 論点 | 決定 | 決定日 |
|---|---|---|
| 通知の目的 | **個人へのリマインド**（チーム共有ではない） | 09-30 |
| 通知チャネル | **①Windows通知（Web Push）②アプリ内通知** の2つ。**本人が個人設定でチャネル・通知する種類（期限超過／今日期限）・送信時刻の3つを選べる**（案C。§4.4参照）。既定はアプリ内通知＝オン・Windows通知＝オフ。管理者が他人の設定を変える機能は作らない | 09-30（rev2で送信時刻の個人選択を追加） |
| 送信タイミング | **平日（月〜金・祝日除く）に1回**。時刻は本人が30分刻み・7:00〜19:00（JST）から選べる（既定8:30）。対象タスクが無い人には送らない | 09-30（rev2で個人選択制に変更） |
| 表示内容 | **件数＋最初の1件のタスク名**（例「期限超過2件・今日期限1件：◯◯の資料作成 ほか」）。クリックでアプリの自分のタスク一覧を開く | 09-30 |
| 現行 Teams 週次通知 | **新方式の稼働確認まで動かしたまま**。稼働確認後、関連機能（`notify-deadlines`・`group_notification_settings`・Webhook欄・PAテンプレート配布）ごと削除する（§9 フェーズ6） | 09-30（rev2で削除方針を確定） |
| バックアップ通知 | `backup-daily` の失敗通知・週次サマリ（Teams向け）を、super_admin へのアプリ内通知（本人がWindows通知をオンにしていればWindows通知も）に切り替える。本書の範囲に含める（§6参照） | 09-30（rev2で追加） |
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

🔴 **同じ PA 経路に依存している別機能がある。** `backup-daily` の失敗通知と週次サマリ（`notifyTeams()`・`TEAMS_WEBHOOK_URL`）も同じ Power Automate フローへ送っているため、同時に止まっていると考えられる。管理画面バナー（`BackupHealthBanner`）は生きているが、Teams 通知自体は届いていない。**この代替（super_admin へのアプリ内通知＋Web Push）は本書の範囲に含める**（決定済み。§6.2・§11参照）。

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
[Supabase DB]  push_subscriptions / notification_prefs / in_app_notifications
               / reminder_runs / reminder_send_log
        ▲
  pg_cron（平日 JST 7:00〜19:30・30分刻み＝1日26回）── net.http_post + x-cron-secret
        ▼
[Edge Function push-reminders]
  祝日なら即終了 → 現在時刻のスロットと一致する人だけ抽出 → reminder_send_logに1日1回だけ記録
        → ①in_app_notifications に1行書く  ②Web Push 送信（RFC 8291 暗号化・VAPID 署名）
        │                                            │
        ▼                                            ▼
  reminder_runs に結果を記録            プッシュサービス（Edge=WNS／Chrome=FCM）
                                                     ▼
                                     [ブラウザの Service Worker] push → showNotification
                                                     └─ クリック → /?open=my-tasks

[Edge Function backup-daily]（日次バックアップ・失敗時／週次）
  super_admin 全員へ ①in_app_notifications に1行  ②Web Push（push-reminders と共通の送信処理を再利用）
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
  notify_overdue   boolean NOT NULL DEFAULT true,   -- 期限超過を含める（§4.4 案C）
  notify_due_today boolean NOT NULL DEFAULT true,   -- 今日期限を含める（§4.4 案C）
  reminder_time    time NOT NULL DEFAULT '08:30:00', -- 送信時刻（JST・§4.4 案C・09-30 rev2で追加）
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_reminder_time_check CHECK (
    reminder_time >= time '07:00' AND reminder_time <= time '19:00'
    AND extract(minute from reminder_time)::int % 30 = 0
    AND extract(second from reminder_time) = 0
  )
);
```

列を分けて `members` に足す案を採らない理由：①`members_write_update` は同部署の他人も更新できるため「本人だけが変える」を RLS で保証できない、②`saveMember()` は行全体を送るので、管理者のメンバー編集と楽観ロックの競合を起こす、③チャネルや種類が増えるたびに `members` が太る。

行が無い人は既定値（アプリ内＝オン・Windows＝オフ・送信時刻＝8:30）として扱い、Edge Function 側も同じ既定値を使う（COALESCEで補う。§7.2）。

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

### 4.4 「自由に変更」の範囲（決定：案C。09-30 rev2）

| 案 | 本人が変えられるもの | 追加コスト |
|---|---|---|
| A | チャネルごとのオン／オフだけ | 最小 |
| B | A ＋ 通知する種類（期限超過／今日期限） | 小。boolean 2列と抽出時の絞り込みだけ。cron・実行記録の構造は変わらない |
| **C（採用）** | B ＋ **送信時刻**（30分刻み・7:00〜19:00（JST）の25通り。既定8:30） | 大。cron を平日30分ごとに回し、その時刻を選んでいる人だけへ送る必要がある。実行記録は1回の起動＝1行のまま維持するが、「今日の8:30の実行が無い」というバナー判定を「直近の予定起動時刻から30分経っても記録が無い」に見直す（§6・§7.1） |

**当初はBを推奨していたが、山本さんの判断でCへ変更した。** 選択肢は`<select>`（`08:00`〜`19:00`等の表記。25件）。実装コストの詳細は §5〜§7 に反映済み。

### 4.5 設定UIの場所と文言

個人設定画面が存在しないため、**新規に `NotificationSettingsModal` を作り、2か所から開く。**

1. `DashboardView` のリマインダーカード：現在の `<select>` を「🔔 通知設定」ボタンに置き換える（`reminderDays` の `<select>` はそのまま）。
2. アプリ内通知のベルパネル（§5）の右上「⚙ 通知設定」。PJ選択中はリマインダーカードが隠れるため、こちらが常時の入口になる。

モーダルは Section 21（高さ上限）に従う。トグルは押した時点で保存する（タスク編集面ではないため Section 44 の明示保存の対象外。ただし保存失敗はトーストで出す）。

```
通知設定
  平日（祝日を除く）に、期限超過・今日期限のタスクをお知らせします。
  対象のタスクが無い日は届きません。

  [✓] アプリ内通知        アプリを開いたときにベルに表示します
  [ ] Windows通知         アプリを閉じていても、画面右下に通知が出ます
                          （このブラウザでだけ有効です）   [テスト通知を送る]
  通知する内容  [✓] 期限超過   [✓] 今日期限
  送信時刻      [8:30 ▾]（7:00〜19:00の30分刻みから選べます）
```

- **送信時刻の`<select>`**は25件の固定選択肢（7:00〜19:00・30分刻み）。変更した瞬間に`notification_prefs.reminder_time`へ保存する（他のトグルと同じ「押した時点で保存」・Section 44の対象外という扱いは§4.5冒頭のとおり）。

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
  run_id      bigint REFERENCES reminder_runs(id),  -- backup系の行はNULL（reminder_runsと無関係のため）
  kind        text NOT NULL CHECK (kind IN ('deadline_digest', 'backup_failure', 'backup_weekly_summary')),
  title       text NOT NULL,
  body        text NOT NULL,
  url         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX ON in_app_notifications (member_id, created_at DESC);
```

- `kind='backup_failure'`／`'backup_weekly_summary'`（09-30 rev2で追加）は`backup-daily`（§6参照）が、`members.is_super_admin=true`かつ`is_deleted=false`の全員へ1行ずつ書く。`run_id`は持たない（バックアップの実行記録は`backup_runs`であり`reminder_runs`とは無関係のため）。`url`は管理画面のバックアップタブ（`/?open=admin-backup`等。実装時に決める）を指す。
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
- **`reminder_runs` は起動ごとに1行のままとする**（日次への集約はしない）。平日は1日26回（§7.1）起動するため空振り（対象0件）の行が大半になるが、その「空振りの記録があること自体」が正常性の証拠であり、バナー判定（後述）の材料になる。90日保持でも `26回×約22営業日×3ヶ月 ≒ 1,700行` 程度でPostgresへの負荷は無視できる。

### 6.1 1人1日1回の保証（`reminder_send_log`）

平日26回起動する cron のうち、各人には自分が選んだ時刻の回でしか送らない。二重送信・遅延・時刻変更に対する扱いを次のテーブルで保証する。

```sql
CREATE TABLE reminder_send_log (
  member_id   text NOT NULL REFERENCES members(id),
  send_date   date NOT NULL,               -- JST基準の日付
  run_id      bigint REFERENCES reminder_runs(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, send_date)
);
```

- **判定・記録は1本のSQLで行う**：`INSERT INTO reminder_send_log (member_id, send_date, run_id) VALUES (...) ON CONFLICT (member_id, send_date) DO NOTHING RETURNING member_id`。この`INSERT`が実際に1行返した人だけを「今日まだ送っていない人」として以後の処理（in_app_notifications書き込み・Web Push送信）に進める。主キー制約が排他ロックの役割を兼ねるため、TOCTOUレースは起きない。
- **遅延**：cronの起動自体が遅れても、その回が実際に処理するのは「現在のJST時刻を30分単位に切り捨てたスロット」（§7.2）であり、`reminder_send_log`への条件付きinsertが唯一の関門のため、遅延そのものは二重送信を生まない。
- **二重起動**：同じ回のcronが何らかの理由で2回動いても、2回目の`INSERT`は主キー衝突で弾かれ0行になり、その人には送らない。
- **選択時刻を当日の途中で変更した場合**：
  - まだ今日の分を送っていない時刻へ変更（例：8:30→15:00に、まだ8:30を過ぎていない朝に変更）→ 変更後の時刻に送られる（`reminder_send_log`に今日の行がまだ無いため）。
  - 既に今日の分を送信済みの後に変更 → その日はもう届かない（`reminder_send_log`に今日の行が既にあるため）。翌営業日から新しい時刻で届く。
  - 既に過ぎた時刻へ変更（例：10:00の時点で8:30へ変更）→ 次のスロット判定はその日はもう来ないため、その日は届かない。翌営業日から届く。
  - **「その日は届かない・翌日から」という扱いは、1日1回という保証を優先した結果であり、意図した仕様**（誤って同日に2回届く方が実害が大きいと判断した）。
- **記録できていても実際の送信（push）が失敗した場合は再送しない**：`reminder_send_log`は「送信を試みたか」の印であり、成否は問わない。個別の失敗は`reminder_runs.error_summary`・`push_failed`で追える（既存方針のまま）。
- RLS：SELECTは super-admin のみ、書き込みは service_role のみ（`reminder_runs`と同じ流儀）。90日で削除。

### 6.2 バックアップ通知の統合（`backup-daily`。09-30 rev2で追加）

`backup-daily`（日次バックアップ。docs/dev/backup-design.md）の失敗通知・週次サマリは、現在Teams（`notifyTeams()`・`TEAMS_WEBHOOK_URL`）へ送っている。これを super_admin へのアプリ内通知＋Web Pushへ切り替える。

- **宛先**：`members.is_super_admin=true AND is_deleted=false` の全員。1人ずつ`in_app_notifications`（`kind='backup_failure'`または`'backup_weekly_summary'`）へ1行書き、その人の`notification_prefs.push_enabled`がtrueなら合わせてWeb Pushも送る。
- **送信ロジックの共有**：Web Push送信（RFC 8291暗号化・VAPID署名・購読の失効処理）は`push-reminders`が実装するものと同じであり、二重実装しない。`supabase/functions/_shared/webPush.ts`（新規）に切り出し、`push-reminders`・`backup-daily`の両方から呼ぶ。
- **`TEAMS_WEBHOOK_URL`・`notifyTeams()`はこの時点では削除しない**：フェーズ6（Teams関連を丸ごと削除するタイミング。§9）で、`backup-daily`側の呼び出しも合わせて削除する。それまでは新旧両方が動く（新方式の稼働確認期間）。
- **記録**：`backup_runs`（既存）に成否は既に記録されているため、通知専用の追加テーブルは作らない。

### 6.3 管理画面・バナー

- **管理画面**：`AdminView` の「アプリ設定」カテゴリ（super-admin 限定）に「通知」タブを新設する（`BackupSection.tsx` と同じ構成）。直近の実行30件（平日1日26回のため、10件固定だと数時間分しか見えない。30件でおおよそ1営業日分をカバーする）・購読数の合計・「今すぐ実行（dryRun）」ボタンを出す。
- **管理画面バナー**：`BackupHealthBanner` と同型の `ReminderHealthBanner` を置く。判定は純粋関数に切り出す。
  - 🔴 赤：現在のJST時刻が平日7:00〜19:30の範囲内のとき、直前の予定起動スロット（30分単位に切り捨てた時刻）から30分経っても、その回の `cron` の実行記録が無い、または `failed`。範囲外（夜間・週末）は判定自体をスキップする。
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
- **pg_cron（09-30 rev2で30分刻みに変更）**：送信時刻を個人で選べるようにしたため（案C）、平日7:00〜19:00（JST・30分刻み）の間、常に起動して「その時刻を選んでいる人」だけへ送る。JSTは平日でもUTC日付をまたぐため、ジョブを2本に分ける：
  - `push-reminders-am`：`'0,30 22,23 * * 0-4'`（UTC 日〜木の22:00/22:30/23:00/23:30＝JST 月〜金の7:00/7:30/8:00/8:30）
  - `push-reminders-pm`：`'0,30 0-10 * * 1-5'`（UTC 月〜金の0:00〜10:30＝JST 月〜金の9:00〜19:30）
  - 合計 **平日26回/日**（19:30の回は選べる時刻の範囲外だが、該当者がいないだけの無害な空振りとして許容する。25回ちょうどに絞る3本構成も検討したが、cronジョブが1本増える割に得るものが小さいため採らなかった）。
  - **Supabase Free プランの Edge Functions 呼び出し上限との比較**：公式ドキュメント（[Pricing | Supabase Docs](https://supabase.com/docs/guides/functions/pricing)）で Free プランは **月50万回**。26回×約22営業日／月 ≒ **572回/月**で、上限の**約0.11%**。問題にならない。
  - **ジョブ名**：`push-reminders-am`／`push-reminders-pm`（両方とも同じ関数`push-reminders`を呼ぶ）。

### 7.2 対象の抽出

0. **起動時刻の解決（09-30 rev2で追加）**：現在のJST時刻を30分単位に切り捨てた値を `slotTime` とする（cronは30分ちょうどに起動するが、起動遅延を吸収するための丸め）。**祝日判定（後述7.3）で祝日なら、この時点で処理を打ち切る**（`reminder_runs`に`status='success'`・`target_members=0`・`error_summary='祝日のためスキップ'`を記録して終了）。
1. tasks：`is_deleted=false`・`status in ('todo','in_progress')`・`due_date <= 今日（JST）`。部署で絞らない（個人リマインドなので、本人が担当するタスクは全部署分を対象にする）。
2. 担当者の展開：`assignee_member_ids` が空でなければそれ、空なら `assignee_member_id`（src の `getAssigneeIds` と同じ）。複数担当なら全員に数える。
3. members：`is_deleted=false`。`notification_prefs` の行が無い人は既定値（アプリ内＝オン・Windows＝オフ・`reminder_time`＝8:30）。次の条件で絞り込む：①`reminder_time = slotTime` の人だけ（案C。他の時刻の人はこの回では対象外）②両チャネルともオフの人、または対象件数が0の人は除外③`reminder_send_log`へ`(member_id, 今日の日付)`を条件付きinsertし、実際に挿入できた人だけ以後へ進める（1人1日1回の保証。§6.1）。
4. 種類の絞り込み（§4.4 案C）：期限超過＝`due_date < 今日`、今日期限＝`due_date = 今日`。本人の`notify_overdue`/`notify_due_today`がfalseの種類は集計・文面から除く。
5. **最初の1件**：`due_date` の昇順 → `created_at` の昇順 → `id` の昇順（同じ入力で常に同じ1件になるよう、最後に主キーで決める）。
6. 文面：`title`＝「タスクの期限」、`body`＝「期限超過2件・今日期限1件：◯◯の資料作成 ほか」（1件だけなら「ほか」を付けない。0件の種類は書かない。タスク名は40字で切る）、`url`＝`/?open=my-tasks`。
7. 一覧取得はすべて `notify-deadlines` 末尾の Deno 版 `fetchAllRows` と同じ実装を使う（総件数到達または空ページで止める。「返ってきた件数 < ページサイズ」で止めない）。

### 7.3 送信

- 購読ごとに送信。`201` は成功として `last_success_at` を更新、`410`/`404` は購読を削除して `subscriptions_removed` に数える、それ以外（`429`・`5xx`・例外）は失敗として `failure_count` を増やし、ステータス別件数を `error_summary` にまとめる。1件の失敗で全体を止めない。
- TTL は12時間（翌朝まで溜まった古い通知が届かないようにする）。
- アプリ内通知の INSERT はプッシュの成否と独立に行う。
- **祝日（決定：送らない。09-30 rev2）**：フロントの `src/lib/date/holidays.ts` が使っている `japanese-holidays`（依存ゼロ・通信なしをオフライン検証済み。CLAUDE.md v3.05）を、Edge Function（Deno）側でも使う。Edge Functionは各関数が独立したデプロイ単位で `src/` を直接importできないため、`notify-deadlines`が`@supabase/supabase-js`を`https://esm.sh/@supabase/supabase-js@2`で読み込んでいるのと同じ手法（esm.sh経由のnpmパッケージimport）で `https://esm.sh/japanese-holidays@1` を読み込み、`isHoliday(d, true)`を呼ぶ薄いラッパーを`push-reminders`内に持つ（`src/lib/date/holidays.ts`とロジックを一致させ、コメントで対応関係を明記する）。**esm.sh経由でのDeno実行時の動作は今回未検証**（コードは依存ゼロと確認済みだが、実際にEdge Function上で動くかはdevデプロイ後に確認する。§7.4のライブラリ選定と同様、実装フェーズで検証すること）。
- **起動回数の試算は§7.1参照**（Freeプラン上限の約0.11%）。
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
| 1 | dev にマイグレ（6表：`push_subscriptions`・`notification_prefs`・`in_app_notifications`・`reminder_runs`・`reminder_send_log`・RPC2本・RLS）→ `schema.sql`・`schemaChecks.ts` 同期（Section 22）→ Edge Function（祝日判定・スロット解決・1人1日1回ガードを含む）→ フロント（送信時刻セレクタを含む） | dev で Chrome・Edge とも §10 の検証が通る。dev は cron 未稼働のため手動起動で確認する |
| 2 | prod に同じ順で適用。pg_cron `push-reminders-am`／`push-reminders-pm`（平日26回/日。§7.1）を登録。**Teams 週次は止めない** | — |
| 3 | 並行運用（5営業日） | 5営業日すべて `reminder_runs` が `success`、バナーが出ない、山本さんの Chrome・Edge に、選んだ時刻どおりに1日1回だけ届く |
| 4 | `cron.unschedule('notify-deadlines-weekly-monday')` | — |
| 5 | 方式B（`useDeadlineNotifications`）とリマインダーカードの `<select>` を削除。`useMentionNotifications` のゲートを付け替え | — |
| 5.5 | `backup-daily` の失敗通知・週次サマリを super_admin へのアプリ内通知＋Web Pushに切り替える（§6.2）。Web Push送信処理を`supabase/functions/_shared/webPush.ts`へ切り出し、`push-reminders`・`backup-daily`両方から呼ぶ | `backup_runs` が `failed`/`partial` になった実行で、super_admin にアプリ内通知（オンならWindows通知も）が届く |
| 6 | **1か月後（決定：新方式の稼働確認後に削除する。09-30 rev2）**：`notify-deadlines` 関数・`group_notification_settings` 表と管理画面の Webhook 欄・PA テンプレート配布（`admin-templates` バケット）・`TEAMS_WEBHOOK_URL`（`backup-daily`側の参照を含む）を削除する。PA フローはフロー所有者が削除する | — |

**ロールバック**：フェーズ3までは `cron.unschedule('push-reminders-am')`／`cron.unschedule('push-reminders-pm')` だけで元に戻る（Teams 週次は無改修で動いている）。フェーズ4以降は、`notify-deadlines` のジョブを `20260702b_reschedule_notify_deadlines_weekly.sql` の本文で登録し直す。ただし PA フローが死んでいる限り Teams 側へ戻しても届かないため、実質的なロールバック先は「Web Push を直す」になる。

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
| 9 | 匿名（ゲスト）JWT で6表を REST から読む | 本文が空配列（Section 58 の手順4） |
| 10 | cron を止めた翌朝 | 管理画面に赤バナーが出る |
| 11 | 送信時刻を12:00に変更し、8:30の回では届かず12:00の回で届く | `reminder_send_log`に今日の行が1つだけ作られる |
| 12 | 祝日に起動する | 通知が届かず、`reminder_runs`に「祝日のためスキップ」の行が残る |
| 13 | `backup_runs` を意図的に`failed`にする（手動実行の失敗を模擬） | super_admin 全員にアプリ内通知が届き、Windows通知オンの人には画面右下にも出る |

機械的な検証は、判定の純粋関数（対象抽出・最初の1件・文面・バナー判定・ディープリンク解析）を vitest で押さえる。`reminder_runs` のバナー判定は、修正前（バナー無し）で落ちるテストから書く。

---

## 11. 決定事項（2026-09-30 rev2）

rev1（本書初版）の未決事項9件について、同日中に山本さんの判断を得て以下のとおり確定した。以後この文書はこの決定に基づいて書かれている（§0・§4〜§9に反映済み）。

1. **既定値**：アプリ内通知＝オン、Windows通知＝オフ。
2. **個人で変えられる範囲**：チャネル＋種類（期限超過／今日期限）＋**送信時刻**（案C。当初推奨していた案Bから変更）。30分刻み・7:00〜19:00（JST）・既定8:30（§4.4）。
3. **祝日**：送らない。フロントが使っている `japanese-holidays` を Edge Function（Deno）側でも esm.sh 経由で読み込んで判定する（§7.3）。
4. **対象範囲**：本人が担当するタスクを全部署分まとめて数える（既存案のまま）。
5. **メンション通知**：Windows通知をオンにした人にだけ、タブ表示中のメンション通知を残す（既存案のまま）。
6. **設定UIの場所**：新規の通知設定モーダルを、リマインダーカードとベルの2か所から開く（既存案のまま）。
   - **【2026-10-01 変更・v3.127】** 通知設定モーダルは新設しない。設定ページ（`src/components/settings/SettingsView.tsx`）の「🔔 通知」タブに置き換える（リマインダーカード・ベルからはこのタブを開く）。
7. **Teams 関連の後始末（フェーズ6）**：`notify-deadlines`・`group_notification_settings`・Webhook 欄・PA テンプレート配布は、新方式の稼働確認後に**削除する**（§9）。
8. **バックアップ通知**：`backup-daily` の失敗通知・週次サマリは super_admin へのアプリ内通知（Windows通知をオンにしていればそちらも）に切り替える。**本書の範囲に含める**（§6.2・§9フェーズ5.5）。
9. **利用者への案内**：公開時に作る。「ブラウザを完全に終了していると届かない」「PC・ブラウザごとに設定が要る」を必ず書く。

### 新たに生じた未決事項（次回判断）

- 送信時刻の実装で新設した `japanese-holidays` の esm.sh 経由importが、実際にDeno上で（依存ゼロという事前確認どおり）問題なく動くかは未検証（§7.3）。dev検証（フェーズ0〜1）で確認する。
- super_admin が0人・またはsuper_admin全員がWindows通知をオフにしている部署運用での、バックアップ失敗通知の代替手段（メール等）は今回検討していない。アプリ内通知には届くため実害は小さいと見て一旦保留にした。
- 利用者向けガイドの執筆担当・具体的な公開時期は、実装フェーズが進んだ時点で改めて決める。

---

## 12. 実装（v3.128・2026-10-01）で設計から変えた点

実物の正本はコードと CLAUDE.md Section 66。以下はこの設計書の本文と違うところだけを記録する。

| # | 本文の記述 | 実装 | 理由 |
|---|---|---|---|
| 1 | §3.1 notificationclick は既存のウィンドウを `navigate(url)` | 開いているタブには `postMessage({type:"notification-click", url})` を送り、アプリ側（MainLayout）が `guardedNavigate` 経由で「自分のタスク一覧」に切り替える。タブが無ければ `openWindow(url)` | `navigate()` は再読み込みになり、保存前の編集が無言で消える（Section 46） |
| 2 | §3.1 SW は push と notificationclick の2ハンドラだけ | 加えて install で `skipWaiting()`・activate で `clients.claim()` を持つ（fetch ハンドラは持たない）。`vercel.json` で `/sw.js` を `no-store`、登録は `updateViaCache:"none"` | 更新時に古い SW が残らないようにするため。キャッシュはしないので version.json の再読み込み案内（Section 63）とは衝突しない |
| 3 | §7.3 dryRun は人ごとの文面を返す | 時刻で絞らず全員分を返し、各人の送信時刻（`reminderTime`）・その日が休日か（`daySkip`）・VAPID の設定有無も返す | 現在のスロットに該当者がいないと何も確認できないため |
| 4 | §6 reminder_runs の列 | `slot_time` 列を追加。RPC を2本追加：`claim_reminder_sends`（§6.1 の INSERT … ON CONFLICT DO NOTHING RETURNING を1文で行う・service_role 専用）／`push_subscription_stats`（購読数を super_admin に返す。購読表は本人の行しか読めないため） | — |
| 5 | §5.2 既読化 RPC | `mark_in_app_notifications_read(NULL)` は本人の未読をすべて既読にする（「すべて既読」用） | — |
| 6 | §6.3 赤の条件 | 予定スロットの記録が `running` のまま残っている場合も赤（数秒で終わる処理が終わっていない＝途中で落ちた）。手動実行・テスト送信の記録は cron の代わりに数えない。祝日も判定する（祝日も cron は動き「祝日のためスキップ」を記録するため） | — |
| 7 | §4.3 方式B は §9 フェーズ5で廃止 | v3.128 で廃止した（`useDeadlineNotifications` を削除）。ダッシュボードのリマインダーカードの `<select>` は「🔔 通知設定」ボタン（設定ページの通知タブを開く）に置き換えた。`members.notify_pref` 列は残す | 通知方法を選ぶ UI を設定ページへ移したため、旧方式をオフにする手段が無くなる。ベルがタブ表示中の役割を引き継ぐ |
| 8 | §4.5 送信時刻を変えた日の扱い | 本文どおり（その日の分を送った後に変えたら翌営業日から） | — |
| 9 | §5.3 ベルの置き場所 | サイドバー下部の1行（カレンダーの右）とモバイルのヘッダー（設定の左）。パネルの「⚙ 通知設定」は設定ページの通知タブを開く | — |
| 10 | §7.1 テスト送信 | 本人の JWT のみ。1分6回までの連打防止（Section 18）を手動実行と共用。`reminder_runs` に `trigger='test'` で記録する | — |
| 11 | §7.3 送信は「購読ごとに送信」（人は1人ずつ処理） | 独立レビュー対応（2026-10-01）。人ごとの送信を同時実行数10人の上限つきで並列化（`_shared/concurrencyPool.ts` の `runWithConcurrency`。Promise.allSettledベース）。**1人1日1回のclaim（§6.1）は並列化より前に完結しており、送信に失敗した人をその場で再試行することはしない＝「その日は再送しない」仕様は変わらない。** `reminder_runs` の成功・失敗件数は並列実行でも人ごとの結果を集計してから書くため正しい | 直列だと人数分だけ実行時間が伸びる |
| 12 | §3.1 ログアウト時の購読解除は本文に無し | 独立レビュー対応（2026-10-01）。`App.tsx` の `handleLogout` が `signOut()` の前にこのブラウザの購読解除（`unsubscribeThisBrowser` → DB削除）を行う。失敗してもログアウトは止めない（console.warnのみ） | 共有PCで前の利用者宛の通知が出続けるのを防ぐため |
| 13 | §3.1 notificationclick のURL検証 | 独立レビュー対応（2026-10-01）。開くURLを `new URL(url, self.location.origin)` で解決し、origin不一致なら `"/"` を開く | 他オリジンへの遷移を防ぐ |
| 14 | §7.3 祝日判定の失敗時の扱い・日付構築 | 独立レビュー対応（2026-10-01）。`isHoliday` が読み込めなければ throw（黙って「祝日ではない」へフェイルオープンしない）。判定日付は年月日を直接ローカル構築し、実行環境のタイムゾーンに依存しないようにした | ライブラリ読み込み失敗を検知できないまま運用されるのを防ぐ |
| 15 | §7.1 x-cron-secret の比較方法 | 独立レビュー対応（2026-10-01）。定数時間比較（`_shared/timingSafeEqual.ts`）に変更 | タイミング攻撃への耐性 |
| 16 | §5.3 ベルの更新タイミング | 独立レビュー対応（2026-10-01）。`sw.js` が push 受信時に開いているクライアントへ `postMessage` し、ベルが受けて未読数を再取得（保険で3分おきの定期取得も追加） | タブを開いたままでも未読バッジが追従するように |
| 17 | §5.3 ベルの置き場所・§4 個人設定（種類は期限超過／今日期限のみ） | v3.129：ベルは画面右上に常設（サイドバー・モバイルヘッダーの旧ベルは撤去／統合）。個人設定は種類×チャネル（notification_prefs.kind_channels）。管理者向け通知（利用者の画面でエラー）を追加し、push-reminders の cron 実行で期限とは別枠にまとめて送る | CLAUDE.md Section 67 |

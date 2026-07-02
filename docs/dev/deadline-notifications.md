# 期限の通知（リマインダーのアラート化）— 設計・デプロイ手順

> ステータス：**B・D ともに実装・デプロイ完了**（Dの@メンション化は作業中・Power Automateフロー未整備） ・ 作成 2026-05-29／2026-07-02 Dを「毎週月曜・全員向け週次レポート」仕様に変更／2026-07-02b @メンション対応の構造化JSON化＋dryRun追加
> 関連：`DashboardView`（設定UI・Bのみ対象）, `hooks/useDeadlineNotifications.ts`（方式B）,
> `supabase/functions/notify-deadlines/`（方式D）, `KrReportPanel`（既存のTeams送信＝MessageCard形式の参考）

ダッシュボードの受動的な「リマインダー」に加え、能動的な**アラート（通知）**を出す。

## 全体像

| 方式 | 対象 | いつ届く | 担当コード | 状態 |
|---|---|---|---|---|
| **B ブラウザ通知** | 自分（`notify_pref='browser'`を選んだ人のみ・個人opt-in） | アプリ（タブ）を開いている間 | `useDeadlineNotifications`（MainLayoutで起動） | ✅ 実装・本番反映で有効 |
| **D Teams週次レポート** | **全員**（opt-in不要。チーム全体の状況共有） | 毎週月曜 JST 8:30・Teams共有チャンネルへ1通 | Edge Function `notify-deadlines` ＋ pg_cron | ✅ 2026-07-02 本番配線完了 |

### D（Teams週次レポート）の仕様（2026-07-02 確定）

- **頻度**：毎週月曜 JST 8:30 のみ（当初「毎朝・Teams希望者だけ」で設計したが、共有チャンネルに他人のタスクが毎日流れるのは「うざったい」というフィードバックを受け、「全員が見てよい週次のチーム状況レポート」に設計変更）
- **対象**：`notify_pref` に関係なく、全メンバーの未完了タスク全件（個人のTeams opt-in設定は本方式には使われない。Bのブラウザ通知のみ個人設定が有効）
- **構成**：**PJごとに**セクションを分け、各PJ内で以下2カテゴリを列挙
  - 🔴 期限超過（本日期限も含む・`due_date <= 今日`）
  - 🟡 今週中に完了予定（`今日 < due_date <= 今週の日曜`）
  - 各行は `- タスク名（担当者）` 形式。担当者が複数いる場合は `/` 区切り
  - どちらのカテゴリにも該当タスクが無いPJはレポートから省略
- **マルチテナント非対応**：現状は全メンバーが単一グループ（`grp-egg`）のため`group_id`での絞り込みはしていない。将来複数グループが実運用されたら要対応（コード側にコメント済み）。

### D の担当者を Teams @メンションにする（2026-07-02b・作業中）

担当者を「（駒井 映里）」という平文ではなく、実際に本人へ通知が飛ぶ **@メンション** にする改修に着手。

**技術的な制約：**
- @メンショントークンは **Power Automate フロー側でしか生成できない**（Edge Functionからは作れない）。MessageCard形式自体もメンションに対応していない。
- そのため Edge Function の出力形式を、MessageCardの直送りから**構造化JSON**に変更した：
  ```json
  {
    "messageText": "...本文全体（担当者名の代わりに %%mention_1%% のようなプレースホルダーが入っている）...",
    "mentions": [ { "placeholder": "%%mention_1%%", "email": "someone@amita-net.co.jp" } ],
    "totalOverdue": 50, "totalThisWeek": 2, "projectCount": 6
  }
  ```
- `email` が未登録のメンバーはメンション不可のため、その担当者だけ表示名の平文になる（フォールバック）。
- **Flow bot（ボットとして投稿）だと @メンショントークンが機能しないことがある**という既知の制約報告あり。今のPower Automateフローはこの投稿方式のため、動作しない可能性がある。「投稿者」をFlow botではなく接続アカウント本人（User）にする設定に変更すると改善する可能性がある（要現地確認）。

**現状のブロッカー（2026-07-02 dryRunで判明）：**
- **`members.email` が誰も登録されていない**（`mentions: []`）。メンションを実現する前提として、まず管理画面「メンバー」タブで各人の会社メールアドレス（Microsoft 365のログインメールと同じもの）を入力する必要がある。

**安全なテスト方法（`?dryRun=1`）：**
```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/notify-deadlines?dryRun=1" \
  -H "x-cron-secret: <NOTIFY_CRON_SECRET>" -H "Content-Type: application/json" -d "{}"
```
Teamsへは投稿されず、生成される `messageText` / `mentions` の中身だけを確認できる。emailを入力したメンバーの分だけ `mentions` 配列に追加されるはずなので、まずこれで登録状況を確認できる。

**残作業（山本さん・Power Automate側）：**
1. 管理画面でメンバーの `email` を埋める
2. `?dryRun=1` で `mentions` 配列が空でなくなることを確認
3. Power Automateフローを「MessageCard直送り」から下記のロジックに作り直す：
   1. HTTPトリガーの受信ボディから `messageText` と `mentions` を取得
   2. 文字列変数 `resultText` を初期化し、`messageText` を代入
   3. `mentions` 配列に対して **Apply to each（同時実行数を1に設定＝順次実行）**：
      - アクション「ユーザーの@メンショントークンを取得する」に `email`（`item()?['email']`）を渡す
      - `resultText` を `replace(variables('resultText'), item()?['placeholder'], <取得したメンショントークンの動的な値>)` で更新
   4. ループ後、「チャットまたはチャネルでメッセージを投稿する」で `resultText` を本文として投稿
      - **投稿者（Post as）は「Flow bot」ではなく「User」（フロー所有者）に変更してみる**（メンションがbot contextで動かない既知の制約への対策）
4. 動作確認は少人数（1〜2件）でまず試す
5. うまくいかない場合は投稿者設定・トリガー種別を再検討

## デプロイ手順（D）

### 1. DBマイグレーション（members.notify_pref 追加）
`supabase/migrations/20260529_add_notify_pref.sql` を Supabase SQL Editor で実行：

```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS notify_pref text NOT NULL DEFAULT 'none';
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_notify_pref_check;
ALTER TABLE members ADD CONSTRAINT members_notify_pref_check
  CHECK (notify_pref IN ('none','browser','teams'));
```

> ※ これは **B/D共通の前提**。設定UIで保存する前に必ず適用すること（未適用だと保存時にエラー）。

### 2. Edge Function のシークレット設定
受信Webhook URL（`.env` の `VITE_TEAMS_WEBHOOK_URL` と同じ値でよい）と、起動用の共有シークレットを登録：

```bash
supabase secrets set TEAMS_WEBHOOK_URL="https://xxxx.webhook.office.com/webhookb2/xxxx"
supabase secrets set NOTIFY_CRON_SECRET="<長いランダム文字列を生成して設定>"
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Edge Function 実行時に自動付与される
```

### 3. Edge Function のデプロイ
```bash
supabase functions deploy notify-deadlines
```

### 4. 手動テスト（Teamsに届くか先に確認）
```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/notify-deadlines" \
  -H "x-cron-secret: <NOTIFY_CRON_SECRET>" -H "Content-Type: application/json" -d "{}"
```
- 期待：PJごとに期限超過／今週中のタスクがあれば Teamsチャンネルに投稿され `{"posted":true,"totalOverdue":n,"totalThisWeek":n,"projects":n}`。
- **注意：`notify_pref` に関係なく全員のタスクが対象なので、このcurlを叩くと実際に本番Teamsチャンネルに投稿される。** テスト目的でも本番相当の内容が飛ぶことを踏まえて実行すること。
- 対象タスクが1件もなければ投稿せず `{"posted":false,"reason":"no target tasks"}`。
- **末尾に `?dryRun=1` を付けるとTeamsへ投稿せず、生成されるJSON（`messageText`/`mentions`）だけを確認できる。** Power Automateフロー未整備の間や `email` 登録状況の確認はこちらを使うこと。

### 5. 毎週月曜の定期実行（pg_cron）
Supabase SQL Editor で（`<PROJECT_REF>` と `<NOTIFY_CRON_SECRET>` を置換。詳細は `supabase/migrations/20260702b_reschedule_notify_deadlines_weekly.sql`）：

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 旧・毎日ジョブが残っていれば解除
select cron.unschedule('notify-deadlines-daily')
where exists (select 1 from cron.job where jobname = 'notify-deadlines-daily');

-- 毎週月曜 JST 8:30（= 毎週日曜 UTC 23:30）に起動
select cron.schedule(
  'notify-deadlines-weekly-monday',
  '30 23 * * 0',  -- 曜日欄の 0 = 日曜（UTC）。JSTでは翌月曜 8:30
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<NOTIFY_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 確認：select * from cron.job;
-- 解除：select cron.unschedule('notify-deadlines-weekly-monday');
```

## 注意・将来の論点
- **O365 受信Webコネクタは 2026年5月18〜22日に Microsoft により完全廃止済み**。本番は最初から Power Automate の「Workflows」（テンプレート「Webhook 要求を受信したときにチャンネルに投稿する」）で構築。Workflows は MessageCard 形式をそのまま受理するため、Edge Function 側のペイロード変更は不要だった。
- **個別（各自に私信）通知**は受信Webhookでは不可。Power Automate Workflows もしくは Graph API＋Azure AD（IT部門）が要る。今回は共有チャンネルまとめで開始し、要件が固まってから検討（`members.teams_account` を宛先解決に使える）。
- **送信内容**：タスク名・期日・PJ名・担当者名のみ。`comment` 等の機微情報は載せない。
- **社用PCのブラウザ通知**：グループポリシーで無効化されている可能性あり。その場合は Teams（D）が確実。

# 期限の通知（リマインダーのアラート化）— 設計・デプロイ手順

> ステータス：実装済み（クライアント）／**Dはデプロイ待ち** ・ 作成 2026-05-29
> 関連：`DashboardView`（設定UI）, `hooks/useDeadlineNotifications.ts`（方式B）,
> `supabase/functions/notify-deadlines/`（方式D）, `KrReportPanel`（既存のTeams送信＝MessageCard形式の参考）

ダッシュボードの受動的な「リマインダー」に加え、能動的な**アラート（通知）**を出す。
ユーザーごとに **Teams通知 / ブラウザ通知 / 通知なし** を選べる（`members.notify_pref`）。

## 全体像

| 方式 | いつ届く | 担当コード | 状態 |
|---|---|---|---|
| **B ブラウザ通知** | アプリ（タブ）を開いている間 | `useDeadlineNotifications`（MainLayoutで起動） | ✅ 実装・本番反映で有効 |
| **D Teamsまとめ投稿** | タブを閉じていても（毎朝Teamsに） | Edge Function `notify-deadlines` ＋ pg_cron | ⏳ 下記手順でデプロイ |

- 対象タスク：自分担当・未完了・**期限切れ＋本日期限**（`due_date <= 当日`）。
- ユーザー設定：ダッシュボードのリマインダーカード右上のセレクタ（なし/ブラウザ/Teamsまとめ）。`members.notify_pref` に保存。
- B は `notify_pref='browser'` かつブラウザ通知許可が前提。同じ日の二重通知は localStorage で防止。
- D は `notify_pref='teams'` のメンバーの期限タスクを**担当者別にまとめ**、Teams受信Webhookへ MessageCard を投稿（=共有チャンネルに1日1回）。

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
- 期待：`notify_pref='teams'` のメンバーに本日以前期限のタスクがあれば Teamsチャンネルに投稿され `{"posted":true,...}`。
- 対象が無ければ投稿せず `{"posted":false,...}`（=ノイズを出さない）。
- まずテスト用に自分を `notify_pref='teams'` にし、期限切れタスクを1件用意して確認すると確実。

### 5. 毎朝の定期実行（pg_cron）
Supabase SQL Editor で（`<PROJECT_REF>` と `<NOTIFY_CRON_SECRET>` を置換）：

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 毎朝 08:00 JST（= 23:00 UTC）に起動
select cron.schedule(
  'notify-deadlines-daily',
  '0 23 * * *',
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
-- 解除：select cron.unschedule('notify-deadlines-daily');
```

## 注意・将来の論点
- **O365 受信Webコネクタは Microsoft が段階的に廃止予定**。後継は Power Automate の「Workflows」（HTTPトリガー → チャネル/チャットへ Adaptive Card 投稿）。移行時は `TEAMS_WEBHOOK_URL` を Workflows のURLに差し替え、必要ならペイロード形式を MessageCard → Adaptive Card に変更するだけで Edge Function のロジックは流用可能。
- **個別（各自に私信）通知**は受信Webhookでは不可。Power Automate Workflows もしくは Graph API＋Azure AD（IT部門）が要る。今回は共有チャンネルまとめで開始し、要件が固まってから検討（`members.teams_account` を宛先解決に使える）。
- **送信内容**：タスク名・期日・PJ名・担当者名のみ。`comment` 等の機微情報は載せない。
- **社用PCのブラウザ通知**：グループポリシーで無効化されている可能性あり。その場合は Teams（D）が確実。

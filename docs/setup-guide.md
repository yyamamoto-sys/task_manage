# グループ計画管理アプリ セットアップガイド

> 新しいグループへ展開するための手順書です。IT担当者または展開責任者が実施してください。
> 所要時間：約2〜3時間（Supabase作業含む）

---

## 前提条件

- GitHubアカウント（リポジトリへのアクセス権）
- Supabaseアカウント（無料枠で運用可能）
- Vercelアカウント（GitHubと連携）
- Microsoft Teams 管理者権限（Webhook設定を行う場合）

---

## STEP 1：Supabase プロジェクトを作成する

新しいグループ向けに **独立したSupabaseプロジェクト**を作成します（既存グループのデータと完全に分離されます）。

1. [supabase.com](https://supabase.com) にログインし、「New project」をクリック
2. プロジェクト名を設定（例：`group-task-manage-XX`）
3. データベースパスワードを設定して保存しておく
4. リージョンは **Northeast Asia（Tokyo）** を選択
5. プロジェクト作成完了まで約1〜2分待つ

### 1-1. データベーススキーマの適用

Supabase の「SQL Editor」を開き、以下のSQLファイルを順番に実行します。

```
supabase/migrations/ 内のファイルを番号順に実行
```

> 実行後、「Table Editor」で各テーブルが作成されていることを確認してください。

### 1-2. Edge Function のデプロイ

AI機能を使用するために、Edge Functionをデプロイします。

```bash
supabase functions deploy ai-consult --project-ref <プロジェクトREF>
```

その後、Supabaseダッシュボードの **Settings > Edge Functions** で環境変数を設定：

| キー | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic APIキー（IT部門から取得） |

### 1-3. 接続情報を控える

Supabase の **Settings > API** から以下を控えます：

- **Project URL**（例：`https://xxxx.supabase.co`）
- **anon public key**（長い文字列）

---

## STEP 2：環境変数ファイルを作成する

リポジトリのルートに `.env.local` ファイルを作成します（`.env.example` をコピーして編集）：

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...（控えたanon key）

# Teamsへの通知送信が必要な場合のみ設定（任意）
VITE_TEAMS_WEBHOOK_URL=https://xxxx.webhook.office.com/webhookb2/xxxx
```

> `.env.local` は絶対にGitにコミットしないこと。`.gitignore` で除外済みです。

---

## STEP 3：Vercel にデプロイする

1. [vercel.com](https://vercel.com) にログインし、「Add New Project」
2. GitHubリポジトリを選択してインポート
3. **Environment Variables** に STEP 2 の値を入力
4. 「Deploy」をクリック

デプロイ完了後、発行されたURLがアプリのアクセス先になります。

> 本番環境でもSTEP 2の環境変数を同様にVercelのダッシュボードで設定する必要があります。

---

## STEP 4：初期データを登録する

アプリにアクセスし、管理画面（右上メニュー → 管理）から以下の順番で登録します。

### 4-1. メンバー登録

**管理 → メンバー** タブを開き、グループメンバーを登録します。

| 項目 | 説明 |
|---|---|
| 表示名 | フルネーム（例：山本 太郎） |
| 短縮名 | チェックイン等で使う呼称（例：山本） |
| アバター色 | 識別用のカラー |

### 4-2. Objective / KR 登録

**管理 → Objective / KR** タブを開きます。

1. 通期Objective（年間目標）を入力して保存
2. KR（Key Result）を追加（通常3件程度）

> KRは「測定可能な成果指標」で記述します。例：「○○の件数を△から□に増やす」

### 4-3. Task Force（TF）登録

**管理 → Task Force** タブを開きます。

各KRに対して、施策単位でTFを作成します。

| 項目 | 説明 |
|---|---|
| TF番号 | TF1, TF2... の連番 |
| TF名 | 施策の名称（例：新規顧客開拓） |
| リーダー | このTFの責任者を選択 |

---

## STEP 5：動作確認

以下の操作ができれば初期セットアップ完了です。

- [ ] メンバーでログインできる
- [ ] ダッシュボードにKR進捗サマリーが表示される
- [ ] タスクを1件追加できる
- [ ] AIアシスタント（相談ボタン）が応答する
- [ ] ラボ → KRセッション記録 が開ける

---

## よくあるトラブル

**「ログインできない」**
→ メンバー登録が完了しているか確認してください。

**「AIが応答しない」**
→ Supabase Edge Function に `ANTHROPIC_API_KEY` が設定されているか確認してください。Supabaseのダッシュボード → Functions → ai-consult → Secrets で確認できます。

**「データが表示されない」**
→ `.env.local`（またはVercelの環境変数）のSupabase URLとAPIキーが正しいか確認してください。

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-04-29 | 初版作成 |

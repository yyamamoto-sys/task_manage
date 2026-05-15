# plan-app アーキテクチャ

plan-app の全体構成・主要パターン・データの流れ。後任者がコードを読み解くための地図。

## 1. 技術スタック

| レイヤ | 採用 |
|---|---|
| フロントエンド | React 18 + TypeScript + Vite 8 |
| 状態管理 | Zustand（`src/stores/appStore.ts`） |
| バックエンド | Supabase（PostgreSQL + Auth + Edge Functions） |
| AI | Anthropic Claude（モデル： `claude-sonnet-4-6` ほか）via Edge Function `ai-consult` |
| デプロイ | Vercel（main ブランチへの push で自動デプロイ） |
| テスト | Vitest |
| Lint | ESLint + jsx-a11y + react-hooks |
| ファイル抽出 | fflate（.docx 解凍） |

## 2. ランタイム構成

```
┌────────────┐    ┌─────────────┐    ┌──────────────┐
│  Browser   │───►│   Vercel    │    │   Supabase   │
│ (React app)│    │  (静的配信)  │    │              │
│            │    └─────────────┘    │  ┌─────────┐ │
│            │─────────────────────► │  │Postgres │ │
│            │  supabase-js (Data API)  │ ※RLS有効│ │
│            │                       │  └─────────┘ │
│            │                       │  ┌─────────┐ │
│            │─────────────────────► │  │Auth     │ │
│            │  signInWithPassword   │  └─────────┘ │
│            │                       │  ┌─────────┐ │   ┌────────────┐
│            │─────────────────────► │  │Edge Func│──►│ Anthropic  │
│            │  functions.invoke     │  │ai-consult│   │   Claude   │
│            │                       │  └─────────┘ │   └────────────┘
└────────────┘                       └──────────────┘
```

- **アプリ本体は静的アセット**として Vercel から配信
- データ API・認証は **直接 Supabase に supabase-js 経由でアクセス**
- AI 呼び出しは **必ず Edge Function `ai-consult` を経由**（APIキーをクライアントに露出させないため）

## 3. 認証フロー

1. `<App />` 起動時に `supabase.auth.getSession()` でセッション確認
2. 未ログイン → `<LoginScreen>`：メアド+パスワードで `supabase.auth.signInWithPassword`
3. ログイン成功 → JWT がブラウザに保管され、以降の Supabase アクセスは **`authenticated` ロールに昇格**
4. `<UserSelectScreen>` でアプリ内の「業務上のメンバー」を選択（ログイン中ユーザーと別人格を選べる）
5. 選択メンバーが localStorage に記録され、各 API 呼び出しの `member_id` として使われる

> **重要：** Supabase Auth のユーザーと、アプリの業務メンバー（members テーブル）は**別概念**。1つの Auth アカウントで複数のメンバーを切り替えられる設計。

## 4. モジュール構造（`src/`）

| ディレクトリ | 役割 |
|---|---|
| `App.tsx` | ルート。認証状態によって表示を切替 |
| `main.tsx` | エントリーポイント |
| `components/layout/` | サイドバー・モード切替・全体レイアウト |
| `components/auth/` | LoginScreen, UserSelectScreen, SetupWizard |
| `components/dashboard/` | 計画モードのトップ画面、ProjectKarte |
| `components/kanban/` `gantt/` `list/` | 計画モードのビュー |
| `components/okr/` | OKR モード本体 |
| `components/lab/` | KR会議系パネル（Session/Report/Why/QuarterPlan/JointFlow） |
| `components/consultation/` | AI相談ツール（複合パネル） |
| `components/meeting/` | 会議読み込み |
| `components/admin/` | 設定（メンバー/Objective/KR/TF/PJ管理） |
| `components/guide/` | 📖 ガイドモード・HelpButton・GuideOverlay |
| `components/common/` | Toast, MarkdownLite, FileAttachButton, アイコンなど |
| `components/task/` | TaskEditModal, QuickAddTaskModal |
| `lib/ai/` | invokeAI, 各 intent ごとのプロンプト＋クライアント |
| `lib/supabase/` | client.ts（接続）、各 store（テーブルごとの CRUD） |
| `lib/localData/` | localStorage 経由のローカルキャッシュ・型定義 |
| `lib/docs/` | docs/guides/**/*.md の取り込みと frontmatter パース |
| `stores/appStore.ts` | Zustand のグローバル状態（テーブルの in-memory 表現） |
| `hooks/` | useTheme, useIsMobile, useAIConsultation, useTypingEffect, etc. |
| `context/AppDataContext.tsx` | 初期データロード・realtime購読・provider |

## 5. データフロー

### 読み込み
1. `<AppDataProvider>` がマウント時に全テーブルを fetch して `appStore` にセット
2. Supabase realtime で変更を購読（テーブルごとに subscription）
3. 各コンポーネントは `useAppStore(s => s.tasks)` のように個別 selector で必要なものだけ購読

### 書き込み
1. UI イベント → `lib/supabase/*Store.ts` の関数を呼ぶ
2. Supabase に書き込み → realtime 経由で他クライアントにも反映
3. **楽観ロック**：`updated_at` を `expectedUpdatedAt` として検証する `saveWithLock` パターン

### AI 呼び出し
1. UI から `lib/ai/invokeAI.ts` の `invokeAI(systemPrompt, messages, maxTokens, intent)` を呼ぶ
2. `supabase.functions.invoke('ai-consult', ...)` で Edge Function を叩く
3. Edge Function が Anthropic API にプロキシ + 使用量を `ai_usage_logs` に記録
4. レスポンスをアプリに返す
5. 各 intent は型 `AIIntent` で定義（`task-management`, `kr-report`, `kr-quarter-plan`, `kr-session-extract`, etc.）

## 6. ビルド・デプロイ

```
git push → GitHub → Vercel webhook → vite build → dist/* を配信
```

- **コマンド：** `npm run build`（内部で `tsc && vite build`）
- **環境変数：** Vercel 側で `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定
- **チャンク分割：** 重量級ビューは `lazyWithRetry` で動的 import（OkrDashboardView, AdminView, GraphView 等）。デプロイ直後の古いチャンク 404 を自動リトライで吸収

## 7. 主要パターン

### lazyWithRetry
`src/lib/lazyWithRetry.ts`。React.lazy のラッパで、`Failed to fetch dynamically imported module` を一定回数リトライしてから諦める。Vercel 再デプロイ直後の古いチャンクハッシュ参照対策。

### 楽観ロック（saveWithLock）
`updated_at` を `expectedUpdatedAt` として比較してから UPDATE。並行編集を検出して衝突を防ぐ。

### 個別 selector
`useAppStore(s => s.tasks)` のように **必要な state だけを購読**。Zustand の再レンダー最適化。

### MarkdownLite
`src/components/common/MarkdownLite.tsx`。AI出力の `## / ### / - / 1. / **bold**` のみをサポートする軽量パーサ。フル Markdown ライブラリを入れない代わりに、AI プロンプトをこの subset に合わせている。

### ガイド統合
`docs/guides/**/*.md` を `import.meta.glob` で取り込み、frontmatter の `mode:` キーで `<HelpButton modeKey="...">` と紐づけ。`?` ボタンが対応 MD を即表示。

## 8. AI 周辺の構造

`src/lib/ai/` 配下：

| ファイル | 役割 |
|---|---|
| `invokeAI.ts` | 全 AI 呼び出しの共通入口。intent ごとに max_tokens を分けたい時はここから |
| `types.ts` | `AIIntent` 型・`AIMessageInput`・`FileAttachment` |
| `proposalMapper.ts` | AI出力 → UI Proposal（PJ/タスク登録用） |
| `inferConsultationType.ts` | 入力テキストから相談カテゴリを推定 |
| `chatHistoryStorage.ts` | 相談履歴の保存（Supabase） |
| 個別プロンプト | `krReportPrompt.ts`, `krQuarterPlanPrompt.ts`, `krSessionExtractor.ts`, `meetingExtractor.ts`, `taskDecompose.ts`, ... |
| 個別クライアント | `krReportClient.ts`, `krQuarterPlanClient.ts`, ... |

各 AI 機能は **プロンプト（システム＋フォーマット指示） + クライアント関数（invokeAI 呼び出し）** のペアで構成。

## 9. 関連ドキュメント

- [supabase-migrations.md](./supabase-migrations.md)
- [data-model.md](./data-model.md)
- [runbook.md](./runbook.md)
- [handover-checklist.md](./handover-checklist.md)
- [全体像（5分）](../guides/00_overview.md)（利用者向け）

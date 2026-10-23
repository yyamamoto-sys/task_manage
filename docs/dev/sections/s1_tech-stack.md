## 1. 技術スタック

| 項目 | 選定 | 理由 |
|---|---|---|
| フロントエンド | TypeScript + React | 型安全・AI補助開発との相性 |
| データベース | Supabase（PostgreSQL） | 無料枠で十分・多対多リレーション対応・RLS設定可 |
| AI連携 | Anthropic Claude API（claude-sonnet-4-6） | OKR/PJ/タスクの相談・分析・レポート生成等に使用（2026-05-13以降 OKR関連情報も投入可） |
| AI中継 | Supabase Edge Function（ai-consult） | APIキーをサーバーサイドにのみ保持するため |
| 通知連携 | Web Push＋アプリ内通知（Edge Function push-reminders・backup-daily） | 期限リマインド・管理者向け通知（Section 66〜68）。Teams 通知は v3.136 で撤去（KRレポートの「Teams送信」ボタンは別機能で残る） |
| ホスティング | Vercel | GitHubへのpushで自動デプロイ（main branch） |

**⚠ 確認が必要な事項（未解決）**
- ~~Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要~~
  → **2026-08-07に確認済み（社内的にクリア）。** 山本さんが「Supabase保存はすでに問題ない」と確認した。この記述が残っていたために `quarterPlanStore.ts` が localStorage 実装のまま取り残されていた（2026-08-07にSupabase移行・v3.38。`docs/dev/okr-redesign-plan.md` §9参照）。**この決着が付いたことは記録として残す（放置するとまた誰かが同じ判断をやり直すため）。**
- Claude APIへのデータ送信について社内ポリシーとの整合性確認が必要（今回の確認範囲外・未解決のまま）
- Teams埋め込みアプリとしての申請手続き確認が必要（今回の確認範囲外・未解決のまま）

---

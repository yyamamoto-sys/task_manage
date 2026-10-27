# 現状と未解決事項（status-and-open-items）

作成：2026-10-27（本番 v3.186 時点）。設計の正本は `CLAUDE.md` と `docs/dev/sections/`、変更履歴は `docs/dev/CHANGELOG.md`。
本書は「いま何が動いていて、何が決まっていないか」だけを書く。版が進んだら更新すること。

## 1. 現在の状態

- 本番は **v3.186**（`src/lib/version.ts` の `APP_VERSION`。`MIN_CLIENT_VERSION` は 3.152）。main へ push すると Vercel が本番へ自動デプロイする。**Edge Function は push では反映されず**、Supabase 側で個別にデプロイが必要。
- 本番 Supabase は **Free プラン・Nano（RAM 約411MB）**。自動バックアップ・PITR は無い（`backup-design.md`・`runbook.md` §5）。リージョンは国外（シドニー）、開発 DB は東京。
- 期限通知は **Web Push＋アプリ内通知**（`web-push-reminder-design.md`・Section 66〜68）。旧 Teams 週次通知は v3.136 で撤去済み。
- CLAUDE.md は目次化済み（約320行）。各節の本文は `docs/dev/sections/`（Grep→部分読みが前提）。
- コード巡回（領域ごとの定期点検）は 64 回目まで実施。台帳は `docs/REFACTORING.md` の M 表。点検済みは A 計画ビュー全範囲・B AI相談・C 会議読み込み・D OKR（①〜⑤）・E PJ別AI分析・G オンボーディング・AI基盤・共通UI・データ基盤・App Shell。
- 英語化は Phase 2 以降が**凍結中**（`i18n-plan.md`）。

## 2. 保留中の記録課題（`docs/REFACTORING.md` の M 表）

いずれも「現状は実害が小さい／判断材料が足りない」ために直していないもの。再開の条件も併記する。

| ID | 内容 | 現状・再開条件 |
|---|---|---|
| M57 | `outlookFingerprint` が `imported_at` を `updated_at` より優先する | 実害なし（明示ボタンが `force` を付けるため）。自動発火を戻すときに見直す |
| M76 | グループ並べ替えが1件ずつ保存で、途中失敗すると `sort_order` が重複する（表示は `created_at` で安定） | 1回で全件更新する RPC が要る＝**次にマイグレーションを出すときに相乗り**。単独では直さない |
| M82 | AI相談の履歴10ターンを全文送信（assistant ターンは提案 JSON 全文） | 過去の assistant ターンを「件数＋タイトル」に要約する案。応答品質に影響しうるため、実会話で比較してから |
| M86 | 資料インプット抽出の `max_tokens` が 4096。長い議事録で出力切れ（案内文は出る） | 切れる頻度を見てから。`max_tokens` 引き上げは 546 の再発リスクがあるため単純には上げない |
| M88 | PJ別AI分析が全タスクを上限なしでプロンプトに並べる | 完了・中止は件数のみ・一覧は上限200件にする案。大きな PJ で遅い／失敗するのを確認してから |
| M89 | 全PJのAI分析（ダッシュボード）は保存されず、再読込で再課金 | 現状維持が推奨。利用頻度が上がれば PJ 単体と同じく保存を検討（テーブル・RLS・GRANT が要る） |
| M90 | ゲストの AI 回数枠が Anthropic 側エラーでも消費される | 現状維持が推奨。直すなら返却用 RPC＋Edge 再デプロイ |
| M92 | 非2xx の文言が `invokeAI` と `apiClient` で違う | 実害なし。AI相談を `invokeAI` へ寄せるときに統一 |
| M94 | ツアー定義の将来の落とし穴2点（先頭ステップに `whileVisible: back` を付けると固まる／`start()` が進行中ツアーを既読にせず切り替える） | 現行4本では起きない。ツアーを足すときに `tour-guidelines.md` へ規約追記 |

関連して、M93（初回ツアーの AI 実演が、ツアー終了後も実データで1回送信され、直前の会話を消す）は未解決で、次回の巡回で直す方針。

## 3. 未解決事項

- **SMTP 未設定**：Supabase 標準のメール送信は、組織メンバー宛てにしか送れず、1時間に2通まで。このため、未サインアップのメンバーへの確認メールやパスワード再設定メールが届かない。社用メールサーバーでの SMTP 設定で解消できる。環境移管の範囲からは外し、移管完了後に検討する（2026-10-27 決定）。それまでの再設定は管理者が手作業で行う。手順は `account-recovery.md`。
- **2026-10-30 の Supabase 仕様変更（Data API の自動 GRANT 廃止）**：既存テーブルは影響なし。備えとして `schema.sql` 末尾に GRANT ブロック（57テーブル）を追加し、CLAUDE.md Section 39 に「新テーブルは同じマイグレーションに GRANT を書く」を追加済み。**以後の新テーブルはマイグレーションと `schema.sql` の配列の両方に書く**。
- **Disk IO と Pro 移行**：本番で Disk IO Budget 警告が出た。原因はディスクではなくメモリ不足（Swap が常時張り付き）。DB 本体は約22MB。CPU の最大消費は Realtime の変更取得。根本対策は Pro プラン（組織アカウントへの環境移管に合わせて実施予定）。つなぎとして v3.171 で、非表示10分で Realtime 購読を解除・通知ベルの定期取得を間引く対策を入れた。購読テーブルの削減（key_results・task_forces・todos 等）は未実施（publication の変更は別マイグレーション）。リスクは、朝の一斉復帰で全件再取得が集中すること。効果はダッシュボードの Disk IO 残量を数日観察して確認する。
- **巡回の次回候補**：65 回目＝ユーティリティ／フック（useConfirmClose・useUnsavedEditor・overlayEscape・useFloatingPanel・fetchAllRows）。同時に、文章を返す AI 呼び出し（KR レポート・分析・対話）の出力切れを、例外ではなく「注記を付けて残す」に戻す（v3.186 で例外にしたのは行き過ぎ。PJ 分析の `finalizeAnalysisText` 型に揃える）。その次は F 管理・設定（AdminView 各セクション本体・lib/feedback・FeedbackModal）、I 通知の未点検分（reminderLogic 等・各 store・sw.js・Edge Function 本体）。巡回1回あたりの AI 消費は約20〜24万トークン。
- **`VITE_TEAMS_WEBHOOK_URL` がクライアントに埋め込まれている**：`KrReportPanel.tsx` が KR レポートを Teams へ投稿するために `import.meta.env.VITE_TEAMS_WEBHOOK_URL` を読む。`VITE_` 変数はビルド成果物（JS）に含まれ、ログイン後の誰でも読める。環境移管後に Edge Function 経由へ移す予定（URL は Edge Function の secrets に置く）。
- **組織アカウントへの環境移管が進行中**：アプリ管理専用の組織アカウント（app_gantt@amita-net.co.jp）で Claude・Supabase・GitHub・Vercel を登録済み（Vercel は Team 作成済み）。本番の GitHub・Supabase・Vercel は移管前は個人アカウント配下のまま。Supabase・Vercel は組織用プランにする。移管完了後に社名入りの vercel.app ドメインへ切り替え、旧アドレスは案内ページを残す。移管前バックアップは素の `pg_dump`（Session pooler 経由。`auth.refresh_tokens`・`auth.sessions` のデータは除外）の手順を用意済み。実行前に決めること＝pg_dump の導入・DB パスワードの再設定・Storage の保持日数・開発 DB 復元の要否・旧環境の廃棄時期。
- **Teams 以外の外部前提**：旧 Teams 通知は Power Automate が受信時点で 202 を返すため、接続が死んでも送信側からは成功に見え、黙って止まった。同種の「外部の接続先に依存する通知」を足すときは、送信結果を DB に記録して管理画面で見えるようにする（`lessons-learned.md` §4）。

## 4. 実機確認について

v3.171 以降の実機確認（ブラウザ目視）は未実施の変更が多い。主なもの：ガントのグループ ⋮ 並べ替え（v3.165）、グループのドラッグ表示・端の自動スクロール（v3.166〜167）、Disk IO 対策の復帰時再取得（v3.171）、巡回 47〜64 回目の修正。縮小表示（ブラウザ拡大率が低いとき）で文字が荒れる件は、v3.164 のフォント切替が一部環境で発動せず、原因は未確定。再現条件（Windows の拡大縮小％・Chrome の拡大率・拡大スクリーンショット）が揃えば再調査する。

## 5. 関連

- 変更履歴：`CHANGELOG.md` ／ 巡回台帳：`../REFACTORING.md` ／ 引き継ぎ：`handover-checklist.md` ／ 障害対応：`runbook.md`
- 教訓：`lessons-learned.md`

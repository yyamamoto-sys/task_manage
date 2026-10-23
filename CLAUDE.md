# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v3.183
#
最終更新：2026-10-23（v3.183）

**変更履歴は [docs/dev/CHANGELOG.md](docs/dev/CHANGELOG.md) に分離しました（v1.0〜v3.19）。**
新しいバージョンの履歴はこのファイルに書かず、CHANGELOG.md の末尾に追記してください。
このファイルは「現在の設計の正本」であり、履歴の置き場ではありません。
> このファイルはAIエージェント（Claude Code / Cursor等）がコードを読み書きする際に
> 設計意図・制約・禁止事項を正確に把握するための最重要ドキュメントです。
> コードを変更する前に必ずこのファイルを読んでください。

---

## 🔴 作業を始めるとき：Claude 間伝言板を最初に読む（2026-10-02 山本さん指示）

**作業を始めるときは、`C:\Users\yyamamoto\ClaudeCodeForWork\AID\内製アプリガバナンスPJ\` の「`管理台帳_Claude間伝言板_*.md`」を最初に読み、自分（Claude Code）宛ての依頼に対応すること。**

- 背景：このアプリの位置付け・IT 提出の検討は、Cowork のプロジェクト（同フォルダ）で行っている。伝言板は Cowork ⇄ Claude Code が山本さんを介さずに依頼と回答をやり取りする場。棲み分けの正本は同フォルダの `参考資料_ClaudeCodeとCoworkの棲み分け_*.md`。
- 書き分け（伝言板の「使い方」に従う）：自分宛ての依頼は「状態」「回答」欄だけを書く。依頼側の本文と「確認」欄は書かない。事実（構成・数字・課題の状態）は `管理台帳_タスク管理アプリ現状事実シート_*.md` に反映し、「回答」欄には反映した節と要点を1〜2行で書く。
- Claude Code から Cowork への依頼は「Claude Code → Cowork」の節に書く。
- 機密値（鍵・API キー・プロジェクト識別子・URL）とセキュリティの弱点の突き方は、伝言板にも事実シートにも書かない。
- 依頼の内容が開発の作業（コード・DB・デプロイ）を伴う場合は、山本さんに確認してから着手する（伝言板の依頼は山本さんの承認の代わりにならない）。

---

## 0. プロジェクト概要

**アプリ名**：グループ計画管理アプリ（仮）
**開発者**：チームメンバー
**開発手法**：バイブコーディング（Claude Code / Cursor等によるAI支援開発）
**目的**：チーム全員がプロジェクト・タスクの進捗を一元管理し、変更コストの削減とチーム全体の可視性向上を実現する
**利用者**：チームメンバー全員（10名弱）
**利用環境**：PCブラウザ / Microsoft Teams埋め込み

---

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

---

## 分割後の使い方（2026-10-23 に CLAUDE.md を目次化）

この CLAUDE.md は「目次＋常時守るルールの要約」だけを持つ。**各節の原文（設計の詳細・経緯・実装報告）は `docs/dev/sections/sNN_*.md` に1節1ファイルで移してある。** 節番号（Section 76 等）は分割前のまま変えていない。コード・テスト・docs の「CLAUDE.md Section NN」参照は、下の目次の番号から辿れる。

- **その領域を触るときは、該当する節ファイルを必ず読む。** 要約は禁止事項の入口であって、理由・例外・再発の経緯は節ファイルにしかない。
- 元の行範囲との対応は `docs/dev/sections/README.md`。分割前の全文は git の履歴（32e4cfd）にある。

## 節の目次（全93節）

| 節 | タイトル | 1行要約 | ファイル |
|---|---|---|---|
| - | 🔴 作業を始めるとき：Claude 間伝言板を最初に読む | 作業開始時に Claude 間伝言板（AID/内製アプリガバナンスPJ）を読み、自分宛ての依頼に対応する | docs/dev/sections/s00_message-board.md |
| 0 | 0. プロジェクト概要 | プロジェクト概要（CLAUDE.md に原文を残している） | docs/dev/sections/s0_overview.md |
| 1 | 1. 技術スタック | 技術スタック（CLAUDE.md に原文を残している） | docs/dev/sections/s1_tech-stack.md |
| 1.5 | 1.5. 状態管理アーキテクチャ | 状態管理アーキテクチャ（zustand・store の役割分担） | docs/dev/sections/s1_5_state-management.md |
| 1.6 | 1.6. マルチテナンシー（部署／グループ）とロール | マルチテナンシー（部署／グループ）とロール、RLS の前提 | docs/dev/sections/s1_6_multi-tenancy-roles.md |
| 2 | 2. 情報の6層構造（最重要） | 情報の6層構造（Objective→KR→TF→ToDo→Task） | docs/dev/sections/s2_six-layers.md |
| 3 | 3. データモデル（確定版） | データモデル確定版（テーブル・列・型） | docs/dev/sections/s3_data-model.md |
| 4 | 4. 削除・アーカイブ設計（確定） | 削除・アーカイブ設計（物理削除しない） | docs/dev/sections/s4_delete-archive.md |
| 5 | 5. 同時編集の競合制御（確定） | 同時編集の競合制御（updated_at による競合検知） | docs/dev/sections/s5_concurrency.md |
| 6 | 6. AI連携設計（確定） | AI連携設計（6-1 絶対的な禁止事項・APIキー管理・コメントのサニタイズ等。AI を触るときは必読） | docs/dev/sections/s6_ai-integration.md |
| 7 | 7. 変更履歴の設計 | 変更履歴の設計 | docs/dev/sections/s7_change-history.md |
| 8 | 8. 画面一覧と設計済みの画面 | 画面一覧と設計済みの画面 | docs/dev/sections/s8_screens.md |
| 9 | 9. 未解決の設計論点 | 未解決の設計論点 | docs/dev/sections/s9_open-issues.md |
| 10 | 10. 開発時の注意事項 | 開発時の注意事項（型・コメント・RLS・物理削除禁止・AI は Hook 経由） | docs/dev/sections/s10_dev-notes.md |
| 11 | 11. このドキュメントの更新ルール | ドキュメント更新ルール・バージョンを上げる4点セット | docs/dev/sections/s11_doc-update-rules.md |
| 12 | 12. 関連設計書ファイル一覧 | 関連設計書ファイル一覧 | docs/dev/sections/s12_related-docs.md |
| 13 | 13. ファイル構成（実装時の配置先） | ファイル構成（実装時の配置先） | docs/dev/sections/s13_file-structure.md |
| 14 | 14. リファクタリング管理 | リファクタリング管理（巡回の運用） | docs/dev/sections/s14_refactoring.md |
| 14.5 | 14.5. ツアー（オンボーディング）改修の必読ルール | ツアー改修の必読ルール：tour-guidelines.md を先に読む | docs/dev/sections/s14_5_tour-rules.md |
| 14.6 | 14.6. マイページ用ウィジェット改修の必読ルール | マイページ用ウィジェット改修の必読ルール：widget-authoring.md を先に読む | docs/dev/sections/s14_6_mypage-widget-rules.md |
| 15 | 15. グランドルール：ユーザー向けエラー表示 | ユーザー向けエラー表示は formatErrorForUser を通す | docs/dev/sections/s15_error-display.md |
| 16 | 16. グランドルール：AI 使用量の計測 | AI使用量の計測：AI 呼び出しは invokeAI 経由 | docs/dev/sections/s16_ai-usage-metering.md |
| 17 | 17. グランドルール：AIと実UIの乖離防止 | AIと実UIの乖離防止：uiGuide.ts を正本にする | docs/dev/sections/s17_ai-ui-parity.md |
| 18 | 18. グランドルール：AI Edge Function のセキュリティ最小セット | AI Edge Function のセキュリティ最小セット（CORS・レート制限） | docs/dev/sections/s18_ai-edge-security.md |
| 19 | 19. グランドルール：ダウンロード量の最小化 | ダウンロード量の最小化：重い機能は lazy 分割＋確認ダイアログ | docs/dev/sections/s19_download-volume.md |
| 20 | 20. グランドルール：全画面ラボ系ビューは position:fixed を使わずメインエリア内に収める | ラボ系ビューは position:fixed を使わずメインエリア内に収める | docs/dev/sections/s20_no-position-fixed.md |
| 21 | 21. グランドルール：中央寄せモーダルは必ず画面内に収まる高さ上限を持つ | 中央寄せモーダルは画面内に収まる高さ上限を持つ（modalStyles） | docs/dev/sections/s21_modal-height.md |
| 22 | 22. グランドルール：マイグレーション追加時は検査項目も1行足す | マイグレーション追加時は schemaChecks.ts に検査項目を1行足す | docs/dev/sections/s22_migration-schema-check.md |
| 23 | 23. ゲスト（サンプル閲覧）モードの設計 | ゲスト（サンプル閲覧）モード：Supabase に一切接続しない設計 | docs/dev/sections/s23_guest-mode.md |
| 24 | 24. 個人OKR層（OKRモード再設計 Phase 1・Step A=v3.36／Step B=v3.37／Step C=v3.38／Step D=v3.39／Step E=v3.40） | 個人OKR層（OKRモード再設計 Phase 1・Step A〜E） | docs/dev/sections/s24_personal-okr.md |
| 25 | 25. プロジェクト招待（部署外メンバーの受け入れ）Phase 1〜3 | プロジェクト招待（部署外メンバーの受け入れ）Phase 1〜3 | docs/dev/sections/s25_project-invite.md |
| 26 | 26. AI呼び出しの非2xxエラーの原因が捨てられていたバグの修正 | AI呼び出しの非2xxエラーの原因が捨てられていたバグの修正 | docs/dev/sections/s26_ai-non2xx-error.md |
| 27 | 27. PDF添付でEdge Functionが落ちる問題の修正・PDFのクライアント側テキスト抽出 | PDF添付でEdge Functionが落ちる問題の修正 | docs/dev/sections/s27_pdf-attach.md |
| 28 | 28. 個人OKR取込のAI呼び出しを2回に分割（実行時間起因の546再発対策・v3.46・2026-08-10） | 個人OKR取込のAI呼び出しを2回に分割（546再発対策） | docs/dev/sections/s28_okr-import-split.md |
| 29 | 29. 利用者向けバージョン履歴 | 利用者向けバージョン履歴（リリースノート） | docs/dev/sections/s29_release-history.md |
| 30 | 30. サイドバーの境界をドラッグで幅変更 | サイドバーの境界をドラッグで幅変更 | docs/dev/sections/s30_sidebar-resize.md |
| 31 | 31. グランドルール：ビューヘッダー（左タイトル＋右ツールバー）は `flexWrap` と `flexShrink` で守る | ビューヘッダーは flexWrap と flexShrink で守る（タイトルを flex:1 にしない） | docs/dev/sections/s31_view-header-flex.md |
| 32 | 32. サイドバー下部「その他」（ガイド／設定／招待コードを入力）の折りたたみ | サイドバー下部「その他」の折りたたみ | docs/dev/sections/s32_sidebar-misc.md |
| 33 | 33. プロジェクト招待まわりの権限境界を締める＋招待受諾者からPJ参加者全員が見えるように | プロジェクト招待まわりの権限境界を締める | docs/dev/sections/s33_invite-permissions.md |
| 34 | 34. 招待された人の体験3件の修正 | 招待された人の体験3件の修正 | docs/dev/sections/s34_invitee-experience.md |
| 35 | 35. AI提案の反映・Undoまわりの不具合5件の修正 | AI提案の反映・Undoまわりの不具合5件の修正 | docs/dev/sections/s35_ai-suggest-undo.md |
| 36 | 36. 招待受諾者の取りこぼし3箇所の修正＋再発防止の機械チェック3種 | 招待受諾者の取りこぼし3箇所の修正＋機械チェック3種 | docs/dev/sections/s36_invitee-gaps.md |
| 37 | 37. PDF取込をクライアント側テキスト抽出に統一 | PDF取込をクライアント側テキスト抽出に統一 | docs/dev/sections/s37_pdf-client-extract.md |
| 38 | 38. スキーマ検査：関数の「本文差し替え型」＋列の「型のずれ」の検知 | スキーマ検査：関数の本文差し替え型＋列の型のずれの検知 | docs/dev/sections/s38_schema-check-fn-body.md |
| 39 | 39. グランドルール：RLSポリシー内でSECURITY DEFINER関数を呼ぶときは`(SELECT ...)`で包む | RLSポリシー内の SECURITY DEFINER 関数は (SELECT ...) で包む | docs/dev/sections/s39_rls-security-definer.md |
| 40 | 40. `visible_project_member_ids()` の中身を軽くする | visible_project_member_ids() の中身を軽くする | docs/dev/sections/s40_visible-member-ids.md |
| 41 | 41. サイドバーの「表示部署」をリロード後も維持する | サイドバーの「表示部署」をリロード後も維持する | docs/dev/sections/s41_display-group-persist.md |
| 42 | 42. グランドルール：トリガー追従のポップオーバー（ドロップダウン・候補パネル）は画面外へのはみ出しをクランプする | トリガー追従ポップオーバーは画面外へのはみ出しをクランプする | docs/dev/sections/s42_popover-clamp.md |
| 43 | 43. タスク追加「＋」FABの共通化 | タスク追加「＋」FABの共通化＋右下スタックの一元管理 | docs/dev/sections/s43_fab-bottom-stack.md |
| 44 | 44. グランドルール：タスク編集面（モーダル／サイドパネル）は明示保存にする | タスク編集面は明示保存にする | docs/dev/sections/s44_explicit-save.md |
| 45 | 45. `TaskSidePanel`：タスク切替時の保存失敗で編集内容が消える不具合の修正 | TaskSidePanel：タスク切替時の保存失敗で編集内容が消える不具合の修正 | docs/dev/sections/s45_sidepanel-save-fail.md |
| 46 | 46. グランドルール：明示保存の画面は、自分がアンマウントされうる経路すべてに対して未保存の警告を持つ | 明示保存の画面はアンマウント経路すべてに未保存警告を持つ | docs/dev/sections/s46_unsaved-warning.md |
| 47 | 47. `guardedNavigate`の網羅化＋機械チェックの新設 | guardedNavigate の網羅化＋機械チェックの新設 | docs/dev/sections/s47_guarded-navigate.md |
| 48 | 48. クレーム「内容を変更したのに保存ボタンに🚫が出て押せない」への対応 | 「保存ボタンに🚫が出て押せない」クレームへの対応 | docs/dev/sections/s48_save-button-disabled.md |
| 49 | 49. 拡大率・フォント設定でFAB/保存ボタンがズレる問題への対応 | 拡大率・フォント設定で FAB/保存ボタンがズレる問題への対応 | docs/dev/sections/s49_zoom-fab-shift.md |
| 50 | 50. グランドルール：右下スタックの要素に固定`height`を使わない | 右下スタックの要素に固定 height を使わない | docs/dev/sections/s50_bottom-stack-height.md |
| 51 | 51. グランドルール：`document.body`へのPortal要素は`pointerEvents:"auto"`を必ず明示する／トリガー追従のポップオーバーは`useFloatingPanel`に集約する | body への Portal は pointerEvents:auto を明示／ポップオーバーは useFloatingPanel に集約 | docs/dev/sections/s51_portal-pointer-events.md |
| 52 | 52. 個人OKR「今月の計画」欄・「振り返り」欄をunsavedEditorRegistryの対象に追加＋KR/月/四半期切替のガード | 個人OKR「今月の計画」欄・「振り返り」欄を unsavedEditorRegistry の対象に追加 | docs/dev/sections/s52_okr-registry.md |
| 53 | 53. 日次バックアップ フェーズ4（失敗通知・管理画面UI。v3.107・2026-09-17） | 日次バックアップ フェーズ4（失敗通知・管理画面UI） | docs/dev/sections/s53_backup-phase4.md |
| 54 | 54. タスクの並び替えを楽にする2機能：親子選択・番号順ソート | タスクの並び替え2機能：親子選択・番号順ソート | docs/dev/sections/s54_task-reorder.md |
| - | Best practices for developing on Vercel | Vercel 開発のベストプラクティス（Vercel 提供の定型ブロック） | docs/dev/sections/sxx_vercel-best-practices.md |
| 55 | 55. PJ基本情報の編集を部署メンバー全員へ開放 | PJ基本情報の編集を部署メンバー全員へ開放 | docs/dev/sections/s55_pj-info-edit.md |
| 56 | 56. AI相談から一括リネーム・一括ステータス変更ができるようにする | AI相談から一括リネーム・一括ステータス変更 | docs/dev/sections/s56_ai-bulk-rename.md |
| 57 | 57. タスク・PJの編集履歴とUndo | タスク・PJの編集履歴と Undo | docs/dev/sections/s57_edit-history-undo.md |
| 58 | 58. 🔴 グランドルール：機能を有効にする前に「それが前提を変えないか」を確認する | 機能を有効にする前に「それが前提を変えないか」を確認する | docs/dev/sections/s58_assumption-check.md |
| 59 | 59. 🔴 グランドルール：ソース走査型の機械チェックは「コメントに書いた文字列」で無力化される | ソース走査型の機械チェックは「コメントに書いた文字列」で無力化される | docs/dev/sections/s59_scan-test-comments.md |
| 60 | 60. 表示の圧縮方針：拡大して使う利用者への対応 | 表示の圧縮方針：拡大して使う利用者への対応 | docs/dev/sections/s60_compact-display.md |
| 61 | 61. 🔴 グランドルール：一覧を丸ごと読む select は `fetchAllRows` を通す（PostgREST の1000行上限・必須・v3.116・2026-09-28） | 一覧を丸ごと読む select は fetchAllRows を通す（1000行上限） | docs/dev/sections/s61_fetch-all-rows.md |
| 62 | 62. AI生成中の進捗表示：本当の進捗は取れない前提で「止まらない」演出にする | AI生成中の進捗表示：「止まらない」演出にする | docs/dev/sections/s62_ai-progress.md |
| 63 | 63. 再読み込みが必要な更新だけを利用者に促す | 再読み込みが必要な更新だけを利用者に促す | docs/dev/sections/s63_reload-notice.md |
| 64 | 64. 個人OKRの週の目標状態：四半期初日にサンプルデータの評価が全て未評価になるテスト失敗の修正 | 個人OKRの週の目標状態：四半期初日のテスト失敗の修正 | docs/dev/sections/s64_personal-okr-week-test.md |
| 65 | 65. 設定画面（トップのカード一覧＋詳細ページ。v3.127で新設・v3.155で作り直し） | 設定画面（カード一覧＋詳細ページ） | docs/dev/sections/s65_settings-page.md |
| 66 | 66. 期限リマインド：Windows通知（Web Push）＋アプリ内通知 | 期限リマインド：Windows通知（Web Push）＋アプリ内通知 | docs/dev/sections/s66_deadline-reminder.md |
| 67 | 67. 通知の種類のレジストリ・管理者向け通知・利用者の画面のエラー記録・右上のベル | 通知の種類のレジストリ・管理者向け通知・エラー記録・ベル | docs/dev/sections/s67_notification-registry.md |
| 68 | 68. 管理者からのお知らせ配信 | 管理者からのお知らせ配信 | docs/dev/sections/s68_admin-announcement.md |
| 69 | 69. 🔴 グランドルール：翻訳関数（useT の戻り値）を取得の effect・callback の依存に入れない | useT の戻り値を取得の effect・callback の依存に入れない | docs/dev/sections/s69_uset-deps.md |
| 70 | 70. members の書き込み権限：本人とホーム部署の管理者だけ | members の書き込み権限：本人とホーム部署の管理者だけ | docs/dev/sections/s70_members-write-perm.md |
| 71 | 71. メンバー・PJ・タスクの表示と担当者の候補を「表示部署」単位に絞る | メンバー・PJ・タスク・担当者候補を「表示部署」単位に絞る | docs/dev/sections/s71_display-group-scope.md |
| 72 | 72. ガイドの表示部品・削除のUndo・メンション確定の共通化 | ガイドの表示部品・削除のUndo・メンション確定の共通化 | docs/dev/sections/s72_guide-undo-mention.md |
| 73 | 73. AIに送るPJ・タスクの範囲：「対象PJ」と aiTarget.ts | AIに送るPJ・タスクの範囲：対象PJ と aiTarget.ts | docs/dev/sections/s73_ai-target-scope.md |
| 74 | 74. ガントの拡大縮小：スライドバー（1日あたり8〜80px）・Ctrl/Cmd＋ホイール | ガントの拡大縮小：スライドバー・Ctrl/Cmd＋ホイール | docs/dev/sections/s74_gantt-zoom.md |
| 75 | 75. AI相談に資料を添付する | AI相談に資料を添付する | docs/dev/sections/s75_ai-attachment.md |
| 76 | 76. 長く使うと重くなる問題・黙った再読み込みの対策 | 長く使うと重くなる問題・黙った再読み込みの対策（realtime・再同期） | docs/dev/sections/s76_realtime-resync.md |
| 77 | 77. リストの中でその場でタスクを追加する | リストの中でその場でタスクを追加する | docs/dev/sections/s77_inline-add.md |
| 78 | 78. PJ内の「グループ」・タスクの「成果物」欄・追加プロジェクト／タスクフォース欄の撤去 | PJ内の「グループ」・タスクの「成果物」欄・追加PJ/TF欄 | docs/dev/sections/s78_pj-group-deliverable.md |
| 79 | 79. パスワードの再設定・変更 | パスワードの再設定・変更 | docs/dev/sections/s79_password-reset.md |
| 80 | 80. ガントの左右の行が一番下でずれる | ガントの左右の行が一番下でずれる（再発） | docs/dev/sections/s80_gantt-row-gap.md |
| 81 | 81. リストの複数選択まわりの操作：Shift範囲選択・PJ移動・まとめてドラッグ・日程ずらし・グループ見出しのドラッグ | リストの複数選択まわり：Shift範囲選択・PJ移動・まとめてドラッグ・日程ずらし | docs/dev/sections/s81_list-multiselect.md |
| 82 | 82. アプリ内フィードバック 段階1 | アプリ内フィードバック 段階1 | docs/dev/sections/s82_feedback-stage1.md |
| 83 | 83. お知らせツアー（新機能の紹介）の仕組みと「アプリ内から要望を送れるようになりました」 | お知らせツアー（新機能の紹介）の仕組み | docs/dev/sections/s83_announce-tour.md |
| 84 | 84. ガイドツアー：クリックで開いたUIに吹き出しが隠れて続行不能になる不具合 | ガイドツアー：吹き出しが隠れて続行不能になる不具合 | docs/dev/sections/s84_tour-bubble-hidden.md |
| 85 | 85. キーボードショートカットの追加 | キーボードショートカットの追加 | docs/dev/sections/s85_keyboard-shortcuts.md |
| 86 | 86. 縮小表示時のフォント切替 | 縮小表示時のフォント切替 | docs/dev/sections/s86_small-font-switch.md |

---

## 常時守るルールの要約（グランドルール・必須・🔴）

以下は「見出しにグランドルール／必須／🔴 が付く節」の要約。迷ったら節ファイルの原文が正本。

### 作業開始時：Claude 間伝言板
- 作業を始めるときは、AID/内製アプリガバナンスPJ の「管理台帳_Claude間伝言板_*.md」を最初に読み、自分（Claude Code）宛ての依頼に対応すること（本文は上に原文を残してある）。
- 機密値（鍵・API キー・プロジェクト識別子・URL）とセキュリティの弱点の突き方は、伝言板にも事実シートにも書かない。開発作業を伴う依頼は山本さんに確認してから着手する。
- 詳細＝`docs/dev/sections/s00_message-board.md`（この領域を触るときは必読）

### Section 11：ドキュメント更新・バージョンを上げる4点セット
- バージョンを上げるときは ①`src/lib/version.ts` の `APP_VERSION` ②このファイル冒頭のバージョン表記 ③`docs/dev/CHANGELOG.md` ④利用者向けリリースノート の4点を必ず更新する（`version.test.ts`・`changelogVersion.test.ts`・`releaseNotes.test.ts` が同期を検査する）。
- 互換性を破壊する変更を入れるときは `MIN_CLIENT_VERSION` も引き上げる。マイグレーションを足したら `schemaChecks.ts` に検査項目を1行足す。右下に新要素を足すときは `bottomStack.ts` に載せる。
- 詳細＝`docs/dev/sections/s11_doc-update-rules.md`（リリース時は必読）

### Section 6：AI連携の絶対禁止事項
- APIキーをクライアントに露出させない。AI 呼び出しは必ず `invokeAI()`（クライアント → Edge Function `ai-consult` → Anthropic API）を経由し、直叩きしない。`invokeAI()` の `intent` は必須（`ai_usage_logs.consultation_type` に保存される）。
- 詳細＝`docs/dev/sections/s6_ai-integration.md`（AI を触るときは必読）

### Section 10：開発時の注意事項
- `any` を使わず型を定義する／設計意図コメントを書く／全テーブルに RLS を設定する／物理削除は絶対に実装しない（Section 4）／AI は `useAIConsultation` Hook 経由でのみ呼ぶ。
- 詳細＝`docs/dev/sections/s10_dev-notes.md`（この領域を触るときは必読）

### Section 14.5：ツアー（オンボーディング）改修
- ツアーを変更する前に、必ず `docs/dev/tour-guidelines.md` を読み、その基準に従うこと。明度やアニメを個別にハードコードしない。
- 詳細＝`docs/dev/sections/s14_5_tour-rules.md`（この領域を触るときは必読）

### Section 14.6：マイページ用ウィジェット改修
- ウィジェットを追加・変更する前に、必ず `docs/dev/widget-authoring.md` を読むこと。`useAppStore`/`supabase` の直接使用禁止・`WidgetContext` だけを唯一の入口とする・`configSchema` 駆動の設定フォーム、等の契約に従う。
- 詳細＝`docs/dev/sections/s14_6_mypage-widget-rules.md`（この領域を触るときは必読）

### Section 15：ユーザー向けエラー表示
- ユーザーに見せるエラーは `formatErrorForUser` を通す。`"エラーが発生しました"` のような固定文字列の直接 setError は禁止（原因究明ができなくなる）。
- `supabase.functions.invoke` が非2xxのとき `data` は必ず `null`。Edge Function の本文は `error.context`（response）から読む。
- 詳細＝`docs/dev/sections/s15_error-display.md`（この領域を触るときは必読）

### Section 16：AI 使用量の計測
- 新しい AI 機能は必ず `ai_usage_logs` に使用量が記録される経路（`invokeAI`）を通す。`supabase.functions.invoke("ai-consult", ...)` を直接呼んではいけない。
- 詳細＝`docs/dev/sections/s16_ai-usage-metering.md`（この領域を触るときは必読）

### Section 17：AIと実UIの乖離防止
- UI のボタン名・機能一覧は `uiGuide.ts` の定数を正本にする。機能追加・削除・変更時は `FEATURE_LIST_SECTION` を必ず更新する。`systemPrompt.ts` にボタン名をハードコードしない。
- 詳細＝`docs/dev/sections/s17_ai-ui-parity.md`（この領域を触るときは必読）

### Section 18：AI Edge Function のセキュリティ最小セット
- 新しい Edge Function を追加するときは、CORS ドメイン制限（ワイルドカード禁止）とレート制限の2点（①CORS ドメイン制限・②ユーザーごとのレート制限）を必ず実装する。
- 詳細＝`docs/dev/sections/s18_ai-edge-security.md`（この領域を触るときは必読）

### Section 19：ダウンロード量の最小化
- 使用者が限られる重量級機能は `React.lazy`（`lazyWithRetry(factory, name)`）で分割し、閾値超えチャンクは確認ダイアログを通す。全員が使うとは限らないデータを静的 import で束ねない。
- チャンクサイズは必ずビルド出力から実測し、コードにハードコードしない。
- 詳細＝`docs/dev/sections/s19_download-volume.md`（この領域を触るときは必読）

### Section 20：ラボ系ビューの position:fixed 禁止
- 全画面ラボ系ビューは `position:fixed` を使わず、メインエリア内（`flex:1`）に収める。サイドバーを常に見える状態に保つ（`labViewContainment.test.ts` が検査）。
- 詳細＝`docs/dev/sections/s20_no-position-fixed.md`（この領域を触るときは必読）

### Section 21：中央寄せモーダルの高さ上限
- モーダルは `modalOverlayStyle`／`modalBoxStyle`（`maxHeight:"100%"`・`margin:"auto"`）／`MODAL_BODY_STYLE`（`minHeight:0` は必須）／`MODAL_FOOTER_STYLE` を使う。保存ボタン等のフッターが画面外に出る構造を作らない。
- 詳細＝`docs/dev/sections/s21_modal-height.md`（この領域を触るときは必読）

### Section 22：マイグレーション追加時の検査項目
- マイグレーションを追加したら `src/lib/schema/schemaChecks.ts` に検査項目を1行足す（SQL側にハードコードしない）。スキーマは自動修正せず、検知して知らせるだけ。
- 詳細＝`docs/dev/sections/s22_migration-schema-check.md`（この領域を触るときは必読）

### Section 23：ゲストモード
- ゲストは Supabase に一切接続しない。これが「実部署のデータをゲストに見せない」ことの唯一の安全性の根拠であり、この前提を崩す変更を入れないこと（`client.ts` の `assertGuestBlocked()` が choke point）。
- 詳細＝`docs/dev/sections/s23_guest-mode.md`（この領域を触るときは必読）

### Section 31：ビューヘッダー
- ヘッダーの外側 div に `flexWrap:"wrap"`、タイトルの div は `flex:1` を使わず `flexShrink:0`、ツールバーのボタンは `whiteSpace:"nowrap"`＋`flexShrink:0`。「タイトルを `flex:1` にすれば」と直したくなっても戻さない。
- 詳細＝`docs/dev/sections/s31_view-header-flex.md`（この領域を触るときは必読）

### Section 39：RLS 内の SECURITY DEFINER 関数
- RLS の USING/WITH CHECK で SECURITY DEFINER 関数を呼ぶときは、必ず `(SELECT 関数呼び出し())` の形で包む（InitPlan 化）。`FOR ALL` に戻さない・`WITH CHECK` を省略しない。
- 🔴 **新しいテーブルを作ったら、同じマイグレーションに GRANT を書く**（2026-10-30以降、Supabase は public の新テーブルに Data API 権限を自動付与しない。書かないと RLS が正しくても `permission denied`）。`authenticated` と `service_role` に `select, insert, update, delete`。`anon` には付けない。`schema.sql` 末尾の `$grant_tables$` の配列にもテーブル名を足す。
- 詳細＝`docs/dev/sections/s39_rls-security-definer.md`（この領域を触るときは必読）

### Section 42：トリガー追従ポップオーバー
- ドロップダウン・候補パネル等のトリガー追従ポップオーバーは画面外へのはみ出しをクランプする。座標計算は個別にコピペせず共通ユーティリティ（Section 51 の `useFloatingPanel`）に集約する。
- 詳細＝`docs/dev/sections/s42_popover-clamp.md`（この領域を触るときは必読）

### Section 44：タスク編集面は明示保存
- モーダル／サイドパネルは明示保存。保存ボタンは常時表示、単一行 input の Enter で保存（画面は閉じない）、未保存の変更があるまま閉じる・タスクを切り替えるときは破棄確認を出す。
- 詳細＝`docs/dev/sections/s44_explicit-save.md`（この領域を触るときは必読）

### Section 45：TaskSidePanel の切替時保存失敗
- タスク切替時の保存に失敗したら切替を中止し、永続的なエラー帯で表示する。`onSwitchFailed` は必須 prop。
- 詳細＝`docs/dev/sections/s45_sidepanel-save-fail.md`（この領域を触るときは必読）

### Section 46：明示保存画面の未保存警告
- 明示保存の画面は、自分がアンマウントされうる経路すべてに対して未保存の警告を持つ。`unsavedEditorRegistry` に登録し、`confirmDiscardUnsavedEdits()` に集約する。
- 詳細＝`docs/dev/sections/s46_unsaved-warning.md`（この領域を触るときは必読）

### Section 47：guardedNavigate の網羅
- 画面遷移・アンマウントを起こす経路は `guardedNavigate` 経由にする。`guardedNavigateCoverage.test.ts` の機械チェックで網羅性を担保している。
- 詳細＝`docs/dev/sections/s47_guarded-navigate.md`（この領域を触るときは必読）

### Section 48：保存ボタン🚫クレーム
- 保存ボタンの活性判定は `computeFormDirty` で行い、全フィールドを対象にする（`computeFormDirtyFieldCoverage.test.ts`）。未変更時は「押せない禁止ボタン」ではなく「保存済み」表示にする。
- 詳細＝`docs/dev/sections/s48_save-button-disabled.md`（この領域を触るときは必読）

### Section 49：拡大率・フォント設定での右下ズレ
- 右下スタックの土台に、描画サイズの見積もり値をハードコードしない（`bottomStack.ts`）。
- 詳細＝`docs/dev/sections/s49_zoom-fab-shift.md`（この領域を触るときは必読）

### Section 50：右下スタックの固定 height 禁止
- 右下スタックの要素に固定 `height` を使わない（文字を含む要素は `minHeight`）。`devOverlapCheck.ts` があふれを検出する。
- 詳細＝`docs/dev/sections/s50_bottom-stack-height.md`（この領域を触るときは必読）

### Section 51：Portal の pointerEvents
- `createPortal(document.body)` で描画する要素は、`pointerEvents:"auto"` を必ず自分自身の style に明示する（`body { pointer-events: none }` の継承による）。
- トリガー追従の小さいポップオーバーは `useFloatingPanel` に集約し、座標計算・`maxHeight` を個別実装しない。
- 詳細＝`docs/dev/sections/s51_portal-pointer-events.md`（この領域を触るときは必読）

### Section 52：個人OKR欄の未保存ガード
- 個人OKRの「今月の計画」「振り返り」欄は `unsavedEditorRegistry` の対象。KR/月/四半期の切替には `guardedSwitch` を通す。
- 詳細＝`docs/dev/sections/s52_okr-registry.md`（この領域を触るときは必読）

### Section 58：機能を有効にする前の前提確認
- 外部サービスの設定を変えるとき、「それが今まで成り立っていた前提を壊さないか」を必ず確認する。RLS を書くときは `pg_policies` で実体を見る（`schema.sql` の記述を信じない）。JWT のクレーム等も確認してから書く。
- 詳細＝`docs/dev/sections/s58_assumption-check.md`（この領域を触るときは必読）

### Section 59：ソース走査型テストとコメント
- ソース走査型の機械チェックを新設・変更したときは、必ず「意図的に壊して赤くなること」「戻すと緑になること」を1回確認する。
- 走査型の検査が探すパターンそのものを、コメント・文字列リテラル・テストの説明文に書かない。新しい走査型テストは行頭の `//` `/*` `*` の行を除外してから照合する。
- 詳細＝`docs/dev/sections/s59_scan-test-comments.md`（この領域を触るときは必読）

### Section 61：fetchAllRows
- 一覧を丸ごと読む select は `fetchAllRows` を通す（PostgREST の1000行上限）。直書きしない（例外は `.limit()`・`.single()`・`.maybeSingle()`）。
- 終了条件を「返ってきた件数 < 要求したページサイズ」にしない（サーバの `max_rows` が小さいと打ち切られる）。`rowLimitScan.test.ts` が検査する。
- 詳細＝`docs/dev/sections/s61_fetch-all-rows.md`（この領域を触るときは必読）

### Section 69：useT の依存配列
- `useEffect`／`useLayoutEffect`／`useCallback` の依存配列に `useT()` の戻り値を入れない。文言が要るときは `const tRef = useRef(t); tRef.current = t;` として `tRef.current(...)` で読む。
- 取得を伴う effect は「開いたとき（false→true）・対象が変わったとき」だけ走らせ、取得は世代番号で古い応答を捨てる。
- 詳細＝`docs/dev/sections/s69_uset-deps.md`（この領域を触るときは必読）

---

## 10. 開発時の注意事項（要約。原文＝docs/dev/sections/s10_dev-notes.md）

- 型を定義する（`any` 禁止）／設計意図コメントを書く／全テーブルに RLS を設定する／物理削除は実装しない（Section 4）／AI は `useAIConsultation` Hook 経由でのみ呼ぶ。
- 実装後に必ず `npx tsc --noEmit` と `npx vitest run` を通す（走査系の2本は5秒タイムアウトに掛かることがある）。

## 11. このドキュメントの更新ルール（2026-10-23 に新運用へ書き直し。元の原文＝docs/dev/sections/s11_doc-update-rules.md）

- **新しい節は `docs/dev/sections/sNN_<slug>.md` として追加する。** CLAUDE.md には書かない。CLAUDE.md の「節の目次」に1行足し、**グランドルール（必須・🔴）なら「常時守るルールの要約」にも1項目足す。**
- **版ごとの記録（v3.xxx の節）は、該当する節ファイルに追記する。** 新しい領域なら新しい節ファイルを作る。
- 既存の節の内容を変えたら、その節ファイルを直す。要約と食い違う場合は要約を直す。節番号は変えない・詰めない。
- バージョン履歴は CLAUDE.md に書かず `docs/dev/CHANGELOG.md` の末尾に追記する。
- **🔴 バージョンを上げるときは次の4点セットを必ず更新すること**（2026-08-12・v3.63で追加。Section 29参照）：①`src/lib/version.ts` の `APP_VERSION` ②このファイル冒頭のバージョン表記 ③`docs/dev/CHANGELOG.md`（開発者向け・技術的な記述のまま末尾に追記） ④`src/lib/releaseNotes.ts`（利用者向け・「何ができるようになったか」の粒度に書き直したものを配列の先頭に追記）。①②の一致は`version.test.ts`、①④の一致（`RELEASE_NOTES[0].version`）は`src/lib/__tests__/releaseNotes.test.ts`が機械的に検査する。③と④は読み手が違う（開発者 vs 利用者）ため統合しない別ファイルのまま運用する
- **リリース時、DBスキーマに変更を伴うマイグレーションを追加した場合は `src/lib/schema/schemaChecks.ts` に検査項目を1行足すこと**（2026-08-06・v3.26で追加。Section 22参照）。マイグレSQLを書いて終わりにせず、この配列への追記までがワンセット。
- **🔴 画面右下（PC）／画面下端（モバイル）に新しい要素を追加するときは、必ず `src/lib/layout/bottomStack.ts` のスタックに載せること**（2026-08-21・v3.91で追加。Section 43参照）。bottom値を手書きしない。
- **🔴 互換性を破壊する変更（DBの列削除・改名・RLS変更・Edge Functionの入出力の非互換・localStorageの形式変更等）を入れるときは、`src/lib/version.ts` の `MIN_CLIENT_VERSION` もそのリリースの版まで引き上げること**（2026-10-01・v3.125で追加。Section 63参照）。4点セットの更新と同時に行う。機能追加・見た目の変更だけでは上げない。
- **CLAUDE.md 冒頭1行目の `v数字.数字` は `src/lib/__tests__/version.test.ts` が読む。** 形式（`# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v3.xxx`）を変えない。

## 53. 日次バックアップ フェーズ4（失敗通知・管理画面UI。v3.107・2026-09-17）

**正本は [docs/dev/backup-design.md](docs/dev/backup-design.md)。** フェーズ1〜3（DB層の3表・3関数／Edge Function `backup-daily`／pg_cron登録）は完了済みで本番稼働中だったが、「失敗しても誰も気づかない」状態のままだった。フェーズ4はこれを解消する。

### 作ったもの

1. **管理画面「バックアップ」タブ**（`src/components/admin/BackupSection.tsx`。「アプリ設定」カテゴリ・super-admin限定・`LoadingTipsSection.tsx`と同じガード）。直近の実行状況（`backup_runs`最新10件）・現在有効な世代一覧（`backup_objects`の`deleted_at IS NULL`）を表示し、各世代に「ダウンロード」ボタンを付けた（④のEdge Functionから署名URLを取得して`window.open`）。「今すぐ実行」ボタンで手動実行できる（二重押しはローカルstateで防止）。
2. **管理画面バナー**（`src/components/common/BackupHealthBanner.tsx`。`App.tsx`に`SchemaHealthBanner`と並べてマウント。同じ非ブロッキング取得・管理者限定・「閉じても次回読み込みでまた出す」流儀）。判定ロジックは`src/lib/backup/backupHealth.ts`の`resolveBackupHealth()`（純粋関数）に切り出した：
   - 🔴 赤：`backup_runs`の最新successが24時間以上前（**一度も成功していない場合も赤にした**。設計書に明記は無いが、一次バックアップが一度も成功していない状態を放置しないための安全側の判断）
   - 🟡 黄：`backup_exports`の最新successが3日以上前。**`backup_exports`が1件も無ければ何も出さない**（フェーズ5未実施のため。ここで警告すると常時点灯して無視される）
   - 両方の条件を満たす場合は赤を優先（一次バックアップの停止の方が緊急度が高い）
   - テーブル未適用・取得失敗時は黙って消えず「バックアップの状態を確認できません」を表示する（`SchemaHealthBanner`と同じ方針）
3. **手動実行**：`supabase.functions.invoke("backup-daily", { body: {} })`を呼ぶだけで、supabase-jsが現在ログインセッションのアクセストークンを自動的に`Authorization: Bearer <token>`として付与する（`node_modules/@supabase/supabase-js`の`fetchWithAuth`実装で確認済み。ヘッダーを明示的に組み立てるコードは書いていない）。`backup-daily`内部の自前検証（`members.is_super_admin`）が唯一のガード（`backup-daily`は`verify_jwt: false`でデプロイされているためSupabase側のJWT検証は働かない。docs/dev/backup-design.md §3.2参照）。
4. **新規Edge Function `supabase/functions/backup-export-urls/index.ts`**：super-adminのJWT（または、フェーズ5の二次保管スクリプト用に`x-cron-secret`＝`BACKUP_EXPORT_SECRET`。受け口のみ作り、今は未使用）を検証し、指定パスの署名URL（5分）と`backup_objects`のsha256/bytesを返すだけ。認証・エラー処理・`json()`ヘルパー・`toStorageKey()`は`backup-daily/index.ts`をそのまま踏襲した。
5. **週次サマリ**（`backup-daily/index.ts`に追記。新しいcronは増やしていない）：実行の最後で「JSTで月曜なら」（`isJstMonday()`。`jstDateStr()`と同じ「+9時間してからUTC値として読む」変換を再利用）だけ、直近7日の`backup_runs`を集計（成功回数・容量・孤児件数の合計・削除件数の合計）し、`backup_exports`の最新successを二次保管の最終取得日として（空／未成功なら「未設定」）、既存の`notifyTeams()`でTeamsへ送る（v3.136 から super_admin へのアプリ内通知＋Windows通知。Section 67）。週次サマリの取得・送信失敗は`try/catch`で囲み、日次バックアップ本体のレスポンス・statusには一切影響させない。**既存の[1]〜[6]の処理フローは1行も変更していない（追記のみ）。**

### `backup-daily`のCORS対応（2026-09-17・統括の承認を得て追加実装）

フェーズ4の初回実装時点では、`backup-daily/index.ts`は元々CORSヘッダー・OPTIONSプリフライト応答を一切持たず（pg_cronからのサーバー間呼び出しが主用途で、ブラウザからの手動実行は今回のフェーズ4で初めて追加されたため）、管理画面の「今すぐ実行」ボタンがブラウザから直接呼ぶと失敗する懸念をリスクとして報告していた。統括の承認を得て、`ai-consult/index.ts`と同じ`ALLOWED_ORIGINS`方式のCORSを`backup-daily/index.ts`にも追加した。

- **追加した内容**：`ALLOWED_ORIGINS`（環境変数。本番設定済み）・`getCorsHeaders(origin)`をそのまま踏襲して追加。`Deno.serve`の先頭で`corsHeaders`を計算し、`OPTIONS`には`204`＋`corsHeaders`で応答する。既存の`json()`ヘルパーは`corsHeaders`を第3引数として受け取る形に変更し、ハンドラ内の全8箇所の呼び出し（`server misconfigured`／`Unauthorized`×4／`backup_begin failed`／最終成功レスポンス）に`corsHeaders`を渡すよう更新した。
- **🔴🔴 pg_cronへの影響が無いことの確認**：`getCorsHeaders(null)`（Originヘッダーが無い＝pg_cron/pg_netからの呼び出し）は例外を投げず、`ALLOWED_ORIGINS`の先頭要素（無ければ`"*"`）にフォールバックするだけで、レスポンスヘッダーに何を載せるかが変わるのみ。CORSヘッダーはブラウザだけが検証するレスポンスのメタ情報であり、`pg_net`（サーバー間呼び出し）はこれを一切見ないため、Originの有無に関わらず認証・スナップショット取得・保存等の本体処理は今までどおり実行される。また`pg_net`は常に直接POSTするため`if (req.method === "OPTIONS")`分岐にも入らない。既存の`[1]〜[6]`の処理フロー・認証ロジック・レスポンスのbody・statusは一切変更していない（`json()`へ引数を1つ追加してヘッダーに反映しただけ）。
- **`Access-Control-Allow-Headers`にai-consultの一覧＋`x-cron-secret`を追加**：この関数自身が`x-cron-secret`ヘッダーで認証を受け付けるため（`backup-export-urls/index.ts`と同じ一覧）。
- **実機確認はしていない**（デプロイ・実行は行っていない）。`npx tsc --noEmit`・`npx vitest run`（168ファイル・1987件）は通過済みだが、Edge Function（Deno）はtscの対象外（`tsconfig.json`は`src`のみinclude）であり、Deno側の型チェックは未実施。デプロイ時は`supabase functions deploy backup-daily --no-verify-jwt`の再デプロイが必要（週次サマリの追記時と同様）。

### 未着手（フェーズ5・スコープ外）

二次保管スクリプト（`scripts/backup_export.ps1`）・`.backup-destination-marker`・タスクスケジューラ・復元訓練は今回作っていない。共有ライブラリの場所と権限が未定のため（docs/dev/backup-design.md §11 未決事項2b）。

---

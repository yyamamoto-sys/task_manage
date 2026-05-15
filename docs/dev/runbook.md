# 障害対応 Runbook（plan-app）

よくある障害パターンと対処手順。**慌てたときの最初の参照先**。

## 1. 緊急時の判断フロー

```
障害発生
   │
   ├─ アプリが完全に開かない？  → §2 全体障害
   │
   ├─ 一部の機能だけ動かない？  → §3 機能別障害
   │
   ├─ AI機能が動かない？        → §4 AI障害
   │
   └─ データが壊れた／消えた？  → §5 データ事故（緊急）
```

## 2. 全体障害

### 症状：URL を開いても真っ白／"設定エラー" 表示

**確認順序：**

1. **環境変数チェック**（Vercel ダッシュボード → Project → Settings → Environment Variables）
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が設定されているか
   - 値が正しいプロジェクトのものか
2. **Vercel デプロイ状態**（Deployments タブ）
   - 最新デプロイが成功しているか
   - 失敗していたら **Redeploy** または前バージョンに **Rollback**
3. **ブラウザキャッシュ**
   - シークレットウィンドウで開いて変わるか
   - 変われば旧チャンク参照。ブラウザリロード（Ctrl+Shift+R）

### 症状：`Failed to fetch dynamically imported module`

**原因：** Vercel 再デプロイ直後に古いチャンクハッシュを参照している。

**対応：**
- `lazyWithRetry` が自動リトライするので大抵自動回復
- リロード（Ctrl+R）で確実に解消

## 3. 機能別障害

### `PGRST205` Could not find the table 'public.XXXX' in the schema cache

**原因：** テーブルが存在しないか、PostgREST のスキーマキャッシュが古い。

**対応：**

1. **テーブル存在確認**
   ```sql
   select table_schema, table_name
   from information_schema.tables
   where table_name = 'XXXX';
   ```
2. **存在しない場合：** `supabase/migrations/` から該当 migration を見つけて SQL Editor で実行
3. **存在する場合：** スキーマキャッシュ再読み込み
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
4. それでも解消しなければ Supabase ダッシュボード → Settings → API → Reload Schema

### `42501` permission denied for table XXXX

**原因：** Data API ロールに対する GRANT が不足。

**対応：**
- エラー本文に**修正用 SQL がそのまま返される**ので、それを SQL Editor で実行
- 標準的には：
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.XXXX TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.XXXX TO service_role;
  ```

### `column "XXX" does not exist`

**原因：** アプリ側コードと DB スキーマが乖離。新しい migration が反映されていない、または逆。

**対応：**
1. `git log --oneline -- supabase/migrations/` で最新 migration を確認
2. SQL Editor で migration が流れているか確認
3. 抜けていれば流す

### 楽観ロック衝突

**症状：** 「他の人が更新しました。リロードしてください」のメッセージ。

**対応：**
- アプリの想定挙動。ユーザーにリロードしてもらう
- 頻発するなら、同じレコードを複数人が同時編集している可能性。運用ルールを確認

## 4. AI 障害

### 症状：「AI分析」「AI初稿生成」などが反応しない／タイムアウト

**確認順序：**

1. **Anthropic Status** をブラウザで確認（status.anthropic.com）
2. **API キー有効性**
   - Supabase Edge Function → `ai-consult` → Environment Variables の `ANTHROPIC_API_KEY` を確認
   - キーが期限切れ・無効化されていないか Anthropic コンソールで確認
3. **使用量・レート制限**
   - 設定 → AI使用量パネルで急増がないか
   - Anthropic コンソールで billing/rate limit を確認
4. **Edge Function ログ**
   - Supabase ダッシュボード → Edge Functions → `ai-consult` → Logs
   - 直近の失敗エラーを見る

### 症状：AI 応答の質が急に落ちた

**確認順序：**

1. **モデルバージョン**：`lib/ai/invokeAI.ts` のモデル指定（`claude-sonnet-4-6` 等）が最新か
2. **プロンプト変更履歴**：`git log --oneline -- src/lib/ai/` で直近の変更を確認
3. **コンテキスト過多**：渡しているデータが膨らみすぎていないか確認（max_tokens 超過の前段で落ちている可能性）

### 症状：AI 抽出した内容が変な振り分けに

**多くは入力データの質が原因：**
- 議事メモが短すぎる
- KR の文言が抽象的すぎてマッチしづらい
- 1回の入力で複数会議が混在

**対応：** 入力を分割するか、文言を明確化。プロンプト調整は最終手段。

## 5. データ事故（緊急）

### 症状：レコードが大量に消えた／壊れた

**最初の3分：**

1. **更新を止める**
   - Vercel デプロイをロック（Production Branch Protection を一時的に有効に）
   - 関係者に「アプリを使わないで」と即時連絡
2. **Supabase バックアップ確認**（Settings → Database → Backups）
   - 直前のバックアップ時刻を確認
3. **影響範囲調査**
   ```sql
   select count(*) from public.XXXX where is_deleted = true;
   select count(*) from public.XXXX where is_deleted = false;
   ```

**復旧手順：**

1. **論理削除（is_deleted）の場合：** UPDATE で戻せる
   ```sql
   update public.XXXX set is_deleted = false
   where /* 条件 */;
   ```
2. **物理削除・データ破損の場合：** バックアップから Point-in-Time Restore
   - Supabase Pro 以上のプランで可能
   - 失われる範囲を明示してから判断（最終バックアップ以降の更新は失われる）
3. **関係者に通知**：何が起こり、何を復旧し、何が失われたか

### 個人情報・機密漏洩疑い

1. **即座に藤本さんに連絡**
2. **Anthropic API キーをローテーション**
3. **Supabase の RLS ポリシーを再確認**（`anon` 経由で漏れていないか）
4. **アクセスログ調査**：Supabase の Logs から異常アクセスを探す

## 6. 性能劣化

### 症状：ダッシュボードが重い

**順次確認：**

1. ブラウザ DevTools の Performance タブで何が遅いか
2. `appStore` のサイズ：タスク数が10,000 を超えているような場合は虚弱
3. PJフィルタや個別selectorを使わずに全state購読しているコンポーネントがないか
4. Supabase 側のクエリプラン：`explain analyze` で確認

### 症状：AI 呼び出しがいつも遅い

- 添付ファイル（PDF / 大量 VTT）のサイズを確認
- `max_tokens` を必要分まで下げる
- 不要なコンテキスト（過去履歴）を渡していないか

## 7. デプロイ周り

### 症状：`tsc` エラーで build が落ちる

**対応：**
- ローカルで `npm run build` を再現
- 型エラー箇所を修正
- 急いでいるなら一時的に `// @ts-expect-error` で凌いで PR コメントに TODO を残す（推奨されない）

### 症状：Vercel デプロイは成功するのに 古いまま表示される

- ブラウザキャッシュ・CDN キャッシュの可能性
- シークレットウィンドウで確認
- Vercel ダッシュボードで Deployment ID を確認し、その URL を直接開いて確認

## 8. 連絡先

| 事象 | 連絡先 |
|---|---|
| Vercel 障害 | Vercel サポート + status.vercel.com |
| Supabase 障害 | Supabase サポート + status.supabase.com |
| Anthropic 障害 | status.anthropic.com |
| データ事故 | 藤本さん（即時）+ Supabase サポート |
| アプリの致命的バグ | 後任者（即時）+ 影響範囲を藤本さんに共有 |

## 9. 関連

- [handover-checklist.md](./handover-checklist.md)
- [architecture.md](./architecture.md)
- [data-model.md](./data-model.md)
- [supabase-migrations.md](./supabase-migrations.md)

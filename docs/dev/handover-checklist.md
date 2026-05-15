# 引継ぎチェックリスト（plan-app）

plan-app の所有者を後任に引き継ぐ際に、抜け落ちなく対応するためのチェックリストです。
**山本さんが連絡不能になった場合の最低限**としても機能するよう作っています。

## 0. 引継ぎ前の準備

- [ ] 後任者を決める（最低1名、できれば2名で冗長化）
- [ ] 後任者に [全体像（5分）](../guides/00_overview.md) と [architecture.md](./architecture.md) を読んでもらう
- [ ] 引継ぎミーティングを設定（90分目安）

---

## 1. アカウントとアクセス権の譲渡

### GitHub
- [ ] リポジトリ：`yyamamoto-sys/task_manage`
- [ ] 後任者を **Owner / Admin** で追加（Settings → Collaborators）
- [ ] 必要なら organization 移管も検討

### Vercel
- [ ] プロジェクト：plan-app（自動デプロイ先）
- [ ] 後任者を **Owner** で追加（Team Settings → Members）
- [ ] 環境変数の閲覧権限を確認

### Supabase
- [ ] プロジェクト：plan-app
- [ ] 後任者を **Owner** で追加（Organization Settings → Members）
- [ ] DB バックアップ手順の説明（後述）

### Anthropic API（Claude）
- [ ] 現在のキー保管場所を共有（後任者にロック付き保管）
- [ ] **キーローテーション**の方針：
  - 引継ぎ後30日以内に**現在のキーを無効化**
  - 後任者が新規キーを発行し、Supabase Edge Function の `ANTHROPIC_API_KEY` を更新
  - 「いつ・誰が・どこで」キーを保管しているかを記録

### ドメイン / DNS（該当する場合）
- [ ] 独自ドメインを使っているか確認
- [ ] DNSレジストラ・ホスティング情報の譲渡

---

## 2. 環境変数とシークレット

### Vercel（フロントエンド）
- [ ] `VITE_SUPABASE_URL` — Supabase プロジェクト URL（公開しても問題ないが、Supabaseキーとセット）
- [ ] `VITE_SUPABASE_ANON_KEY` — Supabase anon キー（フロントエンドに渡る）

### Supabase Edge Function（`ai-consult`）
- [ ] `ANTHROPIC_API_KEY` — Anthropic API キー（**絶対に公開しない**）
- [ ] その他、追加した環境変数があれば

### .env / .env.local（ローカル開発用）
- [ ] 後任者にローカル開発用の `.env` テンプレートを共有
- [ ] `.gitignore` でコミットされていないことを確認

---

## 3. Supabase DB の継続運用

### バックアップ
- [ ] Supabase の自動バックアップ設定を確認（Settings → Database → Backups）
- [ ] 手動エクスポートの手順を引継ぎ：
  - SQL Editor から `pg_dump` 出力相当を取得する方法
  - Supabase ダッシュボードの「Database → Backups」からのリストア手順

### マイグレーション運用
- [ ] [supabase-migrations.md](./supabase-migrations.md) を読んでもらう
- [ ] 既存テーブルと grant の状況：[data-model.md](./data-model.md) を参照
- [ ] **2026/10/30 以降**は新規テーブル作成時に明示 GRANT が必要（migration テンプレ参照）

### スキーマ更新フロー
- [ ] `supabase/migrations/YYYYMMDD<n>_<slug>.sql` を作成
- [ ] PR レビュー（構造変更のみ厳しめ）
- [ ] Supabase SQL Editor で実行
- [ ] アプリ側コードを反映
- [ ] git push → Vercel 自動デプロイ

---

## 4. 既知の課題・技術的負債

### Phase 2 タスク（未対応）
- [ ] RLS強化：`anon` の全権限を REVOKE、KR代表ロール別ポリシー
- [ ] A11y Phase 2：オーバーレイ背景の `jsx-a11y/click-events-have-key-events` 違反
- [ ] Tag-2/3 機能の実装

### 既知の障害パターン
- [ ] `PGRST205`：テーブル未認識 → スキーマキャッシュ再読み込み（`NOTIFY pgrst, 'reload schema';`）
- [ ] `42501`：DB権限不足 → エラー本文の GRANT 文を実行
- [ ] Vercel デプロイ直後の `dynamic import failure` → `lazyWithRetry` で自動リトライ済。それでも出ればブラウザリロード
- [ ] `update_updated_at` 関数が Supabase に手動で作られている → migration ファイルに無い。新環境構築時は手動作成が必要

---

## 5. ドキュメントの所在

| 種別 | 場所 |
|---|---|
| **利用者向けガイド** | `docs/guides/`（GitHub＋アプリ内「📖 ガイド」モード） |
| **開発者ドキュメント** | `docs/dev/` |
| **設計ドキュメント** | `docs/okr-cycle-design.md` ほか docs/ 直下 |
| **意思決定ログ** | git commit メッセージ＋CLAUDE.md 更新ログ |
| **チーム外向け説明** | このリポジトリの README.md（あれば） |

---

## 6. 関係者リスト

- [ ] 業務オーナー：（Phase 1〜2 のパイロット利用者を後任者と共有）
- [ ] EGG 全体統括：藤本 阿可理さん
- [ ] DX 推進：山本 勇気さん（引継ぎ元）
- [ ] 伴走サポート：吉田氏・久野氏（ストラテジーデザイン）
- [ ] 開発：Claude Code（伴走AI）

---

## 7. 引継ぎ後30日アクション（後任者向け）

最初の1ヶ月で押さえてほしいこと：

### 1週目：オンボーディング
- [ ] 全ガイド（`docs/guides/`）を読む
- [ ] [architecture.md](./architecture.md) と [data-model.md](./data-model.md) を読む
- [ ] ローカル開発環境を立ち上げ（`npm install && npm run dev`）
- [ ] Supabase ダッシュボードでテーブル一覧と認証設定を確認
- [ ] Vercel ダッシュボードでデプロイログを見る

### 2週目：実機運用
- [ ] パイロットメンバーの会議に1回参加し、実運用を観察
- [ ] 自分でも1KR代表として①〜③を回してみる
- [ ] フィードバックを受けて、ガイドの違和感を修正してみる（小さくてOK）

### 3週目：技術理解
- [ ] [supabase-migrations.md](./supabase-migrations.md) の手順で、テスト用のテーブルを追加→削除してみる
- [ ] Edge Function `ai-consult` のログを Supabase で確認
- [ ] Anthropic API キーをローテーション（30日以内に必須）

### 4週目：定着
- [ ] [runbook.md](./runbook.md) の障害パターンを実演して試す
- [ ] 月次レビュー：AI使用量・古いガイド（180日経過）の棚卸し
- [ ] 引継ぎ完了の宣言（旧オーナー権限を Owner から Member に降格 or 撤去）

---

## 8. 緊急連絡先と承認権

| 事象 | 連絡先 |
|---|---|
| Vercel 障害・大規模アウテージ | Vercel サポート（Pro プラン以上なら） |
| Supabase 障害 | Supabase サポート（Pro プラン以上なら） |
| Anthropic API 不調 | Anthropic Status ページ確認 → 必要ならサポート |
| アプリのバグで業務が止まる | 後任者（即時）／藤本さん（影響範囲共有） |
| データ消失・漏洩疑い | 藤本さん（即時）＋ Supabase サポート |

---

## 9. 引継ぎ完了の判定

以下が全部 ✅ になったら引継ぎ完了：

- [ ] 後任者が単独で1サイクル（①〜③）を回せる
- [ ] 後任者が単独で migration を1本流せる
- [ ] 後任者が AI使用量モニタを確認できる
- [ ] 後任者が新規メンバー登録できる
- [ ] 旧オーナー（山本さん）の権限が降格 or 撤去された
- [ ] 引継ぎ後30日が経過し、致命的トラブルが発生していない

---

## 関連

- [architecture.md](./architecture.md)
- [data-model.md](./data-model.md)
- [supabase-migrations.md](./supabase-migrations.md)
- [runbook.md](./runbook.md)

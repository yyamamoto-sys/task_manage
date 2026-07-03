# 引継ぎチェックリスト（plan-app）

plan-app の所有者を後任に引き継ぐ際に、抜け落ちなく対応するためのチェックリストです。
**山本さんが連絡不能になった場合の最低限**としても機能するよう作っています。

## 0. 引継ぎ前の準備

- [ ] 後任者を決める（最低1名、できれば2名で冗長化）
- [ ] 後任者に [全体像（5分）](../guides/00_overview.md) と [architecture.md](./architecture.md) を読んでもらう
- [ ] 後任者にCLAUDE.md **Section 1.6（マルチテナンシー・部署／グループ・ロール）** を読んでもらう。全社展開の要になる仕組みなので必読
- [ ] 引継ぎミーティングを設定（90分目安）

> ⚠️ **このチェックリストは2026-05-15版がベースです。** その後（2026-06-26〜07-02）に本番導入された
> マルチテナンシー（部署／グループ・全社スーパー管理者）はCLAUDE.md Section 1.6に追記済みですが、
> このチェックリスト自体は2026-07-03に部分更新したのみです。他にも抜け漏れがないか、
> 引継ぎ直前に必ず `git log` と CLAUDE.md の更新履歴（v2.20時点）を照合してください。

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

> 🔑 **鍵の実体はどこにあるか（このファイルには実際のキー文字列は書きません）**
> 現状、実際のキー値は下記の**各サービスのダッシュボード（環境変数設定画面）にしか存在しません**。
> パスワードマネージャー等への別途保管は行っていません（未確認・要山本さんに直接確認）。
> 引継ぎ時は各ダッシュボードの権限譲渡（Section 1参照）を受けた上で、値そのものはそこから直接確認してください。

### Vercel（フロントエンド）
- [ ] `VITE_SUPABASE_URL` — Supabase プロジェクト URL（公開しても問題ないが、Supabaseキーとセット）
- [ ] `VITE_SUPABASE_ANON_KEY` — Supabase anon キー（フロントエンドに渡る）
- 実体の確認場所：Vercel ダッシュボード → プロジェクト → Settings → Environment Variables

### Supabase Edge Function（`ai-consult`）
- [ ] `ANTHROPIC_API_KEY` — Anthropic API キー（**絶対に公開しない**）
- [ ] その他、追加した環境変数があれば
- 実体の確認場所：Supabase ダッシュボード → プロジェクト → Edge Functions → `ai-consult` → Settings（Secrets）

### .env / .env.local（ローカル開発用）
- [ ] 後任者にローカル開発用の `.env` テンプレートを共有（`.env.example` をコピーして値を埋める）
- [ ] `.gitignore` でコミットされていないことを確認
- ⚠️ Claude Code は `.env` / `.env.local` を読み取り禁止設定（brand-core §1）になっています。値の確認・共有は人間同士で行ってください

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

### マルチテナンシー関連（2026-06-26〜07-02導入・CLAUDE.md Section 1.6参照）
- [ ] **OKR系テーブル（objectives/key_results/task_forces/todos等）は部署分離が未対応。** 新しい部署を追加する際は、その部署にはPJ/タスク管理機能のみ使わせ、OKR機能を使わせないこと
- [ ] マイグレーション適用直後は管理者0人＝ブートストラップ窓が開いた状態になる。**新環境構築時・部署追加時は、適用直後に必ずオーナー自身が管理画面から自分を昇格させて窓を閉じること**（詳細はCLAUDE.md Section 1.6）

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
| **開発者ドキュメント** | `docs/dev/`（下表） |
| **設計ドキュメント** | `docs/okr-cycle-design.md` ほか docs/ 直下 |
| **意思決定ログ** | git commit メッセージ＋CLAUDE.md 更新ログ（v2.20時点） |
| **チーム外向け説明** | このリポジトリの README.md（あれば） |

### `docs/dev/` 内訳（2026-07-03時点）

| ファイル | 内容 |
|---|---|
| `architecture.md` | システム構成全体 |
| `data-model.md` | データモデル |
| `module-map.md` | コードのモジュール構成・視覚地図 |
| `supabase-migrations.md` | マイグレーション運用手順 |
| `task-hierarchy-design.md` | タスク階層（親子）設計 |
| `teams-embedding.md` | Teams埋め込み対応 |
| `tour-guidelines.md` | オンボーディングツアーの基準 |
| `i18n-plan.md` | 英語化（i18n）の段階導入計画 |
| `deadline-notifications.md` | 期限通知（Teams週次レポート等）の設計 |
| `runbook.md` | 障害対応手順 |
| `handover-checklist.md` | このファイル |

**新しい `docs/dev/*.md` を追加したら、この表にも必ず追記すること。**

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
- [ ] CLAUDE.md Section 1.6（マルチテナンシー・部署／グループ・ロール）を読む
- [ ] ローカル開発環境を立ち上げ（`npm install && npm run dev`）
- [ ] Supabase ダッシュボードでテーブル一覧と認証設定を確認（`groups`／`group_id`列を含む）
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

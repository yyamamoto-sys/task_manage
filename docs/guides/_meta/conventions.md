---
title: ガイド執筆規約
audience: [maintainer]
mode: guide.conventions
order: 0
last_updated: 2026-05-13
owner: yamamoto
related: [guide.glossary]
---

# ガイド執筆規約

plan-app のガイドは「**Documentation as Code**」で運用します。MD を編集して push すれば、アプリ内の「📖 ガイド」と各画面の `?` ボタンに即反映されます。

## 1. ファイル配置

```
docs/guides/
  _meta/                      … メタ情報（用語集・本規約・自動生成成果物）
  00_overview.md
  01_onboarding/
  02_modes/                   … モード／画面別マニュアル
  03_roles/                   … 役割別ガイド
  04_workflows/               … 週次・四半期などのルーティン
  05_admin/                   … 管理者作業
  06_troubleshooting/
  07_changelog.md             … ユーザー向けリリースノート
```

## 2. Frontmatter（必須）

すべての MD は先頭に YAML を置きます。

```yaml
---
title: 会議ノート（①）              # 必須・一覧表示で使う
audience: [kr-rep, member]         # 必須・配列。値: all / member / kr-rep / facilitator / admin / maintainer
mode: okr.note                     # 任意・アプリ側の "?" ボタンと連動するキー（一意）
order: 1                           # 任意・同階層内の並び順（小さいほど上）
last_updated: 2026-05-13           # 必須・ISO日付
owner: yamamoto                    # 必須・更新責任者
related: [okr.cycle, okr.session]  # 任意・関連ページの mode キー
deprecated: false                  # 任意・true で「⚠ 旧仕様」表示（一覧には出続ける）
archived: false                    # 任意・true で目次・?ボタンから完全除外（Section 5.1参照）
---
```

### `mode:` キー命名規則

`<エリア>.<画面/トピック>` の小文字＋ドット。例：

| キー | 接続先 |
|---|---|
| `dashboard.main` | ダッシュボード本体 |
| `okr.cycle` | OKR モードの週次サイクル全体 |
| `okr.note` | ① 会議ノート |
| `okr.session` | ② セッション記録&分析 |
| `okr.report` | ③ レポート作成 |
| `okr.quarter-plan` | クォーター計画 |
| `okr.why` | なぜなぜ |
| `consultation.main` | AI相談 |
| `admin.objective-kr-tf` | Objective/KR/TF 登録 |

## 3. 本文の書き方

### 3.1 構成

1. **目的（1〜2文）** — 「この機能は何を解決するか」
2. **基本操作** — 番号付き手順。スクリーンショットは `assets/` 配下に置きパス相対参照
3. **注意点** — 失敗しやすい所
4. **関連** — `related` の中身を本文末尾でも軽く列挙

### 3.2 用語

頻出語は [_meta/glossary.md](./glossary.md) に1度だけ定義し、本文では `[KR](../_meta/glossary.md#kr)` のように参照。同じ語の説明を複数箇所に書かない（更新漏れ防止）。

### 3.3 表記

- 数字・英字は半角、記号は全角を許容（読みやすさ優先）
- ボタン名は `「保存」` のように鉤括弧
- アプリの画面名は **太字**：**OKR管理モード**
- コードは `バッククォート`、長文コードは三連バッククォート

### 3.4 スクショ運用

- `docs/guides/_assets/<記事スラッグ>/<連番>.png` に置く（命名で記事と紐づく）
- 撮り直しが必要になったら **置換**（同ファイル名で上書き）が原則。リンク切れを起こさない

## 4. 更新フロー

1. 仕様変更を含む PR では `docs/guides/` も同 PR で更新する
2. PR テンプレートの「ガイド更新チェック」にチェックを入れる
3. `last_updated:` を必ず更新する
4. 古くなった記事は削除せず `_archive/YYYY-MM/` に移動

## 5. アーカイブと削除

- **削除しない**：参照が残っている可能性があるため
- `_archive/2026-05/` のような月単位フォルダに移動
- frontmatter の `deprecated: true` を立てる（一覧には出るが「⚠ 旧仕様」タグが付く）

### 5.1 `archived: true`（2026-08-10追加・目次からの完全除外）

機能そのものがアプリのUIから撤去され、記事が指す画面がもう存在しない場合は
`deprecated: true` では足りない（一覧に出続けてしまう）。この場合は frontmatter に
`archived: true` を立てる。`src/lib/docs/manifest.ts` がビルド時にこのフラグを見て、
ガイド目次・`?` ボタン（`getDocByMode`）・slug直参照（`getDocBySlug`）の**どこからも
到達できなくする**（一覧に出ることすらない）。ファイルは移動・削除しない（コード側の
アーカイブ方針と同じ「描画経路を切るだけ」）。実例：OKRモードのグループ側アーカイブ
（`docs/guides/02_modes/okr/00_cycle.md`〜`03_report.md`・`03_roles/kr-rep.md`・
`03_roles/facilitator.md`・`04_workflows/weekly-rhythm.md`）。

## 6. レビュー

- 月1回：`last_updated` が180日経過した記事を棚卸し
- 各記事末尾の「役立ちましたか？」ボタンの低評価ページを優先メンテ（Phase 4 で実装）

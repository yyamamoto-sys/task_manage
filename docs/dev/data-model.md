# データモデル（plan-app）

Supabase の `public` スキーマに置かれているテーブル一覧と用途。
詳細なスキーマは `supabase/migrations/*.sql` を参照。

## 1. 全テーブル一覧

### コア OKR・PJ・タスク階層

| テーブル | 用途 | キー | 主な参照 |
|---|---|---|---|
| `objectives` | Objective（1件） | id | — |
| `key_results` | KR（Objective に複数） | id | objective_id |
| `task_forces` | TF（KR にぶら下がる） | id | kr_id |
| `quarterly_objectives` | クォーター別 Objective 設定 | id | objective_id, quarter |
| `quarterly_kr_task_forces` | クォーター×KR×TF 割り当て | id | quarterly_objective_id, kr_id, tf_id |
| `projects` | プロジェクト | id (text) | — |
| `project_task_forces` | PJ ⇔ TF 多対多 | id | project_id, tf_id |
| `todos` | TF 配下の ToDo | id | tf_id |
| `tasks` | タスク | id | — |
| `task_projects` | タスク ⇔ PJ 多対多 | id | task_id, project_id |
| `task_task_forces` | タスク ⇔ TF 多対多（廃止予定） | id | task_id, tf_id |
| `milestones` | マイルストーン | id | — |

### OKR 週次サイクル

| テーブル | 用途 |
|---|---|
| `kr_meeting_notes` | ①会議ノート本体（KR×週で1件） |
| `kr_note_tf_entries` | 会議ノートのTFごとの中身 |
| `kr_sessions` | ②セッション記録本体 |
| `kr_declarations` | ②セッションで抽出された宣言 |
| `okr_analyses` | ②分析結果（scope='kr' / 'objective' の2レベル） |
| `kr_reports` | ③レポート（draft / finalized） |
| `project_analyses` | PJ別 AI分析結果（ダッシュボード） |

### メンバー・タグ・ログ

| テーブル | 用途 |
|---|---|
| `members` | メンバー一覧 |
| `member_tags` | メンバータグの定義 |
| `member_tag_members` | メンバー ⇔ タグ 多対多 |
| `admin_change_logs` | 管理操作のログ |
| `ai_usage_logs` | AI呼び出しの使用量ログ |

## 2. 共通カラム

ほとんどのテーブルに以下の共通カラムがあります（過去のmigration 経緯で抜けているものも一部あり）：

| カラム | 型 | 意味 |
|---|---|---|
| `id` | uuid または text | 主キー |
| `is_deleted` | boolean | 論理削除フラグ |
| `created_at` | timestamptz | 作成日時 |
| `updated_at` | timestamptz | 更新日時（trigger で自動更新） |
| `updated_by` | text | 最終更新者の member_id |

### 共通トリガ
`update_updated_at()` 関数が `BEFORE UPDATE` で `updated_at` を自動更新する。**この関数は migration には含まれておらず、Supabase 上で手動作成されている**ため、新環境構築時は別途作成が必要。

```sql
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

## 3. RLS と GRANT の現状（2026-05-15 時点）

- すべての `public.*` テーブルに **`authenticated full access` ポリシー**が適用済
- 既存テーブルは Supabase の旧デフォルトで **`anon` にも全権限**が付与されている
- 新規テーブル作成方針：authenticated + service_role のみ grant（anon は外す）
- **2026/10/30** 以降は Supabase 側のデフォルトが変わるため、明示 GRANT が必須に

詳細は [supabase-migrations.md](./supabase-migrations.md)。

## 4. 主要な関係（簡略 ER）

```
objectives
   └── key_results
         └── task_forces
              ├── todos ──── tasks（todo_ids[]）
              └── (via project_task_forces) ──► projects
                                                   └── (via task_projects) ──► tasks

quarterly_objectives
   └── quarterly_kr_task_forces ──► (kr_id, tf_id) で割り当て

kr_meeting_notes (KR×週)
   └── kr_note_tf_entries (TFごと)

kr_sessions (KR×週・種別)
   └── kr_declarations (KRごとの宣言)
okr_analyses (KR or Objective scope)

kr_reports (KR×週・mode)
project_analyses (PJごとの最新2件)
```

## 5. 命名規約

- テーブル名：複数形・snake_case（例 `kr_meeting_notes`）
- 結合テーブル：両側のテーブル名を `_` で並べる（例 `task_task_forces`、ただし旧式）
- カラム：snake_case
- 外部キーカラム：`<referenced>_id`（例 `kr_id`, `tf_id`）
- 配列カラム：複数形（例 `todo_ids[]`）

## 6. テーブル変更時の注意

- `is_deleted` カラムがある場合、SELECT 側は必ず `where is_deleted = false`
- アプリ側 store（`lib/supabase/*Store.ts`）の型と同期させる
- realtime 購読を使っているテーブルは Supabase ダッシュボードで「Database → Replication」を確認
- 詳細手順：[supabase-migrations.md](./supabase-migrations.md)

## 7. 関連

- [architecture.md](./architecture.md)
- [supabase-migrations.md](./supabase-migrations.md)
- [runbook.md](./runbook.md)
- `supabase/migrations/*.sql`（実際のスキーマ定義）

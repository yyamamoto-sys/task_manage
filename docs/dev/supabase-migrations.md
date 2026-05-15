# Supabase Migration の書き方（plan-app）

plan-app の Supabase テーブル追加・変更時の標準手順と RLS / GRANT 方針です。
**2026/10/30 以降、新規テーブルは明示的な GRANT が必須**になります（Data API公式アナウンス）。本ドキュメントの「新規テーブル作成テンプレ」を毎回使えば、その日が来ても破綻しません。

## 1. 大原則

- plan-app は **supabase-js（Data API）経由**でクライアントから DB を叩く構造
- 公開ロールは **`authenticated`** と **`service_role`** のみ使う
- **`anon` には何も grant しない**（未ログインからは触らせない）
- すべての `public.*` テーブルは **RLS 有効** ＋ **`authenticated full access` ポリシー**を基本とする
- 例外（特定ユーザのみ・読み取り専用など）はテーブル単位で個別ポリシーを書く

## 2. 新規テーブル作成テンプレ（コピペ用）

`supabase/migrations/YYYYMMDD<n>_<slug>.sql` に新規テーブルを追加するときは、必ず以下のセットで書く。

```sql
-- ============================================================
-- <テーブル名> : <用途を1文>
-- ============================================================

create table public.<table_name> (
  id uuid primary key default gen_random_uuid(),
  -- 業務カラム ...
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス（必要に応じて）
create index <table_name>_<col>_idx on public.<table_name> (<col>);

-- ★ Data API 経由で読み書きするための GRANT（2026/10/30 以降は必須）
grant select, insert, update, delete on public.<table_name> to authenticated;
grant select, insert, update, delete on public.<table_name> to service_role;
-- anon には付けない（plan-app 方針）

-- RLS
alter table public.<table_name> enable row level security;

create policy "authenticated full access on <table_name>"
  on public.<table_name> for all
  to authenticated
  using (true) with check (true);
```

> **`updated_at` の自動更新**が必要なら、共通トリガ（`set_updated_at()` 関数があるはず）を最後に1行で適用：
> `create trigger <table_name>_set_updated_at before update on public.<table_name> for each row execute function public.set_updated_at();`

## 3. テーブル変更（ALTER）の注意

- カラム追加・型変更：通常通り `alter table` で OK。grant は維持される
- **テーブルを `drop` して作り直す**ような場合は、新規テーブル扱いになる。テンプレの GRANT + RLS + policy を必ず再付与する
- ポリシー差し替えは `drop policy ... ; create policy ...` の順で

## 4. GRANT を忘れた時に出るエラー

PostgREST / supabase-js のレスポンスに：

```
code: 42501
message: permission denied for table <table_name>
hint: <修正用の GRANT 文がここに入って返ってくる>
```

エラー本文に「これを実行しろ」という SQL が入っているので、それを `supabase/migrations/` に新規ファイルとして保存して反映するのが最速。

## 5. 既存テーブルの GRANT 棚卸し

定期的に（または不安な時に）Supabase の SQL Editor で以下を実行して、想定通りの権限になっているか確認する。

```sql
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('authenticated', 'service_role', 'anon')
group by grantee, table_name
order by table_name, grantee;
```

期待結果：

| grantee | privileges | 備考 |
|---|---|---|
| `authenticated` | `DELETE, INSERT, SELECT, UPDATE` | 全テーブルでこの4つ |
| `service_role` | `DELETE, INSERT, SELECT, UPDATE` | 全テーブルでこの4つ |
| `anon` | （行が出ない） | plan-app は `anon` に grant しない方針 |

**もし `authenticated` の grant が欠けているテーブルがあれば**、補完 migration を作る：

```sql
grant select, insert, update, delete on public.<missing_table> to authenticated;
grant select, insert, update, delete on public.<missing_table> to service_role;
```

## 6. RLS ポリシーの棚卸し

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

- すべての `public` テーブルに最低1つはポリシーがあること
- `rowsecurity = true`（`select tablename, rowsecurity from pg_tables where schemaname='public';` で確認）

## 7. ロールアウト

1. ローカルで SQL を書く（`supabase/migrations/YYYYMMDD<n>_<slug>.sql`）
2. PR で見せる（人間レビューは構造変更のみ厳しめに）
3. Supabase SQL Editor に **コメントを除いた SQL を一気に貼って実行**（過去にコメント混入で 42601 エラーが出たことがあるため）
4. 反映後、`information_schema.role_table_grants` で grant を確認
5. アプリ側コードを反映してデプロイ

## 8. 関連ドキュメント

- 全テーブル一覧と意味：[../dev/data-model.md](./data-model.md)（未作成）
- 既知の障害パターン：[../dev/runbook.md](./runbook.md)（未作成）
- 公式アナウンス：Supabase メール「Action required: Data API default change on May 30, 2026」

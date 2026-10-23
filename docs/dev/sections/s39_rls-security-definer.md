## 39. グランドルール：RLSポリシー内でSECURITY DEFINER関数を呼ぶときは`(SELECT ...)`で包む（必須・v3.80・2026-08-19）

### 実測で判明した誤り

v3.75（`20260818_harden_invite_related_rls.sql`）の「性能：`id = ANY(...)`を選んだ理由」というコメントには「membersの各行と相関を持たないため、PostgreSQLはクエリ全体で1回だけ評価するuncorrelated subplanとして実行できる」と書いたが、**これは誤りだった**。2026-08-19、山本さんが本番で招待受諾者アカウント・RLSを効かせた状態で`EXPLAIN (ANALYZE, BUFFERS)`を実測したところ：

```
Seq Scan on members  (cost=0.00..34.88 rows=21 width=279) (actual time=8.093..76.053 rows=16 loops=1)
  Filter: ((group_ids && current_member_group_ids()) OR current_member_is_super_admin()
           OR (group_ids && visible_invite_group_ids()) OR (id = ANY (visible_project_member_ids())))
  Rows Removed by Filter: 5
  Buffers: shared hit=6504
Planning Time: 48.270 ms
Execution Time: 76.085 ms
```

`members`は21行＝実体は1ページで足りるはずが、`shared hit=6504`という異常値が出た。引数無しのSTABLE/SECURITY DEFINER関数であっても、RLSポリシーのWHERE句に直接書くとPostgreSQLは**行ごとに評価する**（uncorrelated subplanにはならない）ことが実測で確定した。`20260818_harden_invite_related_rls.sql`の該当コメントは、誤りだったことと実測値・是正した版（v3.80）を追記する形で訂正した（消していない）。

### ルール

**RLSポリシーのUSING/WITH CHECK句でSECURITY DEFINER関数（引数の有無を問わない）を呼ぶときは、必ず`(SELECT 関数呼び出し())`の形で包むこと。** PostgreSQLはこの形をInitPlanとして認識し、クエリ全体で1回だけ評価してキャッシュする。Supabaseが公式にRLSの性能改善として推奨している定石（`auth.uid()`を`(SELECT auth.uid())`と書く）と同じ手法。

```sql
-- ❌ 行ごとに再評価される
USING (group_ids && current_member_group_ids() OR current_member_is_super_admin())

-- ✅ InitPlanとして1回だけ評価される（式の意味は同じ）
USING (group_ids && (SELECT current_member_group_ids()) OR (SELECT current_member_is_super_admin()))
```

### v3.80で対応した範囲（`members`のみ）

`supabase/migrations/20260819c_optimize_members_rls_initplan.sql`で`members_select`/`members_write_insert`/`members_write_update`/`members_write_delete`の4ポリシー全ての関数呼び出しを`(SELECT ...)`で包んだ（**式の意味・条項の順序・キャストは一切変えていない**）。`schema.sql`のmembersポリシー4本も同期済み。

- **v3.75で塞いだ穴は再度開けていない**：`FOR ALL`に戻していない・`WITH CHECK`を省略していない・SELECT用と書き込み用のポリシー分割を維持している。
- **書き込み系に`visible_project_member_ids()`は足していない**（元々存在しない。書き込みスコープを広げる変更はしていない）。

### 同型の問題を抱える他のポリシー（v3.80では対応しない・調査結果の記録）

`projects_group`／`tasks_group`／`task_dependencies_group`は、いずれも`current_member_group_ids()`/`current_member_is_super_admin()`をSECURITY DEFINER関数として`(SELECT ...)`で包まずに直接呼んでおり、**同型の性能問題を抱えている可能性が高い**。ただしv3.80で実測により問題を確認できたのは`members`のみのため、今回はこの3ポリシーには手を入れていない（一度に触る範囲を広げない）。実際に性能問題が顕在化した場合は、同じ`(SELECT ...)`で包む対応を個別に検討すること。

### 🔴 但し書き：単数列（text）を配列と比較するときは `= ANY((SELECT ...))` と書けない（2026-09-17に実際に踏んだ）

`entity_change_logs`（v3.111）のRLSを次のように書いたところ、**SQL Editorでの適用が失敗した**。

```sql
-- ❌ 42883: operator does not exist: text = text[]
group_id = ANY((SELECT current_member_group_ids()))
```

**`ANY()` は括弧の中身を「配列式」ではなく「サブクエリ」として解釈する。** そのため
`(SELECT 関数())` を渡すと「1列N行を返すサブクエリ」とみなされ、`text`（group_id）と
`text[]`（各行の値）を比較しようとして型エラーになる。

本Sectionの `(SELECT ...)` で包む書き方は、**`group_ids && (SELECT 関数())` のような
【配列同士】の比較でしか素直に使えない。**

単数列では**配列包含演算子 `@>`** を使い、`(SELECT 関数())` をスカラーサブクエリとして
左辺に置く。これならInitPlan化（クエリ全体で1回だけ評価）を保ったまま比較できる。

```sql
-- ✅ InitPlan化を保ったまま、単数列を配列と比較できる
(group_id IS NOT NULL AND (SELECT current_member_group_ids()) @> ARRAY[group_id])
OR (SELECT current_member_is_super_admin())
```

`group_id` が NULL の行はどの配列にも含まれないため、`IS NOT NULL` で明示的に除外し、
super_adminだけが見られるようにしている（書かないと判定がNULLになり挙動が読みにくい）。

**なお、既存の `objectives` / `key_results` / `task_forces` / `todos` 等は
`group_id = ANY(current_member_group_ids())`（包まない形）のままである。** これらは
Section 39制定前のもので、包む場合は上記の `@>` 形式に書き換える必要がある
（`ANY((SELECT ...))` にすると同じ型エラーで適用できない）。

### このルールは新しいRLSポリシーを書くとき必ず確認する

- [ ] USING/WITH CHECK句でSECURITY DEFINER関数を呼んでいるか？ → `(SELECT ...)`で包んだか？
- [ ] 式の意味・条項の順序・キャストを変えていないか？（包むだけで、ロジックは1文字も変えない）
- [ ] `schema.sql`の該当ポリシーも同期したか？
- [ ] 🔴 **新しいテーブルを作ったら、同じマイグレーションに GRANT を書いたか？**（2026-10-30以降、Supabase は public の新テーブルに Data API 権限を自動付与しない。書かないと RLS が正しくても `permission denied`）
  ```sql
  grant select, insert, update, delete on public.新テーブル to authenticated;
  grant select, insert, update, delete on public.新テーブル to service_role;
  ```
  anon には付けない（ログイン前提・anon 向けポリシーは無い）。`schema.sql` 末尾の `$grant_tables$` ブロックの配列にもテーブル名を足す。

---

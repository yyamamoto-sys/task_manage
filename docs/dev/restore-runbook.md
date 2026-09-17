# 復元手順書（バックアップからデータを戻す）

最終更新：2026-09-17（dev で復元訓練を実施し、実測結果を反映）
正本：[backup-design.md](./backup-design.md)（バックアップの設計）／[runbook.md](./runbook.md)（障害対応の全体）

> **この手順は 2026-09-17 に dev で実際に通したもの**である。机上の想定ではない。
> 実行した SQL・得られた結果・予測が外れた点まで、訓練の記録として §6 に残してある。

---

## 0. 使う前に（30秒で読む）

- **戻せるのは日次スナップショットを取った時点（JST 3:00）だけ。** 本番は Free プランで PITR が無く、任意の時刻には戻せない。最大24時間ぶんの更新が失われる
- **復元の誤爆は削除より被害が大きい。** 焦って本番へ直接流さない。必ず §2 の順で進める
- **トリガーを止めずに復元すると、更新日時と `group_ids` が書き換わる**（§3-①）
- 迷ったら、まず §1「最初の5分」だけ実行して人を集める

---

## 1. 最初の5分（何が起きたか分かる前にやること）

1. **更新を止める**
   - Vercel のデプロイをロック（Production Branch Protection を一時的に有効化）
   - 関係者に「アプリを使わないで」と即時連絡。**使い続けられると、戻す対象が増え続ける**
2. **壊れた状態のバックアップを取る**（これを飛ばすと、復元をやり直せない）
   - 管理画面 → 設定 → アプリ設定 → バックアップ → 「今すぐ実行」
   - または Edge Function を直接起動する
3. **材料があるか確認する**
   ```sql
   select id, trigger, status, group_count, bytes_written, started_at
     from backup_runs order by id desc limit 5;

   select path, scope, group_id, bytes, taken_at
     from backup_objects where deleted_at is null
    order by taken_at desc limit 10;
   ```
   🔴 **ここに何も無ければ、この手順書では戻せない。** 二次保管（共有ライブラリ）を探す

---

## 2. 復元の進め方（この順番を守る）

```
① 影響範囲を確定する      → 何が・いつ・何件壊れたか
② 戻す範囲を宣言して合意  → 失われる更新を先に明示する
③ dev で予行する          → 本番へ直接流さない
④ 本番へ適用する          → トランザクションで、対象テーブルだけ
⑤ 報告する                → 何が起き、何を復旧し、何が失われたか
```

### ① 影響範囲を確定する

```sql
-- いつ何が起きたかの手がかり
select * from admin_change_logs
 where performed_at > now() - interval '3 days'
 order by performed_at desc limit 50;

-- 論理削除された行の件数（物理削除でなければ §3-④ で戻せる）
select count(*) from tasks where is_deleted = true;
```

### ② 戻す範囲を宣言して合意する

**「grp-egg の tasks のみ、9月16日 3:00 時点へ」**のように、対象・粒度・時点を1文で書く。あわせて次を明示して合意を取る。

- **失われる更新**：スナップショット以降の変更（最大24時間ぶん）
- **戻さないもの**：対象外のテーブル・部署

### ③ dev で予行する

**dev はスキーマが本番とずれている**（2026-09-17 時点で個人OKR系9本が未適用）。予行の前に、対象テーブルが dev に存在するか確認する。

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('tasks','projects','members');
```

---

## 3. 復元の実行（ケース別・すべて dev で実証済み）

### 共通の型

```sql
begin;

alter table <テーブル> disable trigger user;   -- ①トリガーを止める

insert into <テーブル>
select * from jsonb_populate_recordset(null::<テーブル>, <JSON配列>)
on conflict (id) do ...;                        -- ②衝突の扱いを決める

alter table <テーブル> enable trigger user;     -- ③必ず戻す

commit;
```

🔴 **`begin` / `commit` で囲むこと。** 途中でエラーが出れば自動で巻き戻り、**トリガーも有効なまま残る**。囲まないと、エラー時にトリガーが無効のまま取り残され、以後アプリの保存が壊れる。

### ① なぜトリガーを止めるのか

止めないと2つが起きる（2026-09-17 に実測）。

| トリガー | 止めないとどうなるか |
|---|---|
| `trg_tasks_updated_at` | `updated_at` が**復元した瞬間の時刻**で上書きされる |
| `trg_tasks_sync_group_ids` | `group_ids` が**親から再計算**され、スナップショット当時の値が消える |

**`alter table ... disable trigger user` は Supabase の SQL Editor で権限エラーなく実行できる**（実測）。`session_replication_role = replica` は不要。

🔴 **`disable trigger user` は FK 制約を止めない。** ユーザー定義トリガーだけが対象で、FK（システムトリガー）は有効なまま。**存在しない親を参照する行を入れようとすれば、ちゃんと 23503 で弾かれる**（実測で確認済み）。安全装置は生きている。

### ② 衝突の扱い（事故の型で決める）

| 事故の型 | `on conflict` | 使う場面 |
|---|---|---|
| **行が消えた**（物理削除） | `do nothing` | 消えた行だけを入れ直す。既存行には触れない |
| **値が書き換えられた**（上書き事故） | `do update set ...` | 誤って更新された列を元に戻す |

🔴 **`on conflict do update set` は列を1つずつ書く。** `excluded.*` による全列一括指定は Postgres に存在しない。**戻したい列だけを書く**ので、事故のたびに文が変わる。

🔴 **`updated_at = excluded.updated_at` を必ず含める。** 書き忘れると、トリガーを止めていても復元行だけ更新日時が残ったままになる。

### ③ FK の順序について（予測が外れた点）

**同一テーブル内の自己参照（`tasks.parent_task_id`）は、順序を気にしなくてよい。**

PostgreSQL の FK 制約（`NOT DEFERRABLE INITIALLY IMMEDIATE`）は**行ごとではなく SQL 文の終わりに検証される**ため、**1つの INSERT 文で親と子を同時に入れれば、並び順は関係ない**。2026-09-17 に「子を先に並べた INSERT」を実際に流して成功を確認した。

**ただしテーブルをまたぐ FK は別。** 必然的に別の INSERT 文になるため、**文と文の順序**は必要。

```
groups → members → objectives → key_results → task_forces → todos
       → projects → tasks → 中間テーブル（task_task_forces / task_projects / task_dependencies）
```

`task_dependencies` は `tasks` を2列（先行・後続）で参照するため、必ず `tasks` を入れ終えてから。

### ④ 論理削除なら復元は不要

`is_deleted = true` になっただけなら、バックアップを使わず戻せる。**まずこれを疑う**（このアプリは物理削除を行わない設計のため、多くの事故はこちら）。

```sql
update tasks set is_deleted = false, deleted_at = null, deleted_by = null
 where /* 条件 */;
```

---

## 4. そのまま使えるテンプレート

### A. Storage の JSON を DB に取り込む

管理画面 → バックアップタブ → 対象行の「ダウンロード」で JSON を取得し、SQL Editor で一時テーブルに入れる。

```sql
create table if not exists restore_work (
  id      bigserial primary key,
  label   text,
  payload jsonb not null
);

-- ダウンロードした JSON の中身を payload に貼る
insert into restore_work (label, payload) values ('2026-09-16 grp-egg', '<ここにJSON全文>'::jsonb);
```

> ファイルが大きい（1.5MB前後）ため SQL Editor に貼りにくい場合は、**その場で新しいスナップショットを取って使う**ほうが早い（§6の訓練ではこの方法を使った）。
> ```sql
> insert into restore_work (label, payload)
> select '現時点', backup_snapshot('full', NULL, NULL);
> ```

### B. 消えた行を戻す（物理削除からの復元）

```sql
begin;
alter table tasks disable trigger user;

insert into tasks
select *
  from jsonb_populate_recordset(
         null::tasks,
         (select jsonb_agg(elem)
            from (select payload from restore_work order by id desc limit 1) s,
                 lateral jsonb_array_elements(s.payload -> 'tables' -> 'tasks') elem
           where elem ->> 'id' in ('戻したいID', '...'))
       )
on conflict (id) do nothing;

alter table tasks enable trigger user;
commit;
```

### C. 書き換えられた値を戻す（上書き事故からの復元）

```sql
begin;
alter table tasks disable trigger user;

insert into tasks
select *
  from jsonb_populate_recordset(
         null::tasks,
         (select jsonb_agg(elem)
            from (select payload from restore_work order by id desc limit 1) s,
                 lateral jsonb_array_elements(s.payload -> 'tables' -> 'tasks') elem
           where elem ->> 'id' in ('戻したいID', '...'))
       )
on conflict (id) do update set
  name       = excluded.name,
  due_date   = excluded.due_date,
  status     = excluded.status,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;   -- 🔴 これを忘れない

alter table tasks enable trigger user;
commit;
```

### D. 部署まるごと戻す（未検証・慎重に）

部署別ファイル（`backups/by-group/<部署>/YYYY-MM-DD.json`）には、その部署のデータが層A・層B（backup-design.md §4）で完結した形で入っている。**ただし §3-③ の順序でテーブルごとに文を分ける必要があり、2026-09-17 時点で実機検証していない。** 実行前に必ず dev で予行すること。

---

## 5. 復元後の確認

```sql
-- 件数が戻ったか
select count(*) from tasks;

-- 🔴 updated_at が書き換わっていないか（トリガー停止が効いた証拠）
select id, name, updated_at, updated_by from tasks where id in ('...');

-- 🔴 トリガーが有効に戻っているか（O=有効 / D=無効）
select tgname, tgenabled from pg_trigger
 where tgrelid = 'tasks'::regclass and not tgisinternal;
```

**最後に利用者へ再読み込みを依頼する。** 復元中に画面を開いていた人は、古い状態を保持したままになる。

---

## 6. 訓練の記録（2026-09-17・dev）

### 実施した3ケース

| # | 事故の型 | 方法 | 結果 |
|---|---|---|---|
| 1 | 参照のないタスク5件を**物理削除** | `on conflict do nothing` | ✅ 328件に復帰・`updated_at` 保持 |
| 2 | 5件の名前・期日・更新者を**上書き**（`updated_at` も今日に変化） | `on conflict do update set` | ✅ 完全復帰・`updated_at` が6〜7月に戻った |
| 3 | 親1件＋子5件を**削除し、子を先に並べて復元** | 1つの INSERT 文 | ✅ FK 違反は起きず成功 |

### 予測が外れた点（設計書を修正した）

**backup-design.md §9 に「子を先に入れると FK 違反で止まる」と書いていたのは誤りだった。** 同一テーブル内・1文の INSERT なら順序は関係ない（§3-③）。実機で試さなければ、存在しない問題への対策を手順書に書き続けるところだった。

### 確かめた安全装置

`disable trigger user` の状態で、存在しない親を参照する UPDATE を試したところ **23503（FK 違反）で正しく弾かれた**。トリガーを止めても FK は生きている。

### 未検証で残っている点

| # | 内容 | なぜ未検証か |
|---|---|---|
| 1 | **部署別ファイルからの復元**（§4-D） | dev は個人OKR系9本が未適用で、`backup_snapshot('group', ...)` が失敗する |
| 2 | **テーブルをまたぐ復元の順序** | dev の `task_dependencies` が0件で、依存関係を再現できなかった |
| 3 | **スキーマ差分がある状態での復元** | 同一スキーマ間でしか試していない |
| 4 | **プロジェクトごと失われた場合の復旧** | 新規 Supabase プロジェクトの作成が必要（Free は組織あたり2プロジェクトが上限で、現在 prod/dev で埋まっている） |

---

## 7. 次の訓練で試すこと

**四半期に1回**、dev で実施する。次回は §6 の未検証項目を潰す。

- [ ] dev のスキーマを本番と揃える（個人OKR系7本のマイグレーション適用）
- [ ] 部署別ファイルからの復元（§4-D）
- [ ] テーブルをまたぐ復元（tasks → task_task_forces → task_dependencies）
- [ ] 所要時間の計測（本番で何分かかるか の目安を持つ）

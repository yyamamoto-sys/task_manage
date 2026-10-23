## 40. `visible_project_member_ids()` の中身を軽くする（v3.81・2026-08-19）

`supabase/migrations/20260819d_optimize_visible_project_member_ids.sql` 参照。

### 実測で切り分けられたこと（次に性能を疑うときの手順として記録）

v3.80でmembersのRLS内の関数呼び出しを`(SELECT ...)`で包んでInitPlan化した後、本番・招待受諾者アカウントで取った`EXPLAIN (ANALYZE, BUFFERS)`は次のようになっていた：

```
InitPlan 1 (current_member_group_ids)      actual time=2.583..2.584   Buffers: shared hit=86
InitPlan 2 (current_member_is_super_admin) actual time=0.227..0.228   Buffers: shared hit=2
InitPlan 3 (visible_invite_group_ids)      actual time=5.935..5.936   Buffers: shared hit=299
InitPlan 4 (visible_project_member_ids)    actual time=53.922..53.922 Buffers: shared hit=730
Execution Time: 63.500 ms
```

**ここが今回の切り分けの要点**：InitPlan化により4つの関数はいずれも「クエリ全体で1回しか呼ばれていない」状態になっていた。にもかかわらずInitPlan 4だけ53.9ms・shared hit=730と突出していた。**呼び出し回数を1回に減らしても遅いなら、次に疑うべきは「関数の中身」である**——今回はこの理屈で`visible_project_member_ids()`本体の重さ（8ブランチ、実際に数えると7ブランチのUNION、各ブランチが独立にprojects/tasksを走査し関数を呼び直している）を犯人だと確定できた。**「1回しか呼ばれていないのに重い」という実測値の読み方**は、今後同様の性能調査でも使える手順として残す。

### 何をしたか

`current_member_group_ids()`/`current_member_is_super_admin()`をCTE（`ctx`）で1回だけ評価し、「自分がアクセスできる、削除されていないPJ」をCTE（`accessible_projects`）で1回だけ作った。オーナー系3ブランチ（`owner_member_id`／`owner_member_ids`／`member_ids`）はそのCTEから取り、tasksの走査は「project_id直接」「task_projects経由」の2系統に絞って、各系統内の単数・複数担当者は配列結合してから1回unnestする形にまとめた（旧4ブランチ→新2ブランチ）。

- 🔴 **`ctx`・`accessible_projects`の両方に`AS MATERIALIZED`が必須（統括レビューで訂正）**：実装時は`accessible_projects`（5箇所から参照）にだけ明示し、`ctx`（`accessible_projects`から1回だけ参照）には付けていなかった。しかしPostgreSQL 12以降は「参照が1回だけ」かつ「volatile関数を含まない」非再帰CTEを既定でインライン展開する。`ctx`は参照1回・中の関数もSTABLE（volatileでない）のため、この既定インライン展開の条件を完全に満たしてしまい、`MATERIALIZED`が無いとWHERE句が元の形（`p.group_ids && current_member_group_ids() OR current_member_is_super_admin()`）に戻って行ごとに関数が再評価される——v3.80で実測・確定した「関数呼び出しは`(SELECT ...)`で包まない限りInitPlan化されない」問題（Section 39）が、関数の内側でそっくり再発する構造だった。統括のレビューで指摘を受け、`ctx`にも明示的に`AS MATERIALIZED`を付けて修正した。
- **走査回数**：projectsの物理スキャン 7回→1回、tasksの物理スキャン 4回→2回、`current_member_group_ids()`/`current_member_is_super_admin()`の呼び出し 14回（7ブランチ×2関数）→各1回。
- **返る集合は1要素も変えていない**。旧7ブランチ→新実装の対応表・型キャストを結合前に行う理由（20260819bと同型の事故を防ぐため）はmigrationファイルのコメントに全文残した。
- **関数名・シグネチャ・RLSポリシー（`members_select`）は無変更**。
- `schema.sql`の同関数を同期した。
- `src/lib/schema/schemaChecks.ts`に`kind:"function_body_contains"`の検査項目を1件追加（`visible_project_member_ids_optimized_body`。needleは`accessible_projects AS MATERIALIZED`。**当初は`JOIN accessible_projects ap ON ap.id = t.project_id`を選んでいたが、統括レビューで「エイリアス名変更だけで検知が壊れる」脆さを指摘され選び直した**。単なる命名ではなく、この最適化の性能特性そのものを担うCTEディレクティブのため、これが消える＝再検証が必要な変更、という対応が取れる。旧実装（20260818時点）にはCTE自体が存在しないためこの文字列は登場しない）。
- **`projects.group_ids`のGINインデックスは存在しない**（`idx_projects_owner_member_id`／`idx_projects_status`のみ）。`accessible_projects`のWHERE句の`&&`判定に理論上効きうるが、「一度に触る範囲を広げない」方針により今回は追加していない。

### 検証の分離（結果不変性の担保）

このリポジトリのテスト環境（Vitest/Node）では実際のPostgresを起動できず、SQL関数の集合演算そのものを単体テストで検証する手段が無い（`consume_guest_ai_quota`と同型の制約。Section 22参照）。そのため、無理に形だけのテストは書かず、代わりに**migrationファイル内に旧ブランチ→新実装の対応表をコメントで明示**し、**山本さんが適用前後に同一クエリ（`visible_project_member_ids()`をソート済み配列で比較）を実行して完全一致を確認する監査手順**をmigration末尾に用意した。

### やらないこと

- `projects.group_ids`へのGINインデックス追加（見立てのみ報告。Section本文参照）。
- `task_dependencies`のRLSポリシー・`projects_group`／`tasks_group`／`task_dependencies_group`のInitPlan化（Section 39で「対応しない」と記録済みの範囲。スコープ外のまま）。
- マイグレーションの適用は行っていない。山本さんが手動適用する。

---

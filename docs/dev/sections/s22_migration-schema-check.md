## 22. グランドルール：マイグレーション追加時は検査項目も1行足す（必須・v3.26）

### 2026-08-06に実際に起きた事故

`20260721_add_task_status_hold_cancelled.sql`（v2.74・2026-07-21適用予定だったマイグレ）が本番に未適用のまま**約2週間気づかれず**、タスクのステータスに「保留」「中止」を選ぶと保存に失敗する不具合が、タスク編集モーダル・カンバン・リスト・ガント・AI提案の反映の**全経路**で発生し続けた。コード側は正しく `on_hold` を送っていたが、DB側の `tasks.status` CHECK 制約が3値のままだったために起きた。マイグレの適用が手作業でコードだけ先に本番へ出るため、適用漏れが「機能が静かに壊れたまま」残る構造になっている。

### 仕組み（起動時に管理者だけが検知する）

```
起動時（管理者のみ・1回）→ RPC（check_schema_health）でスキーマ検査 → 欠けていたら管理者にだけ控えめな警告バナー
```

- **検査項目は `src/lib/schema/schemaChecks.ts` に宣言的な配列として持つ**（SQL側にハードコードしない）。理由：SQL側に埋め込むと項目を追加するたびに新しいマイグレーションが必要になり、この仕組み自体が必ず形骸化する。TS側の配列に1行足すだけで済むようにしてある。
- 各項目は `{ kind, table/column/needle/name/udt, label, migration }` の形（`kind` は `"table"` / `"column"` / `"check_contains"` / `"function"` / `"function_body_contains"` / `"column_type"`）。`migration` は該当マイグレファイル名で、実在することを `src/lib/schema/__tests__/schemaChecks.test.ts` が機械的に検査する（存在しないファイル名を書くとテストが落ちる）。
- 実際の問い合わせは汎用RPC `check_schema_health(p_checks jsonb)`（`supabase/migrations/20260806_add_schema_health_check.sql`。`function_body_contains`／`column_type`はv3.80・`20260819_add_schema_health_function_body_and_column_type_check.sql`で追加）。**動的SQL（EXECUTE）は使わず**、`pg_catalog`/`information_schema` へのパラメータ化された参照だけで判定する。呼び出せるのは部署管理者・全社スーパー管理者のみ（それ以外は例外ではなく静かに空配列を返す）。
- **`kind:"function_body_contains"`（v3.80）**：関数の名前・引数を変えず本文（中身）だけを差し替えるマイグレーションは、`kind:"function"`（`pg_proc`に同名関数が存在するかしか見ない）では適用漏れを検知できない（Section 25 Phase 5・33で発見された既知の限界。v3.80で解消）。この場合は`pg_get_functiondef()`で関数定義全文を取得し、`position()`でneedle（そのマイグレーションでしか登場しない実行文の断片）を含むか判定する`kind:"function_body_contains"`を使う。**needleは変数名・コメント文言のような消えやすいものを選ばない**（将来のリファクタで名前だけ変わって検知が壊れるため）。そのマイグレーションの核心的な振る舞い（消せば機能が壊れる実行文）を選ぶこと。Section 38参照。
- **`kind:"column_type"`（v3.80）**：列は存在するが宣言と実際の型がずれる事故（2026-08-18、`projects.owner_member_ids`の実DBが`uuid[]`のまま宣言の`text[]`からドリフトしていた。v3.75の適用が「UNION types text and uuid cannot be matched」で2回失敗した実際の原因）は、`kind:"column"`（列の存在有無しか見ない）では検知できない。`information_schema.columns.udt_name`（配列型は`"_text"`/`"_uuid"`のように先頭にアンダースコアが付く内部表記）で判定する。Section 38参照。
- クライアント側（`src/components/common/SchemaHealthBanner.tsx`、`src/App.tsx` から admin にのみマウント）は起動時に1回だけ非ブロッキングで呼び、欠落があれば控えめな警告バナー（赤一色ではない warning トーン）を出す。**閉じても次回読み込み時にはまた表示される**（localStorageで永久に黙らせない。今回のように2週間放置されるのを防ぐため）。
- **スキーマを自動修正しない**（検知して知らせるだけ。Human in the loop）。
- RPC自体が未適用（この仕組み自体のマイグレが未適用）のときは、黙って無効化せず「検査を実行できません」を出す（Section 19 のDL確認ゲートが黙って無効化されうる件と同じ轍を踏まないため）。

### このルールは新しいマイグレーションを追加するとき必ず確認する

- [ ] スキーマを変える新しいマイグレ（テーブル・列・CHECK制約・関数の追加）を書いたか？ → `src/lib/schema/schemaChecks.ts` に検査項目を1行足したか？
- [ ] 追加した項目の `migration` は実際のファイル名と一致しているか？（`schemaChecks.test.ts` が機械的に検証する）
- [ ] 適用直後、管理者としてログインしてバナーが出ないこと（＝正しく適用された）を確認したか？

---

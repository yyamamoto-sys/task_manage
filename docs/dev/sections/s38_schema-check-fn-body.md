## 38. スキーマ検査：関数の「本文差し替え型」＋列の「型のずれ」の検知（v3.80・2026-08-19）

Section 22・25 Phase 5・33で繰り返し既知の限界として記録していた穴（`kind:"function"`が`pg_proc`に同名関数が存在するかしか見ないため、関数の名前・引数を変えず本文だけを差し替えるマイグレーションの適用漏れを検知できない）を解消した。あわせて、2026-08-18に実際に踏んだ「列は存在するが宣言と実DBの型がずれていた」事故（`projects.owner_member_ids`）の再発防止として`kind:"column_type"`も追加した。

### 棚卸し結果：診断の「1件」から2件へ（本文差し替え型）

2026-08-17の診断は本文差し替え型を`accept_project_invite()`（`20260812_accept_invite_for_existing_member.sql`）の1件と確定していたが、今回`CREATE (OR REPLACE) FUNCTION`の再定義箇所を全マイグレーションから機械的に洗い出したところ、`guard_member_privilege_columns()`（v3.75・`20260818_harden_invite_related_rls.sql`）も同型（名前・引数不変・本文のみ差し替え）と判明し、**合計2件**が対象と確定した。他に複数回再定義されている関数（`guard_group_deletion`／`current_member_group_id`）もあったが、いずれも同じマイグレーション内でテーブル列追加等の既存kindで検知可能な変更を伴っており、対象から除外した（本文差し替えだけが唯一の変更点になっているのは上記2件のみ）。

### 追加事故：`projects.owner_member_ids`の型ドリフト

山本さんが実DBの型を確認した結果、`projects.owner_member_ids`の実DBが`uuid[]`（宣言は`20260331_add_missing_columns.sql`・`schema.sql`ともに一貫して`text[]`）のままドリフトしていたことが確定した。`projects.member_ids`／`tasks.assignee_member_ids`は宣言と実DBが一致していた（食い違いは1列のみ）。この型ずれが、2026-08-18のv3.75適用が「UNION types text and uuid cannot be matched」で2回失敗した原因だった。`supabase/migrations/20260819b_fix_owner_member_ids_type.sql`（新規・山本さんが手動適用）で`ALTER COLUMN owner_member_ids TYPE text[]`により是正した（NOT NULL・DEFAULT '{}'は明示的に再宣言。`20260818_harden_invite_related_rls.sql`の`unnest(...)::text`キャストはそのまま残す＝将来また型がずれても壊れない安全網として機能する）。`schema.sql`の該当列にドリフトと是正日のコメントを追記した。

### 実装

- **SQL側**：新規マイグレーション`supabase/migrations/20260819_add_schema_health_function_body_and_column_type_check.sql`（既存の`20260806_add_schema_health_check.sql`は書き換えず、`check_schema_health()`を`CREATE OR REPLACE`で拡張）。新kind`"function_body_contains"`は`pg_get_functiondef(p.oid)`で関数定義全文（本文含む）を取得し`position(needle IN ...)`で部分一致を判定する。新kind`"column_type"`は`information_schema.columns.udt_name`が期待値（配列は`"_text"`/`"_uuid"`等の内部表記）と一致するかを判定する。動的SQL（EXECUTE）は使わない。呼び出し権限（部署管理者・全社スーパー管理者のみ、それ以外は空配列）・`SET search_path=''`・既存kindの判定ロジックは1文字も変えていない。**適用回数を増やさないため2つのkindを1ファイルにまとめた**（山本さんの手動適用の手間を優先）。
- **TS側**：`src/lib/schema/schemaChecks.ts`に`SchemaCheckDescriptor`の新バリアント2つ（`kind:"function_body_contains"; name; needle` / `kind:"column_type"; table; column; udt`）と検査項目5件（本文差し替え型2件＋列の型3件＝`projects.owner_member_ids`／`projects.member_ids`／`tasks.assignee_member_ids`。**visible_project_member_ids()がUNIONする3列全てを登録**——1列だけ守っても次に別の列が同じ理由でずれたら同じ事故が起きるため）を追加。`src/lib/schema/checkSchemaHealth.ts`の`toCheckPayload`に対応するcaseを追加。`SchemaHealthBanner.tsx`はlabel/migrationを汎用的に表示するだけの実装のため無改修で両kindに対応済み。
- **`function_body_contains`のneedle選定方針**：変数名・コメント文言（消えやすい）ではなく、そのマイグレーションの核心的な振る舞いを表す実行文そのものを選んだ。
  - `accept_project_invite`：`v_invite.invite_group_id = ANY(COALESCE(v_existing_group_ids, '{}'::text[]))`（既存メンバーへの冪等な兼務付与判定。この式が無いとSection 25 Phase 5の冪等性要件が壊れる）。
  - `guard_member_privilege_columns`：`NEW.email := old_email;`（v3.75フェーズ4のemail保護の差し戻し文そのもの。これが無いと同一性判定キーの保護という主目的が成立しない）。
- **検証**：`src/lib/schema/__tests__/functionBodyContainsNeedles.test.ts`・`columnTypeChecks.test.ts`（いずれも新規）が、各needle/udtが「差し替え・是正前のマイグレーションファイルには存在せず、差し替え・是正後にのみ存在する」ことを実際のマイグレーションSQLテキストに対して固定する。作成時にそれぞれ一度、値を意図的に間違ったものへ差し替えてテストがredになることを確認し、正しい値に戻してgreenになることを確認した（Section 22の「わざと壊して赤くなることを確認する」記録）。

### やらないこと

- `supabase/schema.sql`は`check_schema_health`自体が元々未反映（既存ドリフト。Section 1の設計と無関係に長期間放置されている）のため、今回のスコープでは同期しない（`projects.owner_member_ids`列自体のコメント追記は別途実施済み。上記参照）。
- `task_dependencies`のRLSポリシー変更（Section 33参照）は今回のkind追加でも検知できない（「関数」ではなく「ポリシー」の中身を見る検査手段が無いため。将来別のkindが必要）。
- マイグレーションの適用は行っていない。山本さんがdev→prodの順でSupabase SQL Editorに手動適用する（3ファイルの適用順はSection 39参照）。

---

## 58. 🔴 グランドルール：機能を有効にする前に「それが前提を変えないか」を確認する（v3.112・2026-09-17）

### 何が起きたか

利用者から「サンプルモードでAIの資料インプットが使えない」と報告があった。原因は
**Supabase の Anonymous Sign-Ins が無効**（`422 anonymous_provider_disabled`）だったこと。
ゲストのAI利用は v3.29（2026-08-07）で実装されていたが、**Supabase側の設定が漏れており
約1.5か月間ずっと動いていなかった。** コードは正しかった。

🔴 **そして有効化した瞬間、別の場所にあった既知の弱点が危険になった。**

9テーブル（`quarterly_objectives` / `quarterly_kr_task_forces` / `kr_sessions` /
`kr_declarations` / `member_tags` / `kr_meeting_notes` / `kr_note_tf_entries` /
`okr_analyses` / `kr_reports`）は「認証さえ通れば誰でも読み書き可」のまま残っていた
（Section 1.6・Section 9のG「第2弾でまとめて対応する方針」）。

**これまでは「authenticated になれるのは社内の正規アカウントだけ」だったため実害が無かった。**
匿名サインインを有効にすると【誰でも authenticated になれる】。anonキーはクライアントに
埋め込まれる公開情報なので、URLさえ知っていれば誰でも匿名JWTを取得し、
これら9テーブルを読み書きできる状態になった（実データ59行）。

### 🔴 グランドルール

**外部サービスの設定を変えるとき、「それが今まで成り立っていた前提を壊さないか」を必ず確認する。**

このアプリのRLSの多くは `TO authenticated` で書かれており、**「authenticated ＝ 社内の人」
という暗黙の前提**の上に成り立っていた。匿名サインインはその前提を壊す。
コードもテストも変わっていないのに、**危険度だけが変わる。**

同種の前提に依存しているものは他にもある（本Section末尾の「外部前提のチェックリスト」）。

### 修正を3回外した記録（同じ失敗を繰り返さないため）

| 版 | やったこと | なぜ失敗したか |
|---|---|---|
| rev1 | `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)` で匿名を判定 | **JWTに `is_anonymous` クレームが入るか確認せずに書いた。** 入っていなければNULL→false→`NOT false = true`で**全員を通す**。弾くつもりの条件が、全員を通す条件になっていた |
| rev2 | 新しいポリシーを追加 | **`DROP POLICY` を名前決め打ちで書いた。** `schema.sql` にある `"authenticated full access"` しか消しておらず、DBの実体には **`authenticated_all`（`auth.role() = 'authenticated'`）** が残っていた。🔴 **PERMISSIVEポリシーはORで評価されるため、緩い方が勝つ** |
| rev3 | `pg_policies` から動的にDROP | **ネストした `DO` ブロック**（`FOR`の中に`FOR`）が SQL Editor で `42601 syntax error` になった |
| **rev4** | DROPは1段のループ・CREATEは9本を展開 | ✅ 成功 |

**3回とも「手元で確認できることを確認せず、動くはずだと考えて進めた」ことが原因。**
セキュリティの修正でこれをやると、**塞いだつもりで穴が開いたまま**になる。

### 確立した確認手順（次回はこの順でやる）

1. **`pg_policies` で実体を見る**（`schema.sql` の記述を信じない。別名のポリシーが残っている）
   ```sql
   select tablename, policyname, permissive, cmd, qual from pg_policies
    where schemaname='public' and tablename in (...) order by tablename;
   ```
2. **ポリシーが1テーブル1本になっているか数える**（2本あるとORで緩い方が勝つ）
3. **RLSを効かせた状態を模擬して、登録済み／匿名を比べる**（`rollback` するので安全）
   ```sql
   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"role":"authenticated","email":"<自分のemail>"}';
   select public.current_member_id(), (select count(*) from <table>);
   rollback;
   -- email を外したものを匿名として比較する
   ```
   🔴 **SQL Editor は `postgres` ロールで動き RLS を迂回する。** 素で `select count(*)` しても
   検証にならない（この罠に1度かかった）
4. **最後に本物の匿名JWTで REST API を叩き、レスポンス本文をそのまま見る**
   （件数の集計だけで判定しない。0件のテーブルは「遮断できた」ように見えてしまう）

### 採用した判定方法

`is_anonymous` クレームではなく **`current_member_id()`** を使う。

```sql
USING ((SELECT public.current_member_id()) IS NOT NULL)
```

この関数は `SELECT id FROM members WHERE email = auth.email() AND is_deleted = false` であり、
匿名ユーザーは `auth.email()` が NULL のため**必ず NULL を返す**。JWTのクレームに依存しない。
副次的に「認証は通ったが members に未登録の人」も弾ける（そちらも本来アクセスさせるべきでない）。

### 残した課題（2026-09-28 更新。経緯は `docs/dev/rls-phase2-investigation.md`）

- ✅ **9テーブルの部署スコープ化** … **8テーブル完了**（`migrations/20260928_scope_okr_peripheral_tables.sql`）。
  `member_tags` は全社共通マスタのため部署スコープ化の対象外（登録済みメンバーのみに締めたまま）
- ✅ **`groups.groups_select`** … `qual = true` から**登録済みメンバーのみ**（`current_member_id() IS NOT NULL`）へ変更済み
  （`migrations/20260928b_restrict_groups_tips_usage_insert.sql`）
- ✅ **`loading_tips.loading_tips_read`** … 同じく**登録済みメンバーのみ**へ変更済み（20260928b）
- ✅ **`ai_usage_logs` の INSERT** … **本人の member_id のみ**（ゲスト行は service_role の Edge Function だけが書く。20260928b）
- ✅ **B3：部署の Teams Webhook URL の分離**（v3.118）… その後 v3.136 で Teams 通知ごと撤去し、
  `group_notification_settings` も DROP した（`20261007b_remove_teams_notifications.sql`）。

### 🔴 外部前提のチェックリスト（コードにもテストにも現れないもの）

`schemaChecks.ts`（DBスキーマ）や `changelogVersion.test.ts`（4点セット）のような機械検査は
このリポジトリに複数あるが、**外部サービスの設定はどれにも引っかからない。**

| 前提 | 状態（2026-09-28時点） |
|---|---|
| Supabase の Anonymous Sign-Ins | ✅ 有効（**無効だったことが今回の発端**） |
| 匿名JWTで読めるテーブル | ✅ マイグレ 20260928・20260928b（2026-09-28）で OKR周辺8テーブルを部署スコープに、groups・loading_tips を登録済みのみに締めた（適用後の確認は `rls-phase2-investigation.md` §5-2・§10 の検証SQL） |
| 部署の Webhook URL の閲覧範囲 | ✅ v3.136 で表ごと撤去 |
| Edge Function secrets（`ANTHROPIC_API_KEY` / `ALLOWED_ORIGINS` / `*_CRON_SECRET` / `VAPID_*`） | ✅ 設定済み（`TEAMS_WEBHOOK_URL`・`NOTIFY_CRON_SECRET` は v3.136 で unset 対象） |
| `ALLOWED_ORIGINS` に本番ドメインが含まれるか | ⚠️ 未確認（AI相談が動いているので含まれるはず） |
| Teams の Power Automate フローが生きているか | ⚠️ 未確認（設定者個人の接続に依存・既知のリスク） |
| pg_cron の登録内容とシークレットの置き換え | ✅ 2026-09-17に確認 |
| Vercel の環境変数 | ⚠️ 未確認 |

**外部設定に依存する機能を実装したら、実装した本人が実機で1度は通しておくこと。**
今回は実装から1.5か月、誰も通していなかった。

---

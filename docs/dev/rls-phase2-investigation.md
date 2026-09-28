# RLS第2弾 調査メモ（2026-09-28）

対象：CLAUDE.md Section 58「残した課題」の4件（A：OKR周辺9テーブル／B：groups_select／C：loading_tips_read／D：ai_usage_logs のゲスト行）。
DBには接続していない。根拠はすべて `supabase/schema.sql`・`supabase/migrations/`・`src/`・`supabase/functions/` の読み取り。**live DB の実体は §5 の検証SQLで確認すること**（Section 58 手順1）。

成果物：
- マイグレ草案 `supabase/migrations/20260928_scope_okr_peripheral_tables.sql`（Aのうち8テーブルのみ。B・C・D・member_tags は含まない）
- `supabase/schema.sql` 同期（後述 §6）
- マイグレ2本目 `supabase/migrations/20260928b_restrict_groups_tips_usage_insert.sql`（B1・C2・D-INS。1本目とは独立して適用できる）

## 0. 緊急：B1 だけを今すぐ本番に貼る最小SQL

匿名JWTから全部署の `groups`（`teams_webhook_url` を含む）が読める穴を塞ぐ。SELECT ポリシーだけを差し替え、INSERT/UPDATE/DELETE のポリシーには触れない。20260928b にも同じ内容が入っているので、後から 20260928b を流しても問題ない（冪等）。

```sql
-- 想定クエリ名：groups_select を登録済みのみに締める（B1・緊急）
DO $drop_groups_select$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'groups' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.groups;', r.policyname);
  END LOOP;
END
$drop_groups_select$;

CREATE POLICY "groups_select" ON public.groups
  FOR SELECT TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL);

SELECT policyname, cmd, array_to_string(roles, ',') AS roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'groups'
 ORDER BY cmd, policyname;
```

確認：最後のSELECTで、SELECT が `groups_select` の1本だけであること。**cmd='ALL' の行があれば、それが OR で全員を通している**ので報告すること（書き込み権限も変わるため、このSQLでは自動で落としていない）。

## 決定事項（2026-09-28 山本さん）

| 論点 | 決定 | 反映先 |
|---|---|---|
| A-1 quarterly_objectives | 自前の group_id で判定（草案どおり） | 20260928 |
| A-2 member_tags | 現状維持（登録済みのみ） | 変更なし |
| B groups | B1 → B3 の二段階。今回は B1 のみ | 20260928b（B3 は §8 の設計案） |
| C loading_tips | C2 登録済みのみ | 20260928b |
| D ai_usage_logs | D-INS（INSERT を本人の member_id に限定）。SELECT 側は §5-3 で切り分けてから | 20260928b |

---

## 1. A：OKR周辺9テーブルの部署解決経路

### 1.1 テーブルごとの経路（schema.sql の列定義と backup-design.md §4 を照合）

| テーブル | 部署の決め方 | schema.sql の根拠 | backup-design §4 | 一致 |
|---|---|---|---|---|
| `quarterly_objectives` | 自前の `group_id` | `group_id text REFERENCES groups(id)`（20260723c） | 層A `group_id` | 一致 |
| `quarterly_kr_task_forces` | `quarterly_objective_id` → `quarterly_objectives.group_id` | 複合PK（qobj, kr, tf）。group_id 無し | 層B 親=quarterly_objectives | 一致 |
| `kr_sessions` | `kr_id` → `key_results.group_id` | `kr_id NOT NULL REFERENCES key_results` | 層B 親=key_results | 一致 |
| `kr_declarations` | `session_id` → `kr_sessions.kr_id` → `key_results.group_id` | `session_id NOT NULL REFERENCES kr_sessions`。`member_id` 列もあるがFKなし | 層B 親=kr_sessions | 一致 |
| `kr_meeting_notes` | `kr_id` → `key_results.group_id` | `kr_id NOT NULL` | 層B 親=key_results | 一致 |
| `kr_note_tf_entries` | `note_id` → `kr_meeting_notes.kr_id` → `key_results.group_id` | `note_id NOT NULL ... ON DELETE CASCADE`。`tf_id` もある | 層B 親=kr_meeting_notes | 一致 |
| `okr_analyses` | scope='kr' は `kr_id`、scope='objective' は `objective_id` → `objectives.group_id` | CHECK制約で一方だけが入る | 層B（objective_id も見る） | 一致 |
| `kr_reports` | `kr_id` → `key_results.group_id` | `kr_id NOT NULL` | 層B 親=key_results | 一致 |
| `member_tags` | **部署を持たない** | group_id 無し・member への FK 無し。`kind`（static/all_members/kr_members/tf_members）と `source_id`（KR/TFのid）だけ | **層C（全社共通）** | 一致 |

### 1.2 「個人データ＝ホーム部署か、兼務 group_ids か」の判定

**9テーブルに個人データは含まれない。** 依頼文の前提（member_tags は member に紐づく）は schema.sql と合わない。

- `member_tags` はタグの定義（名前・説明・種類）で、member への列を持たない。member に紐づくのは中間テーブル `member_tag_members` で、これは既に `member_tag_members_group`（`member_group_ids(member_id)`＝**兼務込みの group_ids**）でスコープ済み（本件の対象外）。
- `kr_declarations.member_id` は「誰が宣言したか」だが、行はKRセッションの一部（業務データ）。バックアップ設計でも層B（親=kr_sessions）で、ホーム部署ルール（`personal_*` 系・`member_widget_layouts`）の対象に入っていない。
- よって8テーブルは**業務データ＝KR／Objective の部署を、閲覧者の兼務込み `group_ids` と比べる**。これは `key_results_group` / `objectives_group`（`group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin()`）と同じ基準であり、「KRが見える人にはそのKRのセッション・ノート・レポートも見える」ことが保たれる。
- super_admin は objectives 等と同じく `OR (SELECT current_member_is_super_admin())` で全部署可。

### 1.3 マイグレ草案で採った形

- quarterly_objectives 以外は group_id 列を足さず、SECURITY DEFINER のヘルパーで親を辿る（`milestones_group` 等の先例と同じ流儀。列追加・バックフィル・トリガーが不要で、親KRの部署が変わっても自動で追随する）。
- 新設ヘルパー5本：`kr_group_id(text)` / `objective_group_id(text)` / `quarterly_objective_group_id(text)` / `kr_session_group_id(uuid)` / `kr_note_group_id(uuid)`。anon と PUBLIC から EXECUTE を剥がし、authenticated のみに付与。
- ポリシー式（Section 39 の `@>` 形式）：
  ```sql
  (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
  OR (SELECT public.current_member_is_super_admin())
  ```
  親が見つからない孤児行は `ARRAY[NULL]` になり `@>` が偽になる（§5-1 の `null_element_check` 行で実機確認する）。孤児行は super_admin だけが見える。
- DROP は pg_policies からの1段ループ、CREATE は8本を展開、1テーブル1ポリシー（Section 58 の rev2/rev3 の教訓）。全体を `BEGIN; ... COMMIT;` で包み、途中で失敗したら何も変わらない。

### 1.4 クライアントコードへの影響（壊れる経路の確認）

読み書き箇所は4ファイルのみ（`grep -rn 'from("<table>")' src supabase/functions`）。Edge Function からの参照は0件。

| ファイル | 読み書きのキー | 部署スコープ化の影響 |
|---|---|---|
| `src/lib/supabase/krSessionStore.ts` | `kr_id` / `session_id` / `id` | KR画面から開くため、KRが見える人には全件見える。影響なし |
| `src/lib/supabase/krMeetingNoteStore.ts` | `kr_id` / `note_id`（upsert onConflict note_id,tf_id） | 同上。upsert は USING と WITH CHECK の両方を通るが同一式なので影響なし |
| `src/lib/supabase/krReportStore.ts` | `kr_id` / `id` | 同上 |
| `src/lib/supabase/okrAnalysisStore.ts` | `kr_id` または `objective_id` | 同上 |
| `src/lib/supabase/store.ts:440` `upsertQuarterlyObjective` | 行の `group_id` | `OkrImportModal.tsx:300` が `group_id: targetGroupId` を送る。自分がアクセスできない部署を選ぶ操作はUI上起きない（super_admin は通る） |

確認した「部署をまたぐ経路」：
- **部署をまたいで一覧で読む画面**：無い。8テーブルとも「KR（またはObjective）を1つ選んで、そのidで引く」経路だけで、全KR横断の一覧は無い。
- **兼務者**：`current_member_group_ids()` が兼務込みの配列を返すため、key_results と同じ範囲が見える。
- **招待受諾者（ホーム部署＝招待用部署）**：既に `key_results_group` で招待元のKRは見えない（招待はPJ単位でKRを共有しない）。周辺テーブルも同じく見えなくなるだけで、今見えているものが消えることは無い。※現状（v3.112）は登録済みなら全部署分を読めるので、**招待受諾者が他部署のKR会議ノート等を REST で読めた穴がこれで塞がる**。
- **ゲスト（サンプルモード）**：`supabase/client.ts` の `assertGuestBlocked()` で `from()` が常に遮断される。影響なし。
- **Realtime**：8テーブルは publication 対象外（`20260518_realtime_publication.sql`）。影響なし。
- **バックアップ**：`backup_snapshot()` は SECURITY DEFINER（RLS 迂回）。影響なし。

### 1.5 判断が要る論点（A）

- **A-1：quarterly_objectives の判定列**。草案は自前の `group_id`（層A・objectives と同型）で判定する。クライアントが送る値なので「親Objectiveと違う部署を書き込める」余地は残る（ただし自分がアクセスできる部署に限る）。死蔵テーブルのため、草案のままを推奨。
  - 選択肢：(1) 草案のまま自前の group_id　(2) `objective_group_id(objective_id)` で親から判定
- **A-2：member_tags を部署スコープにするか**。現状は「登録済みなら全部署のタグ定義（名前・説明）が見える」。UIは全社共通マスタとして設計されている（`AdminView.tsx:114, 3128` のコメント）。
  - 選択肢：(1) 現状維持（草案はこちら。マイグレに含めていない）　(2) `group_id` 列を追加し作成者のホーム部署でバックフィル・RLSで絞る（列追加・フロント改修・既存タグの帰属判断が要る）　(3) kind=kr_members/tf_members だけ `source_id` のKR/TF部署で絞り、static は全社共通のまま

---

## 2. B：`groups.groups_select`（`USING (true)`）

### 2.1 🔴 現状のリスク（Section 58 の記述より重い）

`groups` には **`teams_webhook_url`** 列がある（`schema.sql:54`・20260703）。ポリシーは `FOR SELECT TO authenticated USING (true)` なので、**匿名サインインで得た JWT（role=authenticated）でも、全部署の Teams Webhook URL を REST で読める**。Webhook URL は知っていれば誰でもそのチャネルに投稿できる秘密情報である。§5-2 の `groups_webhook_set` 列で匿名から何件見えるかを確認できる。

### 2.2 groups を読む経路

| 経路 | 誰として読むか | 締めたときの影響 |
|---|---|---|
| `appStore.ts:579` `fetchGroups()`（起動時・`select("*")`） | 登録済みメンバー | 締め方しだい（下記） |
| ログイン前の LoginScreen（招待登録フォームを含む） | anon ロール（JWTなし） | 既に `TO authenticated` なので今も読めていない。影響なし |
| 招待受諾（`accept_project_invite` RPC・SECURITY DEFINER） | 未登録の authenticated | RPC内で完結。受諾後は `window.location.reload()`（`App.tsx:306`）で登録済みとして再取得する。影響なし |
| 初回セットアップ（`bootstrap_first_group_and_member` / `is_system_bootstrapped` RPC） | 未登録の authenticated | RPC内で完結。影響なし |
| サンプルモード（ゲスト） | `from()` を遮断 | 影響なし |
| `notify-deadlines` Edge Function | service_role | RLS迂回。影響なし |

登録済みメンバーが**他部署の** groups 行を使っている箇所：
- `AdminView.tsx:2536` メンバー編集の兼務先選択（全部署から選ぶ）
- `AdminView.tsx:2191` 他部署メンバーの部署名表示（v3.75で members の可視範囲が部署外に広がっている）
- `AdminView.tsx:1593, 2229, 3137, 3715` `is_invite_group` による招待用部署の判定（他部署PJの招待用部署を含む）
- `src/lib/projectInvite/sidebarGroupVisibility.ts` サイドバーの部署一覧（super_admin は全部署）

### 2.3 選択肢

| 案 | 内容 | 壊れる経路 | 評価 |
|---|---|---|---|
| **B1** | `USING ((SELECT public.current_member_id()) IS NOT NULL)`（登録済みは全件・匿名/未登録は0件） | 無し（上表のとおり未登録者は RPC 経由だけ） | 匿名からの Webhook URL 漏えいは止まる。**すぐ適用できる** |
| B2 | 自分の group_ids＋見えるPJの group_ids＋見えるメンバーの group_ids に絞る | 兼務先選択（2536）で他部署を選べなくなる。部署名が「（部署未設定）」表示になる箇所が出る | ヘルパー追加と UI 改修が要る |
| B3 | B1 に加え、`teams_webhook_url` を別テーブル（例：`group_settings`、admin/super のみ）へ移す | AdminView の部署編集（2724/2737/2769/2796）と notify-deadlines の読み先変更 | 登録済みの他部署メンバーから Webhook URL を隠せる。B1 だけでは登録済みなら全部署分が見える |

推奨：**B1 を先に単独で適用し、B3 は別途判断**。→ 2026-09-28 に決定。B1 の SQL は §0（単独・緊急用）と 20260928b に置いた。SELECT ポリシーだけを cmd で絞って落とし、INSERT/UPDATE/DELETE と cmd=ALL は巻き込まない（ALL が実体にあれば確認クエリで検出する）。

---

## 3. C：`loading_tips.loading_tips_read`（`USING (true)`）

- 読む経路は `appStore.ts:607` `fetchLoadingTips()` のみ（登録済みの起動時・fire-and-forget）。
- **サンプルモード（ゲスト）は DB から読まない**：`from()` が遮断され、`loadingTips.ts` の既定値と localStorage キャッシュで表示する。
- ログイン前のローディング画面もキャッシュと既定値で表示する（`appStore.ts:600` のコメント）。
- 中身は操作テクニックのヒント文で、機密性は低い。

| 案 | 内容 | 壊れる経路 |
|---|---|---|
| C1 | 現状維持（匿名JWTでもヒント文が読める） | 無し |
| C2 | `USING ((SELECT public.current_member_id()) IS NOT NULL)` | 無し（ゲスト・ログイン前は DB を読んでいない） |

どちらでも壊れる経路は無い。「匿名に何も見せない」を原則にするなら C2。B1 と同じ形なので、B1 と一緒に当てるのが手間が少ない。

---

## 4. D：ai_usage_logs のゲスト行が管理画面に出ない

### 4.1 関係するコード

- 記録：`supabase/functions/ai-consult/index.ts:287` が service_role で `member_id='__guest__', is_guest=true` を INSERT（失敗は `console.warn` のみ）。
- 取得：`store.ts:572` `fetchAiUsageLogs()` は `select("*")` を RLS 越しに実行（件数上限の指定なし）。
- 表示：`AdminView.tsx:3839` `guestSummary` は取得結果から `is_guest` を数え、**`count > 0` のときだけ行を出す**（3936行）。0件だと何も出ない。
- SELECTポリシー（schema.sql・20260723）：
  ```sql
  USING (public.can_access_group_ids(public.member_group_ids(member_id)))
  ```
  `can_access_group_ids(p)` ＝ `coalesce(p && current_member_group_ids(), false) OR current_member_is_super_admin()`。

### 4.2 仮説（確度の高い順）

1. **H1：RLSで部署管理者（super_admin でない人）には見えない。** `'__guest__'` という member は存在しないので `member_group_ids('__guest__')` が NULL → `coalesce(NULL && ..., false)` が false → **super_admin 以外には1行も返らない**。AI使用量タブは部署管理者にも出る（`AdminView.tsx:265` にsuper限定の条件が無い）ため、部署管理者の画面では常に出ない。設計（CLAUDE.md 1870行「部署の絞り込みは適用しない」）とポリシーが食い違っている。
2. **H2：そもそもゲスト行が記録されていない。** Anonymous Sign-Ins が 2026-09-17 まで無効だった（Section 58）ため、それ以前はゲストAIが1回も成功しておらず、行が0件のはず。super_admin で見ても出ないならこちら。09-17以降も0件なら、Edge Function 側の `SUPABASE_SERVICE_ROLE_KEY` 未設定などで INSERT が失敗している（`console.warn` のみで気づけない）。
3. H3：本番の実体に別名の SELECT ポリシーが残っている（drift）。§5-1 の出力で確認する。
4. （参考）`fetchAiUsageLogs()` は PostgREST の既定上限（1000行）で新しい順に切られる。ゲスト行は新しいので H3 より影響は小さいが、総件数が1000行を超えると古い月の集計が欠ける別の問題がある。

確認は §5-3 の SQL。**super_admin で `guest_visible` が総数と一致し、部署管理者で 0 なら H1**、総数自体が 0 なら H2。

### 4.3 あわせて見つかった穴（INSERT）

`ai_usage_logs_insert_authenticated` は `FOR INSERT TO authenticated WITH CHECK (true)`。**匿名JWTでも任意の `member_id`・`is_guest`・トークン数で行を捏造できる**（`from()` の遮断はクライアント側だけで、REST を直接叩けば通る）。AI使用量の集計・費用目安を汚せる。

### 4.4 選択肢（D）

| 案 | 内容 |
|---|---|
| D1 | SELECT を1本のまま条件を足す：`public.can_access_group_ids(public.member_group_ids(member_id)) OR (is_guest AND (SELECT public.current_member_is_admin()))`（部署管理者にゲスト行を全件見せる。ゲストはどの部署にも属さないので設計どおり） |
| D2 | 現状維持（ゲスト行は super_admin だけが見る）とし、UI 側で非superには「ゲスト利用はスーパー管理者のみ表示」と明記 |
| D-INS | INSERT を `WITH CHECK (member_id = (SELECT public.current_member_id()) AND is_guest = false)` に締める。service_role（Edge Function のゲスト記録）は RLS を迂回するので影響なし。**email 未設定で localStorage 経由ログインしている人は記録できなくなる**（その人は `current_member_id()` が NULL で、他のRLSでも既に何も見えていないはず） |

D の方針が決まるまでマイグレには入れていない。H1/H2 の切り分け（§5-3）を先に行うこと。

---

## 5. 検証SQL

いずれも Supabase SQL Editor で実行する。🔴 SQL Editor は postgres ロールで RLS を迂回するため、RLS の検証は §5-2 の `set local role authenticated` を使う（Section 58 手順3）。§5-2・§5-3 は書き込みを一切しない（末尾で rollback）。

### 5-1. 実体確認（適用前と適用後の両方で実行）

```sql
-- 想定クエリ名：RLS第2弾_実体確認
with t(tablename) as (
  values ('quarterly_objectives'), ('quarterly_kr_task_forces'), ('kr_sessions'), ('kr_declarations'),
         ('member_tags'), ('kr_meeting_notes'), ('kr_note_tf_entries'), ('okr_analyses'), ('kr_reports'),
         ('groups'), ('loading_tips'), ('ai_usage_logs')
)
select 'a_policy' as kind, p.tablename as target, p.policyname as name,
       p.permissive || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') as detail,
       'USING ' || coalesce(p.qual, '-') || ' / CHECK ' || coalesce(p.with_check, '-') as expr
  from pg_policies p join t on t.tablename = p.tablename
 where p.schemaname = 'public'
union all
select 'b_policy_count', t.tablename, count(p.policyname)::text,
       string_agg(p.cmd, ',' order by p.cmd), ''
  from t left join pg_policies p on p.schemaname = 'public' and p.tablename = t.tablename
 group by t.tablename
union all
select 'c_rls_enabled', c.relname, c.relrowsecurity::text, '', ''
  from pg_class c join t on t.tablename = c.relname
 where c.relnamespace = 'public'::regnamespace
union all
select 'd_helper_function', f.name, coalesce(string_agg(p.oid::regprocedure::text, ' ; '), 'なし'),
       coalesce(string_agg(case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end, ','), ''), ''
  from (values ('kr_group_id'), ('objective_group_id'), ('quarterly_objective_group_id'),
               ('kr_session_group_id'), ('kr_note_group_id'),
               ('current_member_id'), ('current_member_group_ids'), ('current_member_is_super_admin')) f(name)
  left join pg_proc p on p.proname = f.name and p.pronamespace = 'public'::regnamespace
 group by f.name
union all
select 'e_orphan', 'kr_sessions', count(*)::text, 'KRが無いかKRのgroup_idがNULL', ''
  from public.kr_sessions s left join public.key_results kr on kr.id = s.kr_id where kr.group_id is null
union all
select 'e_orphan', 'kr_declarations', count(*)::text, 'セッション→KRの部署が引けない', ''
  from public.kr_declarations d left join public.kr_sessions s on s.id = d.session_id
  left join public.key_results kr on kr.id = s.kr_id where kr.group_id is null
union all
select 'e_orphan', 'kr_meeting_notes', count(*)::text, 'KRが無いかKRのgroup_idがNULL', ''
  from public.kr_meeting_notes n left join public.key_results kr on kr.id = n.kr_id where kr.group_id is null
union all
select 'e_orphan', 'kr_note_tf_entries', count(*)::text, 'ノート→KRの部署が引けない', ''
  from public.kr_note_tf_entries e left join public.kr_meeting_notes n on n.id = e.note_id
  left join public.key_results kr on kr.id = n.kr_id where kr.group_id is null
union all
select 'e_orphan', 'okr_analyses', count(*)::text, 'KR/Objectiveの部署が引けない', ''
  from public.okr_analyses a left join public.key_results kr on kr.id = a.kr_id
  left join public.objectives o on o.id = a.objective_id where coalesce(kr.group_id, o.group_id) is null
union all
select 'e_orphan', 'kr_reports', count(*)::text, 'KRが無いかKRのgroup_idがNULL', ''
  from public.kr_reports r left join public.key_results kr on kr.id = r.kr_id where kr.group_id is null
union all
select 'e_orphan', 'quarterly_objectives', count(*)::text, 'group_idがNULL', ''
  from public.quarterly_objectives where group_id is null
union all
select 'e_orphan', 'quarterly_kr_task_forces', count(*)::text, '四半期Objectiveの部署が引けない', ''
  from public.quarterly_kr_task_forces q left join public.quarterly_objectives qo on qo.id = q.quarterly_objective_id
 where qo.group_id is null
union all
select 'f_rows_by_group', 'kr_sessions', coalesce(kr.group_id, '(NULL)'), count(*)::text, ''
  from public.kr_sessions s left join public.key_results kr on kr.id = s.kr_id group by kr.group_id
union all
select 'f_rows_by_group', 'kr_declarations', coalesce(kr.group_id, '(NULL)'), count(*)::text, ''
  from public.kr_declarations d left join public.kr_sessions s on s.id = d.session_id
  left join public.key_results kr on kr.id = s.kr_id group by kr.group_id
union all
select 'f_rows_by_group', 'kr_meeting_notes', coalesce(kr.group_id, '(NULL)'), count(*)::text, ''
  from public.kr_meeting_notes n left join public.key_results kr on kr.id = n.kr_id group by kr.group_id
union all
select 'f_rows_by_group', 'kr_reports', coalesce(kr.group_id, '(NULL)'), count(*)::text, ''
  from public.kr_reports r left join public.key_results kr on kr.id = r.kr_id group by kr.group_id
union all
select 'f_rows_by_group', 'okr_analyses', coalesce(coalesce(kr.group_id, o.group_id), '(NULL)'), count(*)::text, ''
  from public.okr_analyses a left join public.key_results kr on kr.id = a.kr_id
  left join public.objectives o on o.id = a.objective_id group by coalesce(kr.group_id, o.group_id)
union all
select 'g_groups_webhook_set', 'groups', count(*) filter (where teams_webhook_url is not null)::text,
       '件（URLの値は出力しない）', ''
  from public.groups
union all
select 'h_null_element_check', 'array', (array['x'] @> array[null::text])::text, 'falseであること', ''
order by 1, 2, 3;
```

適用後に確認すること：`b_policy_count` で8テーブルがそれぞれ1本（ALL）・member_tags が1本、`a_policy` の式が `current_member_group_ids()` と `@>` を含むこと、`d_helper_function` で5本が SECURITY DEFINER で存在すること、`h_null_element_check` が false。`e_orphan` が0でないテーブルは、その行が super_admin 以外から見えなくなる。

### 5-2. RLSを効かせた比較（適用前と適用後の両方で実行し、visible を比べる）

人物は postgres 権限で自動選定する（自部署＝kr_sessions が最も多い部署）。該当者がいない人物は `email` が空になり、未登録者と同じ結果になる。`expected` は適用後のポリシーを RLS 抜きの JOIN で再計算した値（groups/loading_tips/member_tags/ai_usage_logs は現行ポリシーの想定値）。

```sql
-- 想定クエリ名：RLS第2弾_人物別の見え方比較
begin;

select set_config('rlst.home', coalesce((
  select kr.group_id from public.kr_sessions s join public.key_results kr on kr.id = s.kr_id
   where kr.group_id is not null group by kr.group_id order by count(*) desc limit 1), ''), true);

select set_config('rlst.e1', coalesce((
  select m.email from public.members m
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
     and m.group_ids = array[current_setting('rlst.home')]
   order by m.id limit 1), ''), true);
select set_config('rlst.e2', coalesce((
  select m.email from public.members m join public.groups g on g.id = m.group_id
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
     and not g.is_invite_group and not (m.group_ids @> array[current_setting('rlst.home')])
   order by m.id limit 1), ''), true);
select set_config('rlst.e3', coalesce((
  select m.email from public.members m
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
     and cardinality(m.group_ids) > 1
   order by (m.group_ids @> array[current_setting('rlst.home')]) desc, m.id limit 1), ''), true);
select set_config('rlst.e4', coalesce((
  select m.email from public.members m
   where not m.is_deleted and coalesce(m.email, '') <> '' and coalesce(m.is_super_admin, false)
   order by m.id limit 1), ''), true);
select set_config('rlst.e5', '', true);
select set_config('rlst.e6', coalesce((
  select m.email from public.members m join public.groups g on g.id = m.group_id
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
     and g.is_invite_group
   order by m.id limit 1), ''), true);
select set_config('rlst.e7', coalesce((
  select m.email from public.members m
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
     and coalesce(m.is_admin, false)
   order by (m.group_ids @> array[current_setting('rlst.home')]) desc, m.id limit 1), ''), true);

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e1'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r1', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e2'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r2', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e3'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r3', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e4'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r4', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'is_anonymous', true, 'sub', gen_random_uuid())::text, true);
set local role authenticated;
select set_config('rlst.r5', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e6'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r6', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.e7'), ''))::text, true);
set local role authenticated;
select set_config('rlst.r7', json_build_object(
  'member_id', public.current_member_id(),
  'quarterly_objectives', (select count(*) from public.quarterly_objectives),
  'quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces),
  'kr_sessions', (select count(*) from public.kr_sessions),
  'kr_declarations', (select count(*) from public.kr_declarations),
  'kr_meeting_notes', (select count(*) from public.kr_meeting_notes),
  'kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries),
  'okr_analyses', (select count(*) from public.okr_analyses),
  'kr_reports', (select count(*) from public.kr_reports),
  'member_tags', (select count(*) from public.member_tags),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips),
  'ai_usage_logs_guest', (select count(*) from public.ai_usage_logs where is_guest)
)::text, true);
reset role;

with p(no, label, email) as (
  values (1, '1_自部署メンバー', nullif(current_setting('rlst.e1'), '')),
         (2, '2_他部署メンバー', nullif(current_setting('rlst.e2'), '')),
         (3, '3_兼務者', nullif(current_setting('rlst.e3'), '')),
         (4, '4_super_admin', nullif(current_setting('rlst.e4'), '')),
         (5, '5_匿名', null::text),
         (6, '6_招待受諾者', nullif(current_setting('rlst.e6'), '')),
         (7, '7_部署管理者(非super)', nullif(current_setting('rlst.e7'), ''))
),
m as (
  select p.no, p.label, p.email, current_setting('rlst.r' || p.no)::jsonb as v,
         mm.group_ids as gids, coalesce(mm.is_super_admin, false) as sup, (mm.id is not null) as registered
    from p left join public.members mm on mm.email = p.email and not mm.is_deleted
)
select m.no, m.label, coalesce(m.email, '') as email, coalesce(m.gids::text, '') as group_ids, m.sup as super_admin,
       m.v ->> 'member_id' as member_id_seen, x.tbl, (m.v ->> x.tbl)::bigint as visible, x.expected,
       case when (m.v ->> x.tbl)::bigint = x.expected then 'OK' else 'DIFF' end as judge
  from m
 cross join lateral (values
   ('quarterly_objectives', (select count(*) from public.quarterly_objectives q
      where m.sup or q.group_id = any(m.gids))),
   ('quarterly_kr_task_forces', (select count(*) from public.quarterly_kr_task_forces q
      left join public.quarterly_objectives qo on qo.id = q.quarterly_objective_id
      where m.sup or qo.group_id = any(m.gids))),
   ('kr_sessions', (select count(*) from public.kr_sessions s left join public.key_results kr on kr.id = s.kr_id
      where m.sup or kr.group_id = any(m.gids))),
   ('kr_declarations', (select count(*) from public.kr_declarations d left join public.kr_sessions s on s.id = d.session_id
      left join public.key_results kr on kr.id = s.kr_id where m.sup or kr.group_id = any(m.gids))),
   ('kr_meeting_notes', (select count(*) from public.kr_meeting_notes n left join public.key_results kr on kr.id = n.kr_id
      where m.sup or kr.group_id = any(m.gids))),
   ('kr_note_tf_entries', (select count(*) from public.kr_note_tf_entries e left join public.kr_meeting_notes n on n.id = e.note_id
      left join public.key_results kr on kr.id = n.kr_id where m.sup or kr.group_id = any(m.gids))),
   ('okr_analyses', (select count(*) from public.okr_analyses a left join public.key_results kr on kr.id = a.kr_id
      left join public.objectives o on o.id = a.objective_id where m.sup or coalesce(kr.group_id, o.group_id) = any(m.gids))),
   ('kr_reports', (select count(*) from public.kr_reports r left join public.key_results kr on kr.id = r.kr_id
      where m.sup or kr.group_id = any(m.gids))),
   ('member_tags', case when m.registered then (select count(*) from public.member_tags) else 0 end),
   ('groups', (select count(*) from public.groups)),
   ('groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null)),
   ('loading_tips', (select count(*) from public.loading_tips)),
   ('ai_usage_logs_guest', case when m.sup then (select count(*) from public.ai_usage_logs where is_guest) else 0 end)
 ) as x(tbl, expected)
 order by m.no, x.tbl;

rollback;
```

読み方：
- **適用前**は8テーブルで「登録済みの人物は全件（自部署以外も）」が見え、`expected` と食い違う行が `DIFF` になる。これが今回塞ぐ範囲。
- **適用後**は全行 `OK` であること。特に「2_他部署メンバー」「6_招待受諾者」で自部署の件数が消え、「3_兼務者」で兼務先の分が見え、「5_匿名」は8テーブルとも0件。
- `groups` / `groups_webhook_set` / `loading_tips` は B・C 未対応のため、5_匿名でも全件が見える（`OK` と出るのは現行ポリシーの想定どおりという意味で、安全という意味ではない）。
- `ai_usage_logs_guest` の `expected` は仮説H1（super_admin だけが見える）での値。7_部署管理者で `OK`（=0）なら H1 が確定。
- 結果が表示されない場合は末尾の `rollback;` を外して実行してよい（このSQLは書き込みをしない。`set local` と `set_config(..., true)` はトランザクション終了で消える）。

### 5-3. D の切り分け（postgres 権限で実行）

```sql
-- 想定クエリ名：ai_usage_logs_ゲスト行の実在確認
select 'a_guest_rows_by_month' as kind, to_char(called_at at time zone 'Asia/Tokyo', 'YYYY-MM') as k,
       count(*)::text as v, min(called_at)::text as first_at, max(called_at)::text as last_at
  from public.ai_usage_logs where is_guest group by 2
union all
select 'b_guest_rows_total', 'is_guest=true', count(*)::text, '', '' from public.ai_usage_logs where is_guest
union all
select 'c_guest_member_id_rows', '__guest__', count(*)::text, 'is_guest=falseのまま__guest__で入った行', ''
  from public.ai_usage_logs where member_id = '__guest__' and not is_guest
union all
select 'd_all_rows_total', 'ai_usage_logs', count(*)::text, '1000超なら管理画面の取得が切れる', '' from public.ai_usage_logs
union all
select 'e_policy', policyname, cmd || ' ' || array_to_string(roles, ','),
       'USING ' || coalesce(qual, '-'), 'CHECK ' || coalesce(with_check, '-')
  from pg_policies where schemaname = 'public' and tablename = 'ai_usage_logs'
union all
select 'f_guest_quota_days', usage_date::text, call_count::text, 'ゲストAIの全体カウンタ（成功した呼び出し数）', ''
  from public.guest_ai_usage_global_daily
order by 1, 2;
```

- `b_guest_rows_total` が0で `f_guest_quota_days` に回数がある → ゲストAIは成功しているのにログINSERTが失敗している（H2後段。Edge Function のログで `guest usage log insert failed` を確認）。
- どちらも0 → ゲストAIがまだ1回も成功していない（H2前段）。
- `b` が1以上で、§5-2 の 7_部署管理者が0・4_super_admin が一致 → H1。
- `e_policy` に SELECT が2本以上 → H3（drift）。

---

## 6. schema.sql の同期内容

- 旧「全員フルアクセス」ブランケットループ（9テーブルに `USING (true)`）を撤去し、経緯のコメントに置き換えた。v3.112（20260917c）の時点で live DB からは消えていたが schema.sql に残っていた（drift）。
- member_tags：`member_tags_registered_members_only`（20260917c と同じ式）を `current_member_id()` 定義の後に追加。
- 8テーブル：ヘルパー5本とポリシー8本を kr_quarter_plans ブロックの直後に追加（`current_member_group_ids()` / `current_member_is_super_admin()` 定義より後）。DROP は既知の旧名（`authenticated full access` / `authenticated_all` / `*_registered_members_only` / 新名）を列挙。

- 20260928b：`groups_select` と `loading_tips_read` を登録済みのみに、ai_usage_logs の INSERT を `ai_usage_logs_insert_own` に置き換えた。`loading_tips_read` は `current_member_id()` を参照するため、その関数定義の後（member_tags ブロックの直後）へ移した（CREATE POLICY の時点で関数が存在している必要がある）。

未対応で気づいたこと（本件の範囲外）：`entity_change_logs`（20260917b）のテーブル定義とポリシーが schema.sql に無い。

## 7. 適用手順（山本さん）

1. dev で §5-1 と §5-2 を実行して結果を控える（適用前）
2. dev で `20260928_scope_okr_peripheral_tables.sql` を全文実行
3. dev で §5-1・§5-2 を再実行し、8テーブルが1本ずつ・全行 `OK` を確認
4. dev のアプリで KR会議ノート／KRレポート／KR分析／チェックイン（宣言を含む）を開き、読み書きできることを確認（兼務者のアカウントがあれば兼務先のKRでも）
5. prod で 1〜4 を繰り返す
6. Section 58 手順4：本物の匿名JWTで REST を叩き、8テーブルが `[]` を返すことを確認

20260928b も同じ流れ（dev → prod）。適用前後に §9（棚卸し）と §10（確認）を実行する。B1 だけ先に本番に当てる場合は §0。

---

## 8. B3 設計案：`teams_webhook_url` を管理者専用テーブルへ移す（未実装）

B1 だけでは、登録済みメンバーなら他部署の Webhook URL も読める（groups は部署名の表示に全部署分が要るため、行ごとには絞れない。§2.2）。URL の列だけを別テーブルに分けて、そこを管理者に絞る。

### 8.1 新テーブル

```sql
CREATE TABLE IF NOT EXISTS group_notification_settings (
  group_id          text PRIMARY KEY REFERENCES groups(id),
  teams_webhook_url text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL DEFAULT ''
);
ALTER TABLE group_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_notification_settings_admin" ON group_notification_settings
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_is_super_admin())
    OR ((SELECT public.current_member_is_admin()) AND group_id = (SELECT public.current_member_group_id()))
  )
  WITH CHECK (
    (SELECT public.current_member_is_super_admin())
    OR ((SELECT public.current_member_is_admin()) AND group_id = (SELECT public.current_member_group_id()))
  );
```

判定は `groups_update_admin`（super_admin、または自部署の admin）と同じにする。今 URL を編集できる人だけが読める。

### 8.2 変更箇所

| 箇所 | 現状 | 変更 |
|---|---|---|
| `supabase/functions/notify-deadlines/index.ts:112` | `groups` から `id, name, teams_webhook_url` を取得 | `groups` から `id, name`、`group_notification_settings` から `group_id, teams_webhook_url` を取得して結合する。service_role なので RLS の影響は無い |
| `src/components/admin/AdminView.tsx` GroupsSection（2724 フォーム初期値／2737・2769 保存／2796 設定済み件数） | `Group.teams_webhook_url` を読み書きし、`saveGroup()` が groups 行に含めて保存 | 設定を別に取得して保持し、保存は `group_notification_settings` への upsert に分ける。件数は取得した設定から数える。部署管理者には自部署の分しか返らないので、他部署の件数は出なくなる（表示文言の見直しが要る） |
| `src/lib/supabase/store.ts` | groups の `saveWithLock` のみ | 設定の fetch / upsert 関数を追加 |
| `src/lib/localData/types.ts:12` | `Group.teams_webhook_url?` | 型から外し、設定用の型を別に作る |
| `src/lib/schema/schemaChecks.ts` | なし | 新テーブルの存在チェックを追加（未適用環境で管理画面が壊れないように） |
| `supabase/schema.sql:54` | `ALTER TABLE groups ADD COLUMN teams_webhook_url` | 列の削除と新テーブル定義に置き換える |

### 8.3 移行手順（デプロイの順序が重要）

1. **マイグレ①**：新テーブルと RLS を作成し、`INSERT INTO group_notification_settings (group_id, teams_webhook_url, updated_by) SELECT id, teams_webhook_url, 'migration' FROM groups WHERE teams_webhook_url IS NOT NULL ON CONFLICT (group_id) DO NOTHING;` で複写する。groups 側の列はまだ残す。
2. **notify-deadlines をデプロイ**（新テーブルを読む）。翌回の実行で部署別に送信できていることを確認する。
3. **フロントをデプロイ**（新テーブルを読み書きし、groups 行に `teams_webhook_url` を含めない）。
4. **マイグレ②**：`UPDATE groups SET teams_webhook_url = NULL;` の後に `ALTER TABLE groups DROP COLUMN teams_webhook_url;`。🔴 3 より先に流すと、旧フロントの `saveGroup()` が存在しない列を送って部署の保存が失敗する（マイグレとデプロイの順序の事故と同じ型）。
5. §9 の棚卸しSQLと、匿名・他部署メンバーで `group_notification_settings` が0件になることを確認する。

注意：URL は匿名から読めた期間がある（2026-09-17 の匿名サインイン有効化から B1 適用まで）。漏えいしていないとは言い切れないため、**B3 の完了後に各部署の Webhook を Power Automate 側で再発行し、新しい URL を登録し直すことを推奨**する。

---

## 9. 棚卸しSQL：public 全テーブルの「無条件ポリシー」と「RLS無効」

schema.sql には `todos` / `project_analyses` / `tf_meeting_notes` / `okr_tf_analyses` にも `USING (true)` の履歴がある。今の live DB でどうなっているか、1本目の9テーブルの外に穴が無いかを確認する。

```sql
-- 想定クエリ名：RLS棚卸し_無条件ポリシーとRLS無効
with tbl as (
  select c.oid, c.relname, c.relrowsecurity
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
pol as (
  select p.tablename, p.policyname, p.permissive, p.cmd, array_to_string(p.roles, ',') as roles,
         coalesce(p.qual, '-') as qual, coalesce(p.with_check, '-') as with_check
    from pg_policies p where p.schemaname = 'public'
)
select '1_rls_disabled' as kind, t.relname::text as table_name, '' as policy, '' as cmd, '' as roles,
       'RLS無効＝全ロールが素通し' as detail
  from tbl t where not t.relrowsecurity
union all
select '2_unconditional_policy', p.tablename::text, p.policyname::text, p.cmd, p.roles,
       'USING ' || p.qual || ' / CHECK ' || p.with_check
  from pol p
 where lower(replace(p.qual, ' ', '')) in ('true', '(true)')
    or lower(replace(p.with_check, ' ', '')) in ('true', '(true)')
union all
select '3_role_only_policy', p.tablename::text, p.policyname::text, p.cmd, p.roles,
       'USING ' || p.qual || ' / CHECK ' || p.with_check
  from pol p
 where p.qual ilike '%auth.role()%' or p.with_check ilike '%auth.role()%'
union all
select '4_anon_or_public_role', p.tablename::text, p.policyname::text, p.cmd, p.roles,
       'USING ' || p.qual || ' / CHECK ' || p.with_check
  from pol p
 where p.roles like '%anon%' or p.roles like '%public%'
union all
select '5_insert_without_check', p.tablename::text, p.policyname::text, p.cmd, p.roles, 'INSERTでWITH CHECKなし'
  from pol p
 where p.cmd = 'INSERT' and p.with_check = '-'
union all
select '6_all_without_check', p.tablename::text, p.policyname::text, p.cmd, p.roles,
       'FOR ALLでWITH CHECK省略（USINGが書き込み判定を兼ねる）USING ' || p.qual
  from pol p
 where p.cmd = 'ALL' and p.with_check = '-'
union all
select '7_rls_enabled_no_policy', t.relname::text, '', '', '', 'RLS有効・ポリシー0本＝authenticatedからは全拒否（意図的か確認）'
  from tbl t
 where t.relrowsecurity and not exists (select 1 from pol p where p.tablename = t.relname)
union all
select '8_history_tables', h.name,
       case when t.oid is null then '(テーブル無し)' else coalesce(string_agg(p.policyname::text, ' ; '), '(ポリシー無し)') end,
       case when t.oid is null then '' else coalesce(string_agg(p.cmd, ','), '') end,
       '',
       case when t.oid is null then '' else 'RLS=' || t.relrowsecurity::text || ' / ' || coalesce(string_agg(p.qual, ' ; '), '') end
  from (values ('todos'), ('project_analyses'), ('tf_meeting_notes'), ('okr_tf_analyses')) h(name)
  left join tbl t on t.relname = h.name
  left join pol p on p.tablename = h.name
 group by h.name, t.oid, t.relrowsecurity
union all
select '9_multiple_permissive_same_cmd', p.tablename::text, string_agg(p.policyname::text, ' ; '), p.cmd, '',
       count(*)::text || '本（PERMISSIVEはORで緩い方が勝つ）'
  from pol p
 where p.permissive = 'PERMISSIVE'
 group by p.tablename, p.cmd
having count(*) > 1
order by 1, 2, 3;
```

読み方：
- `1_rls_disabled`・`2_unconditional_policy`・`3_role_only_policy`（`auth.role() = 'authenticated'` は匿名も通す）が穴の候補。20260928・20260928b の適用後に 0 行になるのが目標。残った行はテーブルごとに判断する。
- `4_anon_or_public_role`：`TO public` のポリシーは匿名JWT・anon キーの両方に効く。
- `9_multiple_permissive_same_cmd` は同じ cmd に2本以上。`ALL` と `SELECT` の重なり（例：`loading_tips_write` と `loading_tips_read`）はここには出ないので、該当テーブルは §5-1 の `a_policy` を併読する。
- `6_all_without_check` は milestones_group 等の既知のもの（USING が書き込み判定を兼ねる）。穴ではないが一覧として残す。
- `7_rls_enabled_no_policy` のうち `guest_ai_usage_daily` / `guest_ai_usage_global_daily` は意図的（service_role 専用）。

---

## 10. 検証SQL：20260928b（B1・C2・D-INS）の適用後確認

登録済み（super_admin でない、email 一致でログインできる人）と匿名を比べる。INSERT の成否は DO ブロック内の例外で捕まえ、結果を `set_config` に退避する。末尾の rollback で試験用に入れた行は残らない。

```sql
-- 想定クエリ名：20260928b適用後_groups_tips_ai_usage_insert確認
begin;

select set_config('rlst.self_email', coalesce((
  select m.email from public.members m
   where not m.is_deleted and coalesce(m.email, '') <> '' and not coalesce(m.is_super_admin, false)
   order by m.id limit 1), ''), true);
select set_config('rlst.self_id', coalesce((
  select m.id from public.members m
   where m.email = current_setting('rlst.self_email') and not m.is_deleted limit 1), ''), true);
select set_config('rlst.other_id', coalesce((
  select m.id from public.members m
   where not m.is_deleted and m.id <> current_setting('rlst.self_id')
   order by m.id limit 1), ''), true);
select set_config('rlst.reg_ins_own', 'not run', true);
select set_config('rlst.reg_ins_other', 'not run', true);
select set_config('rlst.reg_ins_guest', 'not run', true);
select set_config('rlst.anon_ins_guest', 'not run', true);
select set_config('rlst.anon_ins_other', 'not run', true);

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', nullif(current_setting('rlst.self_email'), ''))::text, true);
set local role authenticated;
select set_config('rlst.reg_read', json_build_object(
  'member_id', public.current_member_id(),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips)
)::text, true);
do $t_reg_own$
begin
  insert into public.ai_usage_logs (member_id, consultation_type, input_tokens, output_tokens)
  values (current_setting('rlst.self_id'), 'rls-test', 0, 0);
  perform set_config('rlst.reg_ins_own', 'inserted', true);
exception
  when insufficient_privilege then perform set_config('rlst.reg_ins_own', 'denied', true);
  when others then perform set_config('rlst.reg_ins_own', 'error ' || sqlstate, true);
end
$t_reg_own$;
do $t_reg_other$
begin
  insert into public.ai_usage_logs (member_id, consultation_type, input_tokens, output_tokens)
  values (current_setting('rlst.other_id'), 'rls-test', 0, 0);
  perform set_config('rlst.reg_ins_other', 'inserted', true);
exception
  when insufficient_privilege then perform set_config('rlst.reg_ins_other', 'denied', true);
  when others then perform set_config('rlst.reg_ins_other', 'error ' || sqlstate, true);
end
$t_reg_other$;
do $t_reg_guest$
begin
  insert into public.ai_usage_logs (member_id, consultation_type, input_tokens, output_tokens, is_guest)
  values (current_setting('rlst.self_id'), 'rls-test', 0, 0, true);
  perform set_config('rlst.reg_ins_guest', 'inserted', true);
exception
  when insufficient_privilege then perform set_config('rlst.reg_ins_guest', 'denied', true);
  when others then perform set_config('rlst.reg_ins_guest', 'error ' || sqlstate, true);
end
$t_reg_guest$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'is_anonymous', true, 'sub', gen_random_uuid())::text, true);
set local role authenticated;
select set_config('rlst.anon_read', json_build_object(
  'member_id', public.current_member_id(),
  'groups', (select count(*) from public.groups),
  'groups_webhook_set', (select count(*) from public.groups where teams_webhook_url is not null),
  'loading_tips', (select count(*) from public.loading_tips)
)::text, true);
do $t_anon_guest$
begin
  insert into public.ai_usage_logs (member_id, consultation_type, input_tokens, output_tokens, is_guest)
  values ('__guest__', 'rls-test', 0, 0, true);
  perform set_config('rlst.anon_ins_guest', 'inserted', true);
exception
  when insufficient_privilege then perform set_config('rlst.anon_ins_guest', 'denied', true);
  when others then perform set_config('rlst.anon_ins_guest', 'error ' || sqlstate, true);
end
$t_anon_guest$;
do $t_anon_other$
begin
  insert into public.ai_usage_logs (member_id, consultation_type, input_tokens, output_tokens)
  values (current_setting('rlst.other_id'), 'rls-test', 0, 0);
  perform set_config('rlst.anon_ins_other', 'inserted', true);
exception
  when insufficient_privilege then perform set_config('rlst.anon_ins_other', 'denied', true);
  when others then perform set_config('rlst.anon_ins_other', 'error ' || sqlstate, true);
end
$t_anon_other$;
reset role;

select x.persona, x.check_name, x.actual, x.expected,
       case when x.expected = '(not empty)' then case when x.actual <> '' then 'OK' else 'DIFF' end
            when x.actual = x.expected then 'OK' else 'DIFF' end as judge
  from (values
    ('1_registered', 'email', current_setting('rlst.self_email'), '(not empty)'),
    ('1_registered', 'member_id_seen', coalesce(current_setting('rlst.reg_read')::jsonb ->> 'member_id', ''), current_setting('rlst.self_id')),
    ('1_registered', 'groups_visible', current_setting('rlst.reg_read')::jsonb ->> 'groups', (select count(*) from public.groups)::text),
    ('1_registered', 'loading_tips_visible', current_setting('rlst.reg_read')::jsonb ->> 'loading_tips', (select count(*) from public.loading_tips)::text),
    ('1_registered', 'insert_own_member_id', current_setting('rlst.reg_ins_own'), 'inserted'),
    ('1_registered', 'insert_other_member_id', current_setting('rlst.reg_ins_other'), 'denied'),
    ('1_registered', 'insert_is_guest_true', current_setting('rlst.reg_ins_guest'), 'denied'),
    ('2_anonymous', 'member_id_seen', coalesce(current_setting('rlst.anon_read')::jsonb ->> 'member_id', ''), ''),
    ('2_anonymous', 'groups_visible', current_setting('rlst.anon_read')::jsonb ->> 'groups', '0'),
    ('2_anonymous', 'groups_webhook_visible', current_setting('rlst.anon_read')::jsonb ->> 'groups_webhook_set', '0'),
    ('2_anonymous', 'loading_tips_visible', current_setting('rlst.anon_read')::jsonb ->> 'loading_tips', '0'),
    ('2_anonymous', 'insert_guest_row', current_setting('rlst.anon_ins_guest'), 'denied'),
    ('2_anonymous', 'insert_other_member_id', current_setting('rlst.anon_ins_other'), 'denied')
  ) as x(persona, check_name, actual, expected)
 order by 1, 2;

rollback;
```

読み方：全行 OK であること。**適用前**に流すと、2_anonymous の groups / loading_tips が全件、insert 系が inserted になり、穴の実在を確認できる（rollback するので行は残らない）。`error 23503` 等が出た場合は FK などRLS以外の理由なので、その行は個別に確認する。

### 10.1 D-INS の根拠（コードで確認した事実）

- クライアントの INSERT は2経路。`src/lib/ai/usageLog.ts` の `logAIUsage()` は `getCurrentUser().id`（localStorage）、`src/hooks/useAIConsultation.ts:174` は `ConsultationPanel.tsx:125` から渡る `currentUser.id`。どちらも `App.tsx:106` の `setCurrentUser(member.id)` で入る `members.id`。email 一致（autoMatch ①）でログインした人は、`current_member_id()`（`email = auth.email() AND is_deleted = false`）が返す行と同じ id になる。
- 例外：email 未設定で UserSelectScreen から選んだ人、members.email と Auth のメールが大文字小文字だけ違う人（クライアントは `toLowerCase()` で比べるが `current_member_id()` は完全一致）は `current_member_id()` が NULL になり、記録できなくなる。記録失敗は `console.warn` だけで、AI機能自体は止まらない。この人たちは部署スコープの他のRLSでも既に何も見えていない。
- ゲスト行は `supabase/functions/ai-consult/index.ts:169` の `createClient(supabaseUrl, serviceRoleKey)`（service_role）で書くため RLS の対象外。ai_usage_logs に INSERT している Edge Function は ai-consult だけ。

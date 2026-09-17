-- ============================================================
-- 日次バックアップ フェーズ1（DB層）
-- 2026-09-16
--
-- 正本：docs/dev/backup-design.md（rev4）。本ファイルはその §3.1・§4・§6・§8・§10 を
-- 実装したもの。設計の変更はしていない。実装にあたり明示されていなかった箇所を
-- 埋めた判断は各所のコメントに明記した（詳細は作業報告を参照）。
--
-- 【このマイグレーションで作るもの】
-- 1. Storage バケット backups（private）
-- 2. 表3本：backup_runs / backup_objects / backup_exports
-- 3. RLS：3表とも有効化。SELECTはsuper-adminのみ、書き込みはservice_roleのみ
--    （書き込みポリシーは意図的に作らない＝service_role以外は書けない。
--    guest_ai_usage_daily等と同じ流儀。§8）
-- 4. 関数3本：backup_begin() / backup_snapshot(p_scope, p_group_id, p_run_id) /
--    backup_finalize(p_run_id)（§3.1）。いずれもSECURITY DEFINER・service_role専用
-- 5. Storageのクライアント向けポリシーは作らない（§10：全面拒否）
--
-- 【フェーズ2以降（Edge Function・pg_cron・通知・二次保管・復元訓練）はこのファイルの
-- 範囲外。docs/dev/backup-design.md §12参照】
--
-- 【重要な実装上の判断（設計書に明記が無く、実装のために補った点）】
-- a) backup_begin() / backup_finalize(p_run_id) は、設計書のプロセス上どうしても
--    「cron/manual の別」「実行結果のstatus」をDB関数の外（Edge Function）から
--    受け取る必要があるため、両関数とも後方互換のデフォルト引数を追加した
--    （backup_begin(p_trigger DEFAULT 'cron', p_triggered_by DEFAULT NULL)、
--    backup_finalize(p_run_id, p_status DEFAULT 'success', p_error_message DEFAULT NULL)）。
--    どちらも設計書が示す呼び出し形（引数なし／run_idのみ）のままでも呼べる。
-- b) backup_objects への行の記録は、この3関数のどれも行わない。Edge Function が
--    Storageへのput成功後、service_roleクライアントで直接INSERTする設計とした
--    （service_roleはRLSを迂回するため、記録用の関数を別途作る必要がない。
--    consume_guest_ai_quota等と同じ「service_role専用の書き込みはRLSに任せる」流儀）。
--    backup_finalize はその記録を読んで保持ポリシー（§6のGFS）を評価するだけ。
-- c) 保持タグ（daily/weekly/monthly/quarterly）の昇格は、日付の境界判定を
--    Asia/Tokyo で行う（🔴重要）。pg_cronのバックアップ起動はUTC 18:00＝JST翌3:00
--    なので、taken_atをUTCのまま曜日・日付判定すると「月曜JST」が「日曜UTC」に
--    ずれて誤判定する。AT TIME ZONE 'Asia/Tokyo' で変換してから extract() する。
-- d) 対象部署の除外（招待用部署を除く）は、設計書の「grp-invite-で始まるもの」という
--    説明ではなく、実体であるgroups.is_invite_group列で判定する（同じ意味だが、
--    文字列prefix判定より堅牢）。
-- e) sha256計算はpgcryptoを使わず、PostgreSQL 14以降の組み込み関数 sha256(bytea) を
--    使う（extensionスキーマへの依存を避けるため）。
--
-- 【この関数だけは動的SQL（EXECUTE）を使う】
-- check_schema_health()（20260806_add_schema_health_check.sql）は「動的SQLを使わない」
-- 方針だが、これは一般ユーザーも到達しうる関数での安全側の設計判断であり、本ファイルの
-- 方針とは別の話。backup_snapshot() の full スコープは「テーブル一覧をハードコードしない」
-- ことが設計書§3.1の要件そのものであり、動的SQLが必須になる。テーブル名は
-- information_schema.tables（システムカタログ）由来であり利用者入力ではないため、
-- format('%I', ...) で識別子として安全にエスケープしたうえで使用する。
--
-- 【適用方法】
-- Supabase SQL Editor に本ファイルを全文貼って一度に実行する（dev → prod の順）。
-- 内部で3関数を作るが、ドル引用タグは関数ごとに変えている
-- （$fn_backup_begin$ / $fn_backup_snapshot$ / $fn_backup_finalize$）ため、
-- 分割して貼っても閉じタグの取り違いは起きない。
-- ============================================================


-- ============================================================
-- ブロック1/6：拡張機能
-- ============================================================

-- sha256() 自体はPostgreSQL 14以降の組み込みだが、念のためpgcryptoも有効化しておく
-- （このプロジェクトの他のUUID生成等が暗黙に前提にしている可能性への保険。実害なし）。
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- ブロック2/6：表3本（backup-design.md §6・§8）
-- ============================================================

CREATE TABLE IF NOT EXISTS backup_runs (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  trigger       text NOT NULL CHECK (trigger IN ('cron','manual')),
  triggered_by  text,                                 -- manual のとき member id
  status        text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  group_count   integer,
  row_counts    jsonb NOT NULL DEFAULT '{}'::jsonb,
  orphan_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  bytes_written bigint,
  duration_ms   integer,
  deleted_count integer,
  error_message text
);

CREATE TABLE IF NOT EXISTS backup_objects (
  path        text PRIMARY KEY,               -- backups/full/2026-09-16.json
  run_id      bigint REFERENCES backup_runs(id),
  scope       text NOT NULL CHECK (scope IN ('full','group')),
  group_id    text,
  taken_at    timestamptz NOT NULL,
  bytes       bigint NOT NULL,
  sha256      text NOT NULL,
  retention   text[] NOT NULL,                -- {'daily'} / {'daily','weekly','monthly','quarterly'}
  deleted_at  timestamptz                     -- Storage から削除した時刻（行は履歴として残す）
);

CREATE TABLE IF NOT EXISTS backup_exports (           -- 二次保管の報告（§7 [4]。フェーズ5で使用開始）
  id            bigserial PRIMARY KEY,
  reported_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('success','failed')),
  destination   text NOT NULL,                        -- 保存先の識別（末端フォルダ名程度。フルパスは不要）
  object_count  integer,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_objects_run_id ON backup_objects(run_id);
CREATE INDEX IF NOT EXISTS idx_backup_objects_scope_group_taken_at
  ON backup_objects(scope, group_id, taken_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_backup_exports_reported_at ON backup_exports(reported_at DESC);


-- ============================================================
-- ブロック3/6：RLS（backup-design.md §8）
-- SELECTはsuper-adminのみ。書き込みポリシーは意図的に作らない
-- （service_roleはRLSを迂回するため、書けるのはservice_roleだけになる。
--  guest_ai_usage_daily / guest_ai_usage_global_daily と同じ流儀。schema.sql参照）。
-- ============================================================

ALTER TABLE backup_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_runs_read_super_admin" ON backup_runs;
CREATE POLICY "backup_runs_read_super_admin" ON backup_runs
  FOR SELECT TO authenticated USING (current_member_is_super_admin());

DROP POLICY IF EXISTS "backup_objects_read_super_admin" ON backup_objects;
CREATE POLICY "backup_objects_read_super_admin" ON backup_objects
  FOR SELECT TO authenticated USING (current_member_is_super_admin());

DROP POLICY IF EXISTS "backup_exports_read_super_admin" ON backup_exports;
CREATE POLICY "backup_exports_read_super_admin" ON backup_exports
  FOR SELECT TO authenticated USING (current_member_is_super_admin());


-- ============================================================
-- ブロック4/6：Storage バケット（backup-design.md §10）
-- クライアント向けポリシーは作らない＝authenticated/anonからは常にアクセス不可。
-- service_role（Edge Function）のみが読み書きできる。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- ブロック5/6：backup_begin() / backup_finalize(p_run_id)
-- ============================================================

CREATE OR REPLACE FUNCTION public.backup_begin(
  p_trigger      text DEFAULT 'cron',
  p_triggered_by text DEFAULT NULL
)
RETURNS TABLE(run_id bigint, group_ids text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_backup_begin$
DECLARE
  v_run_id    bigint;
  v_group_ids text[];
BEGIN
  IF p_trigger NOT IN ('cron', 'manual') THEN
    RAISE EXCEPTION 'invalid trigger: %', p_trigger;
  END IF;

  -- 対象部署：論理削除済み・招待用部署（is_invite_group=true）を除く（§4「対象とする部署」）
  SELECT array_agg(g.id ORDER BY g.id)
  INTO v_group_ids
  FROM public.groups g
  WHERE g.is_deleted = false
    AND g.is_invite_group = false;

  v_group_ids := coalesce(v_group_ids, '{}'::text[]);

  INSERT INTO public.backup_runs (trigger, triggered_by, status, group_count)
  VALUES (p_trigger, p_triggered_by, 'running', array_length(v_group_ids, 1))
  RETURNING id INTO v_run_id;

  RETURN QUERY SELECT v_run_id, v_group_ids;
END;
$fn_backup_begin$;

REVOKE ALL ON FUNCTION public.backup_begin(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_begin(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.backup_begin(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.backup_begin(text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.backup_finalize(
  p_run_id       bigint,
  p_status       text DEFAULT 'success',
  p_error_message text DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_backup_finalize$
DECLARE
  v_delete_paths text[];
BEGIN
  IF p_status NOT IN ('success', 'partial', 'failed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE public.backup_runs
  SET finished_at   = now(),
      status        = p_status,
      error_message = p_error_message,
      duration_ms   = extract(epoch FROM (now() - started_at)) * 1000
  WHERE id = p_run_id;

  -- 保持タグの昇格：今回のrunで作られた（かつまだ削除されていない）オブジェクトだけを対象にする。
  -- 🔴 JSTで日付境界を判定する（バックアップ起動はUTC 18:00=JST翌3:00のため、UTCのまま
  -- extractすると月曜JSTが日曜UTCとしてカウントされ誤判定する）。
  UPDATE public.backup_objects o
  SET retention = (
    SELECT array_agg(DISTINCT tag)
    FROM (
      SELECT unnest(o.retention) AS tag
      UNION
      SELECT 'daily'
      UNION ALL
      SELECT 'weekly'
      WHERE extract(isodow FROM (o.taken_at AT TIME ZONE 'Asia/Tokyo')) = 1
      UNION ALL
      SELECT 'monthly'
      WHERE extract(day FROM (o.taken_at AT TIME ZONE 'Asia/Tokyo')) = 1
      UNION ALL
      SELECT 'quarterly'
      WHERE extract(day   FROM (o.taken_at AT TIME ZONE 'Asia/Tokyo')) = 1
        AND extract(month FROM (o.taken_at AT TIME ZONE 'Asia/Tokyo')) IN (1, 4, 7, 10)
    ) tags
  )
  WHERE o.run_id = p_run_id
    AND o.deleted_at IS NULL;

  -- 保持ポリシー評価（GFS・世代数管理。backup-design.md §6）：
  -- (scope, group_id, tag) ごとにtaken_at降順で順位付けし、そのタグの保持数以内なら
  -- そのタグにおいて「残す」。オブジェクトはどのタグでも「残す」に入らなければ削除対象。
  WITH ranked AS (
    SELECT
      o.path,
      tag,
      row_number() OVER (PARTITION BY o.scope, o.group_id, tag ORDER BY o.taken_at DESC) AS rnk
    FROM public.backup_objects o
    CROSS JOIN LATERAL unnest(o.retention) AS tag
    WHERE o.deleted_at IS NULL
  ),
  limits (tag, lim) AS (
    VALUES ('daily', 14), ('weekly', 8), ('monthly', 12), ('quarterly', 8)
  ),
  keep AS (
    SELECT DISTINCT r.path
    FROM ranked r
    JOIN limits l ON l.tag = r.tag
    WHERE r.rnk <= l.lim
  )
  SELECT array_agg(o.path)
  INTO v_delete_paths
  FROM public.backup_objects o
  WHERE o.deleted_at IS NULL
    AND o.path NOT IN (SELECT path FROM keep);

  RETURN coalesce(v_delete_paths, '{}'::text[]);
END;
$fn_backup_finalize$;

REVOKE ALL ON FUNCTION public.backup_finalize(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_finalize(bigint, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.backup_finalize(bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.backup_finalize(bigint, text, text) TO service_role;


-- ============================================================
-- ブロック6/6：backup_snapshot(p_scope, p_group_id, p_run_id)
-- 本体。backup-design.md §3.1・§4・§5 の実装そのもの。
-- ============================================================

CREATE OR REPLACE FUNCTION public.backup_snapshot(
  p_scope       text,
  p_group_id    text DEFAULT NULL,
  p_run_id      bigint DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_backup_snapshot$
DECLARE
  v_taken_at      timestamptz := now();
  v_all_tables    text[];
  v_parts         text;
  v_sql           text;
  v_tables        jsonb;
  v_schema        jsonb;
  v_row_counts    jsonb;
  v_orphan_counts jsonb;
  v_sha256        text;
  v_result        jsonb;
BEGIN
  IF p_scope NOT IN ('full', 'group') THEN
    RAISE EXCEPTION 'invalid scope: %', p_scope;
  END IF;
  IF p_scope = 'group' AND (p_group_id IS NULL OR p_group_id = '') THEN
    RAISE EXCEPTION 'p_group_id is required when p_scope = group';
  END IF;

  -- ============================================================
  -- 🔴 REPEATABLE READ は「使えない」うえに「使う必要もない」（2026-09-16 実測で確定）
  --
  -- ここには EXECUTE 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' を置いていたが、
  -- Supabase SQL Editor も PostgREST 経由のRPCも、既にトランザクションを開始した状態で
  -- この関数を呼ぶため、必ず次のエラーで失敗する：
  --   25001: SET TRANSACTION ISOLATION LEVEL must be called before any query
  -- 関数の外から分離レベルを指定する手段も無い（PostgRESTは各リクエストのトランザクションを
  -- 自分で開始するため、呼び出し側から介入できない）。
  --
  -- 削除しても、テーブル間の整合性（親を読んだ後に作られた子行が孤児になる問題）は保たれる。
  -- 理由：PostgreSQLは READ COMMITTED でも「1つのSQL文」は文の開始時点の単一スナップショットを
  -- 文全体で使う。full・group とも、テーブル群の取得を1文にまとめてある：
  --   - full  : EXECUTE v_sql（jsonb_build_object に全テーブルのサブクエリを並べた動的SQL）1文
  --   - group : WITH ... SELECT jsonb_build_object(...) 1文
  -- この1文の中では全テーブルが同じ時点を見るため、分離レベルを上げる必要が無い。
  --
  -- 🔴 この前提を壊さないこと：テーブル群の取得を複数のSQL文に分割すると、文と文の間で
  -- 他トランザクションのコミットが見えるようになり、整合性が崩れる。分割したくなったら、
  -- 先にこのコメントを読み直すこと。
  -- ============================================================

  IF p_scope = 'full' THEN
    ------------------------------------------------------------
    -- full：テーブル一覧をハードコードせず動的に列挙し、1SQL文で丸ごと取得する
    -- （§3.1「新テーブルが追加されたとき黙って漏れないため」）。
    ------------------------------------------------------------
    SELECT array_agg(table_name ORDER BY table_name)
    INTO v_all_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('backup_runs', 'backup_objects', 'backup_exports');

    SELECT string_agg(
      format('%L, coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.%I t), ''[]''::jsonb)', tbl, tbl),
      ', '
    )
    INTO v_parts
    FROM unnest(v_all_tables) AS tbl;

    v_sql := format('SELECT jsonb_build_object(%s)', v_parts);
    EXECUTE v_sql INTO v_tables;

    -- スキーマ情報（復元時の差分検出用。§5・§9）
    SELECT jsonb_object_agg(c.table_name, c.cols)
    INTO v_schema
    FROM (
      SELECT
        table_name,
        jsonb_agg(
          jsonb_build_object(
            'column', column_name,
            'type', data_type,
            'nullable', (is_nullable = 'YES')
          ) ORDER BY ordinal_position
        ) AS cols
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(v_all_tables)
      GROUP BY table_name
    ) c;

    -- 孤児行（§4「孤児データの扱い」）：層Aの直接列がNULL/空のまま残った行の件数。
    -- 層B以下は親を辿るため、親が論理削除(is_deleted)されているだけならFKは有効で
    -- 孤児にはならない（このカウントは物理的な欠落・注入漏れの検知が目的）。
    SELECT jsonb_object_agg(s.t, s.c)
    INTO v_orphan_counts
    FROM (
      SELECT 'objectives'::text AS t, count(*) AS c FROM public.objectives WHERE group_id IS NULL
      UNION ALL SELECT 'key_results', count(*) FROM public.key_results WHERE group_id IS NULL
      UNION ALL SELECT 'quarterly_objectives', count(*) FROM public.quarterly_objectives WHERE group_id IS NULL
      UNION ALL SELECT 'task_forces', count(*) FROM public.task_forces WHERE group_id IS NULL
      UNION ALL SELECT 'todos', count(*) FROM public.todos WHERE group_id IS NULL
      UNION ALL SELECT 'kr_quarter_plans', count(*) FROM public.kr_quarter_plans WHERE group_id IS NULL
      UNION ALL SELECT 'members', count(*) FROM public.members WHERE coalesce(array_length(group_ids, 1), 0) = 0
      UNION ALL SELECT 'projects', count(*) FROM public.projects WHERE coalesce(array_length(group_ids, 1), 0) = 0
      UNION ALL SELECT 'tasks', count(*) FROM public.tasks WHERE coalesce(array_length(group_ids, 1), 0) = 0
    ) s
    WHERE s.c > 0;

  ELSE
    ------------------------------------------------------------
    -- group：層A（直接列）＋層B（親を辿る）。層Cは含めない（§4）。
    -- 🔴 personal_kr_* / personal_period_reviews / member_widget_layouts /
    -- member_tag_members は members.group_ids（兼務）ではなく members.group_id
    -- （ホーム部署）で仕分ける（§4「個人データの仕分けは『ホーム部署』を使う」）。
    ------------------------------------------------------------
    WITH
      home_members AS (
        SELECT id FROM public.members WHERE group_id = p_group_id
      ),
      grp_objectives AS (
        SELECT id FROM public.objectives WHERE group_id = p_group_id
      ),
      grp_krs AS (
        SELECT id FROM public.key_results WHERE group_id = p_group_id
      ),
      grp_quarterly_objectives AS (
        SELECT id FROM public.quarterly_objectives WHERE group_id = p_group_id
      ),
      grp_projects AS (
        SELECT id FROM public.projects WHERE group_ids && ARRAY[p_group_id]
      ),
      grp_tasks AS (
        SELECT id FROM public.tasks WHERE group_ids && ARRAY[p_group_id]
      ),
      -- 🔴 personal_krs は group_id（NOT NULL）を持つが、仕分けには使わない（§4）。
      -- この列は「そのKRが参照するグループKRの部署」であり、データの所有者を表さない。
      -- group_id で仕分けると、同じ人の個人OKRが「KR本体はA部署・期末振り返り（member_id
      -- 基準）はB部署」に分裂し、どちらのファイルからも復元できなくなる（2026-09-16に
      -- 本番の実データで確認：personal_krs 7件=AID / personal_period_reviews 2件=grp-egg）。
      grp_personal_krs AS (
        SELECT id FROM public.personal_krs WHERE member_id IN (SELECT id FROM home_members)
      ),
      grp_personal_kr_weeks AS (
        SELECT id FROM public.personal_kr_weeks WHERE personal_kr_id IN (SELECT id FROM grp_personal_krs)
      ),
      grp_kr_sessions AS (
        SELECT id FROM public.kr_sessions WHERE kr_id IN (SELECT id FROM grp_krs)
      ),
      grp_kr_notes AS (
        SELECT id FROM public.kr_meeting_notes WHERE kr_id IN (SELECT id FROM grp_krs)
      )
    SELECT jsonb_build_object(
      'groups', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.groups x WHERE x.id = p_group_id),
      'members', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.members x WHERE x.group_ids && ARRAY[p_group_id]),
      'objectives', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.objectives x WHERE x.id IN (SELECT id FROM grp_objectives)),
      'key_results', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.key_results x WHERE x.id IN (SELECT id FROM grp_krs)),
      'quarterly_objectives', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.quarterly_objectives x WHERE x.id IN (SELECT id FROM grp_quarterly_objectives)),
      'task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_forces x WHERE x.group_id = p_group_id),
      'todos', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.todos x WHERE x.group_id = p_group_id),
      'projects', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.projects x WHERE x.id IN (SELECT id FROM grp_projects)),
      'tasks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.tasks x WHERE x.id IN (SELECT id FROM grp_tasks)),
      'task_dependencies', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_dependencies x WHERE x.group_id = p_group_id),
      'kr_quarter_plans', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_quarter_plans x WHERE x.group_id = p_group_id),
      'personal_krs', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_krs x WHERE x.id IN (SELECT id FROM grp_personal_krs)),
      'project_invites', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_invites x WHERE x.invite_group_id = p_group_id),

      'personal_kr_months', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_months x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_weeks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_weeks x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_week_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_week_tasks x WHERE x.week_id IN (SELECT id FROM grp_personal_kr_weeks)),
      'personal_kr_memos', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_memos x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_outlooks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_outlooks x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_review_drafts', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_review_drafts x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_period_reviews', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_period_reviews x WHERE x.member_id IN (SELECT id FROM home_members)),
      'member_widget_layouts', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.member_widget_layouts x WHERE x.member_id IN (SELECT id FROM home_members)),
      'kr_sessions', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_sessions x WHERE x.id IN (SELECT id FROM grp_kr_sessions)),
      'kr_meeting_notes', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_meeting_notes x WHERE x.id IN (SELECT id FROM grp_kr_notes)),
      'okr_analyses', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.okr_analyses x WHERE x.kr_id IN (SELECT id FROM grp_krs) OR x.objective_id IN (SELECT id FROM grp_objectives)),
      'kr_reports', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_reports x WHERE x.kr_id IN (SELECT id FROM grp_krs)),
      'kr_declarations', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_declarations x WHERE x.session_id IN (SELECT id FROM grp_kr_sessions)),
      'kr_note_tf_entries', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_note_tf_entries x WHERE x.note_id IN (SELECT id FROM grp_kr_notes)),
      'milestones', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.milestones x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'project_analyses', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_analyses x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'task_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_task_forces x WHERE x.task_id IN (SELECT id FROM grp_tasks)),
      'task_projects', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_projects x WHERE x.task_id IN (SELECT id FROM grp_tasks)),
      'project_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_task_forces x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'quarterly_kr_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.quarterly_kr_task_forces x WHERE x.quarterly_objective_id IN (SELECT id FROM grp_quarterly_objectives)),
      'member_tag_members', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.member_tag_members x WHERE x.member_id IN (SELECT id FROM home_members))
    )
    INTO v_tables;
  END IF;

  -- 行数（0件のテーブルは載せない。§5の出力例と同じ体裁）
  SELECT coalesce(jsonb_object_agg(e.key, jsonb_array_length(e.value)), '{}'::jsonb)
  INTO v_row_counts
  FROM jsonb_each(v_tables) AS e(key, value)
  WHERE jsonb_array_length(e.value) > 0;

  -- tables部のハッシュ（転送後の照合用。§5）。PostgreSQL 14以降の組み込み関数を使う
  -- （pgcryptoのdigest()はSupabaseでは既定でextensionsスキーマに入り、
  -- SET search_path=''の下では明示スキーマ修飾が別途必要になるため避けた）。
  v_sha256 := encode(sha256(convert_to(v_tables::text, 'UTF8')), 'hex');

  v_result := jsonb_build_object(
    'meta', jsonb_strip_nulls(jsonb_build_object(
      'app_version', p_app_version,
      'taken_at', to_char(v_taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'scope', p_scope,
      'group_id', p_group_id,
      'table_count', (SELECT count(*) FROM jsonb_object_keys(v_tables)),
      'row_counts', v_row_counts,
      'sha256', v_sha256,
      'generator', 'backup_snapshot@1'
    )),
    'tables', v_tables
  );

  IF p_scope = 'full' THEN
    v_result := v_result || jsonb_build_object('schema', v_schema);
  END IF;

  IF p_scope = 'full' AND p_run_id IS NOT NULL THEN
    UPDATE public.backup_runs
    SET row_counts    = v_row_counts,
        orphan_counts = coalesce(v_orphan_counts, '{}'::jsonb)
    WHERE id = p_run_id;
  END IF;

  RETURN v_result;
END;
$fn_backup_snapshot$;

REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.backup_snapshot(text, text, bigint, text) TO service_role;


-- ============================================================
-- 適用後の確認（このマイグレーションの一部ではない。Supabase SQL Editorで
-- 山本さんが実行し、結果を確認してください。ダッシュボードはpostgresロールで
-- 実行されるためRLS・REVOKEの影響を受けず、以下はそのまま試せます）。
-- ============================================================

-- 1) 表・関数・バケットが揃っているか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('backup_runs','backup_objects','backup_exports');
-- SELECT proname FROM pg_proc WHERE proname IN ('backup_begin','backup_snapshot','backup_finalize');
-- SELECT id, public FROM storage.buckets WHERE id = 'backups';

-- 2) 一連の流れを一度動かしてみる（groupのp_group_idは実在する部署idに置き換える）
-- SELECT * FROM backup_begin();                                  -- run_idと対象部署一覧が返る
-- SELECT backup_snapshot('full', NULL, <上のrun_id>);             -- jsonbが1個返る。meta.table_countを確認
-- SELECT backup_snapshot('group', 'grp-egg', <上のrun_id>);       -- 部署別jsonbが返る
-- SELECT backup_finalize(<上のrun_id>);                           -- 削除対象パスの配列が返る（初回は空のはず）
-- SELECT row_counts, orphan_counts, group_count, status FROM backup_runs WHERE id = <run_id>;

-- 3) 一般ユーザー（authenticated・super_adminではない）で試すと、上記1)以外は権限エラーになることを確認する
-- ============================================================

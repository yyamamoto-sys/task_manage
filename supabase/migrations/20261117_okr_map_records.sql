-- 想定クエリ名：OKRモード（地図）の記録用の表（段階2）
-- ============================================================
-- 2026-11-17（feature/okr-v2・版は上げない）。冪等（何度流しても同じ状態になる）
--
-- 正本：docs/dev/sections/s91_okr-map-stage1.md（段階2の節）
-- 前提：次の関数が本番にあること（適用前の確認 SQL は s91 の段階2の節）
--   current_member_id() / current_member_group_ids() / current_member_is_super_admin()
--   task_group_ids(text) / personal_kr_owner_member_id(uuid) / update_updated_at()
--
-- 【何をするか】地図の画面の「記録」を保存する表を15本作る。AI の候補は保存しない（段階3で都度作る）。
--   〔全員〕＝同じ部署（group）のメンバー全員が読める・書ける（＋全社スーパー管理者）
--   〔本人〕＝member_id が本人の行だけ読める・書ける
--    1. okr_kr_defs            KRごとの段の基準文・証拠として見るもの・手がかりの単位/期首/目標/向き〔全員〕
--    2. okr_checkins           チェックインの回〔全員〕
--    3. okr_resources          読ませた資料と読み取り結果〔全員〕（表だけ。書き込みは段階3）
--    4. okr_kr_assessments     回×KR×資料の見立て・手がかりの値〔全員〕
--    5. okr_learnings          学び・気づき〔全員〕
--    6. okr_decisions          決定事項と宿題〔全員〕
--    7. okr_outcome_notes      成果の記述（確定して足し合わせたもの）〔全員〕
--    8. okr_outcome_claims     成果の記述と仕事の結びつきへの担当者の答え（下の特別な規則）
--    9. okr_task_kr_links      仕事のつなぎ先の選び直し（読みは〔全員〕・書きは担当者本人）
--   10. okr_task_kr_how        どう役立つか（仕事×KRの一言）〔本人〕
--   11. okr_proposal_choices   提案の採否〔本人〕
--   12. okr_personal_kr_links  個人OKR → KR の矢印（多対多）〔本人〕
--   13. okr_weekly_answers     週の振り返りの答え〔本人〕
--   14. okr_weekly_picks       今週やると選んだ仕事〔本人〕
--   15. okr_tf_locks           今期のTF構成の確定〔全員〕
--
-- 【部署（group_id）の決め方】画面から送らせない（偽れないように）。
--   KR を持つ表（kr_defs・assessments・learnings・outcome_notes）は key_results から、
--   回を持つ表（resources・decisions）は okr_checkins から、claims は outcome_notes から、
--   BEFORE INSERT OR UPDATE のトリガーで入れる（kr_quarter_plans と同じ流儀）。
--   okr_checkins・okr_tf_locks だけは画面が送り、RLS が「自分の部署か」を確かめる。
--
-- 【RLS】Section 39：SECURITY DEFINER 関数は (SELECT ...) で包み、単数の部署は @> ARRAY[group_id] で比べる。
--   物理削除はしない（Section 4）ので DELETE のポリシーは作らない（GRANT はあるが RLS で全件拒否される）。
--   取り消しは is_deleted（または claims の status）で行う。
--
-- 【MIN_CLIENT_VERSION は上げない】新しい表の追加だけ。既存の表・関数は変えない。
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   末尾の確認は DO ブロック1本。全行が OK ならよい。NG があれば例外メッセージにその行が出る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0) 判定用のヘルパー（SECURITY DEFINER。RLS の中から呼ぶ）
-- ------------------------------------------------------------
-- 仕事の担当者（主担当＋副担当）の member_id の配列。削除済みの仕事は空
CREATE OR REPLACE FUNCTION public.okr_task_assignee_ids(p_task_id text)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_okr_task_assignee_ids$
  SELECT coalesce(
           array_remove(array_append(t.assignee_member_ids, t.assignee_member_id), NULL),
           ARRAY[]::text[])
    FROM public.tasks t
   WHERE t.id = p_task_id
     AND t.is_deleted = false
$fn_okr_task_assignee_ids$;

REVOKE ALL ON FUNCTION public.okr_task_assignee_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.okr_task_assignee_ids(text) TO authenticated;

-- KR を持つ表の group_id を key_results から入れる
CREATE OR REPLACE FUNCTION public.okr_sync_group_from_kr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_sync_group_from_kr$
BEGIN
  SELECT kr.group_id INTO NEW.group_id FROM public.key_results kr WHERE kr.id = NEW.kr_id;
  RETURN NEW;
END;
$fn_okr_sync_group_from_kr$;

-- 回を持つ表の group_id を okr_checkins から入れる
CREATE OR REPLACE FUNCTION public.okr_sync_group_from_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_sync_group_from_checkin$
BEGIN
  SELECT c.group_id INTO NEW.group_id FROM public.okr_checkins c WHERE c.id = NEW.checkin_id;
  RETURN NEW;
END;
$fn_okr_sync_group_from_checkin$;

-- claims の group_id を okr_outcome_notes から入れる
CREATE OR REPLACE FUNCTION public.okr_sync_group_from_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_sync_group_from_note$
BEGIN
  SELECT n.group_id INTO NEW.group_id FROM public.okr_outcome_notes n WHERE n.id = NEW.note_id;
  RETURN NEW;
END;
$fn_okr_sync_group_from_note$;

REVOKE ALL ON FUNCTION public.okr_sync_group_from_kr()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_sync_group_from_checkin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_sync_group_from_note()    FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1) 表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.okr_kr_defs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id           text NOT NULL UNIQUE REFERENCES public.key_results(id),
  group_id        text REFERENCES public.groups(id),           -- トリガーが key_results から入れる
  bands           jsonb NOT NULL DEFAULT '{}'::jsonb,           -- {"60":"…","70":"…","80":"…","90"?,"100"?}
  evidence        text NOT NULL DEFAULT '',                      -- Oに近づいた証拠として見るもの
  hint_unit       text,                                          -- 手がかりの数字（無い KR は NULL）
  hint_start      numeric,
  hint_target     numeric,
  hint_direction  text CHECK (hint_direction IS NULL OR hint_direction IN ('up', 'down')),
  is_deleted      boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  deleted_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.okr_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      text NOT NULL REFERENCES public.groups(id),
  checkin_date  date NOT NULL,
  title         text NOT NULL DEFAULT '',
  confirmed_by  text REFERENCES public.members(id),             -- 最後に確定した人
  confirmed_at  timestamptz,
  is_deleted    boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.okr_resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id  uuid NOT NULL REFERENCES public.okr_checkins(id),
  group_id    text REFERENCES public.groups(id),                -- トリガーが okr_checkins から入れる
  file_name   text NOT NULL,
  kind        text NOT NULL DEFAULT '',
  reading     jsonb NOT NULL DEFAULT '{}'::jsonb,               -- AI の読み取り結果（段階3）
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);

-- 1行＝回×KR×資料の見立て。resource_id が NULL の行は「その回に確定した手がかりの値」だけを持つ
CREATE TABLE IF NOT EXISTS public.okr_kr_assessments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id   uuid NOT NULL REFERENCES public.okr_checkins(id),
  kr_id        text NOT NULL REFERENCES public.key_results(id),
  group_id     text REFERENCES public.groups(id),               -- トリガーが key_results から入れる
  resource_id  uuid REFERENCES public.okr_resources(id),
  value        integer CHECK (value IS NULL OR value BETWEEN 60 AND 100),
  summary      text NOT NULL DEFAULT '',
  basis        jsonb NOT NULL DEFAULT '[]'::jsonb,              -- 次の段の要件 [{requirement,status,quote}]
  source       jsonb,                                           -- {doc,page}
  hint_value   numeric,
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS okr_kr_assessments_resource_unique
  ON public.okr_kr_assessments (checkin_id, kr_id, resource_id)
  WHERE is_deleted = false AND resource_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS okr_kr_assessments_hint_unique
  ON public.okr_kr_assessments (checkin_id, kr_id)
  WHERE is_deleted = false AND resource_id IS NULL;

CREATE TABLE IF NOT EXISTS public.okr_learnings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id   uuid NOT NULL REFERENCES public.okr_checkins(id),
  kr_id        text NOT NULL REFERENCES public.key_results(id),
  group_id     text REFERENCES public.groups(id),               -- トリガーが key_results から入れる
  resource_id  uuid REFERENCES public.okr_resources(id),
  kind         text NOT NULL CHECK (kind IN ('分かったこと', '次に試すこと')),
  body         text NOT NULL,
  source       jsonb,
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.okr_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id       uuid NOT NULL REFERENCES public.okr_checkins(id),
  group_id         text REFERENCES public.groups(id),           -- トリガーが okr_checkins から入れる
  resource_id      uuid REFERENCES public.okr_resources(id),
  kind             text NOT NULL CHECK (kind IN ('決定', '宿題')),
  body             text NOT NULL,
  owner_member_id  text REFERENCES public.members(id),
  kr_ids           text[] NOT NULL DEFAULT '{}',
  source           jsonb,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

-- 同じ出来事は note_key を同じにして1行にまとめる（出典と関連の仕事は和集合で上書き保存する）
CREATE TABLE IF NOT EXISTS public.okr_outcome_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        text NOT NULL REFERENCES public.key_results(id),
  group_id     text REFERENCES public.groups(id),               -- トリガーが key_results から入れる
  note_key     text NOT NULL,
  checkin_id   uuid REFERENCES public.okr_checkins(id),         -- 最初に確定した回
  change_text  text NOT NULL DEFAULT '',
  excerpt      text NOT NULL DEFAULT '',
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb,
  links        jsonb NOT NULL DEFAULT '[]'::jsonb,              -- [{taskId,reason}]
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  UNIQUE (kr_id, note_key)
);

-- 行は確定した人が pending で作り、答える（yes／no）のは member_id の本人だけ
CREATE TABLE IF NOT EXISTS public.okr_outcome_claims (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid NOT NULL REFERENCES public.okr_outcome_notes(id),
  task_id      text NOT NULL REFERENCES public.tasks(id),
  member_id    text NOT NULL REFERENCES public.members(id),
  group_id     text REFERENCES public.groups(id),               -- トリガーが okr_outcome_notes から入れる
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no')),
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  UNIQUE (note_id, task_id, member_id)
);

-- 仕事1件につき1行。is_deleted=true は「既定（PJ→TF→KR）に戻した」
CREATE TABLE IF NOT EXISTS public.okr_task_kr_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     text NOT NULL UNIQUE REFERENCES public.tasks(id),
  kr_ids      text[] NOT NULL DEFAULT '{}',                     -- 空配列＝どの KR にもつながない
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.okr_task_kr_how (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   text NOT NULL REFERENCES public.members(id),
  task_id     text NOT NULL REFERENCES public.tasks(id),
  kr_id       text NOT NULL REFERENCES public.key_results(id),
  body        text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  UNIQUE (member_id, task_id, kr_id)
);

CREATE TABLE IF NOT EXISTS public.okr_proposal_choices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   text NOT NULL REFERENCES public.members(id),
  task_id     text NOT NULL REFERENCES public.tasks(id),
  kr_id       text NOT NULL REFERENCES public.key_results(id),
  choice      text NOT NULL CHECK (choice IN ('taken', 'skipped')),
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  UNIQUE (member_id, task_id, kr_id)
);

CREATE TABLE IF NOT EXISTS public.okr_personal_kr_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       text NOT NULL REFERENCES public.members(id),
  personal_kr_id  uuid NOT NULL REFERENCES public.personal_krs(id),
  kr_id           text NOT NULL REFERENCES public.key_results(id),
  is_deleted      boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  deleted_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT '',
  UNIQUE (member_id, personal_kr_id, kr_id)
);

CREATE TABLE IF NOT EXISTS public.okr_weekly_answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     text NOT NULL REFERENCES public.members(id),
  week_start    date NOT NULL,                                  -- 週の月曜
  kr_id         text NOT NULL REFERENCES public.key_results(id),
  effect        text CHECK (effect IS NULL OR effect IN ('役立った', '少し役立った', '今週は役立たなかった')),
  match_answer  text CHECK (match_answer IS NULL OR match_answer IN ('そのとおり', '少し違う', '違う')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT '',
  UNIQUE (member_id, week_start, kr_id)
);

CREATE TABLE IF NOT EXISTS public.okr_weekly_picks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   text NOT NULL REFERENCES public.members(id),
  week_start  date NOT NULL,
  task_id     text NOT NULL REFERENCES public.tasks(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  UNIQUE (member_id, week_start, task_id)
);

CREATE TABLE IF NOT EXISTS public.okr_tf_locks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     text NOT NULL REFERENCES public.groups(id),
  fiscal_year  integer NOT NULL,
  quarter      text NOT NULL CHECK (quarter IN ('1Q', '2Q', '3Q', '4Q')),
  locked_on    date NOT NULL,
  locked_by    text REFERENCES public.members(id),
  snapshot     jsonb NOT NULL DEFAULT '[]'::jsonb,              -- 確定したときの O・KR・TF の並び
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  UNIQUE (group_id, fiscal_year, quarter)
);

-- ------------------------------------------------------------
-- 2) 索引（読み込みの絞り込みに使う列）
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_okr_checkins_group        ON public.okr_checkins (group_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_kr_assessments_kr     ON public.okr_kr_assessments (kr_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_learnings_kr          ON public.okr_learnings (kr_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_decisions_checkin     ON public.okr_decisions (checkin_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_resources_checkin     ON public.okr_resources (checkin_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_outcome_notes_group   ON public.okr_outcome_notes (group_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_outcome_claims_note   ON public.okr_outcome_claims (note_id);
CREATE INDEX IF NOT EXISTS idx_okr_outcome_claims_member ON public.okr_outcome_claims (member_id);
CREATE INDEX IF NOT EXISTS idx_okr_task_kr_how_member    ON public.okr_task_kr_how (member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_proposal_member       ON public.okr_proposal_choices (member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_personal_links_member ON public.okr_personal_kr_links (member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_weekly_answers_member ON public.okr_weekly_answers (member_id, week_start);
CREATE INDEX IF NOT EXISTS idx_okr_weekly_picks_member   ON public.okr_weekly_picks (member_id, week_start) WHERE is_deleted = false;

-- ------------------------------------------------------------
-- 3) トリガー（updated_at・group_id）
-- ------------------------------------------------------------
DO $okr_updated_at_triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'okr_kr_defs', 'okr_checkins', 'okr_resources', 'okr_kr_assessments', 'okr_learnings', 'okr_decisions',
    'okr_outcome_notes', 'okr_outcome_claims', 'okr_task_kr_links', 'okr_task_kr_how', 'okr_proposal_choices',
    'okr_personal_kr_links', 'okr_weekly_answers', 'okr_weekly_picks', 'okr_tf_locks'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
  END LOOP;
END;
$okr_updated_at_triggers$;

DO $okr_group_triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['okr_kr_defs', 'okr_kr_assessments', 'okr_learnings', 'okr_outcome_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sync_group ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_sync_group BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.okr_sync_group_from_kr()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['okr_resources', 'okr_decisions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sync_group ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_sync_group BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.okr_sync_group_from_checkin()', t, t);
  END LOOP;
  DROP TRIGGER IF EXISTS trg_okr_outcome_claims_sync_group ON public.okr_outcome_claims;
  CREATE TRIGGER trg_okr_outcome_claims_sync_group BEFORE INSERT OR UPDATE ON public.okr_outcome_claims
    FOR EACH ROW EXECUTE FUNCTION public.okr_sync_group_from_note();
END;
$okr_group_triggers$;

-- ------------------------------------------------------------
-- 4) RLS
-- ------------------------------------------------------------
-- 〔全員〕：自分の部署（兼務込み）の行・全社スーパー管理者。SELECT／INSERT／UPDATE（DELETE なし）
DO $okr_group_policies$
DECLARE
  t    text;
  cond text := '(group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id]) OR (SELECT public.current_member_is_super_admin())';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'okr_kr_defs', 'okr_checkins', 'okr_resources', 'okr_kr_assessments', 'okr_learnings', 'okr_decisions',
    'okr_outcome_notes', 'okr_tf_locks'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_select', t, cond);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert', t, cond);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_update', t, cond, cond);
  END LOOP;
END;
$okr_group_policies$;

-- 〔本人〕：member_id が本人の行だけ。NULL 猶予は書かない（未登録なら何も見えない）
DO $okr_own_policies$
DECLARE
  t    text;
  cond text := 'member_id = (SELECT public.current_member_id())';
BEGIN
  FOREACH t IN ARRAY ARRAY['okr_task_kr_how', 'okr_proposal_choices', 'okr_weekly_answers', 'okr_weekly_picks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_select', t, cond);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert', t, cond);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_update', t, cond, cond);
  END LOOP;
END;
$okr_own_policies$;

-- 個人OKR → KR の矢印：本人の行で、矢印の元の個人OKRも本人のもの
ALTER TABLE public.okr_personal_kr_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "okr_personal_kr_links_select" ON public.okr_personal_kr_links;
DROP POLICY IF EXISTS "okr_personal_kr_links_insert" ON public.okr_personal_kr_links;
DROP POLICY IF EXISTS "okr_personal_kr_links_update" ON public.okr_personal_kr_links;
CREATE POLICY "okr_personal_kr_links_select" ON public.okr_personal_kr_links
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));
CREATE POLICY "okr_personal_kr_links_insert" ON public.okr_personal_kr_links
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id())
              AND public.personal_kr_owner_member_id(personal_kr_id) = (SELECT public.current_member_id()));
CREATE POLICY "okr_personal_kr_links_update" ON public.okr_personal_kr_links
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id())
              AND public.personal_kr_owner_member_id(personal_kr_id) = (SELECT public.current_member_id()));

-- 仕事のつなぎ先：読みはその仕事が見える人（tasks と同じ部署の判定）、書きは担当者本人（主担当・副担当）だけ
ALTER TABLE public.okr_task_kr_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "okr_task_kr_links_select" ON public.okr_task_kr_links;
DROP POLICY IF EXISTS "okr_task_kr_links_insert" ON public.okr_task_kr_links;
DROP POLICY IF EXISTS "okr_task_kr_links_update" ON public.okr_task_kr_links;
CREATE POLICY "okr_task_kr_links_select" ON public.okr_task_kr_links
  FOR SELECT TO authenticated
  USING (public.task_group_ids(task_id) && (SELECT public.current_member_group_ids())
         OR (SELECT public.current_member_is_super_admin()));
CREATE POLICY "okr_task_kr_links_insert" ON public.okr_task_kr_links
  FOR INSERT TO authenticated
  WITH CHECK (public.okr_task_assignee_ids(task_id) @> ARRAY[(SELECT public.current_member_id())]);
CREATE POLICY "okr_task_kr_links_update" ON public.okr_task_kr_links
  FOR UPDATE TO authenticated
  USING (public.okr_task_assignee_ids(task_id) @> ARRAY[(SELECT public.current_member_id())])
  WITH CHECK (public.okr_task_assignee_ids(task_id) @> ARRAY[(SELECT public.current_member_id())]);

-- 成果の記述との結びつき：
--   読み＝本人の行は全件、他人の行は yes だけ（同じ部署）。
--   作る＝同じ部署の人が、その仕事の担当者あてに pending でだけ作れる（確定した人が届ける）。
--   答える（UPDATE）＝member_id の本人だけ。DELETE なし
ALTER TABLE public.okr_outcome_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "okr_outcome_claims_select" ON public.okr_outcome_claims;
DROP POLICY IF EXISTS "okr_outcome_claims_insert" ON public.okr_outcome_claims;
DROP POLICY IF EXISTS "okr_outcome_claims_update" ON public.okr_outcome_claims;
CREATE POLICY "okr_outcome_claims_select" ON public.okr_outcome_claims
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id())
         OR (status = 'yes'
             AND ((group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id])
                  OR (SELECT public.current_member_is_super_admin()))));
CREATE POLICY "okr_outcome_claims_insert" ON public.okr_outcome_claims
  FOR INSERT TO authenticated
  WITH CHECK (status = 'pending'
              AND public.okr_task_assignee_ids(task_id) @> ARRAY[member_id]
              AND ((group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id])
                   OR (SELECT public.current_member_is_super_admin())));
CREATE POLICY "okr_outcome_claims_update" ON public.okr_outcome_claims
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

-- ------------------------------------------------------------
-- 5) GRANT（Section 39：2026-10-30以降は自動付与されない。anon には付けない）
-- ------------------------------------------------------------
DO $okr_grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'okr_kr_defs', 'okr_checkins', 'okr_resources', 'okr_kr_assessments', 'okr_learnings', 'okr_decisions',
    'okr_outcome_notes', 'okr_outcome_claims', 'okr_task_kr_links', 'okr_task_kr_how', 'okr_proposal_choices',
    'okr_personal_kr_links', 'okr_weekly_answers', 'okr_weekly_picks', 'okr_tf_locks'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END;
$okr_grants$;

COMMIT;

-- ============================================================
-- 確認（適用後に続けて実行する。DO ブロック1本。結果は例外メッセージとして出る。
-- 全行が OK ならよい。書き込みはしない）
-- ============================================================
DO $verify_okr_map_records$
DECLARE
  v_lines  text[] := ARRAY[]::text[];
  v_ok     boolean;
  v_tables text[] := ARRAY[
    'okr_kr_defs', 'okr_checkins', 'okr_resources', 'okr_kr_assessments', 'okr_learnings', 'okr_decisions',
    'okr_outcome_notes', 'okr_outcome_claims', 'okr_task_kr_links', 'okr_task_kr_how', 'okr_proposal_choices',
    'okr_personal_kr_links', 'okr_weekly_answers', 'okr_weekly_picks', 'okr_tf_locks'];
  t        text;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    v_ok := to_regclass('public.' || t) IS NOT NULL
        AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = t)
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t) = 3
        AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND cmd IN ('DELETE', 'ALL'))
        AND has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE')
        AND NOT has_table_privilege('anon', 'public.' || t, 'SELECT');
    v_lines := v_lines || (CASE WHEN coalesce(v_ok, false) THEN 'OK ' ELSE 'NG ' END || t || '（表・RLS・ポリシー3本・DELETEなし・GRANT）');
  END LOOP;

  v_ok := to_regprocedure('public.okr_task_assignee_ids(text)') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_kr()') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_checkin()') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_note()') IS NOT NULL
      AND NOT has_function_privilege('anon', 'public.okr_task_assignee_ids(text)', 'EXECUTE');
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || '関数4本（anon は okr_task_assignee_ids を呼べない）');

  v_ok := (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_okr_%_sync_group' AND NOT tgisinternal) = 7;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'group_id のトリガー7本');

  RAISE EXCEPTION E'確認結果（全行が OK ならよい。この例外は結果の表示用で、何も書き込んでいない）:\n%', array_to_string(v_lines, E'\n');
END;
$verify_okr_map_records$;

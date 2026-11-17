-- 想定クエリ名：OKRモード（地図）の記録用の表（段階2・段階3のレビュー指摘を反映）
-- ============================================================
-- 2026-11-17（feature/okr-v2・版は上げない）。冪等（何度流しても同じ状態になる）
--
-- 正本：docs/dev/sections/s91_okr-map-stage1.md（91-2・91-3・91-4）
-- 前提：次の関数が本番にあること（適用前の確認 SQL は s91 の 91-2・91-4）
--   current_member_id() / current_member_group_ids() / current_member_is_super_admin()
--   task_group_ids(text) / personal_kr_owner_member_id(uuid) / update_updated_at()
--
-- 🔴【未適用の前提】このファイルは「15本の表がまだどこにも無い」状態に流す前提で書いてある。
--   表は CREATE TABLE IF NOT EXISTS なので、前の版をすでに流した環境（dev 等）に流し直しても、
--   列・制約の変更は反映されない（関数・トリガー・ポリシーは作り直される）。
--   前の版が残っている環境に流し直すときは、先に15本の表を作り直すこと（中身は捨ててよい試験データだけのはず）：
--     DROP TABLE IF EXISTS public.okr_outcome_claims, public.okr_kr_assessments, public.okr_learnings,
--       public.okr_decisions, public.okr_resources, public.okr_outcome_notes, public.okr_checkins,
--       public.okr_kr_defs, public.okr_task_kr_links, public.okr_task_kr_how, public.okr_proposal_choices,
--       public.okr_personal_kr_links, public.okr_weekly_answers, public.okr_weekly_picks, public.okr_tf_locks;
--   本番に一度流したあとで表の形を変えるときは、このファイルを直さず新しいマイグレーションにする。
--
-- 【何をするか】地図の画面の「記録」を保存する表を15本作る。AI の候補は保存しない（段階3で都度作る）。
--   〔全員〕＝同じ部署（group）のメンバー全員が読める・書ける（＋全社スーパー管理者）
--   〔本人〕＝member_id が本人の行だけ読める・書ける
--    1. okr_kr_defs            KRごとの段の基準文・証拠として見るもの・手がかりの単位/期首/目標/向き〔全員〕
--    2. okr_checkins           チェックインの回〔全員〕
--    3. okr_resources          読ませた資料と読み取り結果〔全員〕
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
--   KR の部署が変わったら、KR を持つ表と claims の group_id も追随させる（key_results の AFTER UPDATE）。
--   回の部署は画面からは変えられない（ガードのトリガー）。管理者が変えたときは資料・決定事項が追随する。
--   回を持つ表に入れる KR（見立て・学び・決定事項の kr_ids）は、回と同じ部署の KR に限る（トリガーで例外）。
--
-- 【誰が書いたか】updated_by（と confirmed_by・locked_by・deleted_by）は画面が送る値を使わず、
--   トリガーで current_member_id() に上書きする（メンバーとして解決できないとき＝サービスロール等は送られた値のまま）。
--
-- 【RLS】Section 39：SECURITY DEFINER 関数は (SELECT ...) で包み、単数の部署は @> ARRAY[group_id] で比べる。
--   物理削除はしない（Section 4）ので DELETE のポリシーは作らない（GRANT はあるが RLS で全件拒否される）。
--   取り消しは is_deleted（または claims の status）で行う。claims は答え（status）以外の列を変えられない（トリガー）。
--
-- 【確定の保存】okr_confirm_checkin(jsonb)（SECURITY INVOKER＝RLS が効く）が1トランザクションで書く。
--   途中で失敗したら何も書かれない（旧い行を取り消したまま新しい行が無い、にならない）。
--
-- 【MIN_CLIENT_VERSION は上げない】新しい表の追加だけ。既存の表・関数は変えない（key_results にトリガーを1本足す）。
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   末尾の確認は DO ブロック1本。全行が OK ならよい。NG があれば例外メッセージにその行が出る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0) 判定用のヘルパー（SECURITY DEFINER。RLS の中から呼ぶ）
-- ------------------------------------------------------------
-- 仕事の担当者（主担当＋副担当）の member_id の配列。削除済みの仕事・自分の部署に無い仕事は NULL
-- （rpc で直接呼んで他部署の仕事の担当者を調べられないように、呼んだ人の部署で絞る。スーパー管理者は全部）
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
     AND (t.group_ids && (SELECT public.current_member_group_ids())
          OR (SELECT public.current_member_is_super_admin()))
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

-- updated_by（と confirmed_by・locked_by・deleted_by）を書いた本人にする。画面が送った値は使わない。
-- メンバーとして解決できない（サービスロール等）ときは送られた値のまま。
-- 🔴 一部の表にしか無い列（confirmed_by 等）は、必ず「表の名前の IF」の内側の別の IF で読む。
--   `TG_TABLE_NAME = 'x' AND NEW.列` と1つの式に書くと、PL/pgSQL は式を丸ごと準備するので、
--   その列が無い表では「record "new" has no field」で INSERT/UPDATE がすべて失敗する（91-6 M1）。
--   OLD も同じ理由で、TG_OP = 'UPDATE' の IF の内側でだけ読む。
CREATE OR REPLACE FUNCTION public.okr_stamp_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn_okr_stamp_member$
DECLARE
  v_me text := (SELECT public.current_member_id());
BEGIN
  IF v_me IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.updated_by := v_me;
  IF TG_TABLE_NAME = 'okr_checkins' THEN
    IF NEW.confirmed_by IS NOT NULL THEN
      IF TG_OP = 'INSERT' THEN
        NEW.confirmed_by := v_me;
      ELSIF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        NEW.confirmed_by := v_me;
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'okr_tf_locks' THEN
    IF NEW.locked_by IS NOT NULL THEN
      NEW.locked_by := v_me;
    END IF;
  END IF;
  -- 取り消し（is_deleted が false→true）をしたのは必ず本人。取り消し済みの行で deleted_by を消す・書き換えることはできない
  IF TG_TABLE_NAME NOT IN ('okr_outcome_claims', 'okr_weekly_answers') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_deleted THEN
        NEW.deleted_by := v_me;
      END IF;
    ELSIF NEW.is_deleted AND NOT OLD.is_deleted THEN
      NEW.deleted_by := v_me;
    ELSIF NEW.is_deleted AND OLD.is_deleted THEN
      NEW.deleted_by := OLD.deleted_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_okr_stamp_member$;

-- claims は答え（status・answered_at）だけを変えられる。対象（成果の記述・仕事・担当者・部署）を付け替えて
-- 他部署の成果に yes を差し込めないように、画面（authenticated）からの付け替えは例外にする。
-- KR の部署が変わったときの追随（SECURITY DEFINER の関数の中＝current_user が所有者）は通す
CREATE OR REPLACE FUNCTION public.okr_claims_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn_okr_claims_guard$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.note_id IS DISTINCT FROM OLD.note_id
          OR NEW.task_id IS DISTINCT FROM OLD.task_id
          OR NEW.member_id IS DISTINCT FROM OLD.member_id
          OR NEW.group_id IS DISTINCT FROM OLD.group_id) THEN
    RAISE EXCEPTION '結びつきの対象（成果の記述・仕事・担当者・部署）は変えられません。変えられるのは答えだけです'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn_okr_claims_guard$;

-- 回の部署は画面からは変えられない（回に入っている見立て・学び・決定事項の KR の部署と食い違うため）
CREATE OR REPLACE FUNCTION public.okr_checkins_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn_okr_checkins_guard$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'チェックインの回の部署は変えられません' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn_okr_checkins_guard$;

-- 見立て・学び・成果の記述：KR と回の部署が同じであること。資料はその回のものであること（入れたとき・付け替えたときだけ見る）。
-- 成果の記述は回（最初に確定した回）が無い行があるので、そのときは見ない。資料の列は持たない。
-- 列と OLD は、その列を持つ表・UPDATE のときだけ、内側の IF で読む（stamp と同じ理由。91-6 M1）
CREATE OR REPLACE FUNCTION public.okr_check_kr_in_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_check_kr_in_checkin$
DECLARE
  v_ci text;
  v_kr text;
  v_has_resource boolean := TG_TABLE_NAME IN ('okr_kr_assessments', 'okr_learnings');
BEGIN
  IF NEW.checkin_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kr_id IS NOT DISTINCT FROM OLD.kr_id AND NEW.checkin_id IS NOT DISTINCT FROM OLD.checkin_id THEN
      IF NOT v_has_resource THEN
        RETURN NEW;
      END IF;
      IF NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  SELECT c.group_id INTO v_ci FROM public.okr_checkins c WHERE c.id = NEW.checkin_id;
  SELECT kr.group_id INTO v_kr FROM public.key_results kr WHERE kr.id = NEW.kr_id;
  IF v_ci IS NULL OR v_kr IS DISTINCT FROM v_ci THEN
    RAISE EXCEPTION 'KR とチェックインの回の部署が一致しません（%）', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  IF v_has_resource THEN
    IF NEW.resource_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.okr_resources r WHERE r.id = NEW.resource_id AND r.checkin_id = NEW.checkin_id) THEN
        RAISE EXCEPTION '資料がこの回のものではありません（%）', TG_TABLE_NAME USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_okr_check_kr_in_checkin$;

-- 決定事項：kr_ids はすべて回と同じ部署の KR。資料はその回のもの
CREATE OR REPLACE FUNCTION public.okr_check_decision_krs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_check_decision_krs$
DECLARE
  v_ci text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kr_ids IS NOT DISTINCT FROM OLD.kr_ids
       AND NEW.checkin_id IS NOT DISTINCT FROM OLD.checkin_id
       AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT c.group_id INTO v_ci FROM public.okr_checkins c WHERE c.id = NEW.checkin_id;
  IF v_ci IS NULL
     OR EXISTS (SELECT 1 FROM unnest(NEW.kr_ids) AS k(id)
                 WHERE NOT EXISTS (SELECT 1 FROM public.key_results kr WHERE kr.id = k.id AND kr.group_id = v_ci)) THEN
    RAISE EXCEPTION '決定事項の KR がチェックインの回の部署のものではありません' USING ERRCODE = '23514';
  END IF;
  IF NEW.resource_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.okr_resources r WHERE r.id = NEW.resource_id AND r.checkin_id = NEW.checkin_id) THEN
    RAISE EXCEPTION '資料がこの回のものではありません（okr_decisions）' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn_okr_check_decision_krs$;

-- KR の部署が変わったら、KR を持つ表と claims の group_id を追随させる（既存の trg_key_results_cascade_group_id とは別の1本）
CREATE OR REPLACE FUNCTION public.okr_cascade_kr_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_cascade_kr_group$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.okr_kr_defs        SET group_id = NEW.group_id WHERE kr_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
    UPDATE public.okr_kr_assessments SET group_id = NEW.group_id WHERE kr_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
    UPDATE public.okr_learnings      SET group_id = NEW.group_id WHERE kr_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
    UPDATE public.okr_outcome_notes  SET group_id = NEW.group_id WHERE kr_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
    UPDATE public.okr_outcome_claims c SET group_id = NEW.group_id
      FROM public.okr_outcome_notes n
     WHERE n.id = c.note_id AND n.kr_id = NEW.id AND c.group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_okr_cascade_kr_group$;

-- 回の部署が（管理者の操作で）変わったら、回を持つ表の group_id を追随させる
CREATE OR REPLACE FUNCTION public.okr_cascade_checkin_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_okr_cascade_checkin_group$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.okr_resources SET group_id = NEW.group_id WHERE checkin_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
    UPDATE public.okr_decisions SET group_id = NEW.group_id WHERE checkin_id = NEW.id AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_okr_cascade_checkin_group$;

-- jsonb 配列の和集合（先に入っている順を保つ）。p_key があればその項目で、無ければ要素まるごとで重複を除く
CREATE OR REPLACE FUNCTION public.okr_jsonb_union(p_a jsonb, p_b jsonb, p_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn_okr_jsonb_union$
  SELECT coalesce(jsonb_agg(s.e ORDER BY s.ord), '[]'::jsonb)
    FROM (SELECT DISTINCT ON (CASE WHEN p_key IS NULL THEN x.e ELSE x.e -> p_key END) x.e, x.ord
            FROM jsonb_array_elements(coalesce(p_a, '[]'::jsonb) || coalesce(p_b, '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
           ORDER BY CASE WHEN p_key IS NULL THEN x.e ELSE x.e -> p_key END, x.ord) s
$fn_okr_jsonb_union$;

REVOKE ALL ON FUNCTION public.okr_sync_group_from_kr()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_sync_group_from_checkin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_sync_group_from_note()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_stamp_member()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_claims_guard()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_checkins_guard()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_check_kr_in_checkin()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_check_decision_krs()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_cascade_kr_group()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_cascade_checkin_group()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.okr_jsonb_union(jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.okr_jsonb_union(jsonb, jsonb, text) TO authenticated;

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
-- 3) トリガー（updated_at・書いた本人・group_id・付け替えの禁止・部署の一致・部署の追随）
--    BEFORE トリガーは名前の順に動く：check → guard → stamp → sync_group → updated_at
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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_stamp ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_stamp BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.okr_stamp_member()', t, t);
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

  -- 付け替えの禁止（claims は答えだけ・回は部署を変えない）
  DROP TRIGGER IF EXISTS trg_okr_outcome_claims_guard ON public.okr_outcome_claims;
  CREATE TRIGGER trg_okr_outcome_claims_guard BEFORE UPDATE ON public.okr_outcome_claims
    FOR EACH ROW EXECUTE FUNCTION public.okr_claims_guard();
  DROP TRIGGER IF EXISTS trg_okr_checkins_guard ON public.okr_checkins;
  CREATE TRIGGER trg_okr_checkins_guard BEFORE UPDATE ON public.okr_checkins
    FOR EACH ROW EXECUTE FUNCTION public.okr_checkins_guard();

  -- KR と回の部署の一致（成果の記述は最初に確定した回と。回の無い行は見ない）
  FOREACH t IN ARRAY ARRAY['okr_kr_assessments', 'okr_learnings', 'okr_outcome_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_check ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.okr_check_kr_in_checkin()', t, t);
  END LOOP;
  DROP TRIGGER IF EXISTS trg_okr_decisions_check ON public.okr_decisions;
  CREATE TRIGGER trg_okr_decisions_check BEFORE INSERT OR UPDATE ON public.okr_decisions
    FOR EACH ROW EXECUTE FUNCTION public.okr_check_decision_krs();

  -- 部署の追随
  DROP TRIGGER IF EXISTS trg_key_results_cascade_okr_map ON public.key_results;
  CREATE TRIGGER trg_key_results_cascade_okr_map AFTER UPDATE ON public.key_results
    FOR EACH ROW EXECUTE FUNCTION public.okr_cascade_kr_group();
  DROP TRIGGER IF EXISTS trg_okr_checkins_cascade_group ON public.okr_checkins;
  CREATE TRIGGER trg_okr_checkins_cascade_group AFTER UPDATE ON public.okr_checkins
    FOR EACH ROW EXECUTE FUNCTION public.okr_cascade_checkin_group();
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
--   作る＝同じ部署の人が、その仕事の担当者あてに pending でだけ作れる（確定した人が届ける）。仕事の部署に成果の記述の部署が含まれること。
--   答える（UPDATE）＝member_id の本人だけ。変えられるのは答え（status・answered_at）だけで、
--   成果の記述・仕事・担当者・部署の付け替えは trg_okr_outcome_claims_guard が例外にする。DELETE なし
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
              AND public.task_group_ids(task_id) @> ARRAY[group_id]
              AND ((group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id])
                   OR (SELECT public.current_member_is_super_admin())));
CREATE POLICY "okr_outcome_claims_update" ON public.okr_outcome_claims
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));


-- ------------------------------------------------------------
-- 4b) 資料の確定の保存（1トランザクション）。SECURITY INVOKER なので RLS とトリガーがそのまま効く
--   p = {checkin:{id,group_id,date,title}, resource_ids:[uuid], hint_kr_ids:[text],
--        assessments:[{kr_id,resource_id,value,summary,basis,source,hint_value}],
--        learnings:[{kr_id,resource_id,kind,body,source}],
--        decisions:[{resource_id,kind,body,owner_member_id,kr_ids,source}],
--        notes:[{kr_id,note_key,change_text,excerpt,sources,links}],
--        claims:[{kr_id,note_key,task_id,member_id}]}
--   同じ資料を確定し直したときは、その回のその資料の分を取り消してから入れ直す。
--   成果の記述は (kr_id, note_key) で1行。すでにあれば、原文・増減・最初の回は変えず、出典と関連の仕事を DB 側で和集合にする
--   （同時に確定しても先の人の出典が消えない）。取り消し済みの記述は復活させない（和集合もしない・結びつきも作らない）。
--   結びつきは担当者あてに pending で作る（すでにあれば何もしない）。
--   同じ回の確定は pg_advisory_xact_lock で直列にする。取り消し済みの回は例外（55000）。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.okr_confirm_checkin(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn_okr_confirm_checkin$
DECLARE
  v_me    text := (SELECT public.current_member_id());
  v_ci    uuid := (p -> 'checkin' ->> 'id')::uuid;
  v_res   uuid[] := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(p -> 'resource_ids', '[]'::jsonb)) AS x);
  v_hint  text[] := ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(p -> 'hint_kr_ids', '[]'::jsonb)) AS x);
  v_now   timestamptz := now();
  v_notes jsonb;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、確定を保存できません' USING ERRCODE = '42501';
  END IF;
  -- 同じ回の確定を直列にする（2人が同時に確定しても、後の人は先の人の分を取り消してから入れ直す＝二重にならない）
  PERFORM pg_advisory_xact_lock(hashtext('okr_confirm_checkin:' || v_ci::text));
  -- 取り消し済みの回は確定しない（復活させない）
  IF EXISTS (SELECT 1 FROM public.okr_checkins c WHERE c.id = v_ci AND c.is_deleted) THEN
    RAISE EXCEPTION 'このチェックインの回は取り消されています。別の回を選んでください' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.okr_checkins (id, group_id, checkin_date, title, confirmed_by, confirmed_at, updated_by)
  VALUES (v_ci, p -> 'checkin' ->> 'group_id', (p -> 'checkin' ->> 'date')::date, coalesce(p -> 'checkin' ->> 'title', ''), v_me, v_now, v_me)
  ON CONFLICT (id) DO UPDATE
    SET checkin_date = EXCLUDED.checkin_date, title = EXCLUDED.title,
        confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at;

  IF cardinality(v_res) > 0 THEN
    UPDATE public.okr_kr_assessments SET is_deleted = true, deleted_at = v_now, deleted_by = v_me
     WHERE checkin_id = v_ci AND resource_id = ANY (v_res) AND is_deleted = false;
    UPDATE public.okr_learnings SET is_deleted = true, deleted_at = v_now, deleted_by = v_me
     WHERE checkin_id = v_ci AND resource_id = ANY (v_res) AND is_deleted = false;
    UPDATE public.okr_decisions SET is_deleted = true, deleted_at = v_now, deleted_by = v_me
     WHERE checkin_id = v_ci AND resource_id = ANY (v_res) AND is_deleted = false;
  END IF;
  IF cardinality(v_hint) > 0 THEN
    UPDATE public.okr_kr_assessments SET is_deleted = true, deleted_at = v_now, deleted_by = v_me
     WHERE checkin_id = v_ci AND kr_id = ANY (v_hint) AND resource_id IS NULL AND is_deleted = false;
  END IF;

  INSERT INTO public.okr_kr_assessments (checkin_id, kr_id, resource_id, value, summary, basis, source, hint_value, updated_by)
  SELECT v_ci, a ->> 'kr_id', (a ->> 'resource_id')::uuid, (a ->> 'value')::integer, coalesce(a ->> 'summary', ''),
         coalesce(nullif(a -> 'basis', 'null'::jsonb), '[]'::jsonb), nullif(a -> 'source', 'null'::jsonb), (a ->> 'hint_value')::numeric, v_me
    FROM jsonb_array_elements(coalesce(p -> 'assessments', '[]'::jsonb)) AS a;

  INSERT INTO public.okr_learnings (checkin_id, kr_id, resource_id, kind, body, source, updated_by)
  SELECT v_ci, l ->> 'kr_id', (l ->> 'resource_id')::uuid, l ->> 'kind', l ->> 'body', nullif(l -> 'source', 'null'::jsonb), v_me
    FROM jsonb_array_elements(coalesce(p -> 'learnings', '[]'::jsonb)) AS l;

  INSERT INTO public.okr_decisions (checkin_id, resource_id, kind, body, owner_member_id, kr_ids, source, updated_by)
  SELECT v_ci, (d ->> 'resource_id')::uuid, d ->> 'kind', d ->> 'body', d ->> 'owner_member_id',
         ARRAY(SELECT jsonb_array_elements_text(coalesce(d -> 'kr_ids', '[]'::jsonb))), nullif(d -> 'source', 'null'::jsonb), v_me
    FROM jsonb_array_elements(coalesce(p -> 'decisions', '[]'::jsonb)) AS d;

  WITH up AS (
    INSERT INTO public.okr_outcome_notes AS n (kr_id, note_key, checkin_id, change_text, excerpt, sources, links, updated_by)
    SELECT DISTINCT ON (x ->> 'kr_id', x ->> 'note_key')
           x ->> 'kr_id', x ->> 'note_key', v_ci, coalesce(x ->> 'change_text', ''), coalesce(x ->> 'excerpt', ''),
           coalesce(nullif(x -> 'sources', 'null'::jsonb), '[]'::jsonb), coalesce(nullif(x -> 'links', 'null'::jsonb), '[]'::jsonb), v_me
      FROM jsonb_array_elements(coalesce(p -> 'notes', '[]'::jsonb)) WITH ORDINALITY AS e(x, ord)
     ORDER BY x ->> 'kr_id', x ->> 'note_key', ord
    ON CONFLICT (kr_id, note_key) DO UPDATE
      SET sources    = public.okr_jsonb_union(n.sources, EXCLUDED.sources, NULL),
          links      = public.okr_jsonb_union(n.links, EXCLUDED.links, 'taskId')
      WHERE n.is_deleted = false
    RETURNING n.id, n.kr_id, n.note_key
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', up.id, 'kr_id', up.kr_id, 'note_key', up.note_key)), '[]'::jsonb)
    INTO v_notes FROM up;

  INSERT INTO public.okr_outcome_claims (note_id, task_id, member_id, status, updated_by)
  SELECT n.id, c ->> 'task_id', c ->> 'member_id', 'pending', v_me
    FROM jsonb_array_elements(coalesce(p -> 'claims', '[]'::jsonb)) AS c
    JOIN public.okr_outcome_notes n ON n.kr_id = c ->> 'kr_id' AND n.note_key = c ->> 'note_key' AND n.is_deleted = false
  ON CONFLICT (note_id, task_id, member_id) DO NOTHING;

  RETURN jsonb_build_object('notes', v_notes);
END;
$fn_okr_confirm_checkin$;

REVOKE ALL ON FUNCTION public.okr_confirm_checkin(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.okr_confirm_checkin(jsonb) TO authenticated;

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
    -- has_table_privilege に 'SELECT,INSERT,UPDATE' と並べると「どれか1つ」で真になるので、権限ごとに AND で見る
    v_ok := to_regclass('public.' || t) IS NOT NULL
        AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = t)
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t) = 3
        AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND cmd IN ('DELETE', 'ALL'))
        AND has_table_privilege('authenticated', 'public.' || t, 'SELECT')
        AND has_table_privilege('authenticated', 'public.' || t, 'INSERT')
        AND has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
        AND NOT has_table_privilege('anon', 'public.' || t, 'SELECT')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_stamp' AND NOT tgisinternal);
    v_lines := v_lines || (CASE WHEN coalesce(v_ok, false) THEN 'OK ' ELSE 'NG ' END || t || '（表・RLS・ポリシー3本・DELETEなし・GRANT 3種・書いた本人のトリガー）');
  END LOOP;

  v_ok := to_regprocedure('public.okr_task_assignee_ids(text)') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_kr()') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_checkin()') IS NOT NULL
      AND to_regprocedure('public.okr_sync_group_from_note()') IS NOT NULL
      AND to_regprocedure('public.okr_stamp_member()') IS NOT NULL
      AND to_regprocedure('public.okr_claims_guard()') IS NOT NULL
      AND to_regprocedure('public.okr_checkins_guard()') IS NOT NULL
      AND to_regprocedure('public.okr_check_kr_in_checkin()') IS NOT NULL
      AND to_regprocedure('public.okr_check_decision_krs()') IS NOT NULL
      AND to_regprocedure('public.okr_cascade_kr_group()') IS NOT NULL
      AND to_regprocedure('public.okr_cascade_checkin_group()') IS NOT NULL
      AND to_regprocedure('public.okr_jsonb_union(jsonb,jsonb,text)') IS NOT NULL;
  IF v_ok THEN
    v_ok := NOT has_function_privilege('anon', 'public.okr_task_assignee_ids(text)', 'EXECUTE');
  END IF;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || '関数12本（anon は okr_task_assignee_ids を呼べない）');

  -- 関数が無いと has_function_privilege が例外になるので、あるときだけ権限を見る
  IF to_regprocedure('public.okr_confirm_checkin(jsonb)') IS NULL THEN
    v_ok := false;
  ELSE
    v_ok := NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.okr_confirm_checkin(jsonb)'))
        AND has_function_privilege('authenticated', 'public.okr_confirm_checkin(jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.okr_confirm_checkin(jsonb)', 'EXECUTE');
  END IF;
  v_lines := v_lines || (CASE WHEN coalesce(v_ok, false) THEN 'OK ' ELSE 'NG ' END || '確定の保存 okr_confirm_checkin（SECURITY INVOKER・authenticated だけが呼べる）');

  v_ok := (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_okr_%_sync_group' AND NOT tgisinternal) = 7
      AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_okr_outcome_claims_guard', 'trg_okr_checkins_guard',
             'trg_okr_kr_assessments_check', 'trg_okr_learnings_check', 'trg_okr_outcome_notes_check', 'trg_okr_decisions_check',
             'trg_key_results_cascade_okr_map', 'trg_okr_checkins_cascade_group') AND NOT tgisinternal) = 8;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'group_id のトリガー7本・付け替えの禁止2本・部署の一致4本・部署の追随2本');

  RAISE EXCEPTION E'確認結果（全行が OK ならよい。この例外は結果の表示用で、何も書き込んでいない）:\n%', array_to_string(v_lines, E'\n');
END;
$verify_okr_map_records$;

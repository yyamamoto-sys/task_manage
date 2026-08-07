-- ============================================================
-- OKRモード再設計 Phase 1 Step A：個人OKR層の追加（DB・型・ストア層のみ）
-- 2026-08-07（v3.36）
--
-- 【正本】docs/dev/okr-redesign-plan.md（特に §3 データモデル・§4 RLS方針・§10 決定事項）
-- 一行で言うと：Kintoneが正本、このアプリはKintoneに存在しない「週の層」を埋める実行層。
--
-- 【今回作る5テーブル】
--   personal_krs            個人四半期KR（Kintone「個人KR_1〜8」の行化）
--   personal_kr_months      個人月次計画（Kintone取込＋人の決定）
--   personal_kr_weeks       ★週の目標状態（アプリだけが持つ・Kintoneに存在しない層）
--   personal_kr_week_tasks  週とタスクの紐づけ（多対多。自動候補＋明示リンク）
--   personal_kr_memos       KRごとのメモ（追記型）
-- 【今回は作らない】okr_knowledge_docs（Phase 5）／personal_kr_outlooks（Phase 3）
--
-- 【RLS方針（最重要）】全テーブル「本人のみ read/write」。20260727b_add_member_widget_layouts.sql
-- と同じ流儀＝current_member_id()（既存のSECURITY DEFINER関数。今回は新設しない）を使う。
-- 🔴 NULL猶予条項は一切書かない（`OR current_member_id() IS NULL` のような句は絶対に入れない。
-- 2026-06-26に全部署のデータを無制限公開する事故を起こした教訓。CLAUDE.md Section 1.6）。
--
-- 【RLSの実装方式：member_id冗長列 vs 親を辿るポリシー（今回の判断）】
-- personal_krs 以外の4テーブルは、列としての member_id を持たせず「親を辿るポリシー」を
-- 採用した（personal_kr_memos だけは監査用の著者列として member_id を持つが、RLSの根拠には
-- 使わない＝下記参照）。理由：
--   ・比較対象になる既存の2つの先例のうち、どちらがこのケースに近いかを検討した。
--     (a) 20260724_scope_okr_core_tables.sql（objectives→key_results→task_forces→todos）は
--         「列に自前のgroup_idを持たせ、BEFORE INSERT/UPDATEトリガーで親から自動注入・
--         AFTER UPDATEトリガーで子へカスケード」という重厚な設計を選んだ。これは
--         *複数部署・多人数が同じ行を読む共有データ*であり、JOINが4階層に及ぶため、
--         「結合を辿るRLSより堅牢」（=JOINロジックのバグが波及するリスクを避ける）という
--         判断が合理的だった。
--     (b) 20260723_scope_pj_task_satellite_tables.sql（milestones/project_analyses/
--         task_task_forces等）は、単一の親（project/task）にぶら下がる子テーブルに
--         member_idやgroup_idの列を新設せず、SECURITY DEFINERヘルパー関数で親のスコープを
--         引いて判定する「親を辿るポリシー」を選んだ。
--   ・個人OKRは (a) ではなく (b) に近い：①RLSの主体は単一メンバー（本人のみ）で複数部署の
--     読者がいる共有データではない、②JOINの深さは最大2ホップ
--     （personal_kr_week_tasks→personal_kr_weeks→personal_krs）に留まり4階層カスケードの
--     ような複雑さが無い、③1人あたりの行数は極小（四半期KRは最大でも十数本、月次計画は
--     KR×3か月、週は最大でもKR×6週間）。この規模・形状では「列を増やしてトリガーで
--     同期し続ける」コストが「親を辿るEXISTS/SECURITY DEFINER関数」のコストを上回る。
--   ・データモデル（本ファイル冒頭）自体も personal_kr_months / personal_kr_weeks /
--     personal_kr_week_tasks に member_id 列を持たせていない（docs/dev/okr-redesign-plan.md
--     §3-2〜§3-4の列定義どおり）。列が存在しないのに「RLSのためだけの列」を追加で生やすのは
--     本来のデータモデルに無い列を増やすことになり、避けた。
--   ・personal_kr_memos だけは元々 member_id 列を持つ（§3-5・「本人」の意味で著者を明示する
--     列）が、これをRLSの根拠にすると「member_id列の値さえ自分にしておけば、他人の
--     personal_kr_id にぶら下げたメモ行をINSERTできてしまう」というデータ整合性の緩みが
--     残る（実害は小さい＝結局RLSにより誰にも見えない孤立行が増えるだけだが、避けられる
--     緩みは避ける）。そこでmemos も他の3テーブルと同じく「personal_kr_id の所有者が
--     自分か」を親を辿って判定し、WITH CHECK では追加で「member_id列も自分自身であること」
--     を要求する（＝著者列としての整合性は保ちつつ、RLSの根拠は親トレースに一本化する）。
--
-- 【personal_kr_week_tasks は物理削除でよいと判断した】
-- 純粋な中間（多対多）テーブルであり、既存の task_task_forces / task_projects /
-- project_task_forces / quarterly_kr_task_forces と同型（id列を持たずPKが複合キー・
-- is_deletedを持たない）。これらは store.ts で insertX/deleteX の物理delete/insertとして
-- 扱われている（例：deleteTaskTaskForce）。「週とタスクを紐づけた」という関連そのものは
-- 独立した監査価値を持たない（紐づけを外しても、タスク自体の変更履歴・週自体の内容は
-- 別テーブルに残り続ける）ため、既存の同型テーブル群と同じ扱いにする。
--
-- 【personal_krs / personal_kr_months / personal_kr_weeks / personal_kr_memos は論理削除】
-- いずれも本人が書いた実質的な内容（KR定義・月次計画・週の目標状態と自己評価・メモ）を
-- 持つため、CLAUDE.md Section 4（物理削除禁止）に従い is_deleted/deleted_at/deleted_by の
-- フルセットを持たせる（kr_declarations等の is_deleted のみの簡易形ではなく、tasks等と
-- 同じ「誰がいつ消したか」まで残す完全な形を採用した。個人の四半期を跨いだ振り返りで
-- 「いつ・誰が」の記録が意味を持ちうるため）。
--
-- 【week_index の上限は5ではなく6にした（計画書との差分・要注意）】
-- docs/dev/okr-redesign-plan.md §3-3 は「week_index int NOT NULL、1〜5」としているが、
-- 実装に使う既存のカレンダー週アルゴリズム（ganttUtils.ts→src/lib/date/monthWeeks.ts、
-- v3.09から不変）で実際の2026年8月（今月）を計算すると、月初が土曜日のため
-- W1=8/1-8/2の2日・W2〜W5が7日ずつ・月末8/31（月曜）が単独でW6になり、**6週になる**
-- （検証はmonthWeeks.test.tsに実カレンダーで固定）。CHECK制約を1〜5のままにすると、
-- 今月のようなケースで週データの登録自体が失敗する事故になるため、1〜6に広げた。
-- 画面側（Phase 1 Step B）のタブ表示が「W1〜W5」を前提にしている場合はそちらで
-- 別途対応が必要（本マイグレーションのスコープ外）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: personal_krs（個人四半期KR）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_krs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        text NOT NULL REFERENCES members(id),      -- 本人。RLSの主体
  group_id         text NOT NULL REFERENCES groups(id),        -- 部署の集計・将来の公開範囲拡張用。RLSはmember_idのみで判定し、これで緩めない
  fiscal_year      integer NOT NULL,
  quarter          text NOT NULL CHECK (quarter IN ('1Q','2Q','3Q','4Q')),
  kr_kind          text NOT NULL CHECK (kr_kind IN ('group_kr','general','company_common','om_common','agm_common','leader_common')),
  key_result_id    text REFERENCES key_results(id),             -- kr_kind='group_kr' のときのみ使用
  task_force_id    text REFERENCES task_forces(id),
  label            text NOT NULL,
  weight_pct       numeric NOT NULL DEFAULT 0,                  -- 合計100%は警告のみ・DB制約では強制しない
  category         text,
  activity         text,
  strength_role    text,
  weakness_role    text,
  criteria         text,
  supplement       text,
  display_order    integer NOT NULL DEFAULT 0,
  imported_at      timestamptz,
  source_label     text,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

-- ============================================================
-- ブロック2: personal_kr_months（個人月次計画）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_months (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id         uuid NOT NULL REFERENCES personal_krs(id),
  month                  date NOT NULL,                          -- 月初（YYYY-MM-01）
  month_index            integer NOT NULL CHECK (month_index IN (1,2,3)),
  positioning            text,
  activities             text,
  target_and_evidence    text,
  risks                  text,
  band_target            integer CHECK (band_target IS NULL OR band_target IN (60,70,80,90,100)),
  band_override          integer CHECK (band_override IS NULL OR band_override IN (60,70,80,90,100)),
  band_override_by       text REFERENCES members(id),
  band_override_at       timestamptz,
  weight_override_pct    numeric,
  review_text            text,
  self_eval_pct          numeric,
  gm_eval_pct            numeric,
  gm_comment             text,
  imported_at            timestamptz,
  source_label           text,
  is_deleted             boolean NOT NULL DEFAULT false,
  deleted_at             timestamptz,
  deleted_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text NOT NULL DEFAULT '',
  UNIQUE (personal_kr_id, month)
);

-- ============================================================
-- ブロック3: personal_kr_weeks（★週の目標状態。アプリだけが持つ層）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_weeks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id   uuid NOT NULL REFERENCES personal_krs(id),
  month            date NOT NULL,                                -- 月次計画と突き合わせるための冗長保持
  week_index       integer NOT NULL CHECK (week_index BETWEEN 1 AND 6),  -- 上限を6にした理由は本ファイル冒頭コメント参照
  week_start       date NOT NULL,
  week_end         date NOT NULL,
  goal_state       text,
  self_rating      text CHECK (self_rating IS NULL OR self_rating IN ('o','t','x')),
  rated_at         timestamptz,
  note             text,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT '',
  UNIQUE (personal_kr_id, month, week_index),
  CONSTRAINT personal_kr_weeks_date_range_check CHECK (week_end >= week_start)
);

-- ============================================================
-- ブロック4: personal_kr_week_tasks（週とタスクの紐づけ。多対多・物理削除でよい中間テーブル）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_week_tasks (
  week_id    uuid NOT NULL REFERENCES personal_kr_weeks(id),
  task_id    text NOT NULL REFERENCES tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_id, task_id)
);

-- ============================================================
-- ブロック5: personal_kr_memos（KRごとのメモ・追記型）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_memos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id   uuid NOT NULL REFERENCES personal_krs(id),
  member_id        text NOT NULL REFERENCES members(id),  -- 著者列（監査用）。RLSの根拠には使わない（本ファイル冒頭コメント参照）
  body             text NOT NULL,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

-- ============================================================
-- ブロック6: updated_at トリガー（personal_kr_week_tasks は対象外＝updated_at列を持たない）
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN VALUES
    ('personal_krs'), ('personal_kr_months'), ('personal_kr_weeks'), ('personal_kr_memos')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at
         BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION update_updated_at();', t);
  END LOOP;
END $$;

-- ============================================================
-- ブロック7: RLSヘルパー関数（親を辿る所有者判定。current_member_id()は新設しない＝既存を使う）
-- ============================================================

-- personal_kr_id → その personal_krs 行の所有者 member_id（1ホップ）
CREATE OR REPLACE FUNCTION personal_kr_owner_member_id(p_personal_kr_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_personal_kr_owner$
  SELECT member_id FROM public.personal_krs WHERE id = p_personal_kr_id
$fn_personal_kr_owner$;

GRANT EXECUTE ON FUNCTION personal_kr_owner_member_id(uuid) TO authenticated;

-- week_id → personal_kr_weeks → personal_krs の所有者 member_id（2ホップ）
CREATE OR REPLACE FUNCTION personal_kr_week_owner_member_id(p_week_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_personal_kr_week_owner$
  SELECT pk.member_id
  FROM public.personal_kr_weeks w
  JOIN public.personal_krs pk ON pk.id = w.personal_kr_id
  WHERE w.id = p_week_id
$fn_personal_kr_week_owner$;

GRANT EXECUTE ON FUNCTION personal_kr_week_owner_member_id(uuid) TO authenticated;

-- ============================================================
-- ブロック8: RLS有効化＋ポリシー（本人のみ。NULL猶予条項は一切書かない）
-- ============================================================
ALTER TABLE personal_krs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_months     ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_weeks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_week_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_memos      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_krs_own" ON personal_krs;
CREATE POLICY "personal_krs_own" ON personal_krs
  FOR ALL TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

DROP POLICY IF EXISTS "personal_kr_months_own" ON personal_kr_months;
CREATE POLICY "personal_kr_months_own" ON personal_kr_months
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_weeks_own" ON personal_kr_weeks;
CREATE POLICY "personal_kr_weeks_own" ON personal_kr_weeks
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_week_tasks_own" ON personal_kr_week_tasks;
CREATE POLICY "personal_kr_week_tasks_own" ON personal_kr_week_tasks
  FOR ALL TO authenticated
  USING (personal_kr_week_owner_member_id(week_id) = current_member_id())
  WITH CHECK (personal_kr_week_owner_member_id(week_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_memos_own" ON personal_kr_memos;
CREATE POLICY "personal_kr_memos_own" ON personal_kr_memos
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (
    personal_kr_owner_member_id(personal_kr_id) = current_member_id()
    AND member_id = current_member_id()
  );

-- ============================================================
-- ブロック9: インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_personal_krs_member_id            ON personal_krs(member_id)           WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_months_personal_kr_id ON personal_kr_months(personal_kr_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_weeks_personal_kr_id  ON personal_kr_weeks(personal_kr_id)  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_week_tasks_task_id    ON personal_kr_week_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_personal_kr_memos_personal_kr_id  ON personal_kr_memos(personal_kr_id) WHERE is_deleted = false;

-- ============================================================
-- ブロック10: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 5テーブルが作成されたか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name LIKE 'personal_kr%'
--   ORDER BY table_name;
-- → personal_kr_memos / personal_kr_months / personal_kr_week_tasks / personal_kr_weeks / personal_krs の5件であること

-- 2) 全テーブルにRLSが有効化されているか（relrowsecurity = true であること）
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname LIKE 'personal_kr%' AND relkind = 'r';

-- 3) 緩いポリシー（部署・本人チェックを含まない USING(true) 等）が残っていないか（0件であること）
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename LIKE 'personal_kr%'
--   AND coalesce(qual, '') NOT ILIKE '%current_member_id%'
--   AND coalesce(qual, '') NOT ILIKE '%personal_kr_owner_member_id%'
--   AND coalesce(qual, '') NOT ILIKE '%personal_kr_week_owner_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%current_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%personal_kr_owner_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%personal_kr_week_owner_member_id%';
-- → 0行であること

-- 4) NULL猶予条項（IS NULLでの抜け穴）が無いか（0件であること）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename LIKE 'personal_kr%'
--   AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');
-- → 0行であること

-- 5) ヘルパー関数が自分のKR・週に対して正しい member_id を返すか（ログイン中のユーザーで、
--    自分のpersonal_kr_id/week_idを実際にINSERTしてから実行して確認）
-- SELECT personal_kr_owner_member_id('<自分のpersonal_krs.id>');
-- SELECT personal_kr_week_owner_member_id('<自分のpersonal_kr_weeks.id>');
-- → どちらも current_member_id() と同じ値が返ること

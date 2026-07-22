-- 複数部署アクセス（メンバーの兼務・プロジェクトの部署横断）フェーズ1：DBマイグレーション
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】新しい部署を作ろうとした際に「同じメールアドレスで2つの部署にメンバー登録しようと
-- して 23505 duplicate key value violates unique constraint "members_email_unique" に遭遇」
-- した（山本さん自身がAID・EGGの2部署を掛け持ちしているため）。既存の members/projects/tasks
-- はいずれも「1つの部署（group_id）」しか持てない設計だったため、これを拡張する。
-- プラン正本：quirky-exploring-sundae.md（2026-07-03 山本さん承認済み）。設計は変更していない。
--
-- 【今回のスコープ】このマイグレーションのみ。フロントエンド（appStore.ts / AdminView.tsx /
-- 部署切替UI等）は次フェーズで別途対応する。プランの「⑤ロールアウト順序」に従い、
-- マイグレーション適用 → バックフィル検証 → フロント未デプロイのまま既存挙動確認、の順を守ること。
-- このファイルを適用しただけでは画面の見た目・挙動は一切変わらない（既存の group_id ベースの
-- 判定と新しい group_ids ベースの判定は、通常運用下では同じ結果になるよう設計されている）。
--
-- 【重要】このファイルは13ブロックに分かれています。一括実行で失敗する場合はブロックごとに
-- 区切って実行し、失敗箇所を特定してください（関数ごとに固有のドル引用タグを使用）。
--
-- 【データモデル】既存の owner_member_ids/member_ids（projects）・assignee_member_ids（tasks）
-- と同じ「配列カラム」方式。joinテーブルは作らない。
--   members.group_id  （既存・スカラー）＝「ホーム部署」。is_admin の権限スコープは今回変更しない
--   members.group_ids （新規・配列）　　＝「アクセス可能な部署の全リスト」。ホーム部署を必ず含む
--   projects.group_id / group_ids       ＝ 同上（PJの主部署／アクセス可能な部署の全リスト）
--   tasks.group_ids   （新規・配列）    ＝ アプリからは直接編集させず、DBトリガーが唯一の真実
--     （プロジェクト紐づきタスクはプロジェクトのgroup_idsを継承、独立タスクはホーム部署のみ）
--
-- 【適用後すぐにやること】ブロック13の確認クエリを必ず実行し、全て0件であることを確認する。
-- 0件でなければ次フェーズ（フロント）に進まないこと。

-- ============================================================
-- ブロック1: members / projects / tasks に group_ids 列を追加
-- ============================================================
ALTER TABLE members  ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';

-- ============================================================
-- ブロック2: members の既存データをバックフィル（group_ids = ARRAY[group_id]）
--
-- 【注意】バックフィルのUPDATE自体が trg_members_updated_at（BEFORE UPDATE、無条件で
-- updated_at=NOW()にする既存トリガー）を再発火させ、既存の全メンバーのupdated_atが
-- 一律で「今」になってしまう副作用があるため、バックフィルの間だけ一時的に無効化する。
-- guard_member_privilege_columns トリガーはこの時点ではまだ group_ids を一切参照しない
-- （旧バージョンのまま。フェーズ3の拡張はブロック11で行う）ため無効化不要＝このUPDATEに対して
-- 無害。
-- ============================================================
ALTER TABLE members DISABLE TRIGGER trg_members_updated_at;

UPDATE members
SET group_ids = array_append(group_ids, group_id)
WHERE group_id IS NOT NULL
  AND NOT (group_id = ANY(group_ids));

ALTER TABLE members ENABLE TRIGGER trg_members_updated_at;

-- ============================================================
-- ブロック3: projects の既存データをバックフィル（同上の理由でtrg_projects_updated_atを一時無効化）
-- ============================================================
ALTER TABLE projects DISABLE TRIGGER trg_projects_updated_at;

UPDATE projects
SET group_ids = array_append(group_ids, group_id)
WHERE group_id IS NOT NULL
  AND NOT (group_id = ANY(group_ids));

ALTER TABLE projects ENABLE TRIGGER trg_projects_updated_at;

-- ============================================================
-- ブロック4: 不変条件をCHECK制約で強制（members / projects のみ。tasksはDBトリガーが
-- 唯一の真実のため対象外＝プラン記載どおり）
--
-- ブロック2・3のバックフィルが完了した後に追加すること（CHECK制約はADD時点で既存の
-- 全行を検証するため、バックフィル前に追加すると必ず失敗する）。
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_group_id_in_group_ids'
  ) THEN
    ALTER TABLE members
      ADD CONSTRAINT members_group_id_in_group_ids
      CHECK (group_id IS NULL OR group_id = ANY(group_ids));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_group_id_in_group_ids'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_group_id_in_group_ids
      CHECK (group_id IS NULL OR group_id = ANY(group_ids));
  END IF;
END $$;

-- ============================================================
-- ブロック5: tasks の既存データをバックフィル
--
-- project_id がある場合はそのプロジェクトの group_ids（ブロック3で既にバックフィル済み）を
-- そのまま採用、無い場合はホーム部署（tasks.group_id）のみの配列にする。
-- 【注意】このUPDATEも trg_tasks_updated_at を再発火させる（既存の全タスクのupdated_atが
-- 一律で「今」になる）ため、バックフィルの間だけ一時的に無効化する。tasks には他に
-- group_ids を参照するトリガーがまだ存在しない時点（sync_task_group_idsはブロック8で作成）
-- なので無効化はこの1トリガーのみで足りる。
-- ============================================================
ALTER TABLE tasks DISABLE TRIGGER trg_tasks_updated_at;

WITH computed AS (
  SELECT
    t.id,
    CASE
      WHEN t.project_id IS NOT NULL THEN
        COALESCE(p.group_ids, CASE WHEN t.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[t.group_id] END)
      WHEN t.group_id IS NULL THEN '{}'::text[]
      ELSE ARRAY[t.group_id]
    END AS new_group_ids
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
)
UPDATE tasks t
SET group_ids = c.new_group_ids
FROM computed c
WHERE t.id = c.id
  AND t.group_ids IS DISTINCT FROM c.new_group_ids;

ALTER TABLE tasks ENABLE TRIGGER trg_tasks_updated_at;

-- ============================================================
-- ブロック6: RLSヘルパー関数（新規）current_member_group_ids()
--
-- 既存の current_member_group_id()（単数・ホーム部署）は変更せず併存させる
-- （is_admin判定・新規レコードのデフォルト割当は引き続きこちらを基準にする）。
-- ============================================================
CREATE OR REPLACE FUNCTION current_member_group_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_group_ids$
  SELECT group_ids FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_group_ids$;

-- ============================================================
-- ブロック7: members / projects / tasks の RLS ポリシーを配列オーバーラップに置き換え
--
-- 【重要】既存の「OR current_member_is_super_admin()」条項はそのまま維持する
-- （super-adminは引き続き全部署を閲覧・編集可）。「追加部署は閲覧のみ・ホーム部署とホーム
-- 以外の兼務先は編集可」という権限の強弱は、DB側では表現せずフロント側（次フェーズ）で
-- 制御する方針（プランどおり）。
-- ============================================================
DROP POLICY IF EXISTS "members_group" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "tasks_group" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

-- ============================================================
-- ブロック8: tasks.group_ids はDBトリガーが唯一の真実（アプリからは直接編集させない）
--
-- BEFORE INSERT OR UPDATE：project_id があればそのプロジェクトの group_ids をコピー、
-- なければホーム部署（tasks.group_id）のみに正規化する。クライアントが送ってきた
-- group_ids の値は常にこのトリガーが上書きするため、フロントが未対応のこのフェーズ1の
-- 間も安全に機能する（クライアントは group_ids というカラムの存在自体を知らないまま）。
-- ============================================================
CREATE OR REPLACE FUNCTION sync_task_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_task_group_ids$
DECLARE
  proj_group_ids text[];
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT group_ids INTO proj_group_ids FROM public.projects WHERE id = NEW.project_id;
    IF proj_group_ids IS NULL THEN
      -- 参照先PJが見つからない異常系（通常は起きない）。ホーム部署のみへフォールバック
      NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
    ELSE
      NEW.group_ids := proj_group_ids;
    END IF;
  ELSE
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  END IF;
  RETURN NEW;
END;
$fn_sync_task_group_ids$;

DROP TRIGGER IF EXISTS trg_tasks_sync_group_ids ON tasks;
CREATE TRIGGER trg_tasks_sync_group_ids
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_group_ids();

-- ============================================================
-- ブロック9: projects.group_ids が変化したら配下タスクへカスケード反映
--
-- 【既知の副作用（プラン記載どおり）】部署構成（projects.group_ids）を変更すると、
-- 配下タスク全部の updated_at が動く。開いているタスク編集フォームで ConflictError が
-- 出うるが、既知の挙動として受け入れる（B3自動リスケ連鎖等、既存の他機能と同種の割り切り）。
-- ============================================================
CREATE OR REPLACE FUNCTION cascade_project_group_ids_to_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_pj_group_ids$
BEGIN
  IF NEW.group_ids IS DISTINCT FROM OLD.group_ids THEN
    UPDATE public.tasks
    SET group_ids = NEW.group_ids
    WHERE project_id = NEW.id
      AND group_ids IS DISTINCT FROM NEW.group_ids;
  END IF;
  RETURN NEW;
END;
$fn_cascade_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_cascade_group_ids ON projects;
CREATE TRIGGER trg_projects_cascade_group_ids
  AFTER UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION cascade_project_group_ids_to_tasks();

-- ============================================================
-- ブロック10: projects.group_ids の正規化トリガー（安全網）
--
-- 【このトリガーを追加する理由（プラン本文には明記が無いための補足）】
-- プロジェクトの group_ids はプラン上「全員編集可・特別なゲーティングなし」の設計。
-- ただし今回はフロント（AdminView.tsx）を一切変更しないフェーズ1のため、既存のPJ編集
-- フォームは group_ids というカラムの存在をまだ知らない。もし誰かが既存機能（部署ドロップ
-- ダウン）でPJの group_id（ホーム部署）だけを変更した場合、group_ids 側が追従せず
-- ブロック4のCHECK制約（group_id = ANY(group_ids)）に違反して保存が失敗し、フロント未対応の
-- この期間中に既存機能を壊してしまう。それを防ぐため、group_id が group_ids に含まれない
-- 場合は自動的に追加するだけの非破壊的な正規化トリガーを設ける（既存のgroup_idsから何かを
-- 取り除くことは一切しない＝安全側）。
-- ============================================================
CREATE OR REPLACE FUNCTION normalize_project_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_normalize_pj_group_ids$
BEGIN
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(NEW.group_ids)) THEN
    NEW.group_ids := array_append(NEW.group_ids, NEW.group_id);
  END IF;
  RETURN NEW;
END;
$fn_normalize_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_normalize_group_ids ON projects;
CREATE TRIGGER trg_projects_normalize_group_ids
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION normalize_project_group_ids();

-- ============================================================
-- ブロック11: guard_member_privilege_columns() を拡張（フェーズ3：group_ids の権限ガード）
--
-- 【権限設計（プランどおり）】
-- ・group_ids（追加部署アクセス）の直接付与・剥奪は super-admin 限定。
-- ・非super-adminがホーム部署（group_id）を付け替えた場合（部署ブートストラップ含む）は、
--   group_ids を新ホーム部署のみにリセット（既存の複数部署アクセスを追記のまま残さない）。
--   これをやらないと「部署admin が group_id 変更経由で複数部署アクセスを迂回的に付与できる」
--   抜け道になる。
-- ・新規作成（INSERT）も同じ理由でホーム部署のみへ強制する（既存行が無いため常に「変更あり」
--   として扱う）。
-- ・super-admin（既存 or フェーズ1で自己昇格した本人）は自由に付与・剥奪してよい。
-- ・常に NEW.group_id が NEW.group_ids に含まれるよう最終正規化する。
--
-- 以下は既存のフェーズ1・フェーズ2ロジックを一切変更せず、フェーズ3を追記したもの
-- （新規トリガーに分割せず既存関数に追記＝実行順序の懸念を避ける、という既存の設計方針を踏襲）。
-- ============================================================
CREATE OR REPLACE FUNCTION guard_member_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard$
DECLARE
  dept_admin_count    integer;
  super_admin_count   integer;
  acting_super_admin  boolean;
  will_be_super_admin boolean;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
  old_group_ids       text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
  END IF;

  acting_super_admin := public.current_member_is_super_admin();

  -- フェーズ1: is_super_admin（全社ロール。他人の代理昇格は不可、自分自身のみブートストラップ可）
  IF NEW.is_super_admin IS DISTINCT FROM old_is_super_admin THEN
    IF acting_super_admin THEN
      NULL;
    ELSE
      SELECT count(*) INTO super_admin_count
      FROM public.members
      WHERE is_super_admin = true AND is_deleted = false;

      IF super_admin_count = 0 AND NEW.email = auth.email() THEN
        NULL;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  will_be_super_admin := NEW.is_super_admin;

  -- フェーズ2: is_admin / group_id（部署内権限・所属）
  IF NEW.is_admin IS DISTINCT FROM old_is_admin
     OR NEW.group_id IS DISTINCT FROM old_group_id THEN

    IF acting_super_admin OR will_be_super_admin THEN
      NULL; -- super-admin（既存 or フェーズ1で自己昇格した本人）は自由に変更可
    ELSIF public.current_member_is_admin() THEN
      NULL; -- 部署管理者は変更可（部署越境はRLSが別途ブロック）
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      IF dept_admin_count = 0 THEN
        NULL; -- 部署ブートストラップ：その部署にis_admin=trueが1人もいなければ許可
      ELSE
        NEW.is_admin  := old_is_admin;
        NEW.group_id  := old_group_id;
      END IF;
    END IF;
  END IF;

  -- フェーズ3（新規）: group_ids（追加部署アクセス）
  -- 【注意】NEW.group_id はフェーズ2で既に最終確定済み（差し戻された場合は old_group_id と
  -- 一致する）ため、ここで比較する NEW.group_id は「実際に許可された変更後の値」になっている。
  IF acting_super_admin OR will_be_super_admin THEN
    NULL; -- super-adminは自由に付与・剥奪可（末尾の正規化で group_id 包含だけ保証する）
  ELSIF TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM old_group_id THEN
    -- 新規作成、または非super-adminによるホーム部署の付け替え：ホーム部署のみにリセット
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  ELSE
    -- 既存行・ホーム部署不変：group_ids 自体の直接変更は非super-adminには許可せず差し戻す
    NEW.group_ids := old_group_ids;
  END IF;

  -- 常に NEW.group_id が NEW.group_ids に含まれるよう最終正規化する（安全網）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(COALESCE(NEW.group_ids, '{}'::text[]))) THEN
    NEW.group_ids := array_append(COALESCE(NEW.group_ids, '{}'::text[]), NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_guard$;

DROP TRIGGER IF EXISTS trg_members_guard_privilege ON members;
CREATE TRIGGER trg_members_guard_privilege
  BEFORE INSERT OR UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION guard_member_privilege_columns();

-- ============================================================
-- ブロック12: guard_group_deletion() を拡張（追加部署アクセスとしてのみ所属するメンバーも
-- 「非空」判定に含める）
--
-- 従来はその部署が group_id（ホーム部署）のメンバーの有無だけで判定していたため、
-- 誰かがその部署を「追加部署アクセス」としてのみ持っている場合に削除をブロックできなかった
-- 穴を塞ぐ。
-- ============================================================
CREATE OR REPLACE FUNCTION guard_group_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard_group_del$
DECLARE
  active_member_count integer;
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    IF public.current_member_is_super_admin() THEN
      RETURN NEW; -- super-adminは非空の部署でも強制削除可（統廃合用途）
    END IF;

    SELECT count(*) INTO active_member_count
    FROM public.members
    WHERE (group_id = OLD.id OR OLD.id = ANY(group_ids))
      AND is_deleted = false;

    IF active_member_count > 0 THEN
      RAISE EXCEPTION
        'このグループには % 名のアクティブなメンバー（追加部署アクセスとして所属する人を含む）がいるため削除できません（全社スーパー管理者のみ強制削除可）',
        active_member_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn_guard_group_del$;

DROP TRIGGER IF EXISTS trg_groups_guard_deletion ON groups;
CREATE TRIGGER trg_groups_guard_deletion
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION guard_group_deletion();

-- ============================================================
-- ブロック13: 適用後、次フェーズに進む前に必ず実行して確認するクエリ集
--
-- 山本さんへ：以下を SQL Editor で実行し、①が全て 0 件、②・③に想定外の行が
-- 出ないことを確認してから「バックフィル検証OK」として次フェーズ（フロント実装）へ
-- 進めてください。1つでも0件でない・想定外の行があれば、そのまま次フェーズに進まず
-- 報告してください。
-- ============================================================

-- ① プランに定められたバックフィル検証クエリ（全て 0 件であること）
SELECT 'members' AS tbl, count(*) FROM members WHERE group_id IS NOT NULL AND NOT (group_id = ANY(group_ids))
UNION ALL
SELECT 'projects', count(*) FROM projects WHERE group_id IS NOT NULL AND NOT (group_id = ANY(group_ids))
UNION ALL
SELECT 'tasks', count(*) FROM tasks WHERE group_id IS NOT NULL AND NOT (group_id = ANY(group_ids));
-- 全て 0 件であること

-- ② 補足確認：group_id が非NULLなのに group_ids が空配列のまま、という取りこぼしが無いこと
--    （①が0件なら理論上ここも0件になるはずだが、念のため別の切り口で二重チェックする）
SELECT 'members' AS tbl, count(*) FROM members WHERE group_id IS NOT NULL AND group_ids = '{}'
UNION ALL
SELECT 'projects', count(*) FROM projects WHERE group_id IS NOT NULL AND group_ids = '{}'
UNION ALL
SELECT 'tasks', count(*) FROM tasks WHERE group_id IS NOT NULL AND group_ids = '{}';
-- 全て 0 件であること

-- ③ 補足確認：project_id を持つタスクの group_ids が、そのプロジェクトの group_ids と
--    一致していること（トリガーの継承ロジックが正しくバックフィルされているかの確認）
SELECT count(*) AS mismatched_task_project_group_ids
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE t.group_ids IS DISTINCT FROM p.group_ids;
-- 0 件であること

-- ④ 参考：現時点の部署別・アクセス範囲別のメンバー数（実データの雰囲気を確認したい場合）
SELECT group_id AS home_group_id, count(*) AS member_count
FROM members
WHERE is_deleted = false
GROUP BY group_id
ORDER BY group_id;

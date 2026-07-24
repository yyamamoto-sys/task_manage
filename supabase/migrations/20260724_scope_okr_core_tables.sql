-- OKRコア階層（objectives / key_results / task_forces / todos）のDBレベル部署分離
-- 適用方法: Supabase SQL Editor に全文を一括で貼って実行する（dev → prod の順）
--   （分割せず一括で。失敗時はトランザクションごと巻き戻る）
--
-- 【背景・山本さんからの明確な指示】
-- 「データは部署ごとに明確にデータベースを分けて、どんなエラーが起こっても別部署との
-- 干渉が起こらないように」。OKR系テーブルはschema.sql line 577-589のDOループで全て
-- 「authenticated full access」（USING(true) WITH CHECK(true)）＝ログイン済みなら誰でも
-- 全部署のOKRデータを受信・書込可能なまま残っていた。members/projects/tasksは
-- 20260626/20260702b/20260722bで部署分離済みだが、OKR系だけこの穴が残っていた
-- （objectivesはv2.94・20260723bでgroup_id列を追加したが、RLSは表示絞り込み用UI対応の
-- みで据え置きのままだった＝CLAUDE.md Section 1.6・Section 9のG参照）。
--
-- 【今回のスコープ＝コア階層4テーブルのみ（第1弾）】
--   objectives / key_results / task_forces / todos
-- 【今回は触らない（第2弾で別途対応）】
--   kr_sessions / kr_declarations / kr_meeting_notes / kr_note_tf_entries /
--   okr_analyses / kr_reports / quarterly_objectives / quarterly_kr_task_forces
--   （引き続き「authenticated full access」のまま残す）
--   member_tags 本体（全社共通マスタとして従来どおり全公開のまま。触らない）
--
-- 【設計の核】各テーブルに自前のgroup_id列を持たせ、DBトリガーで親から自動注入する。
-- 結合を辿るRLSより堅牢＝「どんなバグでも干渉しない」を満たすため（親を辿るRLSにすると、
-- 親側のポリシーやJOINロジックのバグが子テーブルにも波及するリスクがある。列そのものに
-- group_idを持たせ、単純な `group_id = ANY(...)` 比較にすることで、ポリシーの複雑さと
-- そのぶんのバグ余地を最小化する）。
--   key_results.group_id  ← objective_id 経由で objectives.group_id を継承
--   task_forces.group_id  ← kr_id 経由で key_results.group_id を継承（＝Objective経由）
--   todos.group_id        ← tf_id 経由で task_forces.group_id を継承
--   objectivesは既にgroup_id保有（追加不要）
--
-- 【フロント無改修の設計】KeyResult/TaskForce/ToDoのTypeScript型（src/lib/localData/types.ts）
-- はgroup_id列を持たないため、saveKeyResult/saveTaskForce/saveTodo（appStore.ts経由の
-- upsertKeyResult/upsertTaskForce/upsertToDo）は今後もgroup_idを一切送らない。
-- BEFORE INSERT/UPDATEトリガーが常に親から正しい部署を上書き注入するため、フロントが
-- 何を送ってきても（何も送らなくても）DBの列は必ず正しい値になる。saveObjectiveは
-- v2.94から既にgroup_idを送るため無改修（Objectiveには親がいないため注入トリガー不要）。
--
-- 【過去のRLSインシデントの教訓（CLAUDE.md Section 1.6「過去に実際に起きた事故と教訓」）】
-- 2026-06-26の初回実装で「移行期間の猶予」として入れたOR NULL条項が、未登録ユーザーに
-- 全部署データを無制限公開する抜け穴になっていた。本マイグレーションでは：
--   ・NULL許可の猶予条項は一切書かない（group_id IS NULL を許可する句を含めない）。
--   ・データ側のgroup_idがnullの行は `null = ANY(...)` が偽になり自動的に隠れる
--     （安全側に倒れる＝正しい挙動。特別扱いのコードは書かない）。
--   ・緩いポリシー「authenticated full access」は、新ポリィ作成前に必ずDROPする
--     （緩いポリシーの残存によりORでtrueになり分離が効かなかった、という直接の教訓）。
--
-- 【関連migrationファイル（先例）】
--   20260722b_add_multi_department_access.sql — group_ids配列・トリガー・guard関数の先例
--   20260723_scope_pj_task_satellite_tables.sql — 親を辿る部署スコープの先例
--   20260723b_add_objective_group_id.sql — objectives.group_id追加の先例

-- ============================================================
-- ブロック1: key_results.group_id 列追加＋バックフィル（親=objectives経由）
--
-- 【注意】このUPDATEが trg_key_results_updated_at（BEFORE UPDATE、無条件で
-- updated_at=NOW()にする既存トリガー）を再発火させ、既存の全KeyResultのupdated_atが
-- 一律で「今」になってしまう副作用があるため、バックフィルの間だけ一時的に無効化する
-- （20260722b/20260723bのバックフィル手法に倣う）。この時点ではまだ本ブロック以降の
-- 自動注入トリガーを作成していないため、単純なJOIN UPDATEで直接バックフィルする。
-- ============================================================
ALTER TABLE key_results ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);

ALTER TABLE key_results DISABLE TRIGGER trg_key_results_updated_at;

UPDATE key_results kr
SET group_id = o.group_id
FROM objectives o
WHERE o.id = kr.objective_id
  AND kr.group_id IS NULL;

ALTER TABLE key_results ENABLE TRIGGER trg_key_results_updated_at;

-- ============================================================
-- ブロック2: task_forces.group_id 列追加＋バックフィル（親=key_results経由。ブロック1の後に実行必須）
-- ============================================================
ALTER TABLE task_forces ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);

ALTER TABLE task_forces DISABLE TRIGGER trg_task_forces_updated_at;

UPDATE task_forces tf
SET group_id = kr.group_id
FROM key_results kr
WHERE kr.id = tf.kr_id
  AND tf.group_id IS NULL;

ALTER TABLE task_forces ENABLE TRIGGER trg_task_forces_updated_at;

-- ============================================================
-- ブロック3: todos.group_id 列追加＋バックフィル（親=task_forces経由。ブロック2の後に実行必須）
-- ============================================================
ALTER TABLE todos ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);

ALTER TABLE todos DISABLE TRIGGER trg_todos_updated_at;

UPDATE todos t
SET group_id = tf.group_id
FROM task_forces tf
WHERE tf.id = t.tf_id
  AND t.group_id IS NULL;

ALTER TABLE todos ENABLE TRIGGER trg_todos_updated_at;

-- ============================================================
-- ブロック4: BEFORE INSERT/UPDATE トリガーで親からgroup_idを自動注入
--
-- SECURITY DEFINER（sync_task_group_idsと同じ方式）で親テーブルのRLSを迂回して参照する。
-- 全てのINSERT/UPDATEで毎回、現在の親からgroup_idを再計算する（既存データの補正・
-- 親の付け替え＝objective_id/kr_id/tf_idの変更時の追従の両方をこれ1つでカバーする）。
-- フロントがgroup_idを送ってきても・送ってこなくても、この値を常に上書きする。
-- ============================================================
CREATE OR REPLACE FUNCTION sync_kr_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_kr_group_id$
BEGIN
  SELECT o.group_id INTO NEW.group_id
  FROM public.objectives o
  WHERE o.id = NEW.objective_id;
  RETURN NEW;
END;
$fn_sync_kr_group_id$;

DROP TRIGGER IF EXISTS trg_key_results_sync_group_id ON key_results;
CREATE TRIGGER trg_key_results_sync_group_id
  BEFORE INSERT OR UPDATE ON key_results
  FOR EACH ROW EXECUTE FUNCTION sync_kr_group_id();

CREATE OR REPLACE FUNCTION sync_tf_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_tf_group_id$
BEGIN
  SELECT kr.group_id INTO NEW.group_id
  FROM public.key_results kr
  WHERE kr.id = NEW.kr_id;
  RETURN NEW;
END;
$fn_sync_tf_group_id$;

DROP TRIGGER IF EXISTS trg_task_forces_sync_group_id ON task_forces;
CREATE TRIGGER trg_task_forces_sync_group_id
  BEFORE INSERT OR UPDATE ON task_forces
  FOR EACH ROW EXECUTE FUNCTION sync_tf_group_id();

CREATE OR REPLACE FUNCTION sync_todo_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_todo_group_id$
BEGIN
  SELECT tf.group_id INTO NEW.group_id
  FROM public.task_forces tf
  WHERE tf.id = NEW.tf_id;
  RETURN NEW;
END;
$fn_sync_todo_group_id$;

DROP TRIGGER IF EXISTS trg_todos_sync_group_id ON todos;
CREATE TRIGGER trg_todos_sync_group_id
  BEFORE INSERT OR UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION sync_todo_group_id();

-- ============================================================
-- ブロック5: 親のgroup_id変更時に子へカスケード（cascade_project_group_ids_to_tasksと同型）
--
-- ブロック4のBEFORE INSERT/UPDATEトリガーは「その行自体が保存されたとき」しか働かない。
-- 親（例：Objective）のgroup_idだけが変更され、子（KeyResult等）が保存されない限り
-- 子は追従しないため、親のAFTER UPDATEで子を明示的に更新するカスケードが必要。
-- このUPDATEは子テーブルのブロック4トリガーを再度発火させ、そこで親から再計算した
-- 同じ値が確定する（冪等）。子のgroup_idが実際に変化した場合はさらに孫テーブルへ
-- カスケードが連鎖する（Objective変更 → KR → TF → ToDoまで自動的に波及する）。
-- 【既知の副作用（cascade_project_group_ids_to_tasksと同じ割り切り）】親のgroup_idを
-- 変更すると配下の子・孫全ての updated_at が動く。既存の他機能と同種の割り切りとして
-- 受け入れる。
-- ============================================================
CREATE OR REPLACE FUNCTION cascade_objective_group_id_to_krs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_obj_to_kr$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.key_results
    SET group_id = NEW.group_id
    WHERE objective_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_obj_to_kr$;

DROP TRIGGER IF EXISTS trg_objectives_cascade_group_id ON objectives;
CREATE TRIGGER trg_objectives_cascade_group_id
  AFTER UPDATE ON objectives
  FOR EACH ROW EXECUTE FUNCTION cascade_objective_group_id_to_krs();

CREATE OR REPLACE FUNCTION cascade_kr_group_id_to_tfs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_kr_to_tf$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.task_forces
    SET group_id = NEW.group_id
    WHERE kr_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_kr_to_tf$;

DROP TRIGGER IF EXISTS trg_key_results_cascade_group_id ON key_results;
CREATE TRIGGER trg_key_results_cascade_group_id
  AFTER UPDATE ON key_results
  FOR EACH ROW EXECUTE FUNCTION cascade_kr_group_id_to_tfs();

CREATE OR REPLACE FUNCTION cascade_tf_group_id_to_todos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_tf_to_todo$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.todos
    SET group_id = NEW.group_id
    WHERE tf_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_tf_to_todo$;

DROP TRIGGER IF EXISTS trg_task_forces_cascade_group_id ON task_forces;
CREATE TRIGGER trg_task_forces_cascade_group_id
  AFTER UPDATE ON task_forces
  FOR EACH ROW EXECUTE FUNCTION cascade_tf_group_id_to_todos();

-- ============================================================
-- ブロック6: RLSポリシーの張り替え（インシデント再発防止が最重要）
--
-- 必ず先に「authenticated full access」をDROPしてから新ポリシーを作る。単一group_id列
-- なので配列オーバーラップ（&&）ではなく `= ANY(current_member_group_ids())` を使う
-- （members/projects/tasksのgroup_ids配列とは型が違うため）。NULL許可の猶予句は書かない。
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON objectives;
DROP POLICY IF EXISTS "objectives_group" ON objectives;
CREATE POLICY "objectives_group" ON objectives FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON key_results;
DROP POLICY IF EXISTS "key_results_group" ON key_results;
CREATE POLICY "key_results_group" ON key_results FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON task_forces;
DROP POLICY IF EXISTS "task_forces_group" ON task_forces;
CREATE POLICY "task_forces_group" ON task_forces FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON todos;
DROP POLICY IF EXISTS "todos_group" ON todos;
CREATE POLICY "todos_group" ON todos FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

-- ============================================================
-- ブロック7: 適用後、必ず実行して確認するクエリ集
--
-- 山本さんへ：以下2本を SQL Editor で実行し、①・②が両方0件であることを確認してから
-- 「適用OK」としてください。0件でない場合はそのまま次の環境（prod）に進まず報告してください。
-- ============================================================

-- ① 部署を見ていない緩いポリシーが残っていないか（qual/with_checkに"group"を含まない
--    ポリシーを検出。qual='true'で絞ると別の書き方の緩いポリシーを取りこぼすため、
--    「部署参照の有無」で洗う）
SELECT tablename, policyname, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('objectives', 'key_results', 'task_forces', 'todos')
  AND coalesce(qual, '') NOT ILIKE '%group%'
  AND coalesce(with_check, '') NOT ILIKE '%group%';
-- 0行であること

-- ② バックフィル漏れ検出（group_id IS NULL の行数が0件であること）
SELECT 'objectives' AS tbl, count(*) FROM objectives WHERE group_id IS NULL
UNION ALL
SELECT 'key_results', count(*) FROM key_results WHERE group_id IS NULL
UNION ALL
SELECT 'task_forces', count(*) FROM task_forces WHERE group_id IS NULL
UNION ALL
SELECT 'todos', count(*) FROM todos WHERE group_id IS NULL;
-- 全て0件であること

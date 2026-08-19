-- ============================================================
-- v3.81: visible_project_member_ids() の中身を軽くする
-- ============================================================
--
-- 【背景・実測】v3.80（20260819c_optimize_members_rls_initplan.sql）で members の
-- RLS内のSECURITY DEFINER関数呼び出しを (SELECT ...) で包み、InitPlanとして
-- クエリ全体で1回だけ評価されるようにした。適用後、本番・招待受諾者アカウントで
-- 取った EXPLAIN (ANALYZE, BUFFERS) の内訳：
--
--   InitPlan 1 (current_member_group_ids)      actual time=2.583..2.584   Buffers: shared hit=86
--   InitPlan 2 (current_member_is_super_admin) actual time=0.227..0.228   Buffers: shared hit=2
--   InitPlan 3 (visible_invite_group_ids)      actual time=5.935..5.936   Buffers: shared hit=299
--   InitPlan 4 (visible_project_member_ids)    actual time=53.922..53.922 Buffers: shared hit=730
--   Execution Time: 63.500 ms
--
-- InitPlan 4（visible_project_member_ids()自体）は「クエリ全体で1回しか呼ばれていない」
-- のに53.9ms・shared hit=730かかっている＝呼び出し回数ではなく関数の中身そのものが重い。
-- これはアプリ起動時に必ず通る経路のため、タスク・PJが増えるほど比例して伸びる。
--
-- 【実装を数えて確認した実際の内訳（統括の見立ての検算）】
-- 統括の指示文は「8本のUNION」としていたが、実際に20260818_harden_invite_related_rls.sql
-- の関数本体を数えると、UNIONで連結されたブランチは7つ（UNIONキーワード自体は6個）だった。
-- 念のため実装を機械的に数えて確認したうえで、以下は実際の7ブランチを前提に書く。
-- 各ブランチが独立に projects（一部は tasks とのJOIN）を走査し、かつ各ブランチの
-- WHERE句の中で current_member_group_ids() / current_member_is_super_admin() を
-- 呼んでいた（7ブランチ×2関数＝14回の呼び出し。current_member_group_ids()単体だけで
-- 86バッファ・2.5msかかることがInitPlan 1から分かっている＝これを何度も引くだけで
-- 相当なコストになる）。
--
-- 【この変更でやること・やらないこと】
-- 🔴 返る集合は1要素も変えない（可視性を決める関数のため、速くなっても結果が
-- 変わってはならない）。走査・呼び出し回数だけを減らす。RLSポリシー
-- （members_select）・関数名・シグネチャ（引数無し・RETURNS text[]）は一切変えない
-- （ポリシー側を無改修で済ませるため）。
--   1. current_member_group_ids() / current_member_is_super_admin() をCTE（ctx）で
--      1回だけ評価し、以降はそれを参照するだけにする（各ブランチで呼び直さない）。
--      🔴 【統括レビューで訂正・ctx にも AS MATERIALIZED が必須】PostgreSQL 12以降は
--      「参照が1回だけ」かつ「volatile関数を含まない」非再帰CTEを既定でインライン
--      展開する。ctx は accessible_projects からしか参照されず（参照1回）、
--      current_member_group_ids()/current_member_is_super_admin()はどちらもSTABLE
--      （volatileではない）のため、この既定インライン展開の条件を完全に満たして
--      しまう。展開されるとWHERE句は
--        WHERE p.is_deleted = false
--          AND (p.group_ids && current_member_group_ids() OR current_member_is_super_admin())
--      という元の形に戻り、projectsの行ごとに関数が再評価される（v3.80で実測・確定
--      した挙動そのもの。Section 39）。同じ罠が関数の内側に移動しただけになるため、
--      ctx にも明示的に `AS MATERIALIZED` を付け、インライン展開を禁止して1回だけ
--      評価されることを保証する。
--   2. 「自分がアクセスできる、削除されていないPJ」をCTE（accessible_projects）で
--      1回だけ作り、オーナー系3ブランチ（owner_member_id／owner_member_ids／
--      member_ids）はこのCTEから取る。このCTEは5箇所（オーナー系3ブランチ＋
--      tasksとのJOIN2箇所）から参照されるため、PostgreSQLの「非再帰CTEが2回以上
--      参照されるとmaterializeされる」という既定挙動（12以降）でも実質1回になるが、
--      ctxと同様に挙動を将来のバージョン差・リファクタに依存させないよう明示的に
--      `AS MATERIALIZED` を付けた。これにより projects の物理スキャンは実質1回になる。
--   3. tasksの走査を「project_id直接」「task_projects経由」の2系統に絞り、各系統
--      内の「単数assignee_member_id」「複数assignee_member_ids」は、配列に単数を
--      足してから1回unnestする形にまとめた（旧4ブランチ→新2ブランチ）。
--
-- 【::text キャストを維持する理由】20260819bでprojects.owner_member_idsの実DBは
-- text[]に是正されたが、将来また型が動いても壊れないための保険として、各ブランチの
-- ::textキャストは残す。assignee_member_id/assignee_member_idsを配列結合する際も、
-- 結合（||）する前に個別に ::text[] / ::text へキャストしてから結合する
-- （結合してからキャストする順序にすると、将来どちらか一方だけ型がドリフトした
-- 場合に配列の要素型が食い違い「cannot concatenate incompatible array types」で
-- 落ちる。これは20260819bで実際に踏んだ「UNION types text and uuid cannot be
-- matched」と同型の事故になるため、結合前キャストで同じ轍を踏まないようにする）。
--
-- 【旧7ブランチ→新実装 対応表（結果集合の定義は1つも変えていない）】
--   旧ブランチ1（owner_member_id 単数）                        → 新: owner_member_id ブランチ（accessible_projectsから取得。式は無変更）
--   旧ブランチ2（owner_member_ids 複数）                        → 新: owner_member_ids ブランチ（同上）
--   旧ブランチ3（member_ids 複数）                              → 新: member_ids ブランチ（同上）
--   旧ブランチ4（tasks.assignee_member_id、project_id直接JOIN）  → 新:「project_id直接」ブランチに統合（単数を配列へ足してunnest）
--   旧ブランチ5（tasks.assignee_member_ids、project_id直接JOIN） → 新: 同上（配列側）
--   旧ブランチ6（tasks.assignee_member_id、task_projects経由）  → 新:「task_projects経由」ブランチに統合
--   旧ブランチ7（tasks.assignee_member_ids、task_projects経由） → 新: 同上（配列側）
--
-- 【走査回数】
--   projects の物理スキャン：旧7回（ブランチ1,2,3で3回＋ブランチ4,5,6,7内のJOINで4回）
--                            → 新1回（accessible_projects を MATERIALIZED で1回だけ実体化）
--   tasks の物理スキャン：旧4回（ブランチ4,5,6,7）→ 新2回（project_id直接1回＋task_projects経由1回）
--   current_member_group_ids()/current_member_is_super_admin() の呼び出し：
--     旧14回（7ブランチ×2関数）→ 新各1回（ctx CTEで1回だけ評価）
--
-- 【projects.group_ids のGINインデックス（統括への報告事項・今回は追加しない）】
-- 現時点で projects.group_ids に対するGINインデックスは存在しない
-- （schema.sql・全マイグレーションを確認済み。既存インデックスは
-- idx_projects_owner_member_id／idx_projects_status のみで、どちらも配列演算子
-- && には効かない）。accessible_projects の WHERE句の `p.group_ids && ctx.gids`
-- はPJ件数が増えるほどSeq Scanのコストが線形に伸びる可能性があり、GINインデックス
-- （`CREATE INDEX ... ON projects USING gin (group_ids)`）は理論上ここに効きうる。
-- ただし「一度に触る範囲を広げない」方針により、今回は追加しない
-- （追加する場合は別マイグレーションで検討すること）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.visible_project_member_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_visible_pj_members$
  WITH ctx AS MATERIALIZED (
    -- AS MATERIALIZED が必須（本ファイル冒頭コメント参照）：ctxは1回しか参照されず
    -- （accessible_projectsから1回だけ）、中の関数もSTABLE（volatileでない）ため、
    -- MATERIALIZEDを付けないとPostgreSQLが既定でインライン展開し、展開後は
    -- projectsの行ごとに関数が再評価される（v3.80で実測・確定した挙動そのもの）。
    SELECT
      public.current_member_group_ids() AS gids,
      public.current_member_is_super_admin() AS is_super
  ),
  accessible_projects AS MATERIALIZED (
    SELECT p.id, p.owner_member_id, p.owner_member_ids, p.member_ids
    FROM public.projects p
    CROSS JOIN ctx
    WHERE p.is_deleted = false
      AND (p.group_ids && ctx.gids OR ctx.is_super)
  )
  SELECT coalesce(array_agg(DISTINCT mid), ARRAY[]::text[])
  FROM (
    -- 旧ブランチ1: owner_member_id（単数オーナー・互換目的のFK）
    SELECT ap.owner_member_id::text AS mid
      FROM accessible_projects ap
      WHERE ap.owner_member_id IS NOT NULL
    UNION
    -- 旧ブランチ2: owner_member_ids（複数オーナー対応）
    SELECT unnest(ap.owner_member_ids)::text
      FROM accessible_projects ap
    UNION
    -- 旧ブランチ3: member_ids（PJ関与者列）
    SELECT unnest(ap.member_ids)::text
      FROM accessible_projects ap
    UNION
    -- 旧ブランチ4+5統合: project_id直接紐づきタスクの担当者（単数・複数を1回の走査で）
    SELECT unnest(
             t.assignee_member_ids::text[]
             || CASE WHEN t.assignee_member_id IS NOT NULL
                       THEN ARRAY[t.assignee_member_id::text]
                       ELSE ARRAY[]::text[]
                  END
           ) AS mid
      FROM public.tasks t
      JOIN accessible_projects ap ON ap.id = t.project_id
      WHERE t.is_deleted = false
    UNION
    -- 旧ブランチ6+7統合: task_projects経由タスクの担当者（単数・複数を1回の走査で）
    SELECT unnest(
             t.assignee_member_ids::text[]
             || CASE WHEN t.assignee_member_id IS NOT NULL
                       THEN ARRAY[t.assignee_member_id::text]
                       ELSE ARRAY[]::text[]
                  END
           ) AS mid
      FROM public.tasks t
      JOIN public.task_projects tp ON tp.task_id = t.id
      JOIN accessible_projects ap ON ap.id = tp.project_id
      WHERE t.is_deleted = false
  ) x
  WHERE mid IS NOT NULL
$fn_visible_pj_members$;
GRANT EXECUTE ON FUNCTION public.visible_project_member_ids() TO authenticated;

-- ============================================================
-- 適用前後で結果が変わらないことの監査（山本さんへ：適用前に1回・適用後に1回、
-- 同じ手順を実行して比較してください）
-- ============================================================
--
-- 🔴 これは可視性を決める関数です。速くなっても結果が1件でも変われば、見えるべき
-- 人が見えなくなる（または見えてはいけない人が見える）ことになります。
-- 招待受諾者のアカウント（RLSが効く状態）で、並び順に依存しない形（ソート済み配列）
-- で比較してください。<auth_user_id> と <auth_user_email> は実際のauth.usersの
-- uidとemailに置き換えること。
--
-- 【適用前に実行して控える】
-- BEGIN;
-- SELECT set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<auth_user_id>', 'email', '<auth_user_email>', 'role', 'authenticated')::text,
--   true
-- );
-- SET LOCAL ROLE authenticated;
-- SELECT array_agg(x ORDER BY x) AS visible_member_ids
-- FROM unnest(public.visible_project_member_ids()) AS x;
-- ROLLBACK;
--
-- 【適用後に同じ手順をもう一度実行する】
-- 上と全く同じクエリを再実行し、visible_member_ids の配列が1要素残らず完全一致する
-- ことを確認する（要素が同じでも並び順が違うことがあるため、必ずソートした状態
-- （ORDER BY x）で比較する）。
--
-- 可能であれば、招待受諾者だけでなく通常部署のメンバー・全社スーパー管理者の
-- 3種類程度のアカウントで同じ手順を実行すると、より確度の高い確認になります
-- （group_ids && / is_super の分岐が両方とも通ることの確認）。
-- ============================================================

-- ============================================================
-- 性能改善の確認（山本さんへ：適用後に実行してください）
-- ============================================================
--
-- 招待受諾者アカウントで、v3.80と同じ条件を再現する：
--
-- BEGIN;
-- SELECT set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<auth_user_id>', 'email', '<auth_user_email>', 'role', 'authenticated')::text,
--   true
-- );
-- SET LOCAL ROLE authenticated;
-- EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM members;
-- ROLLBACK;
--
-- 【適用前の実測値（比較対象・v3.80適用後の値）】
--   InitPlan 4 (visible_project_member_ids)    actual time=53.922..53.922 Buffers: shared hit=730
--   Execution Time: 63.500 ms
--
-- 【期待する方向・判断基準】
--   InitPlan 4 のBuffersとTimeが53.922ms/730から大きく下がる方向に動くことを確認する
--   （projects/tasksの物理スキャン回数が7+4回→1+2回に、current_member_group_ids()等の
--   呼び出しが14回→2回（ctx CTE経由で1回ずつ）に減っているため）。Execution Time全体も
--   それに応じて短縮される見込み。🔴 下がらなければこの最適化は撤回対象——その場合は
--   ctx/accessible_projectsのAS MATERIALIZEDが効いていない（EXPLAIN出力にInitPlanが
--   現れない・関数呼び出しが行ごとに再評価されている）可能性が高いので、EXPLAIN全文を
--   持って統括に差し戻すこと。
-- ============================================================

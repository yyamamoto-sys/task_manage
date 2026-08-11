-- ============================================================
-- プロジェクト招待：招待された人をmembersで見えるようにする（追加のみ）
-- 2026-08-10（v3.47）
--
-- 【正本】docs/dev/project-invite-plan.md §4-2・§4-4／CLAUDE.md Section 25
--
-- 【背景・現状のズレ】
-- create_project_invite() は発行者本人と projects.owner_member_id に招待用部署への兼務を
-- 付与するが、それ以外の（兼務を持たない）部署メンバーからは、招待された人の group_ids が
-- 招待用部署のみのため、members の RLS（group_ids && current_member_group_ids()）を満たせず
-- 見えない。招待された人を担当者に指定しても、その部署の一般メンバーの画面では担当者欄が
-- 「未担当」のままになる。
--
-- 【この修正で広げる範囲（ここだけ）】
-- 「招待用部署（is_invite_group=true）に属する人」の可視性のみを広げる。
-- 具体的には「相手が招待用部署に属しており、かつその招待用部署が、自分がアクセスできる
-- PJの group_ids に含まれている」なら見える、という条項を1つ追加する。
--
-- 🔴 部署間の可視性（部署Aの人が部署Bの人を見る）は一切変えない。既存2条項
-- （group_ids && current_member_group_ids() / current_member_is_super_admin()）は
-- 1文字も変更せず、OR で1条項を追加するだけ。
--
-- 🔴 NULL猶予条項は書かない（CLAUDE.md Section 1.6の2026-06-26事故の教訓）。
-- 🔴 SET search_path = ''（既存の流儀を維持）。
-- 🔴 ドル引用タグは関数固有（$fn_visible_invite_groups$）にする
--   （複数関数で$$を共有すると、コピペで1文字欠けた際に後続関数を巻き込み無関係な行で
--   エラーになる事故が起きるため）。
--
-- 【広げていない範囲（意図的）】
-- - projects / tasks の group_ids 比較には広げない（members だけの変更）。
-- - 招待者（招待用部署に属する人）から社内メンバーが見える範囲は今回は変えない
--   （visible_invite_group_ids() は「自分がアクセスできるPJに紐づく招待用部署」を返す
--   だけなので、招待者自身から見れば自分の招待用部署1つしか返らない＝発行者・PJオーナー
--   以外の社内メンバーは引き続き見えない。CLAUDE.md Section 25「可視性の非対称」参照）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- 自分がアクセスできるPJに紐づく「招待用部署」のidの配列を返す。
-- current_member_group_ids()・can_access_group_ids()と同じSECURITY DEFINERの流儀。
-- groups/projectsを直接SELECTするのはproject_group_ids()等（schema.sql下部）の既存の
-- 先例と同じ（SECURITY DEFINERなのでRLSは適用されない＝意図的にRLSを迂回して判定材料を
-- 集める。current_member_group_ids()自体もmembersテーブルをこの流儀で読んでいる）。
CREATE OR REPLACE FUNCTION public.visible_invite_group_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_visible_invite_groups$
  SELECT coalesce(array_agg(DISTINCT g.id), ARRAY[]::text[])
  FROM public.groups g
  JOIN public.projects p ON g.id = ANY(p.group_ids)
  WHERE g.is_invite_group = true
    AND p.group_ids && public.current_member_group_ids()
$fn_visible_invite_groups$;
GRANT EXECUTE ON FUNCTION public.visible_invite_group_ids() TO authenticated;

-- 既存条項は1文字も変えず、OR で1条項だけ追加する。
DROP POLICY IF EXISTS "authenticated full access" ON members;
DROP POLICY IF EXISTS "members_group" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR group_ids && public.visible_invite_group_ids()
  );

-- ============================================================
-- 確認クエリ（山本さんへ：適用後に以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 関数が存在するか
-- SELECT proname FROM pg_proc WHERE proname = 'visible_invite_group_ids';

-- 2) 招待された人が、招待発行者・PJオーナー以外の同部署メンバーからも見えるようになったこと
--    （招待用部署に属する行が最低1件、accepted_member_idとして存在するはず）
-- SELECT m.id, m.display_name, m.group_id
-- FROM members m
-- JOIN groups g ON g.id = m.group_id
-- WHERE g.is_invite_group = true AND m.is_deleted = false;

-- 3) visible_invite_group_ids() が対象PJに紐づく招待用部署のidを正しく返すこと
--    （SQL EditorはRLSを迂回するservice roleで動くため、current_member_group_ids()の
--    判定材料になる auth.email() はSQL Editor上では空になる。実際の確認は次の4)のように
--    アプリの実機（対象部署の一般メンバーとしてログイン）で行うこと）
-- SELECT public.visible_invite_group_ids();

-- 4) 【最重要・広げすぎていないことの確認】招待用部署に属さない、自分と無関係な他部署の
--    メンバーが引き続き見えないこと。以下は「部署Aの一般メンバー」としてアプリにログイン
--    した状態（＝ブラウザの実機。SQL EditorはRLSを迂回するため確認にならない）で、
--    設定画面のメンバー一覧、またはブラウザのSupabaseクライアント経由で以下と同等の
--    SELECTを実行し、招待にもアクセス可能PJにも無関係な部署Bのメンバーが0件であることを
--    確認する。
--
--    以下はservice role権限で「アプリのRLSが正しく絞るはずの範囲」を先に机上算出する
--    ためのSQL（適用直後の期待値の下見用。実際の防御はRLS側で効いているかをアプリの
--    実機で必ず確認すること）：
-- SELECT m.id, m.display_name, m.group_id, m.group_ids
-- FROM members m
-- WHERE m.is_deleted = false
--   AND NOT (m.group_ids && (SELECT group_ids FROM members WHERE email = '<部署Aの一般メンバーのemail>' LIMIT 1))
--   AND NOT EXISTS (
--     SELECT 1 FROM groups g
--     JOIN projects p ON g.id = ANY(p.group_ids)
--     WHERE g.is_invite_group = true
--       AND m.group_id = g.id
--       AND p.group_ids && (SELECT group_ids FROM members WHERE email = '<部署Aの一般メンバーのemail>' LIMIT 1)
--   );
-- -- 期待：0件（部署Aの一般メンバーから見えてよいのは「自部署」と「自部署がアクセスできる
-- -- PJに紐づく招待用部署の人」だけであり、それ以外の部署Bのメンバーはこの条件に該当し、
-- -- かつRLS上も見えないはず。1件でも出た場合は、その部署が実際にPJへアクセス可能で
-- -- 意図通りである可能性があるため、該当PJのgroup_idsを確認すること）。

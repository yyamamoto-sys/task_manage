-- ============================================================
-- プロジェクト招待まわりの権限境界を締める（v3.75・2026-08-18）
--
-- 【正本】CLAUDE.md Section 1.6 / Section 25
--
-- 【背景】
-- v3.47（20260810c）で members のRLSポリシーに3つ目のOR条項
-- （OR group_ids && visible_invite_group_ids()）を追加した。当時の意図は
-- 「可視性だけを広げる」ことだったが、このポリシーは FOR ALL でありながら
-- WITH CHECK を省略していた。PostgreSQLは FOR ALL で WITH CHECK が無い場合、
-- USING式をINSERT/UPDATEの認可としても使う。つまり追加した条項は
-- 可視性だけでなく書き込み権限も同時に広げていた。
--
-- あわせて、members の権限昇格ガード（guard_member_privilege_columns）が
-- 守っていた列は is_super_admin / is_admin / group_id / group_ids の4つだけで、
-- email（ログイン中の利用者と members 行を結びつける同一性判定キー。
-- App.tsx の autoMatch() と current_member_is_admin() 等が使う）と
-- is_deleted（有効な管理者の人数＝ブートストラップ猶予の判定材料）が無防備だった。
--
-- 【このマイグレーションで変えること（7点）】
--   ブロック1: members のポリシーをSELECT用と書き込み用に分割する。
--              可視性（SELECT）は3条項＋新設の4条項目（PJ参加者の可視性・後述）。
--              書き込みだけ、3条項目に「部署管理者または全社スーパー管理者であること」を課す。
--              WITH CHECK は省略せず明示的に書く（省略が今回の原因そのもの）。
--              🔴 あわせて、招待受諾者から「そのPJに参加しているメンバー全員」が見えるように
--              members_select に4条項目（OR id = ANY(visible_project_member_ids())）を追加する
--              （山本さんの追加要望。本番の羅針盤フォーラムPJで実害発生。詳細はブロック1内コメント）。
--              新設のSECURITY DEFINER関数 visible_project_member_ids() を使う。書き込み側
--              （members_write_insert/update/delete）には一切追加しない。
--   ブロック2: guard_member_privilege_columns に email / is_deleted の保護を足し、
--              部署ブートストラップ猶予から招待用部署を除外し、
--              will_be_super_admin（＝操作される側の属性で自由を与えていた誤り）を正す。
--   ブロック3: projects.group_ids のガードトリガーを新設する
--              （自分がアクセスできない招待用部署を後から足せないようにする）。
--   ブロック4: project_invites のSELECTポリシーを「発行者の所属部署」基準から
--              「対象PJが属する通常部署」基準に変える。
--   ブロック5: task_dependencies のRLSを group_id 単数比較から、依存関係が結ぶ
--              両端タスクへのアクセス可否（tasks.group_ids配列基準）に切り替える。
--              招待受諾者・複数部署兼務メンバーにタスク依存関係（ガント矢印・依存
--              ゲート）が見えていなかった既存の取り残しを解消する（統括の追加指示）。
--   ブロック6: 適用前後の監査クエリ（コメント）。
--
-- 【変えないこと】
-- ・members の可視性（SELECT）の既存3条項は1条項も狭めない・式も変えない。v3.47で解決した
--   「招待受諾者と社内メンバーが相互に見える」状態はそのまま維持する。
-- ・既存2条項（group_ids && current_member_group_ids() /
--   current_member_is_super_admin()）の式は1文字も変えていない。
-- ・v3.60の要件「部署管理者が招待受諾者を編集できる」は維持する。
-- ・create_project_invite() / accept_project_invite() の本文は変更しない。
-- ・PJ参加者の可視性拡張（4条項目）はSELECTにのみ足す。書き込み（INSERT/UPDATE/DELETE）
--   ポリシーには一切足さない。既存3条項＋今回のブロック1本来の目的（WITH CHECK分離）を
--   混同・希釈しない。
--
-- 【意図的に受け入れる副作用（4条項目について）】部署をまたぐPJでは、他部署のメンバー同士も
-- 相互に見えるようになる（同じPJの参加者に限る）。「部署間の素の可視性は広げない」という
-- 既存の設計原則（Section 1.6）からの意図的な緩和。山本さん承認済み。緩和はこの1点のみで、
-- PJを共有しない他部署のメンバーは引き続き見えない。
--
-- 【NULL猶予条項は書かない】CLAUDE.md Section 1.6 の2026-06-26事故の教訓を厳守。
-- 【SET search_path = ''】既存の流儀を維持。
-- 【ドル引用タグ】関数ごとに固有のタグ（$fn_xxx$）を使う。
--
-- 【適用】Supabase SQL Editor に貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
--   ⚠️ ブロック単位（1→2→3→4→5）で順に貼っても、全文を一度に貼っても構いません。
--      途中で切れた場合は、そのブロックの先頭から貼り直してください
--      （各ブロックは単体で冪等です）。
-- ============================================================


-- ============================================================
-- ブロック1: members のRLSポリシーをSELECT用と書き込み用に分割する
--            ＋ 招待受諾者からPJ参加者全員を見えるようにする（4条項目・新規追加）
--
-- 【なぜ分割するか】FOR ALL かつ WITH CHECK 省略のポリシーは、USING式が
-- INSERT/UPDATE の認可（WITH CHECK）にも流用される。したがって
-- 「見えること」と「書けること」を別々に設計できない。分割して、
-- 書き込みにだけ管理者条件を課す。
--
-- 【SELECT】v3.47の3条項に加え、4条項目を新設する（合計4条項。可視性は一切狭めない）。
--
-- 【4条項目＝PJ参加者の可視性拡張（山本さんの追加要望・2026-08-18）】
-- 【背景】現状、招待受諾者（招待用部署しか持たない人）から見える社内メンバーは、
-- 3条項目（group_ids && visible_invite_group_ids()）により「招待用部署を兼務している人」
-- ＝発行者本人とPJオーナーの2名だけに限られる（CLAUDE.md Section 25 Phase 4末尾に
-- 「可視性の非対称・運用でカバー」として記録済みの制約）。本番の羅針盤フォーラムPJで
-- 実害が出た（招待された方からPJの他の参加者が1人も見えず、担当者欄が「未担当」になる）。
--
-- 【方針】兼務（group_ids）を増やす方式は採らない（書き込みスコープが広がる・
-- 「表示部署」切替の副作用が出る・既存メンバーのgroup_idsを大量に書き換えることになるため）。
-- 代わりに SELECT ポリシーにだけ条項を1つ追加する。書き込み側
-- （members_write_insert/update/delete）には絶対に足さない（今回の権限昇格の根本原因が
-- 「可視性のつもりで足した条項が書き込み認可も兼ねていた」ことなので、同じ誤りを
-- 繰り返さない）。
--
-- 【「参加しているメンバー」の定義＝computeProjectMembers()の実際の呼び出しと揃える】
-- src/lib/project/projectMembers.ts の computeProjectMembers() 自体は
-- {ownerIds, assigneeIds, inviteGroupId} しか受け取らないが、呼び出し元
-- ProjectSettingsModal.tsx の実際の集合と、同じ考え方で組む
-- ProjectKarte.tsx の pjAllMembers（"AI分析に渡す「このPJに関わる全員」＝
-- オーナー＋メンバー＋タスク担当者の和集合"というコメントがそのまま定義）を正として揃えた：
--   ・オーナー：owner_member_id（互換目的の単数）／owner_member_ids（複数オーナー）
--   ・projects.member_ids（PJの関与者列。オーナー・担当者とは別に持てる「関与者」）
--   ・そのPJに紐づくタスクの担当者：assignee_member_id／assignee_member_ids
--     （project_id直接紐づき ＋ task_projects経由の追加PJ紐づけの両方。
--      ProjectSettingsModal/ProjectKarte両方の pjTasks が同じ2経路を対象にしている）
-- is_deleted=false のPJ・タスクのみを対象にする。
--
-- 【性能：id = ANY(...) を選んだ理由】既存3ヘルパー（current_member_group_ids()・
-- current_member_is_super_admin()・visible_invite_group_ids()）と同じく引数を取らない
-- 関数にした。この関数はmembersの各行と相関を持たないため、PostgreSQLはクエリ全体で
-- 1回だけ評価するuncorrelated subplanとして実行できる（＝members行数分ではなく1回だけ、
-- projects×tasksを辿る）。仮に「メンバーidを引数に取りEXISTSで判定する」形（例：
-- is_visible_project_member(members.id)）にすると、呼び出し側のmembers行ごとに相関実行
-- されるため、members行数が増えるほど不利になる。関数内部はEXISTSではなくUNIONで集合を
-- 作るが、これは「1回だけ評価される関数の中身」なので行数分の繰り返しにはならない。
-- JOINは必要な2経路（project_id直接／task_projects経由）だけにとどめ、is_deleted・
-- 「アクセス可能なPJか」の絞り込みを先に効かせて無駄なJOINを広げない
-- （idx_tasks_project_id・idx_task_projects(task_id,project_id)複合PKが効く）。
--
-- 【can_access_group_ids()を呼ばずインライン展開した理由】意味はcan_access_group_ids()と
-- 同一（group_ids && current_member_group_ids() OR current_member_is_super_admin()）だが、
-- schema.sql（統合スキーマ・上から順に再実行する参照ファイル）ではmembersのRLS群が
-- can_access_group_ids()自体の定義（PJ・タスク周辺テーブル用に後方で新設）より前に
-- 並んでいるため、そのまま呼ぶと前方参照エラーになる。visible_invite_group_ids()
-- （migration 20260810c）が同じ理由でcan_access_group_ids()を使わずインライン展開して
-- いる先例に倣った。
-- ============================================================

DROP POLICY IF EXISTS "authenticated full access" ON members;
DROP POLICY IF EXISTS "members_group" ON members;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_write_insert" ON members;
DROP POLICY IF EXISTS "members_write_update" ON members;
DROP POLICY IF EXISTS "members_write_delete" ON members;

-- 【型を text に揃える理由（2026-08-18・適用時に判明）】実DBでは projects.owner_member_ids /
-- member_ids / tasks.assignee_member_* が uuid 系で、単数の owner_member_id（text）と
-- UNION すると「UNION types text and uuid cannot be matched」で落ちる
-- （schema.sql は text[] と記述していたが実DBと食い違っていた＝member_ids と同種のドリフト）。
-- 各ブランチを ::text に明示的に揃え、ポリシー側も id::text で比較することで、
-- 列が text / uuid のどちらであっても同じ結果になるようにしている
-- （uuid::text は常に小文字の正規形なので members.id（text・UUID文字列）と一致する）。
CREATE OR REPLACE FUNCTION public.visible_project_member_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_visible_pj_members$
  SELECT coalesce(array_agg(DISTINCT mid), ARRAY[]::text[])
  FROM (
    SELECT p.owner_member_id::text AS mid
      FROM public.projects p
      WHERE p.is_deleted = false
        AND p.owner_member_id IS NOT NULL
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT unnest(p.owner_member_ids)::text
      FROM public.projects p
      WHERE p.is_deleted = false
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT unnest(p.member_ids)::text
      FROM public.projects p
      WHERE p.is_deleted = false
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT t.assignee_member_id::text
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.is_deleted = false
        AND p.is_deleted = false
        AND t.assignee_member_id IS NOT NULL
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT unnest(t.assignee_member_ids)::text
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
      WHERE t.is_deleted = false
        AND p.is_deleted = false
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT t.assignee_member_id::text
      FROM public.tasks t
      JOIN public.task_projects tp ON tp.task_id = t.id
      JOIN public.projects p ON p.id = tp.project_id
      WHERE t.is_deleted = false
        AND p.is_deleted = false
        AND t.assignee_member_id IS NOT NULL
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
    UNION
    SELECT unnest(t.assignee_member_ids)::text
      FROM public.tasks t
      JOIN public.task_projects tp ON tp.task_id = t.id
      JOIN public.projects p ON p.id = tp.project_id
      WHERE t.is_deleted = false
        AND p.is_deleted = false
        AND (p.group_ids && public.current_member_group_ids() OR public.current_member_is_super_admin())
  ) x
  WHERE mid IS NOT NULL
$fn_visible_pj_members$;
GRANT EXECUTE ON FUNCTION public.visible_project_member_ids() TO authenticated;

CREATE POLICY "members_select" ON members
  FOR SELECT TO authenticated
  USING (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR group_ids && public.visible_invite_group_ids()
    OR id::text = ANY(public.visible_project_member_ids())
  );

CREATE POLICY "members_write_insert" ON members
  FOR INSERT TO authenticated
  WITH CHECK (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR (
      group_ids && public.visible_invite_group_ids()
      AND (current_member_is_admin() OR current_member_is_super_admin())
    )
  );

CREATE POLICY "members_write_update" ON members
  FOR UPDATE TO authenticated
  USING (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR (
      group_ids && public.visible_invite_group_ids()
      AND (current_member_is_admin() OR current_member_is_super_admin())
    )
  )
  WITH CHECK (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR (
      group_ids && public.visible_invite_group_ids()
      AND (current_member_is_admin() OR current_member_is_super_admin())
    )
  );

CREATE POLICY "members_write_delete" ON members
  FOR DELETE TO authenticated
  USING (
    group_ids && current_member_group_ids()
    OR current_member_is_super_admin()
    OR (
      group_ids && public.visible_invite_group_ids()
      AND (current_member_is_admin() OR current_member_is_super_admin())
    )
  );


-- ============================================================
-- ブロック2: guard_member_privilege_columns の拡張
--
-- 変更点は4つだけで、既存フェーズ1〜3の他のロジックは変えていない。
--   (a) フェーズ2の部署ブートストラップ猶予から招待用部署を除外する。
--       招待用部署には admin を作る経路が設計上存在しないため、
--       dept_admin_count が永久に0＝猶予窓が恒久的に開いたままになる。
--   (b) フェーズ4（新設）: email の保護。
--       email は「ログイン中の人がどの members 行か」を決める同一性判定キー
--       （App.tsx の autoMatch() / current_member_is_admin() 等）。
--       書き換えられると他人の行への成り代わりが成立する。
--   (c) フェーズ5（新設）: is_deleted の false→true（論理削除）の保護。
--       有効な管理者を消せると、フェーズ1/2のブートストラップ猶予
--       （管理者0人なら自己昇格可）を人為的に開けてしまう。
--   (d) will_be_super_admin（旧）を self_bootstrap_super_admin（新）に置き換える。
--       【引継ぎ時の訂正記録】このコメント自体は前任（クラッシュ前）の下書き時点で
--       既に書かれていたが、実際の関数本体は `will_be_super_admin := NEW.is_super_admin;`
--       という旧ロジックのまま未修正だった（コメントと実装が食い違っていた）。つまり
--       「対象行が元々super-adminで今回は無変更」のケースでも、同じ部署の非管理者が
--       そのsuper-adminの行のis_admin/group_id/group_ids/email/is_deletedを書き換えられる
--       穴が実装上まだ残っていた。本セッションで実装をコメントどおりに修正した
--       （self_bootstrap_super_adminはフェーズ1の自己ブートストラップ分岐を実際に
--       通った時だけtrueにするdefault falseの変数として書き直し、フェーズ2〜5の
--       参照先も全て置き換えた）。
--
-- 【(d) の詳細＝認可を「操作される側」で判定していた誤り】
-- 旧実装は `will_be_super_admin := NEW.is_super_admin;` としたうえで、
-- フェーズ2・3で `IF acting_super_admin OR will_be_super_admin THEN NULL;` と
-- 書いていた。NEW は「操作される行」なので、これは
-- 「操作対象が全社スーパー管理者の行なら、誰が操作しても is_admin / group_id /
--  group_ids を自由に変更できる」という意味になっていた。認可は操作する側で
-- 判定しなければならない。
-- 導入時（20260702c・commit 506b800）のコメントによれば、この条項の意図は
-- 「(b) フェーズ1で自分自身が今まさに super-admin になった場合」＝初回
-- ブートストラップで最初のスーパー管理者が自分の行に部署を設定できるように
-- することだった。実装がその意図より広かった（NEW.is_super_admin が true で
-- ありさえすればよい形になっていた）。
-- そこで、フェーズ1のブートストラップ分岐を実際に通ったときだけ立つフラグ
-- self_bootstrap_super_admin を新設し、フェーズ2・3・4・5はそれを見る。
-- これで意図（初回ブートストラップ）は満たしたまま、「対象が super-admin だから
-- 誰でも触れる」という穴だけが閉じる。
--
-- 【(d) でブートストラップ経路が壊れない根拠（SQLの分岐で確認）】
-- ・bootstrap_first_group_and_member()：members が0件のときだけ実行され、
--   email には auth.email() を入れ、is_super_admin=true でINSERTする。
--   → フェーズ1の `super_admin_count = 0 AND NEW.email = auth.email()` を満たし、
--     self_bootstrap_super_admin が true になる。以降のフェーズ2・3は旧実装と同じ枝を通る。
-- ・SetupWizard の残りメンバー登録：ブートストラップ後は本人が super-admin なので
--   acting_super_admin が true。self_bootstrap_super_admin は不要。
-- ・accept_project_invite()：is_super_admin=false でINSERTするためフェーズ1に入らず、
--   旧実装でも will_be_super_admin は false だった（挙動は完全に同じ）。
--
-- 【🔴 SQL Editor から手作業でUPDATEすると挙動が変わる（運用上の注意）】
-- このトリガーの認可判定は auth.email() に依存する。Supabase の SQL Editor は
-- service role で実行され auth.email() が NULL になるため、
-- current_member_is_super_admin() は NULL＝「管理者ではない」と評価される。
-- したがって SQL Editor から members の is_admin / is_super_admin / group_id /
-- group_ids / email / is_deleted を直接UPDATEしても、**エラーを出さずに静かに
-- 元の値へ差し戻される**（2026-08-18に実際に発生：応急処置で2名分の group_ids を
-- 1文でUPDATEしたところ、super-admin の行だけ通り、そうでない行は静かに戻った。
-- 旧実装の will_be_super_admin による差だった。(d) の修正後はどちらの行も通らない）。
-- SQL Editor で意図的にこれらの列を書き換えたいときは、同一トランザクション内で
-- トリガーを一時的に外すこと：
--   BEGIN;
--   ALTER TABLE members DISABLE TRIGGER trg_members_guard_privilege;
--   UPDATE members SET ... WHERE ...;
--   ALTER TABLE members ENABLE TRIGGER trg_members_guard_privilege;
--   COMMIT;
-- 通常運用（アプリ経由）ではこの手順は不要。
--
-- 【INSERTを壊さないこと】(b)(c) はどちらも TG_OP = 'UPDATE' のときだけ働く。
-- INSERT経路（SetupWizard の saveMember / bootstrap_first_group_and_member() /
-- accept_project_invite() の新規メンバー作成）は一切通らない。
-- INSERT時のemailは既存の守り（RLSのWITH CHECK＝自分のアクセス部署の行しか
-- 作れない、members_email_unique＝有効な既存メンバーと同じemailの行は作れない、
-- フェーズ1〜3＝is_admin/is_super_admin/group_ids は昇格できない）で担保する。
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
  -- 【2026-08-18・v3.75】(d)の実装本体。旧will_be_super_adminは「NEW.is_super_adminが
  -- true でありさえすれば真」になっており、「対象行が元々super-adminで今回は無変更」の
  -- ケースでも真になっていた（対象の属性で判定していた誤り）。default falseにし、
  -- フェーズ1の自己ブートストラップ分岐を実際に通った時だけtrueにする。
  self_bootstrap_super_admin boolean := false;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
  old_group_ids       text[];
  old_email           text;
  old_is_deleted      boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
    old_email          := NEW.email;
    old_is_deleted     := NEW.is_deleted;
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
    old_email          := OLD.email;
    old_is_deleted     := OLD.is_deleted;
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
        self_bootstrap_super_admin := true;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  -- フェーズ2: is_admin / group_id（部署内権限・所属）
  IF NEW.is_admin IS DISTINCT FROM old_is_admin
     OR NEW.group_id IS DISTINCT FROM old_group_id THEN

    IF acting_super_admin OR self_bootstrap_super_admin THEN
      NULL; -- super-admin（既存 or フェーズ1で自己昇格した本人）は自由に変更可
    ELSIF public.current_member_is_admin() THEN
      NULL; -- 部署管理者は変更可（部署越境はRLSが別途ブロック）
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      -- 【2026-08-18・v3.75】部署ブートストラップ猶予から招待用部署を除外する。
      -- 招待用部署（is_invite_group=true）には admin を作る経路が設計上存在せず、
      -- dept_admin_count が永久に0のままになるため、この猶予が恒久的に開いた
      -- 窓になっていた（招待受諾者が自分の行を is_admin=true にできた）。
      IF dept_admin_count = 0
         AND NOT EXISTS (
           SELECT 1 FROM public.groups g
           WHERE g.id = check_group_id AND g.is_invite_group = true
         ) THEN
        NULL; -- 部署ブートストラップ：その部署にis_admin=trueが1人もいなければ許可
      ELSE
        NEW.is_admin  := old_is_admin;
        NEW.group_id  := old_group_id;
      END IF;
    END IF;
  END IF;

  -- フェーズ3（複数部署アクセス。migration 20260722b）: group_ids（追加部署アクセス）
  -- 直接付与・剥奪はsuper-admin限定。非super-adminがホーム部署(group_id)を付け替えた場合
  -- （部署ブートストラップ含む）・新規作成時は、group_idsを新ホーム部署のみにリセットする
  -- （追記のまま残すと部署admin経由で複数部署アクセスを迂回的に付与できる抜け穴になるため）。
  -- NEW.group_id はフェーズ2で既に最終確定済み（差し戻された場合は old_group_id と一致）。
  --
  -- 【2026-08-10・migration 20260810_add_project_invites.sql で追加】プロジェクト招待機能の
  -- 「発行権限は全メンバー」（決定事項）により、create_project_invite() が発行者本人と
  -- PJオーナーに招待用部署（is_invite_group=true）への兼務をこのトリガー経由のUPDATEで
  -- 付与する。既存ルールのままだと非super-adminによるこのUPDATEは静かに差し戻されてしまう
  -- ため、以下の3条件を全て満たす場合に限り例外的に許可する：
  --   ① create_project_invite() がトランザクションローカルで明示的に立てたセッション変数
  --      （app.allow_invite_group_grant='on'）が立っている（PostgREST経由のクライアントは
  --      生SQL実行手段が無いため直接この変数を立てられない＝この関数の内部でしか到達しない）
  --   ② 既存の所属を1件も失っていない（NEW.group_ids @> old_group_ids）
  --   ③ 追加された要素が全て is_invite_group=true のグループである
  -- coalesce(...,'')='on' は「NULL（未設定）なら安全側＝許可しない」に倒すためのもので、
  -- 認可チェックをNULLで素通りさせる猶予条項ではない（Section 1.6の教訓とは別種の判定）。
  IF acting_super_admin OR self_bootstrap_super_admin THEN
    NULL; -- super-adminは自由に付与・剥奪可（末尾の正規化で group_id 包含だけ保証する）
  ELSIF TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM old_group_id THEN
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  ELSIF coalesce(current_setting('app.allow_invite_group_grant', true), '') = 'on'
        AND NEW.group_ids @> old_group_ids
        AND NOT EXISTS (
          SELECT 1 FROM unnest(NEW.group_ids) AS gid
          WHERE gid <> ALL(old_group_ids)
            AND NOT EXISTS (
              SELECT 1 FROM public.groups g WHERE g.id = gid AND g.is_invite_group = true
            )
        )
  THEN
    NULL; -- 招待用部署への兼務追加のみを許可（追加分が全てis_invite_group=trueであることを検証済み）
  ELSE
    NEW.group_ids := old_group_ids; -- 非super-adminによるgroup_ids自体の直接変更は差し戻す
  END IF;

  -- 【2026-08-18・v3.75】フェーズ4: email（同一性判定キー）
  -- email は「ログイン中の人がどの members 行か」を決める唯一のキーであり
  -- （App.tsx の autoMatch() / current_member_is_admin() / current_member_id() 等）、
  -- 他人の行の email を自分のアドレスに書き換えられると、その人の権限で
  -- ログインしたのと同じ状態になる。他の特権列と同じく静かに差し戻す
  -- （表示名など他フィールドの保存は妨げない）。
  -- 許可するのは次の3つだけ：実行者がsuper-admin／実行者が部署管理者
  -- （部署越境はRLSが別途ブロック）／対象が実行者自身の行。
  -- 自分自身の行の判定は IS NOT DISTINCT FROM（email が NULL の行を
  -- 「誰の行でもある」と誤判定しないため）。
  IF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM old_email THEN
    IF acting_super_admin
       OR self_bootstrap_super_admin
       OR public.current_member_is_admin()
       OR old_email IS NOT DISTINCT FROM auth.email() THEN
      NULL;
    ELSE
      NEW.email := old_email;
    END IF;
  END IF;

  -- 【2026-08-18・v3.75】フェーズ5: is_deleted の false→true（論理削除）
  -- 有効な管理者を論理削除できると、フェーズ1（全社super-adminが0人なら自己昇格可）
  -- ・フェーズ2（部署adminが0人なら自己昇格可）のブートストラップ猶予を
  -- 人為的に開けられる。削除はadmin以上に限る。復元（true→false）は
  -- 誰かの権限が増える操作ではないため対象にしない。
  IF TG_OP = 'UPDATE'
     AND coalesce(NEW.is_deleted, false) = true
     AND coalesce(old_is_deleted, false) = false THEN
    IF acting_super_admin
       OR self_bootstrap_super_admin
       OR public.current_member_is_admin() THEN
      NULL;
    ELSE
      NEW.is_deleted := old_is_deleted;
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
    END IF;
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
-- ブロック3: projects.group_ids のガードトリガー
--
-- 【なぜ】projects のRLSは group_ids に自分のアクセス部署が1つでも含まれれば
-- 通る。したがって自部署のPJに他PJの招待用部署を後から足すことができ、
-- visible_invite_group_ids()（自分がアクセスできるPJに紐づく招待用部署を返す）の
-- 戻り値を任意に膨らませられた。groups_select が USING(true) のため
-- 招待用部署のidは全員が列挙できる＝知っていることを前提にする必要がある。
--
-- 【ルール（非super-adminのみ。super-adminは無条件で従来どおり）】
--   ① group_ids に置ける招待用部署は次のいずれかに限る：
--      (a) そのPJ自身の招待用部署（'grp-invite-' || projects.id）
--      (b) 変更前から既に入っていたもの（既存状態は壊さない）
--      (c) 実行者自身が既にアクセス権を持っているもの
--          ＝招待受諾者（ホーム部署が招待用部署の人）が新しくPJを作る経路を壊さないため
--      上記以外の招待用部署は静かに取り除く。
--   ② 既存要素の削除は静かに元へ戻す（招待用部署を外して受諾者を締め出す経路を塞ぐ。
--      同時に、古い group_ids を持ったままのクライアントが上書き保存して
--      招待用部署を落としてしまう既存の事故も防げる）。
--   ③ ホーム部署(group_id)にも同じ判定をかける（①で取り除いても、CHECK制約
--      projects_group_id_in_group_ids を満たすための最終正規化で復活してしまうため）。
--
-- 【エラーを投げず静かに戻す理由】既存のクライアントは projects を全列まとめて
-- upsert する（saveWithLock）。例外にすると、悪意のない普通の保存まで失敗しうる。
-- guard_member_privilege_columns と同じ「静かに元の値へ差し戻す」流儀に揃える。
--
-- 【トリガーの実行順序（重要）】同じタイミング（BEFORE INSERT OR UPDATE）の
-- トリガーは名前の昇順に実行される。既存の normalize_project_group_ids は
-- trg_projects_normalize_group_ids という名前で、group_id が group_ids に
-- 無ければ追記するだけの安全網。このガードはその後に走る必要があるため
-- （先に走ると、normalize が後から不正な group_id を group_ids へ書き戻す）、
-- 名前を trg_projects_verify_group_ids（v > n、かつ v > u ＝ updated_at より後）にしている。
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_project_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_verify_pj_group_ids$
DECLARE
  own_invite_group text;
  old_ids          text[];
  actor_ids        text[];
BEGIN
  IF public.current_member_is_super_admin() THEN
    RETURN NEW;
  END IF;

  own_invite_group := 'grp-invite-' || NEW.id;
  old_ids   := CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.group_ids, '{}'::text[]) ELSE '{}'::text[] END;
  actor_ids := coalesce(public.current_member_group_ids(), '{}'::text[]);

  -- ③（先に判定する）ホーム部署が「許されない招待用部署」なら元に戻す。
  -- INSERTの場合は戻す先が無いのでNULLにする（結果として group_ids が空になれば
  -- projects のRLS WITH CHECK が拒否する＝素通りしない）。
  IF NEW.group_id IS NOT NULL
     AND NEW.group_id <> own_invite_group
     AND NOT (NEW.group_id = ANY(old_ids))
     AND NOT (NEW.group_id = ANY(actor_ids))
     AND EXISTS (
       SELECT 1 FROM public.groups g
       WHERE g.id = NEW.group_id AND g.is_invite_group = true
     ) THEN
    NEW.group_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.group_id ELSE NULL END;
  END IF;

  -- ① 許されない招待用部署を取り除く（通常部署には触れない）
  NEW.group_ids := ARRAY(
    SELECT gid
    FROM unnest(coalesce(NEW.group_ids, '{}'::text[])) AS gid
    WHERE gid = own_invite_group
       OR gid = ANY(old_ids)
       OR gid = ANY(actor_ids)
       OR NOT EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = gid AND g.is_invite_group = true
          )
  );

  -- ② 既存要素の削除を元に戻す
  IF TG_OP = 'UPDATE' THEN
    NEW.group_ids := NEW.group_ids || ARRAY(
      SELECT gid FROM unnest(old_ids) AS gid
      WHERE NOT (gid = ANY(NEW.group_ids))
    );
  END IF;

  -- CHECK制約 projects_group_id_in_group_ids を満たすための最終正規化
  -- （ここで復活しうる group_id は上の③で既に妥当性を確認済み）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(NEW.group_ids)) THEN
    NEW.group_ids := array_append(NEW.group_ids, NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_verify_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_verify_group_ids ON projects;
CREATE TRIGGER trg_projects_verify_group_ids
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.verify_project_group_ids();

-- projects のポリシーに WITH CHECK を明示する。式はUSINGと同一のため挙動は変わらない
-- （PostgreSQLが FOR ALL で WITH CHECK 省略時にUSINGを流用するのと同じ結果）。
-- 「省略しているのか、意図して同じ式にしているのか」がSQLを読んだだけで分かるようにする
-- ためだけの変更（今回の事故の再発防止）。
DROP POLICY IF EXISTS "authenticated full access" ON projects;
DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin())
  WITH CHECK (group_ids && current_member_group_ids() OR current_member_is_super_admin());


-- ============================================================
-- ブロック4: project_invites のSELECTポリシーをPJ基準にする
--
-- 【なぜ】現行は can_access_group_ids(member_group_ids(invited_by))＝
-- 「発行者の所属部署」基準。招待を受諾した人は発行者と招待用部署を共有するため、
-- 発行者が発行した全ての招待行（他人のメールアドレス・他PJ宛を含む）が読めてしまう。
-- 監査に必要なのは「そのPJの関係者が、そのPJの招待を見られること」なので、
-- 対象PJが属する通常部署（招待用部署を除く）基準に変える。
--
-- 【招待用部署を除く理由】除かないと、そのPJの招待用部署に属する人＝受諾者が
-- 引き続き全招待行を読めてしまい、変更した意味が無くなる。
-- ============================================================

CREATE OR REPLACE FUNCTION public.project_normal_group_ids(p_project_id text)
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_pj_normal_gids$
  SELECT coalesce(array_agg(gid), ARRAY[]::text[])
  FROM public.projects p
  CROSS JOIN LATERAL unnest(p.group_ids) AS gid
  WHERE p.id = p_project_id
    AND NOT EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = gid AND g.is_invite_group = true
    )
$fn_pj_normal_gids$;
GRANT EXECUTE ON FUNCTION public.project_normal_group_ids(text) TO authenticated;

DROP POLICY IF EXISTS "project_invites_select_same_dept" ON project_invites;
DROP POLICY IF EXISTS "project_invites_select_project_dept" ON project_invites;
CREATE POLICY "project_invites_select_project_dept" ON project_invites
  FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.project_normal_group_ids(project_id)));


-- ============================================================
-- ブロック5: task_dependencies のRLSをPJ範囲（group_ids配列）に追従させる
--            （統括の追加指示・2026-08-18・同じマイグレーションに追記）
--
-- 【なぜ】task_dependencies だけが 20260722b の配列化（group_id単数比較 → group_ids
-- 配列オーバーラップ）に追従しておらず、旧来の group_id = current_member_group_id()
-- （単数・ホーム部署比較）のまま残っていた。実害が2つ：
--   ① 招待受諾者（ホーム部署＝招待用部署）には、参加しているPJのタスク依存関係が
--      1本も見えない。ガントの矢印（B2）・依存ゲート（B1）・BlockedTasksWidgetが
--      機能しない。
--   ② 複数部署を兼務しているメンバーも、兼務先（ホーム部署ではない方）のPJでは
--      依存関係が見えない既存バグ（招待とは無関係に、②単体でも本来直っているべき
--      だった）。
-- あわせて FOR ALL で WITH CHECK を省略していた（今回v3.75で塞いでいるのと同型
-- ＝USINGが書き込み認可を兼ねる）ため、これも直す。
--
-- 【方針】group_id 列の値ではなく、依存関係が結ぶ2つのタスク（predecessor/successor）
-- それぞれへのアクセス可否で判定する。tasks.group_ids は sync_task_group_ids /
-- cascade_project_group_ids_to_tasks によりPJのgroup_ids（招待用部署を含む）が
-- 既に伝播済みのため、これに乗るだけで招待受諾者にも兼務メンバーにも正しく効く。
-- 既存の task_projects_group / task_task_forces_group と同じ
-- can_access_group_ids(task_group_ids(...)) の流儀に揃え、新しいヘルパー関数は
-- 作らない（task_group_ids()は主キー1件参照のSTABLE関数で、既存2ポリシーと同じ
-- コスト。EXISTSに書き換えるより、既存の呼び出し規約に揃える方が可読性が高いと
-- 判断した）。
--
-- 🔴 両端とも（AND）アクセスできることを要求する。ORにすると、見えない方のタスクの
-- 存在が依存線から漏れる（例：他部署の非公開タスクの有無が、自分に見えるタスク側の
-- 依存表示から推測できてしまう）。
--
-- group_id 列自体は残す（NOT NULL・アプリが書き込み続けている）。RLSの判定材料と
-- しては使わなくなるだけで、列・書き込みロジック（sync_task_group_ids等は無関係）は
-- 一切変更しない。
-- ============================================================

DROP POLICY IF EXISTS "authenticated full access" ON task_dependencies;
DROP POLICY IF EXISTS "task_dependencies_group" ON task_dependencies;
CREATE POLICY "task_dependencies_group" ON task_dependencies FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(public.task_group_ids(predecessor_task_id))
    AND public.can_access_group_ids(public.task_group_ids(successor_task_id))
  )
  WITH CHECK (
    public.can_access_group_ids(public.task_group_ids(predecessor_task_id))
    AND public.can_access_group_ids(public.task_group_ids(successor_task_id))
  );


-- ============================================================
-- ブロック6: 監査クエリ
--
-- 【適用前に実行して控えておくもの】（適用後と見比べるため）
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('members','projects','project_invites')
--   ORDER BY tablename, policyname;
--
-- SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal ORDER BY tgname;
-- ============================================================

-- 【適用後1】members のポリシーがSELECTと書き込みに分割されたこと。
--   期待：members_select(SELECT) / members_write_insert(INSERT) /
--         members_write_update(UPDATE) / members_write_delete(DELETE) の4本。
--         members_group（cmd=ALL）は存在しないこと。
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'members' ORDER BY policyname;

-- 【適用後2】WITH CHECK を省略した FOR ALL ポリシーが members/projects に残っていないこと（0行）。
--   ※ この形は「USINGが書き込み認可を兼ねる」＝今回の事故そのもの。
-- SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('members','projects')
--     AND cmd = 'ALL' AND with_check IS NULL;

-- 【適用後3】SELECTポリシーが既存3条項のまま（可視性を狭めていない）＋新設4条項目
--   （PJ参加者の可視性）が加わっていること。期待：4つとも true。
-- SELECT position('current_member_group_ids'   IN qual) > 0 AS has_own_groups,
--        position('current_member_is_super_admin' IN qual) > 0 AS has_super_admin,
--        position('visible_invite_group_ids'   IN qual) > 0 AS has_invite_visibility,
--        position('visible_project_member_ids' IN qual) > 0 AS has_pj_member_visibility
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'members' AND policyname = 'members_select';

-- 【適用後4】guard関数に email / is_deleted の保護と、招待用部署の猶予除外が入ったこと。
--   期待：3つとも true。
-- SELECT position('old_email'       IN pg_get_functiondef(p.oid)) > 0 AS has_email_guard,
--        position('old_is_deleted'  IN pg_get_functiondef(p.oid)) > 0 AS has_is_deleted_guard,
--        position('is_invite_group' IN pg_get_functiondef(p.oid)) > 0 AS has_invite_bootstrap_fix
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'guard_member_privilege_columns';

-- 【適用後5】projects のトリガーが「normalize → verify」の順（名前の昇順）で並んでいること。
--   期待：trg_projects_normalize_group_ids が trg_projects_verify_group_ids より前に出る。
-- SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal ORDER BY tgname;

-- 【適用後6】project_invites のポリシーがSELECT1本だけで、PJ基準になっていること。
--   期待：1行のみ・cmd='SELECT'・qual に project_normal_group_ids を含む。
-- SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'project_invites';

-- 【適用後7】NULL猶予条項（IS NULLでの抜け穴）が今回の対象テーブルに無いこと（0行）。
-- SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('members','projects','project_invites')
--     AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');

-- 【適用後8・実機】招待を受諾したアカウント（管理者ではない人）でアプリにログインし、
--   ブラウザのコンソールから以下を実行して、いずれも「変わらない／0行」になること。
--   ※ SQL Editor は service role でRLSを素通りするため、この確認は必ずアプリ経由で行う。
--   (1) 他人の members 行の書き換えが通らない
--       await supabase.from('members').update({ email: '<自分のメール>' }).eq('id', '<発行者のid>')
--       → その後 select し直して email が変わっていないこと
--   (2) 論理削除できない
--       await supabase.from('members').update({ is_deleted: true }).eq('id', '<発行者のid>')
--       → is_deleted が false のままであること
--   (3) 他PJの招待用部署を自分のPJに足せない
--       await supabase.from('projects').update({ group_ids: [...既存, 'grp-invite-<他PJのid>'] }).eq('id', '<自分がアクセスできるPJのid>')
--       → group_ids が増えていないこと
--   (4) 他人宛の招待が読めない
--       await supabase.from('project_invites').select('id, invited_email')
--       → 0行であること

-- 【適用後9・実機】既存機能が壊れていないこと（通常のアカウントで確認する）。
--   (1) 部署管理者として管理画面「メンバー」から招待受諾者の表示名を編集して保存できる（v3.60の要件）
--   (2) 一般メンバーとして同じ部署の同僚の行を従来どおり編集できる
--   (3) PJカルテ →「⚙ このPJの設定」→「招待」から招待を発行できる（create_project_invite）
--   (4) 招待リンクから新規ユーザーが受諾でき、members が1件増える（accept_project_invite・新規分岐）
--   (5) 既にアプリを使っている別部署の人が受諾でき、members が増えずに group_ids だけ増える（既存メンバー分岐）
--   (6) PJの保存（名前変更等）が従来どおり通り、group_ids が減らないこと

-- 【適用後10・書き込み側に4条項目が漏れていないこと（SQLで確認）】
--   期待：3行とも with_check（またはUPDATEはUSING/WITH CHECK両方）に
--   'visible_project_member_ids' が含まれないこと（0件＝含まれていない）。
--   4条項目はSELECT専用の緩和であり、書き込み系ポリシーに紛れ込むと
--   「見えるようになった人が書き込みも通ってしまう」という今回の事故と同型の再発になる。
-- SELECT policyname, cmd,
--        position('visible_project_member_ids' IN coalesce(qual,''))       AS in_using,
--        position('visible_project_member_ids' IN coalesce(with_check,'')) AS in_with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'members'
--     AND policyname IN ('members_write_insert','members_write_update','members_write_delete');

-- 【適用後11・実機】招待受諾者から見えるメンバーがPJ参加者全員に広がったこと。
--   招待を受諾したアカウント（管理者ではない人）でアプリにログインし、ブラウザの
--   コンソールから以下を実行する。
--   await supabase.from('members').select('id, display_name')
--   → 自分が参加しているPJのオーナー・member_ids・タスク担当者（project_id直接紐づき・
--     task_projects経由の追加紐づけの両方）が全員含まれていること
--     （以前は発行者本人とPJオーナーの2名だけだった）。

-- 【適用後12・実機】PJを共有しない他部署のメンバーは引き続き見えないこと。
--   同じ招待受諾者のアカウントで、上記11のPJに一切関わっていない別部署のメンバーの
--   display_nameで検索しても該当行が返らないこと（部署間の素の可視性は広げていないことの確認）。
--   await supabase.from('members').select('id, display_name').ilike('display_name', '%<無関係な他部署メンバーの名前の一部>%')
--   → 0行であること。

-- 【適用後13・実機】task_dependencies：招待受諾者から、そのPJのタスク依存関係が見えること。
--   招待を受諾したアカウント（管理者ではない人）でアプリにログインし、依存関係
--   （先行→後続）が設定済みのPJのガントビューを開き、依存の矢印が表示されること・
--   完了ゲート（未完了の先行タスクがあるとき保存がブロックされること）が効くことを確認する。
--   ブラウザのコンソールからも直接確認できる：
--   await supabase.from('task_dependencies').select('id, predecessor_task_id, successor_task_id')
--   → 自分が参加しているPJのタスク間の依存行が含まれていること（以前は0行だった）。

-- 【適用後14・実機】task_dependencies：PJを共有しないタスクの依存関係は見えないこと。
--   同じ招待受諾者のアカウントで、上記13のPJに一切関わっていない別部署のPJ・タスク間の
--   task_dependencies行が返らないこと（predecessor/successorのどちらかでも見えない
--   タスクを含む行が0件であること）。
--   await supabase.from('task_dependencies').select('id').eq('predecessor_task_id', '<無関係な他部署タスクのid>')
--   → 0行であること。

-- 【適用後15】task_dependencies のポリシーがUSING/WITH CHECK両方を明示していること。
--   期待：with_check が NULL でないこと（今回のv3.75で塞いでいるのと同型の欠落が
--   このテーブルにも無いことの確認）。
-- SELECT policyname, cmd, with_check IS NOT NULL AS has_with_check
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_dependencies';

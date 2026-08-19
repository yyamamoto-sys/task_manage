-- ============================================================
-- projects.owner_member_ids の型を宣言どおり text[] に是正する
-- 2026-08-19（v3.80）
--
-- 【経緯】宣言（20260331_add_missing_columns.sql:19「add column if not exists
-- owner_member_ids text[] not null default '{}'」・supabase/schema.sql:240）は
-- 最初から一貫して text[] だったが、実DBの列は uuid[] のまま残っていた（列を作った
-- 当時の実際の型がuuid[]で、以降の"add column if not exists"は既存列があるため
-- 何も変更しなかった＝ドキュメントの誤りではなく実DBが宣言から外れていたドリフト）。
--
-- 2026-08-18、v3.75（20260818_harden_invite_related_rls.sql）の適用が
-- 「UNION types text and uuid cannot be matched」で2回失敗した原因はこれだった
-- （visible_project_member_ids()がowner_member_id::text・member_ids::text・
-- assignee_member_ids::textとUNIONする中で、owner_member_idsだけがuuid[]のまま
-- unnest()::textを通しても型不一致にはならない実装だったため、適用自体は
-- 20260818のunnest(...)::textキャストで最終的に成立したが、宣言と実DBが違う状態が
-- 放置されるのは事故の芽であり是正する）。
--
-- members.id はtext（uuid形式の文字列を格納する設計だが型はtext）のため、
-- owner_member_idsがuuid[]のままだと、将来UUID形式でないメンバーIDが生まれた時点で
-- その人だけ複数オーナーに追加できずDBエラーになる潜在リスクがあった。
--
-- 【他の列との比較（2026-08-19・山本さんが実DBの型を確認済み）】
--   projects.owner_member_ids … 実DB uuid[]（宣言 text[]）← 今回是正するのはここだけ
--   projects.member_ids        … 実DB text[]（宣言と一致・是正不要）
--   tasks.assignee_member_ids  … 実DB text[]（宣言と一致・是正不要）
--
-- 【この修正で変えること（ここだけ）】projects.owner_member_ids の型を uuid[] から
-- text[] に変更する。NOT NULL・DEFAULT '{}'は失われないため（PostgreSQLの
-- ALTER COLUMN TYPEはNOT NULL制約をそのまま保持し、DEFAULT式もUSING句と同じ変換で
-- 新しい型へ自動的に読み替える）明示的に再設定する必要は無いはずだが、認識のズレを
-- 残さないため本マイグレーションで明示的に再宣言する（冪等・害はない）。
--
-- 【20260818_harden_invite_related_rls.sql のunnest(p.owner_member_ids)::textキャストは
-- そのまま残す】text[]になった後もキャストは正しく動作し（text::textは恒等変換）、
-- 将来また型がずれても壊れない安全網として機能し続けるため、削除しない。
--
-- 【NULL猶予条項は書かない】CLAUDE.md Section 1.6の2026-06-26事故の教訓を厳守。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- 適用前の確認（是正前の実際の型を記録しておく）：
-- SELECT column_name, data_type, udt_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'owner_member_ids';
-- -- 期待：data_type='ARRAY', udt_name='_uuid'（是正前）

ALTER TABLE public.projects
  ALTER COLUMN owner_member_ids TYPE text[] USING owner_member_ids::text[];

-- ALTER COLUMN TYPEはNOT NULL制約自体を保持するが、認識のズレを残さないよう明示的に
-- 再宣言する（既にNOT NULLなら何もしない・冪等）。
ALTER TABLE public.projects
  ALTER COLUMN owner_member_ids SET NOT NULL;

-- DEFAULTも同様に明示的に再宣言する（型変更時にPostgreSQLがUSING句と同じ変換で
-- 自動的に読み替えるため通常は失われないが、念のため明示する）。
ALTER TABLE public.projects
  ALTER COLUMN owner_member_ids SET DEFAULT '{}'::text[];

-- ============================================================
-- 適用後の確認（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 型が text[] に変わっていること：
-- SELECT column_name, data_type, udt_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'owner_member_ids';
-- -- 期待：data_type='ARRAY', udt_name='_text', is_nullable='NO',
-- --       column_default = '''{}''::text[]'（表記はSupabase側の出力による）

-- 2) 行数・中身が変わっていないこと（型変更前後でPJ数とオーナー内容が一致すること）：
-- SELECT count(*) FROM projects; -- 変更前後で同じ件数であること
-- SELECT id, owner_member_id, owner_member_ids FROM projects ORDER BY created_at DESC LIMIT 10;
-- -- owner_member_idsの中身（UUID文字列の配列）が変更前と1文字も変わっていないことを
-- -- 目視確認する（uuid[]→text[]の変換はUUIDの正規表記をそのまま文字列化するだけのため
-- -- 値自体は変化しない）。

-- 3) visible_project_member_ids()（20260818_harden_invite_related_rls.sql）が
--    引き続き正しく動くこと：招待受諾者アカウントでログインし、PJ設定の
--    「関わるメンバー」タブに他の参加者が表示されることを確認する。
-- ============================================================

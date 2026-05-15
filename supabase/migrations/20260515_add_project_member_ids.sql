-- ============================================================
-- projects.member_ids 列の追加（PJメンバー：オーナーとは別の参加メンバー）
-- ============================================================
-- 背景：これまで projects は owner_member_ids（複数オーナー）しか持たず、
-- 「このPJに関わるメンバー全員」を表す手段がなかった。AI分析の負荷バランス評価や
-- 「自分のPJのみ」フィルタの精度を上げるため、member_ids を追加する。
-- owner_member_ids と member_ids は重複してもよい（オーナー兼メンバーは普通）。

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS member_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.projects.member_ids IS 'PJに参加するメンバーのID配列。オーナーと別に「関与者」を表す。';

-- Supabaseの旧デフォルトでテーブル新規作成時に自動で付与される anon/authenticated/service_role の
-- 既存のテーブルレベルGRANTでカラムは自動的にアクセス可能になるため、追加GRANTは不要。

NOTIFY pgrst, 'reload schema';

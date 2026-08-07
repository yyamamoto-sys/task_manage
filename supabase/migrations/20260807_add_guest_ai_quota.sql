-- ============================================================
-- ゲスト（サンプル閲覧）のAI利用回数制限＋利用ログの管理画面反映
-- 2026-08-07（v3.29・Phase 3）
--
-- 【背景】
-- Phase 2（v3.28）でゲストはSupabaseに一切接続しない設計にした（CLAUDE.md Section 23）。
-- Phase 3はこの遮断に「functions.invoke("ai-consult")」だけの例外を1つ開け、ゲストにAI機能を
-- 限定開放する。ゲストはAIを初めて使うときだけ signInAnonymously() で匿名セッションを作る
-- （Edge Functionが有効なJWTを要求するため）。回数制限は必ずクライアントではなくサーバー
-- （このマイグレーションのSQL関数＋Edge Function）で強制する。クライアント送信のフラグは
-- 偽装できるため、ゲスト判定はJWTの is_anonymous クレームだけで行う（Edge Function側）。
--
-- 【設計方針・なぜこの形か】
-- ・「1ブラウザ=1匿名Auth セッション」とみなし、匿名ユーザーのuuid（auth.uid()）をブラウザの
--   識別子として使う。追加のフィンガープリンティングは不要（ブラウザを跨いだ突合せもしない）。
-- ・consume_guest_ai_quota() は「無条件でインクリメントし、インクリメント後の件数を返す」だけ
--   を担う。「その件数が上限（3/日/ブラウザ・10/日/全体）を超えているか」の判定は
--   supabase/functions/ai-consult/guestQuota.ts（Edge Function側のTypeScript、Deno/ブラウザ
--   依存の無い純粋関数）で行う。判定と加算を別クエリに分けるとその間に競合が起きて上限を
--   超えられてしまうため、加算自体は本関数の中で INSERT ... ON CONFLICT DO UPDATE の
--   1文（Postgresの行ロックで守られる）に閉じている。しきい値の数字はSQL側には一切埋め込まず
--   Edge Function側の定数1箇所（GUEST_AI_PER_BROWSER_DAILY_LIMIT / GUEST_AI_GLOBAL_DAILY_LIMIT）
--   だけで管理する（変更してもこのマイグレーションの再適用は不要）。
-- ・この関数は authenticated には EXECUTE を渡さない（service_roleのみ）。ゲストが直接この
--   関数を叩いて全体枠を意図的に食い潰す経路を作らないため。Edge Functionはサービスロールで
--   呼ぶ（環境変数 SUPABASE_SERVICE_ROLE_KEY は全Edge Functionに自動的に用意されている。
--   supabase/functions/notify-deadlines/index.ts で既に実績あり）。
-- ・guest_ai_usage_daily / guest_ai_usage_global_daily は RLSを有効化するが個別ポリシーは
--   一切作らない（=authenticated/anon には常に0件・書き込み不可。service_role/postgresは
--   RLSを迂回するため関数からは問題なくアクセスできる）。
--
-- 【併せて直す既存のドリフト】
-- ai_usage_logs には元々 INSERT ポリシー（"authenticated users can insert"）が本番に存在するが、
-- 一度もマイグレーションファイルに書かれたことが無く schema.sql にも反映されていなかった
-- （20260723_scope_pj_task_satellite_tables.sql:216-219 のコメントに「そのまま残す」と
-- 書かれているだけで、その作成元が見つからない）。schema.sqlからクリーン構築した環境では
-- AI使用量を誰も記録できない状態だったため、ここで明文化する（本番は既に動いているため
-- 本番への適用上の影響は無い。参照用DDLの是正）。
--
-- 【ゲストのAI利用を管理者に見せる方法】
-- 新設テーブルを増やさず、既存の ai_usage_logs に is_guest 列を追加する。Edge Function が
-- サービスロールで member_id='__guest__'（src/lib/guestMode.ts の GUEST_MEMBER_ID と同一）・
-- is_guest=true として1行INSERTする。既存の管理画面「AI使用量」タブ（AdminView.tsx の
-- AIUsageSection）はこの列を見てゲスト分を「ゲスト（サンプル利用）」として表示する
-- （フロントエンド側の対応は別途 src/components/admin/AdminView.tsx を参照）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行（dev → prod の順）。
-- ============================================================

-- ============================================================
-- ① ドリフト是正：ai_usage_logs の INSERT ポリシー明文化 + is_guest 列追加
-- ============================================================

ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "authenticated users can insert" ON ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_insert_authenticated" ON ai_usage_logs;
CREATE POLICY "ai_usage_logs_insert_authenticated" ON ai_usage_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- ② ゲストAI利用回数の記録テーブル（ブラウザ別・全体）
-- ============================================================

-- ブラウザ別（＝匿名Authユーザー別）の日次カウンタ。
CREATE TABLE IF NOT EXISTS guest_ai_usage_daily (
  usage_date    date NOT NULL,
  anon_user_id  uuid NOT NULL,
  call_count    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, anon_user_id)
);

-- 全ゲスト共通・1日1行の日次カウンタ（コストの天井）。
CREATE TABLE IF NOT EXISTS guest_ai_usage_global_daily (
  usage_date  date PRIMARY KEY,
  call_count  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLSを有効化するが個別ポリシーは作らない（=authenticated/anonからは常にアクセス不可。
-- service_role/postgresはRLSを迂回するため、この関数からは問題なく読み書きできる）。
ALTER TABLE guest_ai_usage_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_ai_usage_global_daily ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ③ 原子的カウントアップ関数：consume_guest_ai_quota
-- ============================================================
-- 「インクリメント後のブラウザ別件数・全体件数」を返すだけの関数（しきい値判定はしない。
-- 判定は呼び出し元のEdge Function側・guestQuota.ts の decideGuestAiQuota() が行う）。
-- INSERT ... ON CONFLICT DO UPDATE はPostgresの一意インデックスの行ロックで直列化されるため、
-- 同時に複数リクエストが来ても加算が失われたり二重に判定がすり抜けたりしない。

CREATE OR REPLACE FUNCTION public.consume_guest_ai_quota(p_anon_user_id uuid)
RETURNS TABLE(browser_count integer, global_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_consume_guest_ai_quota$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_browser_count integer;
  v_global_count integer;
BEGIN
  INSERT INTO public.guest_ai_usage_global_daily (usage_date, call_count)
  VALUES (v_today, 1)
  ON CONFLICT (usage_date) DO UPDATE
    SET call_count = public.guest_ai_usage_global_daily.call_count + 1,
        updated_at = now()
  RETURNING call_count INTO v_global_count;

  INSERT INTO public.guest_ai_usage_daily (usage_date, anon_user_id, call_count)
  VALUES (v_today, p_anon_user_id, 1)
  ON CONFLICT (usage_date, anon_user_id) DO UPDATE
    SET call_count = public.guest_ai_usage_daily.call_count + 1,
        updated_at = now()
  RETURNING call_count INTO v_browser_count;

  RETURN QUERY SELECT v_browser_count, v_global_count;
END;
$fn_consume_guest_ai_quota$;

-- authenticated/anon には絶対に渡さない。service_roleだけが呼べる
-- （ゲストが直接この関数を叩いて全体枠を食い潰す経路を作らないため）。
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_guest_ai_quota(uuid) TO service_role;

-- ============================================================
-- 適用後の確認クエリ（任意）
-- ============================================================
-- 1) 列・テーブル・関数が期待どおり作成されたか
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_logs' AND column_name = 'is_guest';
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('guest_ai_usage_daily', 'guest_ai_usage_global_daily');
-- SELECT proname FROM pg_proc WHERE proname = 'consume_guest_ai_quota';
--
-- 2) authenticated/anon がこの関数を実行できない（0件であること）
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'consume_guest_ai_quota' AND grantee IN ('authenticated', 'anon');
--
-- 3) ai_usage_logs にINSERTポリシーが存在するか
-- SELECT polname FROM pg_policy WHERE polrelid = 'ai_usage_logs'::regclass AND polcmd = 'a';

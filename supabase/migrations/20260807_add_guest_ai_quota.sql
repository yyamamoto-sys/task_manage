-- ============================================================
-- ゲスト（サンプル閲覧）のAI利用回数制限＋利用ログの管理画面反映
-- 2026-08-07（v3.29・Phase 3）／2026-08-07 v3.30で条件付き加算に修正（レビュー指摘）
--
-- 【背景】
-- Phase 2（v3.28）でゲストはSupabaseに一切接続しない設計にした（CLAUDE.md Section 23）。
-- Phase 3はこの遮断に「functions.invoke("ai-consult")」だけの例外を1つ開け、ゲストにAI機能を
-- 限定開放する。ゲストはAIを初めて使うときだけ signInAnonymously() で匿名セッションを作る
-- （Edge Functionが有効なJWTを要求するため）。回数制限は必ずクライアントではなくサーバー
-- （このマイグレーションのSQL関数＋Edge Function）で強制する。クライアント送信のフラグは
-- 偽装できるため、ゲスト判定はJWTの is_anonymous クレームだけで行う（Edge Function側）。
--
-- 【v3.30での修正：無条件インクリメントの設計欠陥】
-- v3.29の初版は consume_guest_ai_quota() が「無条件で両方のカウンタをインクリメントしてから
-- （Edge Function側で）判定する」設計だった。このため拒否されたリクエストも全体枠を消費して
-- しまい、1ブラウザが上限（3回）を超えて何度も押すだけで、全体枠（10回/日）を1人で食い潰せる
-- 可用性バグがあった（本番適用前のレビューで発見・実際には未適用のまま本ファイルを直接修正）。
-- コストは守られていた（拒否されたリクエストはAnthropicを呼ばないため課金は発生しない）。
--
-- 【設計方針・なぜこの形か（v3.30）】
-- ・「1ブラウザ=1匿名Auth セッション」とみなし、匿名ユーザーのuuid（auth.uid()）をブラウザの
--   識別子として使う。追加のフィンガープリンティングは不要（ブラウザを跨いだ突合せもしない）。
-- ・consume_guest_ai_quota() は「上限未満のときだけ加算する条件付き加算」に変更した。
--   `INSERT ... ON CONFLICT DO UPDATE ... WHERE call_count < 上限` の形で、上限に達していれば
--   UPDATE自体が起きず RETURNING が0行（=NULL）になる。この判定と加算は同一SQL文の中で
--   Postgresの一意インデックスの行ロックにより直列化されるため、TOCTOUレース
--   （判定と加算を別クエリに分けた場合に起きる上限超過）は発生しない。
-- ・全体枠（コストの天井）を先に条件付きで加算し、それが通ってから初めてブラウザ別の枠を
--   条件付きで加算する。**ブラウザ別の枠で拒否された場合は、直前に加算した全体枠を
--   同一トランザクション内で必ず1減算して取り消す**（拒否されたリクエストがどちらの
--   カウンタも消費しないようにするための補償。ここを漏らすと「拒否なのに片方だけ進む」
--   という今回と同種のバグになる）。全体枠で拒否された場合はブラウザ別の枠には一切
--   触れないため、この経路には補償が不要（触れていないので消費していない）。
-- ・拒否理由の優先順位は従来の判断を維持する：全体枠を先に判定し、全体枠が尽きている場合は
--   ブラウザ別の枠の状態に関わらず reason='global' を返す（このブラウザ自身は個人枠内でも、
--   実際は共有枠が尽きているのに「あなたが使い切った」と誤案内しないため）。
-- ・しきい値の数字はSQL側には一切埋め込まない。呼び出し元（Edge Function）が
--   p_browser_limit / p_global_limit として毎回渡す。数字の管理場所は
--   supabase/functions/ai-consult/index.ts の定数1箇所（GUEST_AI_PER_BROWSER_DAILY_LIMIT /
--   GUEST_AI_GLOBAL_DAILY_LIMIT）のまま変わらない（変更してもこのマイグレーションの
--   再適用は不要）。
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
-- 【適用】Supabase SQL Editor に全文を貼って実行（dev → prod の順。まだどちらにも未適用）。
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
-- ③ 条件付きカウントアップ関数：consume_guest_ai_quota（v3.30で無条件加算から変更）
-- ============================================================
-- 「上限未満のときだけ加算し、拒否ならどちらのカウンタも進めない」判定＋加算を1関数に
-- 閉じる。引数のシグネチャが変わるため（p_browser_limit/p_global_limitを追加）、
-- v3.29版の関数が存在する場合に備えて明示的にDROPしてから作り直す
-- （本番・devとも未適用のため実際には何もDROPされないが、再実行時の安全のため）。

DROP FUNCTION IF EXISTS public.consume_guest_ai_quota(uuid);

CREATE OR REPLACE FUNCTION public.consume_guest_ai_quota(
  p_anon_user_id uuid,
  p_browser_limit integer,
  p_global_limit integer
)
RETURNS TABLE(allowed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_consume_guest_ai_quota$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_global_count integer;
  v_browser_count integer;
BEGIN
  -- ① 全体枠（コストの天井）を先に条件付きで加算する。上限未満のときだけ加算し、
  --    加算後の件数を返す。上限に達していれば UPDATE が起きずRETURNINGは0行（=NULL）になる。
  INSERT INTO public.guest_ai_usage_global_daily (usage_date, call_count)
  VALUES (v_today, 1)
  ON CONFLICT (usage_date) DO UPDATE
    SET call_count = public.guest_ai_usage_global_daily.call_count + 1,
        updated_at = now()
    WHERE public.guest_ai_usage_global_daily.call_count < p_global_limit
  RETURNING call_count INTO v_global_count;

  IF v_global_count IS NULL THEN
    -- 全体枠が尽きている。ブラウザ別カウンタには一切触れていないため、
    -- 補償（取り消し）は不要（そもそも消費していない）。
    RETURN QUERY SELECT false, 'global'::text;
    RETURN;
  END IF;

  -- ② ブラウザ別（匿名Authユーザー別）の上限を条件付きで加算する。
  INSERT INTO public.guest_ai_usage_daily (usage_date, anon_user_id, call_count)
  VALUES (v_today, p_anon_user_id, 1)
  ON CONFLICT (usage_date, anon_user_id) DO UPDATE
    SET call_count = public.guest_ai_usage_daily.call_count + 1,
        updated_at = now()
    WHERE public.guest_ai_usage_daily.call_count < p_browser_limit
  RETURNING call_count INTO v_browser_count;

  IF v_browser_count IS NULL THEN
    -- ブラウザ別の上限に達している。①で加算した全体枠を同一トランザクション内で
    -- 必ず1減算して取り消す（拒否されたリクエストがどちらのカウンタも消費しないための補償。
    -- 既に①で行ロックを取得済みのため、この減算に競合は発生しない）。
    UPDATE public.guest_ai_usage_global_daily
      SET call_count = call_count - 1, updated_at = now()
      WHERE usage_date = v_today;
    RETURN QUERY SELECT false, 'per_browser'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok'::text;
END;
$fn_consume_guest_ai_quota$;

-- authenticated/anon には絶対に渡さない。service_roleだけが呼べる
-- （ゲストが直接この関数を叩いて全体枠を食い潰す経路を作らないため）。
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) TO service_role;

-- ============================================================
-- 適用後の確認クエリ（任意）
-- ============================================================
-- 1) 列・テーブル・関数が期待どおり作成されたか
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_logs' AND column_name = 'is_guest';
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('guest_ai_usage_daily', 'guest_ai_usage_global_daily');
-- SELECT proname, pronargs FROM pg_proc WHERE proname = 'consume_guest_ai_quota';
--
-- 2) authenticated/anon がこの関数を実行できない（0件であること）
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'consume_guest_ai_quota' AND grantee IN ('authenticated', 'anon');
--
-- 3) ai_usage_logs にINSERTポリシーが存在するか
-- SELECT polname FROM pg_policy WHERE polrelid = 'ai_usage_logs'::regclass AND polcmd = 'a';
--
-- 4) 拒否がカウンタを消費していないことを手動で確認する例（同一ブラウザで4回連続呼ぶ）
-- SELECT * FROM consume_guest_ai_quota('00000000-0000-0000-0000-000000000001'::uuid, 3, 10); -- allowed=true (1回目)
-- SELECT * FROM consume_guest_ai_quota('00000000-0000-0000-0000-000000000001'::uuid, 3, 10); -- allowed=true (2回目)
-- SELECT * FROM consume_guest_ai_quota('00000000-0000-0000-0000-000000000001'::uuid, 3, 10); -- allowed=true (3回目)
-- SELECT * FROM consume_guest_ai_quota('00000000-0000-0000-0000-000000000001'::uuid, 3, 10); -- allowed=false, reason=per_browser (4回目)
-- SELECT call_count FROM guest_ai_usage_global_daily WHERE usage_date = (now() AT TIME ZONE 'Asia/Tokyo')::date; -- 3のままであること（4にならない）

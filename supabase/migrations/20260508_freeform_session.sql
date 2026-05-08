-- ============================================================
-- freeform セッションタイプの追加（OKRモードの第3形態）
-- ============================================================
-- 背景：チェックイン・ウィンセッション以外に、戦略会議や四半期計画など
-- OKR/TF が議題中心になる会議でも文字起こしを活かしたいというニーズ。
-- 構造化フォーマットを固定せず、AI に「議論サマリ・決定事項・KR言及・
-- フォローアップタスク」を抽出させて KR にぶら下げて保存する。

-- 1. session_type の CHECK 制約に 'freeform' を追加
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'kr_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%session_type%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE kr_sessions DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;

ALTER TABLE kr_sessions ADD CONSTRAINT kr_sessions_session_type_check
  CHECK (session_type IN ('checkin','win_session','freeform'));

-- 2. freeform 用の列追加（既存セッションは空文字デフォルトで影響なし）
ALTER TABLE kr_sessions ADD COLUMN IF NOT EXISTS summary      text NOT NULL DEFAULT '';
ALTER TABLE kr_sessions ADD COLUMN IF NOT EXISTS decisions    text NOT NULL DEFAULT '';
ALTER TABLE kr_sessions ADD COLUMN IF NOT EXISTS kr_mentions  text NOT NULL DEFAULT '';

COMMENT ON COLUMN kr_sessions.summary     IS 'freeform 用：AI が生成した議論サマリ（5〜10文）。checkin/win_session では空';
COMMENT ON COLUMN kr_sessions.decisions   IS 'freeform 用：決定事項のリスト（改行区切り）。checkin/win_session では空';
COMMENT ON COLUMN kr_sessions.kr_mentions IS 'freeform 用：言及された KR への注記（改行区切り、各行 "KRタイトル — メモ"）。checkin/win_session では空';

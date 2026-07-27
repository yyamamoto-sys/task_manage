-- ============================================================
-- ローディング画面のヒント（loading_tips）
-- 2026-07-27
--
-- 【目的】
-- 初回データ読み込み中（App.tsx のプログレスバー画面）の待ち時間に、
-- 初回ガイドツアー（first-time.ts）では扱っていない操作テクニックを1つずつ表示する。
--
-- 【設計方針】
-- ・全社共通の1テーブル（group_id を持たない）。編集できるのは全社スーパー管理者のみ。
--   → 部署ごとに違う内容にする要件が無く、「スーパー管理者のみ設定画面から変更」という
--     要件がそのまま company-wide のマスタを意味するため。
-- ・読み取りは authenticated 全員（ヒントは機密情報ではない）。
-- ・書き込み（INSERT/UPDATE/DELETE）は current_member_is_super_admin() のみ。
-- ・論理削除（is_deleted）。CLAUDE.md Section 4 の「物理削除は絶対に行わない」に従う。
-- ・初期の10件は「テーブルが空のときだけ」投入する（再適用しても増殖しない）。
--   投入後は設定画面から自由に編集・追加・削除できる。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行（dev → prod の順）。
-- ============================================================

CREATE TABLE IF NOT EXISTS loading_tips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  deleted_by  text
);

CREATE INDEX IF NOT EXISTS idx_loading_tips_sort_order
  ON loading_tips(sort_order) WHERE is_deleted = false;

-- updated_at トリガー（schema.sql の他テーブルと同じ流儀）
DROP TRIGGER IF EXISTS trg_loading_tips_updated_at ON loading_tips;
CREATE TRIGGER trg_loading_tips_updated_at
  BEFORE UPDATE ON loading_tips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS：読み取りは全員、書き込みは全社スーパー管理者のみ
-- ============================================================
ALTER TABLE loading_tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access" ON loading_tips;
DROP POLICY IF EXISTS "loading_tips_read"  ON loading_tips;
DROP POLICY IF EXISTS "loading_tips_write" ON loading_tips;

CREATE POLICY "loading_tips_read" ON loading_tips
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "loading_tips_write" ON loading_tips
  FOR ALL TO authenticated
  USING (current_member_is_super_admin())
  WITH CHECK (current_member_is_super_admin());

-- ============================================================
-- 初期データ（テーブルが空のときだけ投入）
-- ※ src/lib/tips/loadingTips.ts の DEFAULT_LOADING_TIPS と同じ内容。
--   あちらは「DB が読めない／キャッシュが無い初回」のフォールバックで、
--   こちらは設定画面から編集できる実データ。
-- ============================================================
INSERT INTO loading_tips (title, body, sort_order, is_active, updated_by)
SELECT * FROM (VALUES
  ('🔍 どこからでも一発ジャンプ',
   'Ctrl（Mac は ⌘）＋ K でコマンドパレットが開きます。タスク名・プロジェクト名で横断検索してそのまま開けるほか、ビュー切替・新規タスク・AI相談もここから呼び出せます。',
   10, true, ''),
  ('↩ 間違えても戻せます',
   '削除や一括変更のあとに出るトーストの「元に戻す」、または Ctrl（⌘）＋ Z で直前の操作を取り消せます。文字入力中は通常の文字取り消しが優先されるので、安心して使えます。',
   20, true, ''),
  ('🖱 ガントはドラッグで日付を編集',
   'バーの中央をドラッグすると期間を保ったままタスクごと移動、左右の端をドラッグすると開始日・期日だけを変更できます。ドラッグ中はカーソルの横に日付が出ます。',
   30, true, ''),
  ('✚ 空いた行を横にドラッグして期間をつくる',
   '期日が未設定のタスクは、ガントのその行を横にドラッグするだけで開始日〜期日をまとめて設定できます。まず名前だけ登録して、あとから期間を引く使い方がおすすめです。',
   40, true, ''),
  ('🔗 依存関係はドラッグでつなぐ',
   'ガントのバーにカーソルを合わせると端の外側に小さな丸が出ます。それを別のタスクのバーへドラッグすると「先行 → 後続」の依存になります。先行が終わるまで後続は完了にできません。',
   50, true, ''),
  ('🗂 まとめて動かす',
   'ガントで Ctrl（⌘）＋ クリックすると複数のタスクを選べます。そのうち1本をドラッグすれば、選択中の全タスクが同じ日数だけまとめてずれます。',
   60, true, ''),
  ('🎯 ガントのトグルで見方を変える',
   'ツールバーの 🎯クリティカルパス／▤ベースライン（当初計画との差）／⚠過負荷／🙈完了を隠す を切り替えると、遅れの原因や負荷の偏りが一目で分かります。',
   70, true, ''),
  ('📋 リスト・カンバンも複数選択できます',
   'Shift＋クリックで範囲選択、Ctrl（⌘）＋ A で全選択。選んだあとはステータス・担当者・優先度の変更や削除をまとめて実行できます。',
   80, true, ''),
  ('👥 ワークロードは行をクリック',
   'メンバー別の負荷一覧で行をクリックすると、その人が今抱えているタスクの中身（プロジェクト別・期限超過・先行待ち）が右側のパネルに開きます。',
   90, true, ''),
  ('📄 プロジェクトは過去のPJから作れます',
   'サイドバーの「プロジェクト」見出しの＋から新規作成するとき、「他のPJから引き継ぐ」を選ぶと過去のPJのタスクをチェックで選んで複製できます。日付は新しいPJの開始日を基準にスライドします。',
   100, true, '')
) AS seed(title, body, sort_order, is_active, updated_by)
WHERE NOT EXISTS (SELECT 1 FROM loading_tips);

-- ============================================================
-- 適用後の確認クエリ（任意）
-- ============================================================
-- SELECT sort_order, is_active, title FROM loading_tips WHERE is_deleted = false ORDER BY sort_order;
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'loading_tips'::regclass;

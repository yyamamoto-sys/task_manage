-- 管理者向けテンプレートファイル配布用のStorageバケットを作成する
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】部署別Teams通知の設定に使うPower Automateフローのテンプレート（.zip）を、
-- アプリ内の管理画面から直接ダウンロードできるようにしたい。ただしVite の public/
-- フォルダに置くとログイン不要で誰でもアクセスできる公開URLになってしまい、
-- ファイルに含まれる社内情報（テナント名・メールアドレス等）が無防備に公開される。
-- Supabase Storageにログイン必須の設定でアップロードし、他のデータと同じ
-- 認証保護のレベルに揃える。
--
-- 【適用後にやること】Supabaseダッシュボード → Storage → admin-templates バケットに
-- teams-webhook-flow-template.zip をアップロードする（手動・1回だけ）。

-- バケット作成（非公開＝publicはfalse。認証なしでの直リンクアクセスを防ぐ）
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-templates', 'admin-templates', false)
ON CONFLICT (id) DO NOTHING;

-- ログイン済みユーザーのみ、このバケット内のファイルを読み取れる
DROP POLICY IF EXISTS "admin_templates_read_authenticated" ON storage.objects;
CREATE POLICY "admin_templates_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'admin-templates');

-- アップロード・更新・削除はservice role（Supabaseダッシュボード等）経由のみ。
-- 一般ユーザー向けの書き込みポリシーは意図的に作らない（テンプレート配布は一方向のため）。

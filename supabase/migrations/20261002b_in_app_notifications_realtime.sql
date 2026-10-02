-- 2026-10-02（v3.133）: アプリ内通知（in_app_notifications）を Realtime の購読対象に追加
--
-- 目的：右上のベルの未読数を、通知が作られた（INSERT）・既読になった（UPDATE）その場で取り直す。
--       これまでは表示時・タブ復帰・Windows通知の受信・3分ごとのポーリングでしか取り直さず、
--       Windows通知オフの人や送信直後の本人は最大3分遅れていた。
--
-- 他人の通知が届かないこと：Realtime の postgres_changes は購読者の JWT で SELECT の RLS を評価してから配信する。
--   in_app_notifications の SELECT ポリシーは「本人の行だけ」（20261001_web_push_reminders.sql の
--   in_app_notifications_select_own。current_member_id() = auth.email() で本人を決める）なので、他人の行のイベントは届かない。
--   画面側も member_id=eq.<自分> で filter する（二重）。DELETE は RLS を評価できないため購読しない。
--
-- admin_message_recipients は追加しない：その RLS は「本人の行と super_admin」で、部署の管理者（送信者）には
--   宛先の既読が見えない。送信者へは確認のたびに admin_message_ack の行（in_app_notifications）が更新されるので、それで足りる。
--
-- 未適用でも画面は壊れない（購読に失敗したら従来のポーリングだけで動く）。
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。再実行安全。末尾の確認クエリで結果を見る。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'in_app_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications';
  END IF;
END $$;

-- 確認クエリ：1行（in_app_notifications）が返ればよい
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'in_app_notifications';

-- ============================================================
-- 一括適用スクリプト：2026-05-08 〜 2026-05-18 のマイグレーション13本
-- ============================================================
-- 目的：本番Supabaseに未適用のマイグレーションをまとめて反映する。
-- このファイルは supabase/migrations/ の13本をファイル名順に結合したもの。
--
-- ★ 再実行安全（冪等）：全文が IF NOT EXISTS / DROP IF EXISTS / DOブロックの
--   存在チェックで書かれているため、既に適用済みのものは自動的に no-op になる。
--   「どれが適用済みか」を気にせず、上から一気に貼って実行してよい。
--
-- 使い方：Supabase ダッシュボード → SQL Editor に全文を貼って Run。
--   ※ 万一 42601 エラーが出たら、コメント行(--)を除いて貼り直す（既知の挙動）。
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>> 20260508_freeform_session.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> 20260508_member_tags.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- メンバータグ：複数メンバーをまとめて担当者として扱う仕組み
-- ============================================================
-- 背景：「請求書PJ」「広報チーム」「全員」などのグループに対してタスクを
-- 紐付けたい。グループに属するメンバー全員の業務として集計される。
--
-- Phase Tag-1（このマイグレーション）：
--   タグ定義 + メンバー紐付けの DB スキーマと管理画面のみ。
--   タスクへの紐付けは Phase Tag-2 で別マイグレーションを足す。

-- 1. メンバータグ本体
CREATE TABLE IF NOT EXISTS member_tags (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- kind の使い分け：
  --   'static'      … 手動でメンバーを管理（請求書PJ・広報チーム等）
  --   'all_members' … 全アクティブメンバー（自動同期は Phase Tag-3）
  --   'kr_members'  … 特定 KR の関係メンバー（source_id=KR id・Phase 3）
  --   'tf_members'  … 特定 TF の関係メンバー（source_id=TF id・Phase 3）
  kind        text NOT NULL DEFAULT 'static'
              CHECK (kind IN ('static','all_members','kr_members','tf_members')),
  source_id   text,           -- kr_members/tf_members の参照先
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  deleted_by  text
);

-- 2. メンバータグ ↔ メンバー（多対多）
CREATE TABLE IF NOT EXISTS member_tag_members (
  tag_id     text NOT NULL REFERENCES member_tags(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, member_id)
);

-- 3. インデックス
CREATE INDEX IF NOT EXISTS idx_member_tag_members_member_id ON member_tag_members(member_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_kind ON member_tags(kind) WHERE is_deleted = false;

-- 4. updated_at 自動更新トリガー
DROP TRIGGER IF EXISTS trg_member_tags_updated_at ON member_tags;
CREATE TRIGGER trg_member_tags_updated_at
  BEFORE UPDATE ON member_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. RLS（既存テーブルと同じ authenticated full access ポリシー）
ALTER TABLE member_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_tag_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access" ON member_tags;
CREATE POLICY "authenticated full access" ON member_tags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated full access" ON member_tag_members;
CREATE POLICY "authenticated full access" ON member_tag_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE member_tags IS 'メンバーをグループ化するタグ。タスクの担当者として指定可能（Phase Tag-2で tasks に紐づけ）';


-- >>>>>>>>>>>>>>>>>>>> 20260513_add_project_analyses.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- project_analyses テーブルの追加（PJごとのAI分析結果を全員で共有）
-- ============================================================
-- 背景：プロジェクトカルテの「AI分析」結果を端末ローカル（localStorage）ではなく
-- サーバーに保存し、最新の分析を全メンバーが見られるようにする。
-- 履歴は 1 プロジェクトにつき最新 2 件まで（古いものはアプリ側で削除）。
-- レコードは作成後に変更しないため updated_at / is_deleted は持たない。

CREATE TABLE IF NOT EXISTS project_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id),
  content     text NOT NULL,                       -- AIが返したマークダウン本文
  created_by  text NOT NULL,                       -- 実行した member_id
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  project_analyses            IS 'PJごとのAI分析結果。1PJにつき最新2件まで保持（古い分はアプリ側で削除）。';
COMMENT ON COLUMN project_analyses.content    IS 'AIが返した分析レポート（マークダウン）';
COMMENT ON COLUMN project_analyses.created_by IS '分析を実行したメンバーの member_id';

CREATE INDEX IF NOT EXISTS idx_project_analyses_project_id_created_at
  ON project_analyses(project_id, created_at DESC);

ALTER TABLE project_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON project_analyses;
CREATE POLICY "authenticated full access" ON project_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- >>>>>>>>>>>>>>>>>>>> 20260513_add_tf_meeting_notes.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- tf_meeting_notes テーブルの追加（TF会議ノート：OKR循環ワークフロー Phase A）
-- ============================================================
-- 背景：チェックイン前のTF会議で更新している OneNote の内容（必達定義・評価観点・
-- 先週動かした仮説／起きたこと／次の一手／現在のプロセス状態(%)／ToDo・タスク状況）を
-- アプリ内に移す。TF × 週（月曜起点）で1レコード。前週のノートから内容を「下書き」として
-- 引き継いで次週分を作成できる（carried_from_note_id）。
-- 詳細設計：docs/okr-cycle-design.md

CREATE TABLE IF NOT EXISTS tf_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id                text NOT NULL REFERENCES task_forces(id),
  week_start           date NOT NULL,                  -- 月曜日（kr_sessions と同じ規約）
  target_definition    text NOT NULL DEFAULT '',       -- 必達の定義（「○月-必達(60%相当)」本文）
  eval_criteria        text NOT NULL DEFAULT '',       -- 評価観点
  hypotheses           text NOT NULL DEFAULT '',       -- ① 先週動かした前提・仮説
  facts                text NOT NULL DEFAULT '',       -- ② 実際に起きたこと（事実・反応）
  next_actions         text NOT NULL DEFAULT '',       -- ③ 次にやる一手（判断）
  progress_pct         int,                            -- ④ 現在のプロセス状態（%）
  progress_reason      text NOT NULL DEFAULT '',       -- ④ その理由
  todo_status          text NOT NULL DEFAULT '',       -- ToDo / タスクの状況メモ
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES tf_meeting_notes(id),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE  tf_meeting_notes IS 'TF会議ノート（TF×週で1件）。OneNoteの内容をアプリ化。前週から下書き引き継ぎ可。';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tf_meeting_notes_tf_week ON tf_meeting_notes(tf_id, week_start) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tf_meeting_notes_tf_id_week  ON tf_meeting_notes(tf_id, week_start DESC) WHERE is_deleted = false;

ALTER TABLE tf_meeting_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON tf_meeting_notes;
CREATE POLICY "authenticated full access" ON tf_meeting_notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at トリガー（update_updated_at 関数は既存）
DROP TRIGGER IF EXISTS trg_tf_meeting_notes_updated_at ON tf_meeting_notes;
CREATE TRIGGER trg_tf_meeting_notes_updated_at
  BEFORE UPDATE ON tf_meeting_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260513b_restructure_kr_meeting_notes.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 会議ノートを「TF単位」から「KR単位（中に各TFのセクション）」へ再構成
-- ============================================================
-- 背景：OneNote は KR ごとに1ドキュメントで、その中に TF1〜TFn のセクション
-- （TF説明・必達定義・評価観点・①〜④・TODO）が並んでいる運用。これに合わせ、
-- ノートは KR×週で1件（kr_meeting_notes）、その配下に TF ごとのエントリ（kr_note_tf_entries）を持つ。
-- 旧 tf_meeting_notes は作りたて・実データなしのため作り直す。
-- 詳細設計：docs/okr-cycle-design.md（Phase A）

DROP TABLE IF EXISTS tf_meeting_notes CASCADE;

-- 親：KR×週で1件
CREATE TABLE IF NOT EXISTS kr_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id                text NOT NULL REFERENCES key_results(id),
  week_start           date NOT NULL,                  -- 月曜日（kr_sessions と同じ規約）
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES kr_meeting_notes(id),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);

-- 子：ノート内の TF ごとのエントリ
CREATE TABLE IF NOT EXISTS kr_note_tf_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            uuid NOT NULL REFERENCES kr_meeting_notes(id) ON DELETE CASCADE,
  tf_id              text NOT NULL REFERENCES task_forces(id),
  tf_theme           text NOT NULL DEFAULT '',        -- TFの説明・その期のテーマ（OneNoteの「★1Q＝…」）
  target_definition  text NOT NULL DEFAULT '',        -- 必達の定義
  eval_criteria      text NOT NULL DEFAULT '',        -- 評価観点
  hypotheses         text NOT NULL DEFAULT '',        -- ① 先週動かした前提・仮説
  facts              text NOT NULL DEFAULT '',        -- ② 実際に起きたこと（事実・反応）
  next_actions       text NOT NULL DEFAULT '',        -- ③ 次にやる一手（判断）
  progress_pct       int,                             -- ④ 現在のプロセス状態（%）
  progress_reason    text NOT NULL DEFAULT '',        -- ④ その理由
  todo               text NOT NULL DEFAULT '',        -- ▶ TODO（その時期のToDo）
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, tf_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_meeting_notes_kr_week ON kr_meeting_notes(kr_id, week_start) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_meeting_notes_kr_id_week    ON kr_meeting_notes(kr_id, week_start DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_note_tf_entries_note_id     ON kr_note_tf_entries(note_id);

ALTER TABLE kr_meeting_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_note_tf_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON kr_meeting_notes;
CREATE POLICY "authenticated full access" ON kr_meeting_notes   FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated full access" ON kr_note_tf_entries;
CREATE POLICY "authenticated full access" ON kr_note_tf_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_kr_meeting_notes_updated_at ON kr_meeting_notes;
CREATE TRIGGER trg_kr_meeting_notes_updated_at BEFORE UPDATE ON kr_meeting_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_kr_note_tf_entries_updated_at ON kr_note_tf_entries;
CREATE TRIGGER trg_kr_note_tf_entries_updated_at BEFORE UPDATE ON kr_note_tf_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260513c_add_okr_tf_analyses.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- okr_tf_analyses テーブル（OKR循環ワークフロー Phase B：TF単位のAI分析の蓄積）
-- ============================================================
-- 背景：会議ノート＋セッション履歴＋タスクをまとめてAIが分析した結果を、TFごとに
-- 履歴として残し、過去に遡って読める／手修正できるようにする。
-- 詳細設計：docs/okr-cycle-design.md（Phase B）

CREATE TABLE IF NOT EXISTS okr_tf_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id       text NOT NULL REFERENCES task_forces(id),
  content     text NOT NULL,                    -- AI生成→人が手修正したマークダウン
  edited      boolean NOT NULL DEFAULT false,   -- 人が手修正したか
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE okr_tf_analyses IS 'TF単位のAI分析の蓄積。過去分も残す（遡って分析できるように）。';

CREATE INDEX IF NOT EXISTS idx_okr_tf_analyses_tf_id_created ON okr_tf_analyses(tf_id, created_at DESC) WHERE is_deleted = false;

ALTER TABLE okr_tf_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON okr_tf_analyses;
CREATE POLICY "authenticated full access" ON okr_tf_analyses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_okr_tf_analyses_updated_at ON okr_tf_analyses;
CREATE TRIGGER trg_okr_tf_analyses_updated_at BEFORE UPDATE ON okr_tf_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260513d_restructure_okr_analyses_to_kr.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- AI分析を「TF単位」→「KR単位」へ再構成（OKR循環ワークフロー Phase B 改）
-- ============================================================
-- 分析はKR単位（そのKRに紐づく全TFのノート＋KRのセッション・宣言＋TFのタスクをまとめてAIが分析）で行う。
-- 旧 okr_tf_analyses は作りたて・実データ少のため作り直す。
-- 詳細設計：docs/okr-cycle-design.md（Phase B）

DROP TABLE IF EXISTS okr_tf_analyses CASCADE;

CREATE TABLE IF NOT EXISTS okr_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id       text NOT NULL REFERENCES key_results(id),
  content     text NOT NULL,                    -- AI生成→人が手修正したマークダウン
  edited      boolean NOT NULL DEFAULT false,   -- 人が手修正したか
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE okr_analyses IS 'KR単位のAI分析の蓄積。過去分も残す（遡って分析できるように）。レポート作成の素材にもなる。';

CREATE INDEX IF NOT EXISTS idx_okr_analyses_kr_id_created ON okr_analyses(kr_id, created_at DESC) WHERE is_deleted = false;

ALTER TABLE okr_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON okr_analyses;
CREATE POLICY "authenticated full access" ON okr_analyses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_okr_analyses_updated_at ON okr_analyses;
CREATE TRIGGER trg_okr_analyses_updated_at BEFORE UPDATE ON okr_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260513e_add_kr_reports.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- kr_reports テーブル（OKR循環ワークフロー Phase C：レポートを確認・確定制に）
-- ============================================================
-- レポートは AI が下書き（status='draft'）→ 人が確認・手修正 → 「確定」（status='finalized'、
-- 確定者・確定日時を記録）の流れにする。確定後も再編集可。localStorage から移行。
-- 詳細設計：docs/okr-cycle-design.md（Phase C）

CREATE TABLE IF NOT EXISTS kr_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        text NOT NULL REFERENCES key_results(id),
  week_start   date NOT NULL,                  -- 対象週（月曜起点）
  mode         text NOT NULL DEFAULT 'checkin',-- 'checkin' / 'win_session' 等
  content      text NOT NULL DEFAULT '',       -- 本文（AI下書き→人が編集。HTML）
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by   text NOT NULL,                  -- AI下書きを生成した人
  finalized_by text,                           -- 確定した人（＝内容を確認・編集した人）
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  is_deleted   boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE kr_reports IS 'KRレポート。AI下書き→人が確認・編集→確定（finalized_by/at記録）。';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_reports_kr_week_mode ON kr_reports(kr_id, week_start, mode) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_reports_kr_id_week         ON kr_reports(kr_id, week_start DESC) WHERE is_deleted = false;

ALTER TABLE kr_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON kr_reports;
CREATE POLICY "authenticated full access" ON kr_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_kr_reports_updated_at ON kr_reports;
CREATE TRIGGER trg_kr_reports_updated_at BEFORE UPDATE ON kr_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260513f_add_kr_note_carry_memo.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- kr_meeting_notes に carry_memo 列を追加（Phase D：④③→①の自動引き継ぎ）
-- ============================================================
-- 「前週の確定レポートの要点」＋「最新の③分析の示唆」を自動生成して入れるテキスト欄。
-- ユーザーは編集可能。ノートの上部にエディタとして表示する。
-- 詳細：docs/okr-cycle-design.md（Phase D）

ALTER TABLE kr_meeting_notes ADD COLUMN IF NOT EXISTS carry_memo text NOT NULL DEFAULT '';
COMMENT ON COLUMN kr_meeting_notes.carry_memo IS '前回からの引き継ぎメモ。前週確定レポートの要点＋最新③分析の示唆を自動生成、編集可';


-- >>>>>>>>>>>>>>>>>>>> 20260513g_drop_kr_note_status.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- kr_meeting_notes.status 列を撤去（UI から「下書き/会議で使う」状態の概念を廃止）
-- ============================================================
-- 当初は「TF会議での更新が完了したノートをチェックインで使う」フラグとして導入したが、
-- 実運用では機能ゲートに使われず、画面上のマーカーとしてしか機能していなかった。混乱の元なので撤去。
-- カラムを落とすので、関連する CHECK 制約も同時に消える。

ALTER TABLE kr_meeting_notes DROP COLUMN IF EXISTS status;


-- >>>>>>>>>>>>>>>>>>>> 20260513h_okr_analyses_objective_scope.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- okr_analyses に Objective スコープを追加（B-1：1テーブルで KR/Objective 両対応）
-- ============================================================
-- これまで okr_analyses は KR 単位の分析だけを保持していた。
-- Phase B 仕上げで、Objective 全体の分析（O＋配下KRのノート・セッション・宣言・タスクを束ねた所感）も
-- 同じテーブルで扱えるようにする。scope で 'kr' / 'objective' を区別、objective_id を追加、
-- kr_id を NULL 許可に変更。データ整合性は CHECK 制約で担保。
-- 詳細：docs/okr-cycle-design.md（Phase B 仕上げ）

ALTER TABLE okr_analyses ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'kr';
ALTER TABLE okr_analyses ADD COLUMN IF NOT EXISTS objective_id text REFERENCES objectives(id);
ALTER TABLE okr_analyses ALTER COLUMN kr_id DROP NOT NULL;

-- scope の値を制約
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'okr_analyses'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%scope%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE okr_analyses DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;
ALTER TABLE okr_analyses ADD CONSTRAINT okr_analyses_scope_check
  CHECK (scope IN ('kr','objective'));

-- scope と参照キーの整合性
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'okr_analyses'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%objective_id%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE okr_analyses DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;
ALTER TABLE okr_analyses ADD CONSTRAINT okr_analyses_scope_target_check
  CHECK (
    (scope = 'kr'        AND kr_id        IS NOT NULL AND objective_id IS NULL)
    OR (scope = 'objective' AND objective_id IS NOT NULL AND kr_id        IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_okr_analyses_objective_id_created
  ON okr_analyses(objective_id, created_at DESC) WHERE is_deleted = false;

COMMENT ON COLUMN okr_analyses.scope        IS 'KR単位（kr）か Objective単位（objective）か';
COMMENT ON COLUMN okr_analyses.objective_id IS 'scope=objective のとき必須。配下の全KRを束ねた分析';


-- >>>>>>>>>>>>>>>>>>>> 20260515_add_project_member_ids.sql >>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>> 20260518_realtime_publication.sql >>>>>>>>>>>>>>>>>>>>
-- 2026-05-18: 主要9テーブルをRealtime購読対象に追加
--
-- 目的：複数人が同じ画面でタスク管理しているときに、誰かの変更が
--       他の人の画面にリロードなしで反映されるようにする。
--
-- 対象テーブル（日常業務の主要データ）：
--   - tasks / projects / todos
--   - task_task_forces / task_projects / project_task_forces  （中間テーブル）
--   - key_results / task_forces / milestones                  （OKR構造）
--   - members                                                 （担当者表示同期）
--
-- 含めないテーブル（意図的）：
--   - kr_sessions / kr_declarations / kr_meeting_notes / kr_note_tf_entries
--     okr_analyses / kr_reports / project_analyses
--     → AI生成・1人作成中心で realtime の利得が薄く、メッセージ量を抑える
--   - admin_change_logs / ai_usage_logs / member_tags / member_tag_members
--     → 通常運用での同時編集が少ない
--
-- 注意：この publication 操作は IF NOT EXISTS を直接サポートしないため、
--       DO ブロック内で「未登録のテーブルのみ追加」する。再実行安全。

DO $$
DECLARE
  t text;
  pub_tables text[] := ARRAY[
    'tasks', 'projects', 'todos',
    'task_task_forces', 'task_projects', 'project_task_forces',
    'key_results', 'task_forces', 'milestones',
    'members'
  ];
BEGIN
  FOREACH t IN ARRAY pub_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- 【検証クエリ】適用後に別途実行して、想定どおり入ったか確認する
-- ============================================================
-- 期待：以下のSELECTが各行を返せばOK（テーブル・カラム・制約・publication）。

-- 1) 新規テーブルが存在するか（5行返ればOK）
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('member_tags','member_tag_members','project_analyses',
                     'kr_meeting_notes','kr_note_tf_entries','okr_analyses','kr_reports')
order by table_name;

-- 2) 追加カラムが存在するか
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ( (table_name='kr_sessions'      and column_name in ('summary','decisions','kr_mentions'))
     or (table_name='kr_meeting_notes' and column_name = 'carry_memo')
     or (table_name='okr_analyses'     and column_name in ('scope','objective_id'))
     or (table_name='projects'         and column_name = 'member_ids') )
order by table_name, column_name;

-- 3) kr_meeting_notes.status が「無い」こと（13gで撤去済み・0行が正解）
select column_name from information_schema.columns
where table_schema='public' and table_name='kr_meeting_notes' and column_name='status';

-- 4) Realtime publication に主要10テーブルが入っているか（10行返ればOK）
select tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public'
  and tablename in ('tasks','projects','todos','task_task_forces','task_projects',
                    'project_task_forces','key_results','task_forces','milestones','members')
order by tablename;

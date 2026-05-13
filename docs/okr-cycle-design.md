# OKR循環ワークフロー 設計ドキュメント（ドラフト）

> ステータス：**レビュー済み・実装中**（Phase A から着手）。
> 関連：[週次運用フロー](./weekly-operation-flow.md) / [KRレポート生成手順](./kr-report-howto.md) / CLAUDE.md Section 6（AI境界）

---

## 1. 背景・目的

現状のOKRモードの課題：

- セッション履歴が「種類／シグナル／コメント」中心で、**誰がどんな宣言をしたか**が辿りにくい（→ 2026-05-13 に履歴へ宣言詳細を追加して一次対応済み）。
- **過去ログを遡っての分析**ができない（分析は都度・蓄積されない）。
- レポートが **人の確認なしにAIが自動生成**してしまう。承認の概念がない。
- チェックイン前の **TF会議ノート（OneNote）** がアプリ外にあり、レポート作成までの情報がアプリに集約されていない。

目指す姿：**週次**で `① 会議ノート → ② セッション記録 → ③ 分析結果 → ④ レポート作成 → 次週の①` を**循環**させ、各ステップの成果が次のステップ／次サイクルの出発点になる。最終的にこのアプリだけで運用が完結する状態（当面はOneNote併用）。

ノートは **KR×週で1件**（OneNote が KR ごとに1ドキュメントで、その中に TF1〜TFn のセクションが並ぶ運用に合わせる）。③分析と④レポートも KR/TF 単位で回る。

---

## 2. 全体像（循環図）

```
        ┌────────────────────────────────────────────────────────┐
        │  ④③→① 引き継ぎ：確定レポートの「学び」・③分析の示唆・     │
        │  前週の「次の一手」「現在の状態(%)」が次週ノートに差し込まれる │
        ↓                                                        │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ① 会議ノート   │──→│ ② セッション記録 │──→│ ③ 分析結果    │──→│ ④ レポート作成 │
│ KR×週・中にTF節 │   │ チェックイン/    │   │ ノート＋セッション│   │ AI下書き→人が │
│                │   │ ウィン/freeform  │   │ ＋タスクをAI分析 │   │ 編集→確定     │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
   1サイクル = 1週間（チェックイン週）   分析・レポートは KR/TF 単位で回る
```

- **循環の単位**：1週間（月曜チェックインの週）。
- **ノートの単位**：KR×週で1件。中に そのKRに紐づく TF ごとのセクションを持つ（OneNote と同じ構成）。
- **引き継ぎは「下書き」**：次の週のノートは前週から内容をコピーした状態で開き、すべて編集可能。完全自動置換ではない。
- なぜなぜ分析（既存「なぜなぜ」タブ）と クォーター計画（「計画」タブ）、概要（「概要」タブ）はそのまま残す。③分析結果は新規追加（将来「なぜなぜ」を吸収するかは別途検討）。

---

## 3. 各ステップの定義

### ① 会議ノート（新規）

OneNote で KR会議ごとに更新している内容をアプリ内のフォームに移す。**KR × 週（月曜起点）** で1レコード（`kr_meeting_notes`）。その中に、そのKRに紐づく **TF ごとのエントリ**（`kr_note_tf_entries`）を持つ。

各TFエントリの項目：

| 項目 | 内容 | 引き継ぎ（前週から） |
|---|---|---|
| TFの説明・その期のテーマ | OneNoteの「★1Q＝…」相当 | コピー（ほぼ固定） |
| 必達の定義 | 「○月-必達（60%相当）」の本文（達成状態の定義） | コピー（ほぼ固定） |
| 評価観点 | 「▶ 評価観点」の本文 | コピー（ほぼ固定） |
| ① 先週動かした前提・仮説 | チェックイン向け「１．」 | **前週の「③次の一手」を素材として差し込む** |
| ② 実際に起きたこと（事実・反応） | チェックイン向け「２．」※評価・解釈は書かない | 空（毎週新規） |
| ③ 次にやる一手（判断） | チェックイン向け「３．」 | コピー（更新前提） |
| ④ 現在のプロセス状態 | 「４．」進捗 `%`（数値）＋ 理由テキスト | コピー（更新前提） |
| ▶ TODO | 「▶ TODO」相当。その時期のToDo | コピー（更新前提） |

ノート全体に `status`（`draft` / `ready`）と `carried_from_note_id`（引き継ぎ元）を持つ。

- 「入力担当」欄は持たない（編集者は監査列 `updated_by` で分かる）。
- UI は KR を選ぶ → 週を選ぶ → そのKRのTFを TF1→TF2→… と順に入力 → 最後まで入れたら「このKRノートを作成」。`ready` にするとセッション記録画面に「このノートを下敷きにチェックインを始める」導線が出る（②へ）。
- 「前週から引き継いで作成」で、前週ノートの各TFエントリを下書きとしてコピーして開く（前週から残っているTFのぶんだけ。TFが増減していても破綻しない）。
- 表示するTFは **選択クォーターの TF 割り当て**（`quarterly_kr_task_forces` × その四半期の `QuarterlyObjective`）に絞る。クォーター割り当てが未設定の場合は `task_forces.kr_id` で絞る（従来動作）+ 注記を表示。クォーターセレクタの既定は今のカレンダー四半期（1-3月=1Q…）。

### ② セッション記録（既存 KrSessionPanel を流用）

現行のチェックイン／ウィンセッション／freeform 記録。変更点：

- ①ノート（その週・そのTFの最新）を**コンテキストとして AI抽出に渡す**／画面に「①ノートの内容」を参照表示する導線を足す。
- 既存の `kr_sessions` / `kr_declarations` テーブルはそのまま。
- セッションは KR 単位（既存）だが、TFノートは TF 単位なので「このKRに紐づくTFのノート」を束ねて参照する。

### ③ 分析結果（新規）

**KR単位**で、そのKRに紐づく全TFの**会議ノート履歴＋KRのセッション・宣言＋各TFのタスク**をまとめて AI が分析。結果は蓄積（履歴）し、遡って読める。手修正可。④レポート作成の素材にもなる。

- 入力：対象TFの会議ノート（`kr_note_tf_entries` の当該TF分・直近数週）＋ `kr_sessions`/`kr_declarations`（そのTFが紐づくKRのセッション）＋ そのTFに紐づくタスクの状況。
- 出力：マークダウンの分析レポート（進捗・ペース／仮説の検証状況／リスク・ボトルネック／担当者の負荷／次サイクルへの示唆）。
- 保存：`okr_analyses` テーブル（kr_id・履歴を全件残す）。AIが下書き → 人が手修正して保存 → 再分析も可能。
- AI境界：KR/TF コンテキストを渡す機能なので、ラボ機能例外ルール（`kr-*` 系）に倣う。`AIIntent = "okr-analysis"`。`contribution_memo` は参照しない。

### ④ レポート作成（既存 KrReportPanel を改修）

現状：AI が HTML レポートを自動生成 → localStorage 保存のみ。変更後：**AI下書き → 人が確認・手修正して確定**（編集した人＝確定者。別の承認者を立てる必要はない）。

- AI が下書きを生成（③分析結果を素材として引く）。`status = draft`。
- 人が確認・編集（マークダウン）。
- 「確定」を押すと `status = finalized`、`finalized_by` / `finalized_at` を記録。確定後も再編集はできる（編集すると `draft` に戻すか、`finalized` のまま更新するかは実装時に決める。当面：`finalized` のまま上書き可）。
- 確定（`finalized`）したレポートの「学び」が ④→① 引き継ぎで次週ノートに差し込まれる（`draft` のままだと引き継がれない）。
- `kr_reports` テーブルに保存（localStorage から移行）。

---

## 4. データモデル（新設テーブル）

すべて RLS 有効・`authenticated full access` ポリシー（既存テーブルに倣う）。`text` のFK（`*_id`）は既存テーブルと同じ規約。`updated_at` トリガー対象に追加。

### `kr_meeting_notes` / `kr_note_tf_entries`

```sql
-- 親：KR×週で1件
CREATE TABLE kr_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id                text NOT NULL REFERENCES key_results(id),
  week_start           date NOT NULL,                   -- 月曜日（kr_sessions と同じ規約）
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES kr_meeting_notes(id),  -- 引き継ぎ元
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uq_kr_meeting_notes_kr_week ON kr_meeting_notes(kr_id, week_start) WHERE is_deleted = false;

-- 子：ノート内のTFごとのエントリ
CREATE TABLE kr_note_tf_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            uuid NOT NULL REFERENCES kr_meeting_notes(id) ON DELETE CASCADE,
  tf_id              text NOT NULL REFERENCES task_forces(id),
  tf_theme           text NOT NULL DEFAULT '',          -- TFの説明・その期のテーマ
  target_definition  text NOT NULL DEFAULT '',          -- 必達の定義
  eval_criteria      text NOT NULL DEFAULT '',          -- 評価観点
  hypotheses         text NOT NULL DEFAULT '',          -- ① 先週動かした前提・仮説
  facts              text NOT NULL DEFAULT '',          -- ② 実際に起きたこと
  next_actions       text NOT NULL DEFAULT '',          -- ③ 次にやる一手
  progress_pct       int,                               -- ④ 現在のプロセス状態（%）
  progress_reason    text NOT NULL DEFAULT '',          -- ④ その理由
  todo               text NOT NULL DEFAULT '',          -- ▶ TODO（その時期のToDo）
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, tf_id)
);
```
※ migration: `migrations/20260513b_restructure_kr_meeting_notes.sql`（旧 `tf_meeting_notes` は作りたて・実データなしのため作り直し）。

### `okr_tf_analyses`

```sql
CREATE TABLE okr_tf_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id       text NOT NULL REFERENCES task_forces(id),
  content     text NOT NULL,                            -- AI生成→人が手修正したマークダウン
  edited      boolean NOT NULL DEFAULT false,           -- 人が手修正したか
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_okr_tf_analyses_tf_id_created ON okr_tf_analyses(tf_id, created_at DESC) WHERE is_deleted = false;
```
※ 何件まで残すかは要決定（案：最新10件 or 全件。「遡って分析」要件があるので全件寄り）。

### `kr_reports`

```sql
CREATE TABLE kr_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        text NOT NULL REFERENCES key_results(id),
  week_start   date NOT NULL,                           -- 対象週
  mode         text NOT NULL DEFAULT 'weekly',          -- レポート種別（weekly / monthly 等。要整理）
  content      text NOT NULL DEFAULT '',                -- 本文（AI下書き→人が編集）
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by   text NOT NULL,                           -- AI下書きを生成した人
  finalized_by text,                                    -- 確定した人（＝内容を確認・編集した人）
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  is_deleted   boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_kr_reports_kr_id_week ON kr_reports(kr_id, week_start DESC) WHERE is_deleted = false;
```

既存の `kr_sessions` / `kr_declarations` は変更なし。

---

## 5. 画面設計

### OKRモードのタブ並び（左→右で循環順）

```
上位タブ：[ 🎯 OKR管理 ] [ 🔍 なぜなぜ ] [ 📅 計画 ]   （右上に 🕐 履歴）
OKR管理 のサブタブ：[ 概要 ] [ ① 会議ノート ] [ ② セッション記録 ] [ ③ 分析 ] [ ④ レポート作成 ]
```

- 上部に **サイクルナビ**（①②③④のステップバー）。今いる位置をハイライトし、「対象KR・対象週・前週はどうだったか（前回ノートのステータス／前回レポートの確定状況）」を表示。
- KR/TF選択：①はKRを選んでからそのKRのTFを順に入力。③はTF単位。②④はKR単位だが「このKRに紐づくTF」を絞り込み表示。
- 各画面の上部に「**前回からの引き継ぎ**」セクション（前週ノートのサマリ／前回レポートの学び／③分析の最新示唆）を畳んで表示し、ワンクリックで本文に取り込める。

### 各画面の構成（概要）

- **① 会議ノート**：KR＋週セレクタ → そのKRのTFをステップ表示（TF1→TF2→…）。各TFで TF説明・必達・評価観点・①②③④・TODO を入力 → 最後まで入れたら「このKRノートを作成」（既存なら「保存」）。`status` は `draft`/`ready`。「前週から引き継いで作成」ボタン（前週ノートの各TFエントリを下書きコピー・`carried_from_note_id` を記録）。TFストリップで任意のTFへジャンプ可。
- **② セッション記録**：現行 KrSessionPanel ＋「①ノートを参照」パネル。
- **③ 分析結果**：TFセレクタ → 「✨ AI分析」ボタン → 下書き表示 → 編集 → 保存。下に履歴リスト（日時・実行者・編集済みバッジ）、過去分を開いて閲覧。
- **④ レポート作成**：KR＋週セレクタ → 「✨ AI下書き生成」（③を素材に） → 編集エリア → 「確定」（確定者・確定日時を記録）。確定後も再編集可。コピー/投稿用テキスト出力。

---

## 6. AI連携

| 機能 | AIIntent | 渡すデータ | 備考 |
|---|---|---|---|
| ③ TF分析 | `okr-tf-analysis`（新規） | 対象TFのノート＋紐づくKRのセッション・宣言＋TFのタスク | ラボ例外（KR/TF を渡す）。prompt builder に根拠コメント必須 |
| ④ レポート下書き | 既存の `kr-report` を流用（必要なら拡張） | ③分析結果＋セッション履歴＋宣言 | 既存 krReportClient を改修 |

`AIIntent` への追加は `src/lib/ai/invokeAI.ts` と CLAUDE.md Section 6-1b に反映する（規約）。

---

## 7. 既存資産との関係

- **kr_sessions / kr_declarations**：変更なし。②で①ノートを参照させる導線だけ追加。履歴オーバーレイは 2026-05-13 に宣言詳細表示を追加済み。
- **なぜなぜ（KrWhyPanel）**：当面そのまま。③分析結果と役割が近いので将来統合を検討（今回はスコープ外）。
- **計画（KrQuarterPlanPanel）／概要**：変更なし。
- **PJ単位のAI分析（ProjectKarte / project_analyses）**：別系統（PJ視点）。OKRのTF分析（`okr_tf_analyses`）とは別テーブル・別画面のまま。

---

## 8. 移行戦略（OneNote → アプリ）

1. Phase A で会議ノートを使えるようにする。各TFの「TF説明／必達の定義／評価観点」を初回だけ手で写す（以降は週次で引き継がれる）。
2. 数週間、OneNote とアプリを**併用**して使い勝手を確認・調整。
3. 安定したら OneNote 更新を停止し、アプリに一本化。`docs/weekly-operation-flow.md` を新フロー（①→②→③→④）に改訂。

---

## 9. フェーズ分割と完了条件

| Phase | 内容 | 主な成果物 | 完了条件 |
|---|---|---|---|
| **A**✅ | 会議ノート | `kr_meeting_notes` + `kr_note_tf_entries` テーブル＋migration＋`krMeetingNoteStore`＋`KrMeetingNotePanel`＋OKRタブ追加＋週次の下書き引き継ぎ | KRを選ぶ→TFを順に入力→ノートを作成・編集・保存でき、前週から引き継いで新規作成できる |
| **B**✅ | 分析結果ページ | `okr_tf_analyses` テーブル＋`okrTfAnalysisStore`＋`OkrTfAnalysisPanel`＋OKRタブ「分析結果」＋`okr-tf-analysis` intent＋`okrTfAnalysisClient` | （完了 2026-05-13）TF単位でAI分析を生成・手修正・保存でき、過去の分析を遡って読める |
| **C**✅ | レポート確認・確定 | `kr_reports` テーブル＋store＋KrReportPanel改修（AI下書き→人が編集→確定）＋③から素材を引く | レポートは確定操作を経て初めて `finalized`（確定者・確定日時を記録）になり、`draft` のままは次週引き継ぎに乗らない |
| **D**✅ | 循環の見える化＋ループを閉じる | OKRモード上部のサイクルナビ＋各画面の「前回からの引き継ぎ」＋④③→①の自動引き継ぎ（学び・分析示唆を次週ノートにprefill）＋`weekly-operation-flow.md` 改訂 | ①〜④がステップとして見え、確定レポートと最新分析が次週ノートに反映される |

各フェーズで：`npx tsc --noEmit` クリーン、`npm run build` 成功、`npm run test` パスを確認してコミット＆プッシュ（Vercel自動デプロイ）。新テーブルは Supabase SQL エディタ または `supabase db push` で適用が必要（適用前は該当機能のみエラー、既存機能は無影響）。

---

## 10. 未決事項・要レビュー

- [x] レポートの承認：別の承認者は立てず、AIが下書き→人が確認・編集して確定（編集者＝確定者）で確定（2026-05-13 ユーザー確認）
- [x] その他の未決事項：一旦そのまま（実装時の判断に委ねる）で進める（2026-05-13 ユーザー確認）
  - `okr_tf_analyses` は全件保持（遡り分析のため）
  - ①ノートの「先週動かした仮説」へは前週「次の一手」を prefill（編集可）
  - 対象週はその時点の月曜を既定、手動選択も可
  - freeform は ② の一形態として扱う
  - 新画面は PC 優先（スマホは後で調整）
- [ ] `kr_reports.mode` の種別整理（週次／月次／総務提出用 と既存「チェックイン向け／ウィン向け」モードの関係）— Phase C 着手時に詰める

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-05-13 | 初版ドラフト作成（レビュー用）。要件：週次・TF単位・下書き引き継ぎ・TFノートはTF単位でToDo/タスク状況も内包・OneNote併用→一本化・レポートは承認制 |
| 2026-05-13 | レビュー反映：別の承認者は不要（AI下書き→人が編集して確定）。その他未決事項は実装時判断で進める方針に。Phase A から実装着手 |
| 2026-05-13 | フィードバック反映：ノートを **TF単位→KR単位（中にTFごとのセクション）** に変更。KRを選んでからそのKRのTFを順に入力する方式。TF説明・TODO 欄を追加。テーブルを `tf_meeting_notes` → `kr_meeting_notes` + `kr_note_tf_entries` に作り直し（migration 20260513b）。TF選択の重複も解消 |
| 2026-05-13 | Phase B 仕上げ：③ 分析に「Objective全体」スコープを追加（okr_analyses に scope/objective_id 列。migration 20260513h）。okrObjectiveAnalysisClient（O+配下KRの最新KR分析を束ねた横断分析）。OkrKrAnalysisPanel を Objective/KR の単一セレクタに改修。AIIntent は okr-analysis 流用 |
| 2026-05-13 | ② セッション記録に「合同モード」追加：複数KR一括の議事メモを1回のAIで振り分け抽出（extractJointCheckinData/WinSessionData）。KrJointSessionFlow（新規）。OkrDashboardView に合同/単一トグル（既定＝合同） |
| 2026-05-13 | Phase D 完了：kr_meeting_notes に carry_memo 列追加（migration 20260513f）。会議ノート画面に「前回からの引き継ぎメモ」エディタを表示。「前週から引き継いで作成」と「↻ 引き継ぎメモを自動生成」で、前週の確定レポート（HTML→テキスト）と最新③分析の「次の一手／レポート用要点」セクションから自動生成→編集可。④③→①の引き継ぎが閉じてサイクル完成 |
| 2026-05-13 | Phase D（一次）：OKR管理に「サイクル進捗バー」追加（選択中KR×今週で ①会議ノート→②セッション→③分析→④レポート の状態を表示、各ステップへジャンプ可）。会議ノート画面に「💡 前回の振り返り（③分析）を見ながら書く」折りたたみ（このKRの最新AI分析を参照）を追加。残：④③→①の自動prefillはまだ手動（参照表示まで） |
| 2026-05-13 | Phase C 実装：kr_reports テーブル（migration 20260513e）＋krReportStore。KrReportPanel を「AI下書き→人が確認・編集（HTML直接編集）→確定（finalized_by/at記録、取り消し可）」に。localStorage保存→Supabase保存に移行。レポート生成時に③分析の最新結果を素材として渡す＋バナー表示 |
| 2026-05-13 | OKRモードを2階層に再構成（上位＝OKR管理/なぜなぜ/計画。OKR管理配下に①会議ノート②セッション記録③分析④レポート作成＋概要）。AI分析を **KR単位**に変更（okr_tf_analyses→okr_analyses、migration 20260513d。OkrKrAnalysisPanel/okrKrAnalysisClient、AIIntent=okr-analysis）。④レポート作成を独立サブタブ化。 |
| 2026-05-13 | Phase B 実装（旧）：OKRタブ「📊 分析結果」追加。okr_tf_analyses テーブル＋okrTfAnalysisStore＋OkrTfAnalysisPanel＋okrTfAnalysisClient（AIIntent=okr-tf-analysis）。会議ノート履歴＋KRセッション・宣言＋TFタスクをAIが分析、履歴保存・遡り・手書き編集可 |
| 2026-05-13 | 会議ノートにクォーターセレクタを追加し、表示TFを選択クォーターのTF割り当て（quarterly_kr_task_forces）に絞るように。TF重複の根本原因（過去クォーターのTFも表示されていた）に対応。割り当て未設定時は従来どおり kr_id で絞る＋注記 |

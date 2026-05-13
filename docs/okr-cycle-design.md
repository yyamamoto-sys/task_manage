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

目指す姿：**TF単位・週次**で `① TF会議ノート → ② セッション記録 → ③ 分析結果 → ④ レポート作成 → 次週の①` を**循環**させ、各ステップの成果が次のステップ／次サイクルの出発点になる。最終的にこのアプリだけで運用が完結する状態（当面はOneNote併用）。

---

## 2. 全体像（循環図）

```
        ┌────────────────────────────────────────────────────────┐
        │  ④③→① 引き継ぎ：確定レポートの「学び」・③分析の示唆・     │
        │  前週の「次の一手」「現在の状態(%)」が次週ノートに差し込まれる │
        ↓                                                        │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ① TF会議ノート │──→│ ② セッション記録 │──→│ ③ 分析結果    │──→│ ④ レポート作成 │
│  （TF会議で更新）│   │ チェックイン/    │   │ ノート＋セッション│   │ AI下書き→編集 │
│                │   │ ウィン/freeform  │   │ ＋タスクをAI分析 │   │ →承認依頼→承認 │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
   1サイクル = 1週間（チェックイン週）         TF単位（TF1のサイクル、TF2のサイクル…独立）
```

- **循環の単位**：1週間（月曜チェックインの週）。
- **循環の主語**：TF（タスクフォース）。TFごとに別々のサイクルが回る。
- **引き継ぎは「下書き」**：次の週のノートは前週から内容をコピーした状態で開き、すべて編集可能。完全自動置換ではない。
- なぜなぜ分析（既存「なぜなぜ」タブ）と クォーター計画（「計画」タブ）、概要（「概要」タブ）はそのまま残す。③分析結果は新規追加（将来「なぜなぜ」を吸収するかは別途検討）。

---

## 3. 各ステップの定義

### ① TF会議ノート（新規）

OneNote で TF会議ごとに更新している内容をアプリ内のフォームに移す。**TF × 週（月曜起点）** で1レコード。

| 項目 | 内容 | 引き継ぎ（前週から） |
|---|---|---|
| 必達の定義 | 「○月-必達（60%相当）」の本文（達成状態の定義） | コピー（ほぼ固定） |
| 評価観点 | 「▶ 評価観点」の本文 | コピー（ほぼ固定） |
| ① 先週動かした前提・仮説 | チェックイン向け「１．」 | **前週の「③次の一手」を素材として差し込む** |
| ② 実際に起きたこと（事実・反応） | チェックイン向け「２．」※評価・解釈は書かない | 空（毎週新規）／前週の事実を参考表示 |
| ③ 次にやる一手（判断） | チェックイン向け「３．」 | コピー（更新前提） |
| ④ 現在のプロセス状態 | 「４．」進捗 `%`（数値）＋ 理由テキスト | コピー（更新前提） |
| ToDo / タスクの状況 | 「▶ TODO」相当。TFのToDo・タスクの現況メモ | コピー（更新前提） |
| ステータス | `draft`（編集中）／ `ready`（チェックインに出せる） | `draft` で開始 |

- 「入力担当」欄は持たない（編集者は監査列 `updated_by` で分かる）。必要なら後で `editor_member_ids` 追加を検討。
- ノートを開いて編集 → 保存。`ready` にするとセッション記録画面に「このノートを下敷きにチェックインを始める」導線が出る（②へ）。

### ② セッション記録（既存 KrSessionPanel を流用）

現行のチェックイン／ウィンセッション／freeform 記録。変更点：

- ①ノート（その週・そのTFの最新）を**コンテキストとして AI抽出に渡す**／画面に「①ノートの内容」を参照表示する導線を足す。
- 既存の `kr_sessions` / `kr_declarations` テーブルはそのまま。
- セッションは KR 単位（既存）だが、TFノートは TF 単位なので「このKRに紐づくTFのノート」を束ねて参照する。

### ③ 分析結果（新規）

TF単位で、**過去のノート＋セッション履歴＋タスク**をまとめて AI が分析。結果は蓄積（履歴）し、遡って読める。手修正可。

- 入力：対象TFの `tf_meeting_notes`（直近数週）＋ `kr_sessions`/`kr_declarations`（そのTFが紐づくKRのセッション）＋ そのTFに紐づくタスクの状況。
- 出力：マークダウンの分析レポート（進捗・ペース／仮説の検証状況／リスク・ボトルネック／担当者の負荷／次サイクルへの示唆）。
- 保存：`okr_tf_analyses` テーブル（履歴を残す。最新N件 or 全件）。AIが下書き → 人が手修正して保存 → 再分析も可能。
- AI境界：KR/TF コンテキストを渡す機能なので、ラボ機能例外ルール（`kr-*` 系）に倣う。新 `AIIntent = "okr-tf-analysis"` を追加。`contribution_memo` 等の扱いは既存の `kr-report` 系に準拠。

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

### `tf_meeting_notes`

```sql
CREATE TABLE tf_meeting_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id              text NOT NULL REFERENCES task_forces(id),
  week_start         date NOT NULL,                     -- 月曜日（kr_sessions と同じ規約）
  target_definition  text NOT NULL DEFAULT '',          -- 必達の定義
  eval_criteria      text NOT NULL DEFAULT '',          -- 評価観点
  hypotheses         text NOT NULL DEFAULT '',          -- ① 先週動かした前提・仮説
  facts              text NOT NULL DEFAULT '',          -- ② 実際に起きたこと（事実・反応）
  next_actions       text NOT NULL DEFAULT '',          -- ③ 次にやる一手（判断）
  progress_pct       int,                               -- ④ 現在のプロセス状態（%）
  progress_reason    text NOT NULL DEFAULT '',          -- ④ その理由
  todo_status        text NOT NULL DEFAULT '',          -- ToDo / タスクの状況メモ
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES tf_meeting_notes(id),  -- 引き継ぎ元
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL DEFAULT '',
  is_deleted         boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uq_tf_meeting_notes_tf_week ON tf_meeting_notes(tf_id, week_start) WHERE is_deleted = false;
CREATE INDEX idx_tf_meeting_notes_tf_id_week ON tf_meeting_notes(tf_id, week_start DESC) WHERE is_deleted = false;
```

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
[ ① TF会議ノート ] [ ② セッション記録 ] [ ③ 分析結果 ] [ ④ レポート作成 ]   |   [ なぜなぜ ] [ 計画 ] [ 概要 ]   （右上に 🕐 履歴）
```

- 上部に **サイクルナビ**（①②③④のステップバー）。今いる位置をハイライトし、「対象TF・対象週・前週はどうだったか（前回ノートのステータス／前回レポートの承認状況）」を表示。
- TF選択：①③はTF単位。②④はKR単位だが「このKRに紐づくTF」を絞り込み表示。
- 各画面の上部に「**前回からの引き継ぎ**」セクション（前週ノートのサマリ／前回レポートの学び／③分析の最新示唆）を畳んで表示し、ワンクリックで本文に取り込める。

### 各画面の構成（概要）

- **① TF会議ノート**：TF＋週セレクタ → 上記カラムのフォーム（必達・評価観点・①②③④・ToDo状況）→「下書き保存」「ready にする」。「前週から引き継いで今週分を作成」ボタン（`carried_from_note_id` を埋めて prefill）。
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

1. Phase A で TF会議ノートを使えるようにする。各TFの「必達の定義／評価観点」を初回だけ手で写す（以降は週次で引き継がれる）。
2. 数週間、OneNote とアプリを**併用**して使い勝手を確認・調整。
3. 安定したら OneNote 更新を停止し、アプリに一本化。`docs/weekly-operation-flow.md` を新フロー（①→②→③→④）に改訂。

---

## 9. フェーズ分割と完了条件

| Phase | 内容 | 主な成果物 | 完了条件 |
|---|---|---|---|
| **A** | TF会議ノート | `tf_meeting_notes` テーブル＋migration＋store＋`TfMeetingNotePanel`＋OKRタブ追加＋週次の下書き引き継ぎ | 任意のTFで週次ノートを作成・編集・保存でき、前週から引き継いで新規作成できる |
| **B** | 分析結果ページ | `okr_tf_analyses` テーブル＋store＋`OkrTfAnalysisPanel`＋OKRタブ追加＋`okr-tf-analysis` intent＋AIクライアント | TF単位でAI分析を生成・手修正・保存でき、過去の分析を遡って読める |
| **C** | レポート確認・確定 | `kr_reports` テーブル＋store＋KrReportPanel改修（AI下書き→人が編集→確定）＋③から素材を引く | レポートは確定操作を経て初めて `finalized`（確定者・確定日時を記録）になり、`draft` のままは次週引き継ぎに乗らない |
| **D** | 循環の見える化＋ループを閉じる | OKRモード上部のサイクルナビ＋各画面の「前回からの引き継ぎ」＋④③→①の自動引き継ぎ（学び・分析示唆を次週ノートにprefill）＋`weekly-operation-flow.md` 改訂 | ①〜④がステップとして見え、確定レポートと最新分析が次週ノートに反映される |

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

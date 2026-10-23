## 73. AIに送るPJ・タスクの範囲：「対象PJ」と aiTarget.ts（v3.141・2026-10-14）

### 何が問題だったか

AI相談（`payloadBuilder.ts`）は、表示部署のアーカイブ以外の全PJについて**完了・中止を含む全タスク**を毎回送っていた。タスクの多い部署（EGG）では送信量が膨らみ、応答が遅い。サイドバーでPJを選んでも送る範囲は変わらなかった。資料インプット（`MeetingImportPanel.tsx`）はPJ一覧こそ進行中のみだったが、タスクは表示部署の全タスクで、**アーカイブ済みPJのタスクも送っていた**。

### 決定（山本さん・2026-10-14）

1. AIパネル上部（AI相談・資料インプットの両タブ共通）に「対象PJ」プルダウン（単一選択＋先頭「すべてのPJ」）。ダッシュボードのPJ選択も同じ部品に置き換える。
2. 範囲：「すべてのPJ」＝アーカイブ済み・完了のPJを除く／個別PJ＝そのPJだけ（完了PJも個別に選べば対象）。**AI相談・資料インプットが個別に送るタスクは完了（done）・中止（cancelled）を除く。**
3. アーカイブ済みPJの除外は全AI機能で統一する。完了・中止タスクの除外はAIパネルの2タブだけ（PJ単体分析・全PJ分析の進捗集計は従来どおり）。

### 実装の要点

- **唯一の判定元は `src/lib/ai/aiTarget.ts`**：`isAiTargetProject`（削除・アーカイブを除く）／`isAiBulkTargetProject`（＋完了を除く＝「すべてのPJ」）／`isAiSendableTask`（done・cancelled・削除済みを除く）／`aiTargetPickerProjects`（選択肢）／`resolveAiScope`（PJごとの `allTasks`＝完了・中止を含む全件と `openTasks`＝送るタスク、重複なしの `openTasks`）。AIへPJ・タスクを組み立てる箇所はここを必ず通る。
- **AI相談**：`useAIConsultation(targetPjId, memberId)` → `buildPayload({ projects(表示部署の全PJ), targetPjId, ... })`。範囲の判定は `buildPayload` の内側（`resolveAiScope`）で行う。
  - `pj_progress`（total/done/cancelled…）は**完了・中止を含むPJ単位の件数のまま**残す（個別タスクだけ除外）。`parent_task_name` は完了済みの親も解決する。`shortIdMap` には送ったタスクだけが入る（`applyProposal` の逆引きは壊れない）。
  - **OKR文脈（`okr_context`）は絞らない**：`linked_pj_names` は対象PJの絞り込みに関わらず「アーカイブ以外の全PJ名」（以前はアーカイブ済みPJ名も混ざっていた）。
  - `member_workload` は部署のタスク全体（todo/in_progress）の集計のまま。ワークロード画面と数字を合わせるため、対象PJでは絞らない。
- **資料インプット**：`MeetingImportPanel` が `targetPjId` を受け取り `resolveAiScope`（`includeProjectlessTasks`）でPJ候補とタスクを決める。PJに属さないタスク（ToDo直轄）は「すべてのPJ」のときだけ従来どおり含める。
- **プロンプト**：`systemPrompt.ts` に「tasks に完了・中止は含まれない／pj_progress は完了・中止を含むPJ全体の件数」を追記し、完了履歴クエリの節を「期間別の一覧は出せない」に書き換えた。Edge Function は変更していない。
- **共通部品**：`components/common/ProjectTargetSelect.tsx`（既存 `CustomSelect` を使用）＋選択肢の `lib/project/projectTargetOptions.ts`。完了PJは「（完了）」付き・PJの色の印付き。長い名前は省略記号＋`title`（`CustomSelect` に `title` を追加）。選択肢が9件以上で検索欄を出す。
- **AIパネル（`ConsultationPanel`）**：初期値はサイドバーで選択中のPJ（`MainLayout` が `defaultTargetProjectId` を渡す）。**サイドバーの選択が変わったらパネルの選択も追従する**（パネル内で選んだ値は、次にサイドバーが変わるまで保持）。選択中のPJが選択肢に無い（アーカイブ・部署切替）ときは「すべてのPJ」扱い。プルダウンの下に「対象：N PJ・Mタスク」の目安を出す（`resolveAiScope` の結果）。
- **ダッシュボード**：PJチップ（複数選択）をプルダウンに置き換えた。**KRバークリックで複数PJに絞る挙動は維持**するため、内部の `selectedPjIds` は配列のまま持ち、2件以上のときだけ表示専用の選択肢（「KRで絞り込み中（N PJ）」）を出す。選択肢は `projects`（サイドバーの「完了・アーカイブも表示」に従う一覧）からアーカイブ済みを除いたもの。

### 機械チェック

`src/lib/ai/__tests__/aiTargetCoverage.test.ts`：`buildPayload`／`extractMeetingData`／`analyzeAllProjects`／`analyzeProject` を使うファイルを登録制で走査し、判定関数（`resolveAiScope`／`isAiTargetProject`）を通していることを検査する（Section 59 に従いコメントを除去して走査。新しい呼び出し元を増やすと落ちる）。呼び出し元を足すときは、判定関数を通すか、通さない理由を書いて登録する。PJ単体分析（`ProjectKarte`）は利用者が1PJを明示して実行するため対象外。

### 確認したが変更していないAI経路

ToDo分解（`todoDecomposeClient`）・OKR系（`okrKrAnalysisClient` 等）・個人OKR系はPJ・タスクの一覧を送らない。グループOKRの分析パネルはアーカイブ済みで描画経路が無い。

---

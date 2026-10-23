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

### v3.183 の追記：会話の途中で対象PJを変えたとき（M83）・資料インプットの下書きと登録（巡回61回目）

- **会話の途中で「対象PJ」を変えると確認する（M83・山本さん承認のA案）**：AIは前のターンで見ていたPJのタスクを今回は見えないのに、履歴だけが引き継がれていた。`shouldConfirmTargetChange`（`aiTarget.ts`）が、会話の履歴・表示中の提案・返答待ちのどれかがあり、かつPJが変わるときだけ true を返す。`ConsultationPanel` の「対象PJ」選択とサイドバー追従（パネルを開いているとき。閉じているときは確認なしで追従）は `requestTargetChange` を通り、「対象のプロジェクトが変わりました。新しい相談として始めますか。」を出す。「新しく始める」は `handleReset`（世代番号・ショートIDの reset を含む）してから対象を切り替える。入力中の文は残す。「このまま続ける」は従来どおり（選択は変えない）。会話が空なら確認なしで切り替える。**B案（反映直前に対象の現在状態を見て、完了・削除済みなら止める）は実施しない**（`applyProposal` 全体の設計に及ぶため）。
- **資料インプットの下書き・保存は `lib/ai/meetingDrafts.ts`**：`buildTaskDrafts`（担当者：名前なし＝実行者本人・名前あり不一致＝空。先頭のメンバーへ割り当てない）・`buildStatusDrafts`（AIが返したIDが送った一覧に無ければ空にしてチェックを外す）・`applyMeetingDrafts`（途中で失敗したら保存済みの下書きIDを返す）。画面は保存済みを外すので、残りだけを再登録できる（二重登録の防止）。作成済みの新規PJは `createdProjectIdRef` で使い回す。更新対象は表示部署のタスクから引く。
- **`extractMeetingData`**：`parseMeetingResponse` を通し、`stop_reason==="max_tokens"` は構文エラーではなく「2回に分けて」の案内（Section 6-1b）。`validateAnalysis` は開始日が期日より後の組の開始日を空にする。
- **文字数**：読み込み時に30,000字で切らない（安全上限は100万字）。入力欄の字数と超過警告は `parseTranscript` 後の長さで数える。AIへ渡すのは整形後の先頭30,000字。
- **機械チェック**：`consultationTargetChange.test.ts`・`meetingDrafts.test.ts`。

---

### v3.184 の追記：PJ別AI分析（PJカルテ・全PJポートフォリオ）の点検（巡回62回目・E）

送る範囲は変えていない（全PJ分析は `isAiTargetProject`・PJ単体は利用者が1PJを明示して実行する設計のまま。`aiTargetCoverage.test.ts` の登録どおり）。変えたのは結果の扱い。

- **PJ単体（`ProjectKarte.tsx`）**：実行中をPJのidで持つ（`runningPjIds`）。結果を画面へ出すのは今も同じPJを開いているときだけ（保存は行う）。二重起動は `runningRef` で止める。保存の失敗・保存後の再取得の失敗でAI課金済みの結果を捨てず、画面に出して注意を添える。過去の分析の取得失敗は画面に出す。
- **全PJ（`DashboardView.tsx`）**：結果は実行したときの範囲（分析対象PJのidの集合＝`analysisScopeKey`）と今の範囲が同じときだけ見せる（`resultForScope`）。分析中に範囲が変わったら結果を出さない。二重起動は `allAnalysisRunningRef` で止める。
- **返答の仕上げ（`lib/ai/analysisRun.ts` の `finalizeAnalysisText`）**：空の返答は共有保存せずエラー。`stop_reason` が `max_tokens` の途中切れには注記を付ける（マークダウンの文章なので破棄しない）。両クライアントが通す。
- 残した課題：PJ単体のタスク一覧に上限が無い（M88）、全PJ分析の結果は保存されない（M89）。docs/REFACTORING.md 参照。
- テスト：`lib/ai/__tests__/projectAnalysisRun.test.ts`（修正前のコードで赤を確認）。

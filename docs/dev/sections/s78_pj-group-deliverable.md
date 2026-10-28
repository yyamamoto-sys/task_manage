## 78. PJ内の「グループ」・タスクの「成果物」欄・追加プロジェクト／タスクフォース欄の撤去（v3.149・2026-10-15）

**正本のSQLは `supabase/migrations/20261015_sections_deliverable.sql`（冒頭コメント）。検証は `docs/dev/verify_20261015_sections.sql`（ROLLBACK で終わる）。**

### 用語
画面の文言は「グループ」だが、社内では「グループ」が**部署（groups 表）**の意味でも使われるため、**コード・DB は section で統一**する（`project_sections`・`tasks.section_id`・`src/lib/section/`）。編集画面の説明にも「プロジェクトの中の区分」と明記している。

### DB
- `project_sections`（id text・project_id・name(1〜100字)・sort_order・is_deleted 等。milestones と同じ論理削除）。`tasks.section_id`（NULL＝未分類）・`tasks.deliverable text NOT NULL DEFAULT ''`。
- RLS：milestones と同じ判定（`can_access_group_ids(project_group_ids(project_id))`＝PJの可視範囲）。**SELECT／INSERT／UPDATE の3本に分け、INSERT・UPDATE に WITH CHECK を明示。DELETE のポリシーは作らない**（物理削除禁止）。マイグレ全体は BEGIN／COMMIT で囲み、確認クエリは COMMIT の後に1本（UNION ALL で OK/NG）。PJの基本情報と同じく、PJに入れる人なら誰でも作成・編集・削除（`canEditProjectBasicInfo` と同じ規則）。
- 🔴 **整合は DB トリガーで担保（画面だけを信じない）**：`enforce_task_section_integrity`（BEFORE INSERT/UPDATE・SECURITY DEFINER）＝子は親と同じグループ／PJなし・別PJ・削除済みのグループは NULL。`cascade_task_section_to_children`（AFTER UPDATE・section_id が変わった行だけ）＝親を移すと子も移る。`release_tasks_on_section_delete`＝グループを論理削除すると中のタスクは NULL。`keep_section_project_id`＝グループの project_id は変えられない。アプリ側（`normalizeTaskSection`・`followParentSection`）は同じ規則で即時に揃える（DB 往復を待たない）。
- publication に `project_sections` と `in_app_notifications`（20261002b と同じ再実行安全な DO ブロック）。`backup_snapshot` は full が動的列挙＋40表ずつ連結（10-07の引数上限の教訓）のため自動で入る。**group 分岐だけ表をハードコードしているので `project_sections` を1行足した**（マイグレに関数全文）。schemaChecks に `function_body_contains` で検査を追加。
- 🔴 **適用順序：SQL を dev・prod へ適用してから push（必須）**。理由：①**購読**＝`project_sections` は別チャンネル（`app-sync-optional`）で購読するので、表が無くても本線11表の購読は壊れない（失敗は console.warn のみ）が、適用までグループの変更はリアルタイムに届かない。②**起動時**＝取得は周辺表扱いで、表が無いと「グループ（PJ内の区分）」の読み込み失敗として**警告バナーが全員に出る**（起動は続く）。③**保存**＝グループ・成果物を使う操作は列・表が無いと失敗する。④管理者には SchemaHealthBanner が表・列・関数の欠落を出す。値が変わらない保存（`section_id`・`deliverable` のキーを送らない）と差分取得（`project_sections` の失敗を無視）は未適用でも落ちないが、上の①〜③のため「未適用でも安全」とは扱わない。

### 画面
- **リスト**（PJ別のみ・PCのみ。モバイルのカードにはグループの見出しは出さない）：グループが1つでもあるPJは、PJ見出しの下を「未分類（先頭）→各グループ」の見出しで区切る。**未分類を先頭にした理由**：PJ単位の追加（FAB等）が未分類に入るため作った直後に見え、整理し忘れにも気づける（グループがあるPJでは0件でも常に出す）。見出しの⋮＝名前を変更・上へ・下へ・削除（`SectionMenu`＝`useFloatingPanel`。Section 51）。各区画の末尾に v3.147 の「＋ タスクを追加」行（そのグループの `section_id` が初期値。draft のキーは `${groupKey}§${区画キー}`）、PJの末尾に「＋ グループを追加」。FABの追加は、グループのあるPJでは未分類の追加行へ。D&D：行の before/after は相手と同じグループへ、見出しへのドロップはそのグループの末尾へ（`useTaskDragReorder.handleSectionDrop`）。**子タスクを別グループの見出しへ落とすと「親をドラッグしてください」と案内して拒否**（子だけ別にはできない）。
- **ガント**：PJ別ビューにグループの見出し行（`GanttSectionHeaderRow`・高さ26）。折りたたみは `collapsed` に `sec_<pjId>_<グループid>`。表示順の全選択・範囲選択は `ganttRows` から作る（`visibleOrderedTaskIds`）ので見出しの並びと必ず一致する。**ガントでもグループの並べ替え（見出しの ⋮＝一番上へ・上へ・下へ・一番下へ／見出し左の ⠿ ドラッグ。v3.165）はできる。作成・名前変更・削除はリストで行う**（⋮は `SectionMenu` の `actions` で4項目に絞って再利用。純関数 `computeSectionMoveOrder`。プレビュー・モバイルは対象外。ドラッグ state はタスク行とは別。配線テスト `ganttSectionReorderWiring.test.ts`）。リストの ⋮ にも「一番上へ・一番下へ」を追加。
- **カンバン**：PJを選んでいてそのPJにグループがあるとき、ツールバーに「グループ：すべて／未分類／各グループ」の絞り込み。
- **PJカルテ**：グループごとの進み具合（完了数／件数・葉タスク基準・中止は除く）。
- **編集画面・サイドパネル・登録**：`SectionSelect`（そのPJのグループ＋未分類。親タスクを選んでいる間は親と同じ表示で選べない・PJなしは選べない）。PJを変えるとフォームの section_id を null に戻す。
- **AI相談 payload**：タスクに `section_name`（グループ名）と `deliverable`（後述）。**AIの提案でグループを変える機能は作っていない**。

### 成果物欄（tasks.deliverable）
- 複数行の自由記述（編集画面・サイドパネル・登録の保存ボタン方式＝Section 44）。本文中の **http/https の URL だけ**を検出（`src/lib/task/deliverable.ts`。javascript:・data:・file: は無視。URL は ASCII の可視文字だけで構成し、直後の日本語・末尾の句読点・閉じ括弧を巻き込まない）。
- **リストのタスク名の横の📎**（`DeliverableLink`。PCの行・モバイルのカード・カンバンのカード）。実体は `<a target="_blank" rel="noopener noreferrer">`。**URL が複数あるときは最初の1件を開く**（一覧ポップオーバーは出さない。理由＝行内に出す部品を増やさず、ほかの URL は編集画面の成果物欄の下に並ぶ「📎 URL」リンクで開けるため。ツールチップに「ほかN件は詳細画面から開けます」と案内する）。ツールチップは「成果物：＋URLを除いた本文の先頭120字」。
- 🔴 **AIには説明だけ渡す**：`deliverableForAi`（URL を除去→`sanitizeComment` と同じ伏せ字→空白を詰め→300字）。社内URL・共有リンクの権限トークンを送らないため。`sanitizeCoverage.test.ts` が「`.deliverable` を参照する lib/ai のファイルは `deliverableForAi` を import」「payloadBuilder は `deliverableForAi(task.deliverable)` 経由」を検査（わざと外すと赤になることを確認済み）。
- 変更履歴（`TASK_TRACKED_FIELDS` に `section_id`・`deliverable`。グループは名前で表示）・複製（同じPJ内なので引き継ぐ）・CSV出力（「グループ」「成果物」列）に含めた。

### 追加プロジェクト・タスクフォースの欄を外した（データは残す）
- 編集画面・サイドパネルから「追加プロジェクト」「タスクフォース」の入力欄を撤去。**`task_projects`・`task_task_forces` と、それを読む集計（KR進捗・OKR分析・personalOkrStore・リストの複数PJ表示・AI payload）は無変更**。
- 登録（QuickAddTaskModal）は、タスクフォースを選ばないと ToDo を選べない作りだったため **KR・タスクフォース・ToDo の選択欄を一緒に外した**。ただし ToDo パネル・ToDo グループの追加行から開いたときだけ、渡された `defaultTodoId` に紐づけて作る（選択欄は無く「ToDo「…」に紐づけて追加します」と示す）。`defaultTfId` は廃止。個人OKRの週の目標とタスクの紐づけ（`personal_kr_week_tasks`・okr-intro ツアー）は ToDo/TF の選択に依存しないため壊れない（TF 配下タスクの「優先表示」の元データは、今後は新規登録では増えない）。
- 一括操作・AI提案に TF／追加PJ を付ける経路は**元から無い**（`add/removeTaskTaskForce`・`add/removeTaskProject` の残る呼び出しは複製のデータコピー `DuplicateTasksModal` のみ。残す）。

### 機械チェック・テスト
`src/lib/section/__tests__/sections.test.ts`・`src/lib/task/__tests__/deliverable.test.ts`・`src/components/gantt/__tests__/ganttRows.test.ts`・`taskEditPayload.test.ts`（キーを足さない・親/PJ なしの扱い）・`guestWriteBranches.test.ts`（ゲスト分岐・親子の追従・PJ変更で外れる）・`guestBranchCoverage`（`reorderProjectSections` は `saveProjectSection` への委譲として登録）・schema 系・`realtimeResync`（購読12表）・`sanitizeCoverage`。

### 未対応・留意
- 描画テスト基盤が無いため、グループ見出しの操作・ドラッグ・📎・ガントの見出しは実機確認が要る。
- グループは**タスクが1件も無い（または絞り込みで全件外れた）PJ**ではリストの見出し自体が出ないため作れない（先にタスクを1件作る）。
- 親タスクのグループを移すと DB トリガーが子の `updated_at` も進める。realtime のエコーが届く前に子を保存すると、既知の楽観ロック競合（Section 5）が出うる（group_ids のカスケードと同種）。
- `MIN_CLIENT_VERSION` は上げない（旧画面は新しい列・表を知らなくても読み書きでき、整合はトリガーが守る）。

---

### v3.189：WBSの取込（グループの作り方）

外部WBSの G 行は PJ内グループとして作る（既存PJへ追加するとき、同名のグループがあればそこへ入れ、無ければ新しく作る。名前は前後の空白を除いて完全一致で比べる）。C 行は親 P と同じグループ。詳細は `docs/dev/CHANGELOG.md` の v3.189 と `src/lib/wbsImport/`。

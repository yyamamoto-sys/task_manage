## 91. OKRモードの作り直し 段階1：モックの「地図」を本番の OKR モードに差し替える（2026-11-17・版は上げない）

OKRモードを、モック（ブランチ `mock/okr-mode` の `src/okr-mock/`・第15版＋098dad1）の「日々の仕事と OKR をつなぐ地図」に置き換える。全体は4段階で、**本番へは4段階がそろってから一度に出す**（作業ブランチ `feature/okr-v2`。版の4点セットは最終リリース時にまとめて行う）。

| 段階 | 内容 |
|---|---|
| 1（この節） | DB変更なし。モックを本番のソースツリーへ移し、既存の表のデータで動かす。OKR モードを差し替える |
| 2 | 記録用の新しい表（マイグレーション）と保存。`OkrMapRepository` の Supabase 実装 |
| 3 | 資料を AI に読ませる（新しい invokeAI の intent） |
| 4 | 今の個人OKR画面を「わたし」から開く入口の見た目を、新画面に寄せる |

### 置き場所と構造（`src/components/okr/map/`）

- モックのファイルは名前を変えずに移した（`okr-mock.html`・vite の入口・`main.tsx` は持ち込まない）。モックの vitest もここで通す。
- `fixtures.ts`（架空データ）は**テストだけが読む**。読み込んだ時点で `dataset.ts` の中身を架空データにする。本番のビルドには入らない（`dist` に架空の社名・人名が無いことを確認済み）。
- `dataset.ts`：画面の部品が読むデータの置き場。部品は `export let` の値（`okrItems`・`krBands`・`TODAY` など）を import し、`MockProvider` が描画のたびに `setActiveData()` で差し替える。部品の呼び出し箇所（約100か所）を書き換えずに実データへ切り替えるための形で、**地図は同時に1つしか描かない前提**。
- `adapter.ts`：appStore のデータ → `OkrMapCore`（純粋関数 `buildOkrMapCore`）。
- `repository.ts`：新しい表から読むもの（`OkrMapRecords`）の入口 `OkrMapRepository`。段階1は `memoryRepository`（いつも空を返す。ゲストでも Supabase に触れない）。
- `OkrMapView.tsx`：本番の入口。appStore を読み、記録を読み込み、`App`（`embedded`）を描く。記録は「部署・KRの顔ぶれ」が変わったときだけ読み直し（世代番号で古い応答を捨てる）、そのとき `App` を作り直す。
- `bridge.ts`＋`OkrMapSidebar.tsx`＋`parts/SidebarNav.tsx`：MainLayout のサイドバー（常時読み込み）に、地図（遅延読み込み）のメニュー（チーム／わたし）・KR一覧・資料を読ませるを出す。地図の画面が zustand の小さな置き場へ「いまのページ・KRの行・選択中のKR」と操作の入口を載せ、サイドバーはそれを描くだけ。地図が閉じたら空に戻す。`SidebarNav` は型以外を import しないので、MainLayout の初期チャンクを重くしない。
- `OkrDashboardView.tsx`：地図を出す。`PersonalOkrView`（lazy・ゲートつき）は「わたし」の「個人OKRの記録を開く」から開き、「← 地図へ戻る」は `confirmDiscardUnsavedEdits()` を通す（Section 46・52）。
- `parts/Sidebar.tsx`（ロゴ・モード切替つきの見本）はテストで1枚の画面を確かめるためだけに残し、本番では描かない。モックの上部の帯（見ている人・利用の広がり・ダークの切替）は撤去した。「見ている人」「利用の広がり」はテスト用の `InitialView` にだけ残る。

### アダプタの決め方（`buildOkrMapCore`）

- **部署**：`pickCurrentObjectiveForGroup`（表示部署の現在の Objective を1つ）→ `keyResultsInGroup` のうちその Objective の KR → `taskForcesInGroup`。PJ・タスクは `selectScopedProjects`／`selectScopedTasks`、名前の解決は `s.members`（絞らない。rawMembersUsage の許可リストに登録）。
- **番号**：KR番号は所属 Objective 内の並び順（`payloadBuilder.ts` の `krIndexInObjective` と同じ）。TF は `TF{KR番号}-{tf_number}`。
- **TFの四半期**：本番は1行1四半期。今期は `currentQuarter()`、TF は `tfsForKr`（`effectiveTfQuarter`＝未設定は今期扱い）で今期のものだけを地図に出す。同じ半期の前の四半期（2Q→1Q・4Q→3Q）は「O・KRの取り込み」で読み取り専用で見せる。前の四半期と今期の比較は**番号（ラベル）**で行う（行IDは四半期ごとに別のため）。
- **期**：暦年の半期（上期＝1〜6月・下期＝7〜12月）。モックと同じ。`Objective.period` は自由記述なので使わない。今週＝月曜始まり。
- **状態**：`todo`→未着手・`in_progress`→進行中・`done`→完了・`on_hold`→未着手（再開しうるので残りに入れる）・`cancelled`→地図から外す。削除済みも外す。
- **親子**：末端のタスクだけを数える（Section 88 の集計と同じ。親と子の二重計上を避ける）。
- **列**：担当＝`assignee_member_id`（主担当1人）・期日＝`due_date`（無ければ null。「期日 未設定」と出し、並びでは後ろ）・最終更新＝完了なら `completed_at`、それ以外は `updated_at`（無ければ `created_at`→今日）を端末の日付に直したもの。
- **仕事→KR**：既定は PJ→TF→KR（`project_task_forces` のうち今期のTF）。完了した仕事は「完了した四半期の TF の KR」を記録として持つ（`doneKrIds`。後の四半期にTF構成が変わっても図から落ちない）。
- **task_task_forces**：画面の入力欄は v3.149 で外したが行は残っている。今期のTFへの行は、そのタスクの**既定のつなぎ先に足す**（`Task.tfIds`。PJのTFとの和集合）。完了した仕事の記録にも同じく足す。
- **PJ**：表示部署にない PJ のタスク（招待先の別部署の PJ 等）は載せない。`project_id` が無いタスクは「個人の仕事（PJなし）」。
- **本人**：`currentUser`（ログイン中の member）。
- **なぜこのOか**：`Objective.background`、無ければ `purpose`。どちらも無ければ枠ごと出さない。

### 段階2で差し込むインターフェース

`OkrMapRepository.load({ groupId, krIds }) → OkrMapRecords`。段階1では空。画面は空のときも崩れず、責める・寂しい表示にしない（`__tests__/production.test.tsx` が本番の形のデータ＋空の記録で、チーム／わたし／全体／KR・TF・PJ・仕事の詳細／資料の引き出しを描き、`undefined`・`NaN`・`null`・「遅れ」・「0件」・「0／0」等が出ないことを確かめる）。空のときの見せ方：

- 見立てが無いKR：地図の KR カードは「見立てはこれから」と目盛りだけ（60 と見せかけない）。「チームはいま、どの段にいるか」は1行の案内。
- 段の基準文・証拠として見るもの・出典・見立ての推移・決定事項と宿題：「まだありません」または案内文。
- 「どう役立つか」の候補が無い KR は、その欄を出さない。
- 資料を読ませる：段階3までは「準備ができしだい使えるようになります」の案内だけ。
- O・KRの取り込み：Kintone の読み取りが無いあいだは、今期のTF（アプリにある内容）を見せるだけ。デモ用の「確定待ちに戻す」はテストのときだけ出す。

保存の操作（つなぎ先の選び直し・今週やる・振り返りの答え・個人OKR→KRの矢印など）は段階1ではメモリ上だけで、画面を開き直すと消える。

### 守ったグランドルール

- Section 19：地図は `OkrDashboardView` の遅延チャンクに入る（ゲートつき）。架空データはビルドに入らない。
- Section 20：地図の外枠は `flex:1` でメインエリア内。`position:fixed` は一時的なもの（資料の引き出し・ダイアログ・トースト・狭い画面の詳細の引き出し）だけ。
- Section 23：地図は appStore だけを読み、記録はメモリ実装なので、ゲストでも Supabase に触れない。
- Section 31：地図のヘッダーは `flex-wrap`、タイトルは `flex-shrink:0`。右上のベルの分は `withBellReserve(24)` を空ける。
- Section 69：地図は `useT` を使っていない。
- 印刷の CSS は `body:has(.mk-app)` に絞った（カレンダーの印刷に影響させない）。

### 未解決
- ~~詳細の列が図と並ぶ幅は、モックのサイドバー幅 160px／48px を前提にしている~~ → 段階2で解消（下記）。
- ~~主担当以外の担当者は「本人の仕事」に入らない~~ → 段階2で解消（下記）。

---

## 91-2. 段階2：記録の表と Supabase への保存（2026-11-17・feature/okr-v2・版は上げない）

段階1の `memoryRepository` に、Supabase に保存する実装 `supabaseRepository.ts`（`createSupabaseRepository()`）を足した。開き直しても記録が消えない。ゲストとテストは `memoryRepository` のまま（`OkrMapView` が `isGuestMode()` で選ぶ。Section 23）。

### マイグレーション

`supabase/migrations/20261117_okr_map_records.sql`（冪等・末尾に確認の DO ブロック）。`schema.sql` に同じ内容と `$grant_tables$` の15本を足した。`schemaChecks.ts` に3項目（`okr_kr_defs`・`okr_tf_locks`・関数 `okr_task_assignee_ids`）。**MIN_CLIENT_VERSION は上げない**（新しい表の追加だけ）。

**適用前に本番で確かめること**（Section 58。`schema.sql` ではなく実体を見る）：

```sql
-- 1) RLS が頼る関数が本番にあるか（6行返ればよい）
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND proname IN ('current_member_id','current_member_group_ids','current_member_is_super_admin','task_group_ids','personal_kr_owner_member_id','update_updated_at');
-- 2) 同じ名前の表がまだ無いか（okr_analyses だけが返ればよい）
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'okr\_%';
-- 3) 担当者の判定に使う列があるか（4行）
SELECT column_name, udt_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name IN ('assignee_member_id','assignee_member_ids','group_ids','is_deleted');
```

`tasks.assignee_member_ids` は `text[]`（`_text`）であること（`okr_task_assignee_ids` が `assignee_member_id` と連結する）。

### 表（15本）と RLS

〔全員〕＝部署（兼務込み `current_member_group_ids()`）の行＋全社スーパー管理者。〔本人〕＝`member_id = current_member_id()` の行だけ。どの表も **SELECT／INSERT／UPDATE のポリシーだけで DELETE は作らない**（物理削除しない。取り消しは `is_deleted`・claims は `status`）。`FOR ALL` は使わない。

| 表 | RLS |
|---|---|
| okr_kr_defs（kr_id 一意・bands jsonb・evidence・hint_unit/start/target/direction） | 〔全員〕。group_id は key_results からトリガー |
| okr_checkins（group_id・checkin_date・title・confirmed_by/at） | 〔全員〕。group_id は画面が送り、RLS が自分の部署か確かめる |
| okr_resources（checkin・file_name・kind・reading jsonb） | 〔全員〕。表だけ（書き込みは段階3） |
| okr_kr_assessments（checkin・kr・resource・value・summary・basis・source・hint_value） | 〔全員〕。resource_id が NULL の行＝その回に確定した手がかりの値 |
| okr_learnings／okr_decisions | 〔全員〕 |
| okr_outcome_notes（kr_id＋note_key 一意・sources/links jsonb） | 〔全員〕 |
| okr_outcome_claims（note・task・member・pending/yes/no） | 読み＝本人の行は全件、他人の行は yes だけ（同じ部署）。作る＝同じ部署の人が、その仕事の担当者あてに pending でだけ。答える（UPDATE）＝本人だけ |
| okr_task_kr_links（task_id 一意・kr_ids） | 読み＝その仕事が見える人（`task_group_ids` と自分の部署が重なる）。書き＝担当者本人（`okr_task_assignee_ids` に自分が入る＝主担当・副担当） |
| okr_task_kr_how／okr_proposal_choices／okr_weekly_answers／okr_weekly_picks | 〔本人〕 |
| okr_personal_kr_links（member・personal_kr・kr。多対多） | 〔本人〕＋書くときは矢印の元の個人OKRも本人のもの（`personal_kr_owner_member_id`） |
| okr_tf_locks（group・年・四半期 一意・locked_on/by・snapshot jsonb） | 〔全員〕 |

- **group_id は画面から送らせない**（偽れないように）：KR を持つ表は key_results から、回を持つ表（resources・decisions）は okr_checkins から、claims は outcome_notes から、`BEFORE INSERT OR UPDATE` のトリガーで入れる（kr_quarter_plans と同じ流儀）。RLS の WITH CHECK はトリガーのあとの行を見る。
- Section 39：`current_member_*()` はすべて `(SELECT ...)` で包み、単数の部署は `@> ARRAY[group_id]`。`task_group_ids(task_id)`・`okr_task_assignee_ids(task_id)`・`personal_kr_owner_member_id(...)` は行の列を引数に取るので InitPlan にはならない（包まない。既存の `quarterly_objective_group_id(...)` と同じ）。
- GRANT は同じマイグレーションで `authenticated`・`service_role` に select/insert/update/delete、`anon` は REVOKE。
- 部署を変える担当者の付け替えなどで、仕事が自分の担当でなくなると、その仕事のつなぎ先は書けなくなる（読みは残る）。

### 画面側

- **読み込み**：`load({ groupId, krIds, viewerId, year, quarter, weekStart })`。一覧はすべて `fetchAllRows`（Section 61）。行 → 画面の形は純粋関数 `buildRecords`（`__tests__/persistence.test.ts`）。読み込みに失敗したら `formatErrorForUser` の文を地図の代わりに出す（Section 15）。読み直しは「部署・本人・週・四半期・KRの顔ぶれ」が変わったときだけ（世代番号で古い応答を捨てる）。
- **保存**：画面の状態を先に変え、裏で保存する。失敗したらトーストで `formatErrorForUser` の文を出す（画面の状態は戻さない）。
  - 人ごとの状態（つなぎ先・採否・どう役立つか・個人OKRの矢印・振り返りの答え・今週やる・結びつきへの答え）は、`updateUsers` が変化の前後を `repository.saveUser` に渡し、`diffUser` が書く行だけを出す。つなぎ先は仕事1件1行なので、全員分を足し合わせたもの（`viewerChange`）で比べる。
  - 資料の確定は `confirmSaveOf`（confirm.ts）が今回の回×選んだ資料の分を取り出し、`saveConfirm` が「同じ資料の分を is_deleted にしてから入れ直す」。結びつきは担当者全員あてに pending で作る（すでにある行は上書きしない＝`ignoreDuplicates`）。段階2の本番では資料（okr_resources）がまだ作られないので、確定の保存は段階3から動く。
  - 次の回の ID は uuid（`OkrMapView` が画面を開いたときに1つ作る）。
  - Kintone の取り込みで確定したら `okr_tf_locks` に1行（その時点の O・KR・TF の並び）。
- **KRの段の基準・証拠・手がかりの定めを手で入れる欄**：KR の詳細の「段の基準・証拠・手がかりを入れる／直す」（`parts/KrDefEditor.tsx`）。明示保存・書きかけは `useUnsavedEditor`（Section 46）。保存は `saveWithLock`（Section 5。行の updated_at で競合を検知し、競合したら保存せず原因を出す。開き直すと最新になる）。手がかりの値（value／prev）は資料の確定で入る。値がまだ無い KR は期首を value・prev にする。
- **同時編集**：KRの定めだけ楽観ロック。他は1人の本人の行か、追記・置き換え型なので「後から書いた方が残る」。

### 段階1の判断待ちへの対応

- 保留タスクは未着手のまま（変更なし）。
- **副担当**：`Task.assigneeIds`（adapter が `assignee_member_ids` から作る。2人以上のときだけ）と `isAssignee(t, id)`（logic.ts）。「わたし」の仕事・今週やる・振り返り・つなぎ先の選び直し・結びつきへの答えは、主担当・副担当のどちらでも本人。名前を出すのは主担当。つなぎ先は仕事1件に1つで、副担当が選び直すと主担当の手元の分は外れる（`setOverride`）。結びつきは担当者全員に届き、だれか1人が「そのとおり」と答えれば全員に見える。
- **個人OKR**：地図の左端は `personal_krs` の今期（暦年＝fiscal_year・`currentQuarter()`）・本人の分（`label`）。KRへの矢印は `okr_personal_kr_links`。`personal_krs.key_result_id`（個人OKR画面の取込でつく既存の紐づけ）は矢印の初期値に**使っていない**（判断待ち）。
- **詳細の列が図と並ぶ境目**：`panelNarrowPx(sidebarPx)`＝実際のサイドバーの幅＋48＋1166−1。MainLayout がサイドバーの幅（展開時 140〜420・折りたたみ 48）を `bridge.ts` の `sidebarPx` に載せ、App が `useNarrow` で判定して `is-narrow` を付ける（CSS は `.mk-app.is-embedded.is-narrow`）。見本（テスト）の固定幅の `@media` は `:not(.is-embedded)` に絞った。右の AI 相談パネルを開いたときの幅は計算に入れていない。
- **`dataset.ts` の `export let` を Context に改めるのは見送った。** 理由：部品だけでなく `ui.tsx` の `krLabel`／`krName`／`nameOf`／`krListText` などの普通の関数（フックではない）が、部品・純粋関数の両方から約100か所で呼ばれていて、Context にするとそれらをすべてフックにするか引数でデータを渡す形に書き換えることになる。段階2の保存と同時に入れると差分が読めなくなるので、地図が1つしか描かれない前提（段階1のまま）を保ち、KRの定めを直したときは `MockProvider` が直した分を重ねたデータで `setActiveData` し直す形にした。やるなら段階4のあと、`ui.tsx` の関数を `useOkrMapData()` 経由に寄せるところから。

### 未解決・判断待ち

- ~~`okr_resources.reading` の形（段階3で決める）~~ → 91-3 で決めた。
- 過去の週の「AIのまとめ」は保存しない（その週に動いた仕事から作り直す）。仕事の状態が後で変わると、まとめも変わる。
- ~~`personal_krs.key_result_id` を矢印の初期値にするか~~ → 91-3 で「使う（表示だけ）」。

---

## 91-3. 段階3：資料を AI に読ませる（2026-11-17・feature/okr-v2・版は上げない・マイグレーションの追加なし）

モックの `DocDrawer`（固定データ）・つなぎ先の候補・「どう役立つか」の案・Kintone の取り込みを、`invokeAI` 経由の AI で動かす。**ゲストとテストは AI を呼ばない**（`OkrMapView` がゲストのとき `ai=null` を渡す。Section 23。`App`／`MockProvider` の `ai` の既定も null）。

### ファイル

| ファイル | 中身 |
|---|---|
| `checkinAi.ts` | 資料1件の読み取り：システムプロンプト・本文の組み立て（`buildCheckinUserText`）・構造化出力のスキーマ（`CHECKIN_SCHEMA`）・返答の解釈（`parseCheckinReading`）・保存形（`readingOf`）。純粋関数 |
| `suggestAi.ts` | つなぎ先の候補（PJ単位）と「どう役立つか」の案（仕事×KR）のプロンプト・スキーマ・解釈。純粋関数 |
| `kintone.ts` | Kintone の読み取り結果 → 突き合わせの行（`readingFromImport`）・書き込み計画（`planKintoneApply`）・O・KR の文言の違い（`headDiffs`）・既存の保存関数での書き込み（`writeKintonePlan`） |
| `aiClient.ts` | `OkrMapAi`（`createOkrMapAi()`）。ファイルの文字の抽出（`checkConsultAttachFile`→`loadConsultAttachment`）と `invokeAI` の呼び出し |

### AI の呼び方（Section 6・16）

- intent は2つ足した：`okr-checkin-extract`（資料1件）と `okr-map-suggest`（候補・案）。Kintone は既存の `okr-import` を流用（`extractOkrImportData` に `withBands`・`model` を足した。管理画面の取込は従来どおり）。
- モデルはすべて `claude-sonnet-5-5`（AI相談と同じ `DEFAULT_CONSULT_MODEL`）。資料・候補・案は構造化出力（`invokeAI` の第6引数）・effort=low。Kintone は従来のプロンプトでの JSON（自己修正リトライつき）。
- max_tokens：資料は 8192（添付を伴う抽出の既定。s6 6-1c）。上限で切れたら「資料を分けて」の例外（`assertNotTruncated`）。候補・案は 4096。
- 送るもの：KR の番号・題名・段の基準文・証拠として見るもの・手がかりの定めといまの値・いまの見立て／部署の仕事（末端・中止を除く）を「終わっていない仕事→完了は新しい順」で最大300件、題名・主担当の名前・PJ名／仕事の担当者になっている人と本人の名前／資料の本文。**資料の本文と仕事の題名は `sanitizeComment` を通す**。仕事は `t1` などの番号で送り、返ってきた番号を ID に戻す（ID を AI に見せない）。
- 空の資料・KR が無い地図は AI を呼ばずに止める（`checkReadable`）。文字の無い PDF は AI相談の添付と同じく、200KB までは PDF のまま送る。

### 返答の解釈（`parseCheckinReading`）

- 見立ては**資料の記述だけ**から（プロンプトで仕事の一覧・完了率を使わないよう指示）。**段の基準文が1つも無い KR の見立ては捨てる**。値は 60 未満を 60 に、最上段を超えたら最上段に。**60〜70 の間は AI の整数のまま、70 以上は満たした段の値（`stepBelow`）にそろえる**（統括の指示「60 を下限に、60〜70 の間は AI が状況から決めてよい」をそのまま強制した）。根拠（basis）は2〜4個まで、「まだ」の引用は空にする。
- 一覧に無い KR・仕事の番号・種類の値は捨てる。決定事項の担当は名前で照合（空白・「さん」を除く。一意に決まらなければ担当なし）。
- 成果の記述の `key` は資料ごと（`{資料ID}-n{i}`）。資料をまたいだ同じ出来事の突き合わせは AI に任せていない（足し合わせで1つにならない）。
- 壊れた JSON・JSON でない返答は「もう一度読み取る／資料を分ける」の案内の例外。

### 保存（マイグレーションの追加なし。段階2の表で足りた）

- **`okr_resources.reading`** ＝ `{ version: 1, drafts, assessments, learnings, notes, decisions }`（画面の `Resource` から id・name・kind・checkinId を除いたもの。KR・仕事・担当者は本番の ID）。読み込み（`resourceOf`）は形が崩れていても落ちず、地図に無い KR の分を捨てる。
- 資料を読ませると `saveResource` が、回（`okr_checkins`）が無ければ未確定の回として作り（`ignoreDuplicates`・確定した人は空）、資料の行を入れる。**読ませただけで何も確定していない回は `checkins` に数えない**（`openCheckins` として別に返す。最新の回の日付・「未更新」の判定を動かさない）。確定は段階2の `confirmImport`→`saveConfirm` のまま（食い違いを選ぶまで確定できない）。
- 候補・案は保存しない（画面を開き直すと消える）。選んだ「どう役立つか」は段階2の表に残るので、案が無いときも選んだ文は出す。案は `howOptions[howKey(仕事, KR)]`（モックの KR 単位の固定データも読める）。

### 画面

- 資料を読ませる：1. 回を選ぶ（新しい回＝日付と名前を入れる／未確定の回／確定済みの回の新しい6件）→ 2. 資料を加えて読み取る（複数・1件ずつ・進み具合を出す・読めなかった資料は理由を並べる）→ 3. 読み取った資料を選ぶ（その回の資料だけ）→ 下書き → まとめて確定。未確定の回があれば、いちばん新しいものを最初に選ぶ。
- 仕事の詳細（本人・「わたし」）：つながらない仕事は「AIにつなぎ先の候補を出してもらう」、つながる仕事は KR ごとに「AIに案を出してもらう」。
- O・KRの取り込み：「PDFを選ぶ」→ AI が O・KR・TF と段の基準文を読む → 違い（今期のTF・O と KR の文言）と、段の基準文を読み取った KR・取り込めない TF を見せる → **「Kintone に合わせる」を押したときだけ**、`writeKintonePlan` が appStore の `saveObjective`／`saveKeyResult`／`saveTaskForce` で O・KR・TF を書き、段の基準文を `saveKrDef` で `okr_kr_defs` に書き、`okr_tf_locks` に1行（その時点の並び）。
  - 対応づけ：KR は並び順、TF は番号（`TF{KR番号}-{tf_number}`）。アプリに無い TF は今期で新しく作る（リーダーは空）。**アプリにだけある TF は消さない**（期中の PJ の紐づけを壊さないため。モックの「取り込むとアプリから外れる」とは違う）。アプリに無い KR は作らない（その KR の TF は「取り込めない」と出す）。
  - Kintone の読み取り結果は保存しない（ロックの記録だけが残る）。

### 段階2の判断待ちへの統括の答え（対応済み）

- `personal_krs.key_result_id`：その個人OKRに `okr_personal_kr_links` の行が1つも無いとき（外した行も含めて）だけ、矢印の初期値にする（表示だけ）。本人がその個人OKRの矢印を触ったときに、残した初期値の矢印も一緒に書く（`diffUser`。書かないと開き直したときに消える）。そのため矢印は外した行も読む。
- 詳細の列の境目：`panelNarrowPx(sidebarPx, consultPx)`。MainLayout が開いている AI 相談パネルの幅（モバイル・閉じているときは 0）を `bridge.ts` の `consultPx` に載せる。
- `okr_kr_defs` の同時の初回作成：一意制約（23505）と楽観ロックの競合（`ConflictError`）は、行を読み直して `KrDefConflictError`（最新の内容つき）にする。画面は最新の内容に差し替え、「ほかの人が先に…確かめてからもう一度保存してください」と出す（生のエラーは出さない）。次の保存は読み直した行の ID と updated_at で楽観ロックする。

### Edge Function（ai-consult）

変更なし。intent は許可リストで縛っていない（ゲスト分のログに使うだけ）、`claude-sonnet-5-5` は ALLOWED_MODELS にある、`output_config`（format＋effort）は 6-18 で通すようにしてある。スキーマは根が object・2万字以内（`stage3.test.ts` が見る）。

### 未解決・判断待ち

- Sonnet 5.5（effort=low）で資料1件の読み取りが Edge Function の実行時間の上限に収まるかは、実機で確かめていない。長い資料で 546／タイムアウトが出るなら、資料を分けて読ませる案内か、モデルを Haiku 5.5 に下げる。
- アプリにだけある TF を「合わせる」で消さない判断（上記）。消すなら `deleteTaskForce`（論理削除）を足す。
- Kintone にあってアプリに無い KR は作らない（半期固定の前提）。
- 成果の記述を資料をまたいで1つにまとめる（同じ出来事の `key` をそろえる）仕組みは無い。

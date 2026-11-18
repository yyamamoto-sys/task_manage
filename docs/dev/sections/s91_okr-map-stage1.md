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
- 資料を読ませると `saveResource` が、回（`okr_checkins`）が無ければ未確定の回として作り（`ignoreDuplicates`・確定した人は空）、資料の行を入れる。**読ませただけで何も確定していない回は `checkins` に数えない**（`openCheckins` として別に返す。最新の回の日付・「未更新」の判定を動かさない）。確定は段階2の `confirmImport`→`saveConfirm`（食い違いを選ぶまで確定できない）。保存は 91-4 で RPC 1本（1トランザクション）にした。
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

- Sonnet 5.5（effort=low）で資料1件の読み取りが Edge Function の実行時間の上限に収まるかは、実機で確かめていない（山本さんの実機確認で測る）。長い資料の分割の案内は 91-4 で先に入れた。
- ~~アプリにだけある TF を「合わせる」で消さない判断~~ → 確定（消さない）。
- ~~Kintone にあってアプリに無い KR は作らない~~ → 確定（作らない）。
- ~~見立ての 70 以上を段の値に切りそろえる~~ → 確定（60〜70 は AI の整数・70 以上は満たした段）。
- 成果の記述を資料をまたいで1つにまとめる（同じ出来事の `key` をそろえる）仕組みは無い。

---

## 91-4. 段階3の独立レビューの指摘11件（2026-11-17・feature/okr-v2・版は上げない）

`20261117_okr_map_records.sql` は**まだどこにも適用されていない**ので、別ファイルにせずこのファイルを直した（`schema.sql` の 0)〜4b) も同じ文面にした。`stage3Migration.test.ts` が一致を見る）。**前の版をすでに流した環境（dev 等）では、表を作り直してから流す**（`CREATE TABLE IF NOT EXISTS` なので列・制約の変更が反映されない。DROP の文はマイグレーションの冒頭にある）。本番に一度流したあとは、このファイルを直さず新しいマイグレーションにする。

| # | 指摘 | 対応 |
|---|---|---|
| 1 | claims の UPDATE で note_id・task_id を付け替えて他部署の成果に yes を差し込める | `trg_okr_outcome_claims_guard`（BEFORE UPDATE）：画面（authenticated）から note_id・task_id・member_id・group_id を変えたら例外。変えられるのは status・answered_at だけ |
| 2 | `okr_task_assignee_ids` を rpc で直に呼ぶと他部署の仕事の担当者が取れる | 関数の中で `t.group_ids && current_member_group_ids()` またはスーパー管理者に絞った（他部署の仕事は NULL） |
| 3 | KR・回の部署が変わっても新しい表の group_id が追随しない | `trg_key_results_cascade_okr_map`（key_results の AFTER UPDATE）が kr_defs・assessments・learnings・outcome_notes・claims を追随。回は画面から部署を変えられない（`trg_okr_checkins_guard`）。管理者が変えたときは `trg_okr_checkins_cascade_group` が resources・decisions を追随 |
| 4 | 見立て・学び・決定事項で KR と回の部署の一致を見ていない | `trg_okr_kr_assessments_check`・`trg_okr_learnings_check`（KR と回の部署が同じ・資料がその回のもの）、`trg_okr_decisions_check`（kr_ids がすべて回の部署の KR）。入れたとき・付け替えたときだけ見る（KR が後で部署を移っても既存の行は止めない） |
| 5 | 確認ブロックの `has_table_privilege(…,'SELECT,INSERT,UPDATE')` は「どれか1つ」で真 | 権限ごとに AND。関数が無いときは権限を見ずに NG（例外にしない） |
| 6 | 前の版が残っていると変更が反映されない | 冒頭と本節に「未適用の前提・再適用時は表を作り直す」を書いた |
| 7 | 確定の保存が「取り消し → 入れ直し」を別々に書き、途中で失敗すると旧い行が消えたまま | `okr_confirm_checkin(jsonb)`（plpgsql・**SECURITY INVOKER**＝RLS とトリガーが効く）1本にした。途中で失敗すると何も書かれない。画面は `supabase.rpc` を1回呼ぶだけ（`confirmPayloadOf` が形を作る） |
| 8 | claims の答えが0件更新でも成功扱い・noteId が無いと黙って捨てる・pending への戻しを書かない | `.select('id')` で0件なら失敗、noteId が無ければ失敗（開き直しを案内）、yes／no → pending の戻しも書く（届いたばかりの pending は書かない） |
| 9 | 担当でない仕事のつなぎ先が RLS で拒否されると、以降の表がすべて保存されない | 画面は担当者本人にしか変更の欄を出さない（`userState.setOverride`／`takeProposal` も担当者以外は何もしない）。保存は表ごとに try し、書けなかった表の名前をまとめて知らせる（`SaveUserError`。残りの表は書く） |
| 10 | 成果の記述の upsert が checkin_id を毎回上書き・sources／links を丸ごと上書き | RPC の中で `ON CONFLICT (kr_id, note_key) DO UPDATE` は sources・links を `okr_jsonb_union`（先の順を保った和集合。links は taskId で重複を除く）にし、checkin_id・原文・増減は insert のときだけ |
| 11 | updated_by を画面が送る値で決めている | `trg_okr_*_stamp`（15本・BEFORE INSERT OR UPDATE）が updated_by を `current_member_id()` で上書き。confirmed_by・locked_by・deleted_by も、値が入るときは本人にする。メンバーとして解決できない（サービスロール等）ときは送られた値のまま |

BEFORE トリガーは名前の順に動く：`check` → `guard` → `stamp` → `sync_group` → `updated_at`。

### RLS とトリガーで拒否される操作（画面＝authenticated から）

| 表 | 操作 | 拒否される条件 | 何が拒否するか |
|---|---|---|---|
| 〔全員〕の8表 | 読む・入れる・直す | 行の部署が自分の部署（兼務込み）でない（スーパー管理者を除く）。group_id は親（KR・回・成果の記述）から入るので、送った値では偽れない | RLS |
| 〔全員〕の8表・claims・links ほか全表 | 消す（DELETE） | いつでも | RLS（ポリシーなし） |
| okr_checkins | 直す | group_id を変える | `trg_okr_checkins_guard` |
| okr_kr_assessments・okr_learnings | 入れる・KR／回／資料を付け替える | KR の部署と回の部署が違う／資料がその回のものでない | `trg_*_check` |
| okr_decisions | 入れる・kr_ids／回／資料を付け替える | kr_ids に回の部署でない KR がある／資料がその回のものでない | `trg_okr_decisions_check` |
| okr_outcome_claims | 読む | 他人の行で、status が yes でない（または yes でも自分の部署でない） | RLS |
| okr_outcome_claims | 入れる | status が pending でない／member_id がその仕事の担当者でない／仕事が自分の部署にない／成果の記述が自分の部署にない | RLS（`okr_task_assignee_ids` は自分の部署の仕事だけ返す） |
| okr_outcome_claims | 直す | 本人の行でない（RLS）／note_id・task_id・member_id・group_id を変える（トリガー） | RLS＋`trg_okr_outcome_claims_guard` |
| okr_task_kr_links | 入れる・直す | 自分がその仕事の担当者（主担当・副担当）でない／仕事が自分の部署にない | RLS |
| 〔本人〕の4表・okr_personal_kr_links | 読む・入れる・直す | member_id が本人でない（矢印は元の個人OKRも本人のもの） | RLS |
| 関数 `okr_task_assignee_ids` | rpc で直に呼ぶ | 自分の部署にない仕事は NULL（担当者は見えない） | 関数の中の条件 |
| 関数 `okr_confirm_checkin` | 呼ぶ | anon は呼べない。中の書き込みは上の各行の規則がそのまま効く（INVOKER）。メンバーとして解決できなければ例外 | GRANT＋RLS |

### 適用前に本番で確かめること（91-2 の3本に加えて）

```sql
-- 4) 部署の判定に使う列（2行：key_results.group_id と tasks.group_ids）
SELECT table_name, column_name, udt_name FROM information_schema.columns
 WHERE table_schema = 'public' AND ((table_name = 'key_results' AND column_name = 'group_id') OR (table_name = 'tasks' AND column_name = 'group_ids'));
-- 5) key_results に同じ名前のトリガーがまだ無いこと（0行）
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.key_results'::regclass AND tgname = 'trg_key_results_cascade_okr_map';
```

`tasks.group_ids` は `_text`（text[]）であること（`current_member_group_ids()` と `&&` で比べる）。

### 画面・AI まわり（段階3の判断待ちへの答えの反映）

- 見立ての切りそろえ・Kintone の動き（アプリだけの TF は消さない・KR は作らない）は 91-3 のとおりで確定。画面の文言は「合わせても、アプリからは消しません」「アプリにはありません。合わせても追加しません」。
- 長い資料：引き出しに「目安 1万5千字を超える資料は分けると確実」と出す。読み取った資料が目安を超える・先頭だけ読んだときは読み取りのあとに案内（`longResourceNotice`）。時間切れ・出力切れらしいエラー（546・504・timeout 等）には「前半と後半に分けて」を添える（`withSplitHint`）。目安の 15000 字は実測前の値。
- `invokeAI` の text ブロックの取り出しは全 AI 機能の共通部分なので、既存の intent すべて（20個）× 返答の形3種（type つき・type なし・先頭に thinking）で `content[0].text` が本文になり、使用量がその intent で記録されることを `invokeAI.test.ts` で確かめる。intent を足してテストの一覧に足し忘れると型エラーになる。

---

## 91-5. 段階4：個人OKRの記録の見た目を地図に寄せる（2026-11-17・feature/okr-v2-stage4・版は上げない・見た目だけ）

山本さんの要望：「『わたし』から開けるようにしたいが、雰囲気がかなり違って浮いてみえるので、これから実装するビジュアルに雰囲気・トーンは寄せてください。」機能・データ・保存の挙動（明示保存・未保存の確認・ツアーのサンプル差し込み）は変えていない。

### 共通トークンの置き場所

- `src/components/okr/okrTheme.css`：`.mk-app, .okr-personal` の上に `--okr-radius-card`（16px）・`--okr-radius-head`（18px）・`--okr-radius-inner`（12px）・`--okr-radius-small`（8px）・`--okr-head-bg`（地図の帯のグラデーション）を置く。`:root` に置かないのは、`--okr-head-bg` が `--color-bg-primary` を使い、使う場所で解決させたいため。
- `src/components/okr/okrTheme.tsx`：`OKR_CARD_STYLE`（地図の `.mk-card` と同じカード）・`OKR_RULE_STYLE`（節の見出しの横線）・`OkrLogo`（地図の帯の左端の印）。
- 地図側：`mock4.css` の `.mk-card` の角丸と `.mk-head` の角丸・背景を上の変数に置き換えた（値は同じ・フォールバック付き）。`App.tsx` の見出しの印を `OkrLogo` に置き換えた（SVG は同じ）。`OkrMapView.tsx` で `okrTheme.css` を読む。**地図の見た目は変えていない。**

### 個人OKR側で寄せたもの

- 上部：地図と同じ帯（`.mk-head`・グラデーション・角丸18px）に「← 地図へ戻る」（`.mk-btn .mk-btn-sm`＝丸い札）・地図の印・「OKRモード ／ わたし」・`.mk-h1` の見出し。戻るときの `confirmDiscardUnsavedEdits` はそのまま。`withBellReserve(24)`（Section 31・右上のベル）も地図と同じ。
- 地の色：`.okr-personal` で地図と同じ `bg-secondary` にし、カードを `bg-primary`＋薄い影で浮かせる。KRの中身（`PersonalKrPanel`）・空の案内はタブに接した囲みをやめ、地の上にカードを並べる。
- 角丸：子の部品は inline の `var(--radius-sm|md|lg)` を使っているので、`.okr-personal` の中だけ `--radius-sm`→8px・`--radius-md`→12px・`--radius-lg`→16px に差し替えて一括でそろえた（モーダルも Portal ではなく木の中にあるので同じ値になる。`CustomSelect` の選択肢は body への Portal なので従来どおり）。
- KRの切替：下線のタブをやめ、地図のセグメント・「今週やる」と同じ丸い札（`.okr-krtab`。選択中はブランド色＋白文字、`aria-pressed`）。ウェイトは札の中に添える。「＋ KRを追加」「📥 Kintoneから取込」も丸い文字ボタン（`.okr-linkbtn`）。`data-tour-id` と、対象期の行・タブの帯の `flexShrink:0`／`overflowX:"auto"`（`personalOkrViewLayout.test.ts`）は残した。
- 節の見出し：5ファイルで別々に持っていた `sectionHeadStyle`（11.5px・大文字・薄い色）を `className="okr-sec"` に統一。先頭の語を地図の見出しと同じ `--font-display`・15px・太字にし、添え書きは12px。`ruleStyle`・`cardStyle` は `okrTheme.tsx` の定数を参照する。
- 主ボタン（ブランド色の塗り：今月の計画を保存・メモを追加・KRの保存など6か所）を地図の `.mk-btn-primary` と同じ丸い札（`--radius-full`）に。
- 文字は小さくしていない（Section 60）。`--font-sans` は触っていない（Section 86）。ダークモードは地図と同じ組み合わせ（選択中の札はブランド色＋白、文字ボタンは `text-info`）。

### KRの色について

地図の KR の色（`palette.ts`）はグループの KR の並び順で決まる。個人OKRの KR はそれとは別物（ウェイトを持つ本人の KR）なので、色は付けていない（同じ色で別の物を指すと、地図と行き来したときに取り違える）。個人OKRと地図の KR を色でつなぐなら、`okr_personal_kr_links`（矢印）を読んで色を引く設計が要る。

### 未解決・判断待ち

- ブラウザでの見え方は確かめていない（山本さんの実機確認待ち）。
- 個人OKRのモーダル・AIパネル・週のカードの中身は角丸と主ボタンだけが変わり、配置は今のまま。

---

## 91-6. 最終点検（独立レビュー2本）の指摘（2026-11-18・feature/okr-v2・版は上げない）

マイグレーションはまだ未適用なので同じファイルを直し、`schema.sql` の 0)〜4b) も一致させた。

### マイグレーション（M1〜M10）

| # | 指摘 | 対応 |
|---|---|---|
| M1（重大） | `okr_stamp_member` の `IF TG_TABLE_NAME = 'x' AND NEW.列` は、列の無い表で式の準備が失敗し、authenticated からの INSERT/UPDATE が15本すべて落ちる（SQL Editor では v_me が NULL で先に RETURN するので見えない） | 表の名前の IF の内側の別の IF で列を読む。OLD も TG_OP の IF の内側でだけ読む。`okr_check_kr_in_checkin`／`okr_check_decision_krs` の `TG_OP = 'UPDATE' AND … OLD` も同じ形に直した。`stage3Migration.test.ts` が全関数の IF の条件を検査する（直す前の本文に戻すと赤になることを確認） |
| M2（重大） | 確認ブロックは実行時の失敗を検出できない | 煙試験 `docs/dev/verify_20261117_okr_map_smoke.sql`（既存の `verify_*.sql` の置き場と流儀に合わせた）。メールを1か所差し替えて流す。authenticated・同じ JWT で12段を1件ずつ試して取り消し、最後に ROLLBACK |
| M3 | 同時確定で二重に入る | RPC の先頭で `pg_advisory_xact_lock(hashtext('okr_confirm_checkin:'||回ID))`。後の人は先の人の分を取り消してから入れ直すので、見立てが空の確定でも学び・決定事項は二重にならない。見立ての一意制約（23505）は画面で「ほかの人が先に確定しました」 |
| M4 | payload に同じ (kr_id, note_key) が2つあると全体が失敗 | `SELECT DISTINCT ON (kr_id, note_key)`（先に出たものを採る）。**取り消し済みの記述は復活させない**（`ON CONFLICT … DO UPDATE … WHERE n.is_deleted = false`＝和集合もしない。その記述への結びつきも作らない） |
| M5 | KR の部署移動で、回・資料・決定事項は元の部署に残り、KR と回の部署の一致が事後に崩れる | **仕様として受け入れる**（コード変更なし）。KR の部署移動は管理者の稀な操作。移動後は、KR を持つ表（見立て・学び・成果の記述・結びつき）は新しい部署へ移り、元の部署の回からその KR の見立ては見えなくなる。回・資料・決定事項は元の部署に残る |
| M6 | 成果の記述に部署の一致の検査が無い | `trg_okr_outcome_notes_check`（`okr_check_kr_in_checkin` を共用。回の無い行は見ない。資料の列は持たないので読まない） |
| M7 | claims の INSERT で仕事と記述の部署を見ていない | WITH CHECK に `task_group_ids(task_id) @> ARRAY[group_id]`（group_id は記述からトリガーで入る） |
| M8 | 取り消し済みの回を確定すると復活しうる | RPC で取り消し済みの回は例外（SQLSTATE 55000） |
| M9 | deleted_by の取り扱い | is_deleted が false→true になったら deleted_by を無条件に本人。取り消し済みの行で deleted_by を消す・書き換えることはできない（元の値に戻す） |
| M10 | PJ 招待で入った部署外の担当者 | **仕様として明記**（コード変更なし）。つなぎ先（`okr_task_kr_links`）と結びつき（claims）は、仕事の部署（tasks.group_ids）に自分の部署が入っている人だけが対象。招待で別部署から入った担当者は、その仕事のつなぎ先を変えられず、結びつきも届かない（`okr_task_assignee_ids` が自分の部署の仕事にしか答えないため） |

### 煙試験（適用後に流す）

`docs/dev/verify_20261117_okr_map_smoke.sql`。差し替えるのは ★ の1行（`set_config('smoke.email', '…')`。`current_member_id()` がメールで本人を引くので uid ではなくメール）。最後の表の judge がすべて OK（試すデータが無い段は SKIP）ならよい。

| # | 試すこと | 期待 |
|---|---|---|
| 1 | okr_kr_defs を入れる（updated_by に別人を送る） | ok:1/true（本人になる。M1 の INSERT の経路） |
| 2 | okr_kr_defs を直す | ok:1/true（M1 の UPDATE の経路） |
| 3 | okr_confirm_checkin（最小） | ok:1/true（確定した人は本人） |
| 4 | 確定で学びを1件（自分の部署の KR） | ok:1/1 |
| 5 | 確定で他部署の KR の学び | error 23514（全体が取り消される） |
| 6 | okr_weekly_answers に自分の答え | ok:1 |
| 7 | okr_weekly_answers に他人の答え | denied |
| 8 | 他部署の KR の okr_kr_defs | denied |
| 9 | 結びつきに答える | ok:1 |
| 10 | 結びつきの仕事を付け替える | denied |
| 11 | okr_task_assignee_ids（他部署の仕事） | ok:1/true（NULL） |
| 12 | 取り消し済みの回を確定 | error 55000 |

### 画面・AI（C1〜C10）

| # | 指摘 | 対応 |
|---|---|---|
| C1 | KR の段の基準文の書きかけ（KrDefEditor）が確認なしで消える | 地図の `setSel`・`setMode`（サイドバーの KR を開く・ページ切替もこれを通る）を `guardUnsaved`（書きかけが無ければすぐ、あれば `confirmDiscardUnsavedEdits()`）で包んだ。「個人OKRの記録を開く」（OkrDashboardView）も確認を通す。地図の作り直しは C4 で部署・本人・週・四半期の変化だけになった（部署の切替は MainLayout の guardedNavigate が確認する） |
| C2 | 確定の RPC が失敗しても画面は確定後のまま・成功トーストが先 | `confirmImport` を async にし、`saveConfirm` を await してから画面を確定後にする。失敗したら画面は変えず、引き出しの中に消えないエラー（`formatErrorForUser`）を出す。一意制約（23505）は「ほかの人が先にこの回を確定しました」 |
| C3 | 本人の状態の保存失敗が画面に残り、再送もされない | 保存は1本ずつ直列（`saveQueue`）にし、毎回「保存済みの状態 → いまの状態」の差分を書く。書けなかった表の分は `revertUserFields` で保存済みの状態に戻して知らせる（`SaveUserError.failed` → `fieldsOfLabels`）。確定で届けた結びつき（pending）は保存済みの状態にも反映する |
| C4 | KR の顔ぶれが変わると地図が作り直され、Kintone の読み取り結果・確定前の選択・書きかけが消える | `App` の key は「部署・本人・週・四半期」だけ。KR の顔ぶれの変化と「Kintone に合わせる」の完了後（`onRecordsChanged`）は記録だけ読み直し、`recordsGen` が変わったら画面にまだ無い分だけ足し込む（`addMissingById` 等。画面の状態を優先）。読み直しの最中も前の記録で描き続ける |
| C5 | `repository.load` の副作用（noteIds／defMeta）が世代番号で守られていない | load は値を返すだけ。行IDの対応は `adopt(rec)` で反映し、呼び出し側（OkrMapView）が世代番号を確かめてから呼ぶ |
| C6 | 「Kintone に合わせる」の KR の対応が並び順だけ | KR の件数が違えば止める（画面に件数を出しボタンを押せなくする。state でも止める）。KR ごとに題名と段の基準文の旧／新を並べ、チェックした KR の分だけ書く（最初は違うものすべてにチェック） |
| C7 | つなぎ先の kr_ids を今の KR に絞って空になると「つながない」になる | 元が空でない行が絞って空になったら「選んでいない」扱い（既定のつなぎ先）。最初から空の行はそのまま |
| C8 | Kintone 読み取りに effort が無い | `extractOkrImportData` に `effort` を足し、地図からは `"low"`（管理画面の取込は送らない＝従来どおり） |
| C9 | ガイドから OKR ツアーを再生しても対象の画面が無い | MainLayout の `startTourFromGuide`：OKR のツアーは bridge の `personalTourPending` を立て、OKR モードへ切り替える（初回の紹介があればそれを通る）。OkrDashboardView は立っていれば個人OKRの記録を開き、PersonalOkrView がツアーを最初から始めて下ろす（tour-guidelines.md §9「再生は最初のステップから・完了フラグに関わらず」） |
| C10 | つなぎ先を全件読んでいる | 表示部署の仕事の ID（`OkrMapLoadArgs.taskIds`）で `.in("task_id", …)` に絞り、150件ずつ区切って `fetchAllRows` で読む |

### 残った懸念

- 煙試験・RPC・トリガーは実際の DB で流していない（dev で適用→煙試験の順に山本さんが行う）。
- C9：初回の紹介で「承認しない」を選ぶと `personalTourPending` が立ったまま残り、次に OKR モードへ入ったときに個人OKRの記録とツアーが開く。
- C5 の `adopt` は単体のテストが無い（読み込みの経路をモックするのが重いため。世代の確認は OkrMapView の1か所）。

### 91-7 地図のガイドツアー（v3.217）

* 地図の画面用に `okr-map` ツアーを追加（`tours/okr-map.ts`）。個人OKRの記録のツアー `okr-intro` は別のまま（起動は PersonalOkrView）。ガイドからの再生は bridge の `mapTourPending`（地図のツアー）と `personalTourPending`（個人OKRの記録）で使い分ける。

---

### v3.221：会議の文字起こしをチェックインで扱いやすくする

* 長い文字起こし（1時間で数万字）は LONG_RESOURCE_CHARS を超える。本命は「Copilot にまとめさせてから読ませる」導線で、資料を読ませる引き出し（DocDrawer）のファイル選択の上に開閉式の欄を置いた。プロンプトは `copilotPrompt.ts` の `buildCopilotPrompt` が今期の KR（題名・段の要件）から組む。見出しの語は抽出側（checkinAi.ts）の basis の状態・learnings・decisions に合わせてある。抽出側の語を変えたらここも合わせる。
* 補助として .vtt／.srt を読める（`lib/transcriptClean.ts`。AI 相談の添付にも効く）。時刻行・番号・タグを除き、話者ごとにまとめる。整形後も15000字を超えれば従来の長文の案内が出る。

---

### v3.222：文章を貼り付けて読ませる

* DocDrawer の Copilot 用プロンプトの下に `PasteReadBox`。貼った本文は `pasteRead.ts` で File にして、ファイル選択と同じ `readFiles` に渡す（読み取りの経路は増やさない）。名前は「貼り付け_…」または、本文に「■KR」を含むとき「Copilot要約_…」（資料一覧と出典の doc に出る）。
* 書きかけは unsavedEditorRegistry に載せ、引き出しを閉じる前に `guardUnsaved` の破棄確認が出る。成功時は欄を空にし、失敗時は本文を残してエラーを出す。ゲスト（AI を使えない）では欄を出さない。

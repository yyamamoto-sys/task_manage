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
- 詳細の列が図と並ぶ幅（`mock4.css` の 1373px／1261px）は、モックのサイドバー幅 160px／48px を前提にしている。本番のサイドバーは 140〜420px で可変なので、幅を広げた人は早めに引き出しになる。
- 主担当以外の担当者（`assignee_member_ids` の2人目以降）は「本人の仕事」に入らない。

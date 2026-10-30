## 89. 依存関係の「種類（FS/SS/FF/SF）」と「ずらし日数（ラグ）」（v3.197・2026-10-30）

後で MS Project XML（MSPDI の PredecessorLink：Type 0=FF／1=FS／2=SF／3=SS、LinkLag）を取り込むための土台。それまで依存は FS（終了→開始）1種・ずらしなしだった。

### データ（⚠️マイグレーションは山本さんが手動適用）
- `supabase/migrations/20261030b_task_dependency_type_lag.sql`：`task_dependencies.dep_type text NOT NULL DEFAULT 'FS'`（CHECK IN FS/SS/FF/SF）・`lag_days integer NOT NULL DEFAULT 0`。冪等。新テーブルではないので GRANT／RLS は追加なし。
- 型 `TaskDependency.dep_type?`・`lag_days?` は**任意**。列が無い旧データ・マイグレ未適用のDBの行は undefined になるので、**必ず `lib/dependencies/depType.ts` の `depTypeOf`／`lagOf` を通して読む**（未設定＝FS／0）。読み込みは `select('*')` なので列が無くても落ちない。
- `insertTaskDependency` は FS／0 のとき新列を送らない（未適用DBでも従来どおり追加できる）。非既定を送るのは適用後。種類・ラグの更新 `updateTaskDependencyTerms` は適用後のみ成功する。
- schemaChecks に `task_dependencies_dep_type_column`／`task_dependencies_lag_days_column`（s22）。

### ラグの単位＝暦日
自動リスケ（`reschedule.ts`）は従来から暦日計算（土日祝を飛ばさない）。営業日ロジックはガント側にも無い。よってラグも暦日。負＝リード。UI 表記は「ずらし ◯ 日」。

### 日程の意味（制約）
FS＝先行.終了＋ラグ ≦ 後続.開始／SS＝先行.開始＋ラグ ≦ 後続.開始／FF＝先行.終了＋ラグ ≦ 後続.終了／SF＝先行.開始＋ラグ ≦ 後続.終了。「終了」＝due_date、「開始」＝start_date。

### 既存の FS の挙動と一般化（新しい自動化は足していない）
従来から在るのは次の3つだけ。それぞれを種類へ一般化した。
1. **自動リスケ連鎖（B3・`computeCascadeShiftsMulti`）**：先行の日付が動いたとき、後続が制約に違反したら「ぶつからない最小量」だけ後ろへ押す（作業期間保持・押す方向のみ・複数先行は最大の押し量・done/cancelled の後続は動かさない・start か due が無い後続は動かさない）。→ 4種へ一般化。後続のどちらの端（start/due）で判定するか、先行のどちらの端を基準にするかが種類で変わるだけで、押し方は同じ。FS／0 の結果は従来と同一（回帰テストあり）。**依存を追加・編集した瞬間には連鎖を走らせない**（従来も追加時は走らなかった）。
2. **完了のハードゲート（B1）**：先行が未完了だと後続を完了にできない。→ **FS・FF のみ**対象（先行の「終了」を待つ依存）。SS・SF は先行の開始を基準にするだけなので止めない。`getIncompletePredecessors` の既定がこの扱い。
3. **着手のソフト警告**：todo→進行中で先行が未完了なら警告トースト。→ **FS のみ**（`getIncompletePredecessors(..., "start")`）。
- ブロック中ウィジェット・週カード・ガント矢印の点線（先行が未完了）は従来のまま、ゲートの既定（FS・FF）に従う。ガント矢印の点線は種類を問わず「先行が未完了」で従来どおり。

### ガントの矢印
FS＝先行終端→後続始端（従来の経路そのまま）／SS＝始端→始端／FF＝終端→終端／SF＝先行始端→後続終端（`buildTypedDependencyPoints`）。FS 以外またはラグ≠0 のとき、矢印の最初の折れ点の近くに小さく「SS+2d」等のラベル（SVG の text・pointer-events なし）。矢印は実測した矩形から引くオーバーレイなので行レイアウト（s80）には触れていない。結線ドラッグ（B5）は従来どおり FS／0 で作成し、後から編集する。

### 編集UI
タスクの編集モーダル・サイドパネルの「先行タスク」欄で、各先行の横に種類セレクト（終了→開始（FS）等）とずらし日数（整数・負可）。変更は即時反映（先行の付け外しと同じ線引き）で、**Undo トースト＋Ctrl+Z で元に戻せる**（`updateTaskDependency`）。追加時は FS／0 で作り、横の欄で変える。複製・PJ引き継ぎ（`buildInheritedDependencies`）は種類とラグを引き継ぐ。WBS 取り込みは従来どおり FS／0。

### 循環チェック
種類に関わらず同じグラフ（`cycleCheck.ts` は無変更）。

### AI
AI には依存関係を渡していない（systemPrompt・AI の提案に依存の追加は無い）ため payload は変更なし。uiGuide の FEATURE_LIST_SECTION（s17）の先行タスクの行だけ更新。

### エクスポート
依存を出力する CSV 等のエクスポートは現状ない（`grep` 確認済み）。将来つくるときは `formatDepLabelAlways`（"FS"／"SS+2d"）を使う。

### MIN_CLIENT_VERSION
3.197 へ引き上げ。古い画面は SS/FF/SF を FS として扱い、誤った警告・自動ずらしをするため。

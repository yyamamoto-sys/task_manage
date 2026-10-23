## 61. 🔴 グランドルール：一覧を丸ごと読む select は `fetchAllRows` を通す（PostgREST の1000行上限・必須・v3.116・2026-09-28）

### 何が問題か

Supabase API（PostgREST）は1回の応答を `max_rows`（既定1000）で打ち切り、**エラーを出さない**。
`supabase.from("tasks").select("*")` のような単発の一覧取得は、行数が上限を超えた時点で末尾が
黙って欠ける。tasks は削除済み込みで928行（2026-09-16）まで来ており、1000行を超えると
一覧・カンバン・ガントから一部のタスクが消え、誰も気づけない。同じ型の欠落はバックアップ設計
（フェーズ1）でも一度見つかっている（`backupStore.ts` 冒頭コメント）。

### 使い方（`src/lib/supabase/fetchAllRows.ts`）

```typescript
const { data, error } = await fetchAllRows(o => supabase
  .from("tasks")
  .select("*", o)            // o を select の第2引数にそのまま渡す（1ページ目だけ count:"exact" が入る）
  .eq("is_deleted", false)
  .order("created_at", { ascending: false }), // 既存の並びは書いてよい
  { label: "tasks" });       // 主キーが id でない表は keyColumns: ["task_id", "project_id"] を渡す
if (error) throw error;
```

- 戻り値は `{ data, error }`（supabase の応答と同じ形）。エラーは握りつぶさず返す。
- 並びの最後に主キー（既定 `id`、複合主キーは `keyColumns`）の昇順が必ず足される。ページ間で順序が揺れないため。
- 🔴 主キーが乱数UUIDの表は、`id` だけで並べると画面上の並び（サイドバーのPJ順など）が入れ替わる。並びが画面に出る表は `created_at` などを先に `.order()` しておく（初期ロードの実体10表はそうしている）。
- ページ取得中の同時INSERT/DELETEで重複した行は主キーで1件にまとめる。最終件数が総件数と合わなければ `console.warn`（例外にはしない）。

### 禁止事項・判断の理由

1. 🔴 **終了条件を「返ってきた件数 < 要求したページサイズ」にしないこと。** サーバの `max_rows` が
   要求サイズより小さい（例：500）と、1ページ目で終わったと誤判定し、同じ黙った欠落が起きる。
   総件数（1ページ目の `count:"exact"`）に達したか、空ページが返ったかで止める。次ページの開始位置も
   要求サイズではなく**実際に返ってきた件数**で進める。どちらも `fetchAllRows.test.ts` の max_rows=500 の
   ケースが守っており、片方でも崩すと赤くなることを確認済み。
2. **一覧を丸ごと読む select を直書きしないこと。** 例外は `.limit()`・`.single()`・`.maybeSingle()` で
   件数を絞るもの、insert/update の戻り値の select。`src/lib/supabase/__tests__/rowLimitScan.test.ts` が
   src 配下の全 `.ts`/`.tsx` を走査して検出する（Section 59 に従いコメントを除去してから走査する。
   コメント内に語を書いても無力化されないこと、直書きに戻すと赤くなることを確認済み）。
3. **Edge Function（`supabase/functions/`）は走査の対象外。** （v3.116時点で一覧化した `notify-deadlines` は
   v3.136 で削除した。Deno 側のページングは `_shared/fetchAllRows.ts`）

### 適用範囲（v3.116時点）

store.ts の初期ロード14表（Phase 1・2）・`fetchGroups`・`fetchLoadingTips`・`fetchAiUsageLogs`・
`fetchGroupNotificationSettings`（v3.118新設。36回目巡回で本一覧への記載漏れを解消）、
personalOkrStore の一覧7関数、krSessionStore 2・okrAnalysisStore 2・krMeetingNoteStore 2・
projectAnalysisStore（古い分析の刈り込み用）1・projectInviteStore 1。

### 初期ロードのエラー方針（M41是正・v3.122）

`fetchCriticalData`（Phase 1・8表）は「構造に関わる表」（members/projects/tasks/
task_projects/task_dependencies）と「周辺の表」（milestones/member_tags/
member_tag_members）を分けて扱う。**構造表は1件でも取得失敗したら起動を止める**（throw。
既存のエラー表示経路＝App.tsxの`error`バナーに乗る）。task_dependenciesが黙って空配列に
なるとB1依存ゲートが「依存なし」と誤判定するため、members/projects/tasksと同列にした
（案A・山本さん決定）。**周辺表は失敗しても起動は続け**、`partialFailures`→
`appStore.partialLoadWarning`→App.tsxの警告バナー（既存の`error`バナーと同じ構造を
warning配色で再利用）で「一部のデータ（◯◯）を読み込めませんでした」と知らせる。
**Phase 2（`fetchOkrData`）もM42是正（v3.123）でPhase 1と同型の握りつぶし防止を適用した。
ただしPhase 2は起動後のバックグラウンド読み込みのため throw しない**（Phase 1と違いUI自体を
まだブロックしていない・OKR系データはB1のような致命的ゲート判定に使われないため）。6表
（objectives/key_results/task_forces/todos/project_task_forces/task_task_forces）は
Phase 1の周辺表と同じ扱い＝失敗しても空配列で継続し、`partialFailures`をPhase 1の
`partialLoadWarning`に**追記**する（Phase 1の警告を上書きしない）。`console.error`にも
表名・エラーコードを記録する。回帰テストは`storeRowLimit.test.ts`（`fetchOkrData`の単独失敗・
複数同時失敗・全表正常）と`loadPartialWarnings.test.ts`（Phase 1・Phase 2の警告合成）。
なお、Phase 2の6表はいずれも紐づけの追加/解除が単一行のinsert/delete（`addTaskTaskForce`等）
のみで、クライアント側の空配列を「差分ゼロ」と解釈してDBの紐づけを一括削除する経路は無い
ことを確認済み（部分失敗中でも安全）。

---

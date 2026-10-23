## 35. AI提案の反映・Undoまわりの不具合5件の修正（v3.77・2026-08-18）

2026-08-17〜18に4本の診断エージェントを並列実行して確定した、実害のあるバグ5件。件3・4は
**v3.71の「choke point統一（Section 6-10）」による回帰**であり、同じ性質の回帰が今後の
choke point変更でも起こりうるため、その旨を明記する。

### 件1（🔴最優先）：ゲストの「このPJをAI分析」がAI枠を食い潰す

`ProjectKarte.tsx`の`runAnalysis`は、`analyzeProject()`（AI呼び出し。`invokeAI.ts`がゲストへ
既に開放済み）が成功した直後に`insertProjectAnalysis()`（`project_analyses`への書き込み）を
呼んでいた。ゲストは`client.ts`のchoke pointで`from()`を常にブロックされるため、この書き込みが
必ず失敗し、AI呼び出しの課金・全体枠（10回/日）だけを消費して結果を一度も表示できなかった。

- v3.69「ゲストの日常編集の開放」・v3.67「個人OKRのAI解析結果保持」と同じ方針で解いた：
  choke point（`client.ts`のProxy）は一切緩めず、保存先をゲストのときだけ切り替える。
  新規`src/lib/ai/guestProjectAnalysisStore.ts`（プロジェクトIDごとに最新2件・
  `project_analyses`と同じ`MAX_HISTORY`をこのブラウザのメモリ内Mapで保持。
  localStorage/sessionStorageには書かない＝リロードで消える）。
- `ProjectKarte.tsx`は、マウント時の取得と分析実行後の反映の両方で`isGuestMode()`を見て、
  ゲストなら`fetchProjectAnalyses`/`insertProjectAnalysis`を呼ばずこのストアを読み書きする。
- 回帰テスト：`src/lib/ai/__tests__/guestProjectAnalysisStore.test.ts`（新しい順・最新2件への
  刈り込み・PJごとの独立性）。

### 件2（🔴）：AI提案のUndo失敗が完全に無警告・復旧不能

`useAIConsultation.ts`の`undo`/`undoUntil`は、`popUndo()`/`popUndoUntil()`で**スタックから
先に取り除いてから**`applyUndo()`を呼んでおり、戻り値の`type:"error"`を見ていなかった。
楽観ロック競合等で失敗すると、一部だけ元に戻った状態のまま、通知もリトライ手段も無く消えていた
（スタックから既に消えているため再試行できない）。

- `useUndoStack.ts`に「取り除かずに読む」`peek`/`peekUntil`と、「複数idをまとめて取り除く」
  `removeMany`を追加した。
- `undo`/`undoUntil`を「**先にDB反映→成功を確認してから取り除く**」順序に変更した。失敗時は
  スタックに残し、必ず`showToast`でエラーメッセージを表示する（黙って握りつぶさない）。
- `undoApply.ts`の`UndoResult`（error）に`partial: boolean`を追加した。1つのsnapshotが複数
  operationを持つ場合（例：複数タスクの日程変更のUndo）に途中で失敗すると、それより前の
  operationは既にDBへ反映済みのまま処理が止まる（トランザクションではない・
  `applyProposal.ts`の「部分失敗の方針」と同じ割り切り）。1件でも適用済みなら
  message に「一部のみ元に戻りました。画面を再読み込みしてご確認ください」を含める。
- 回帰テスト：`src/lib/ai/__tests__/undoApply.test.ts`に部分失敗時のmessage/partialの検証を
  追加。`useAIConsultation.ts`/`useUndoStack.ts`自体はこのリポジトリにReactフックの
  レンダリングテスト基盤（react-testing-library等）が無いため単体テストの対象外（既存の
  他フックも同様。ロジックは`undoApply.ts`側のテストと目視レビューで担保した）。

### 件3（🔴・v3.71の回帰）：Undo時に`skipCascade`が漏れていた

`undoApply.ts`の`task_field`分岐（`op.field`が`due_date`のとき＝date_change提案のUndo）が、
`saveTask`に`{ skipCascade: true }`を渡していなかった。B3のUndoパターン（`appStore.ts`の
`runCascade`／`runBulkShift`のUndo。計5箇所）は例外なく`skipCascade:true`を渡しており、
ここだけ抜けていた。Undoで戻した（多くの場合、より後ろの）日付を起点にB3自動リスケが
再発火し、無関係な後続タスクが押し出されたまま取り残されていた。

- **なぜここだけ漏れたか**：v3.71の choke point 統一以前、`undoApply.ts`は`supabase.from(...)`
  を直接呼んでおり、B3（自動リスケ連鎖）という概念自体が存在しなかった（`saveTask`を経由
  しないため発火しようがなかった）。v3.71で`saveTask`経由に統一したことで、このUndoが
  初めてB3の対象になったが、`skipCascade`オプション自体は元々`runCascade`/`runBulkShift`
  （日付シフト機能）専用に作られたものだったため、日付シフトを扱わない`undoApply.ts`の
  改修時に見落とされた（該当5箇所は全て「B3の直接の実装」側にあり、「B3が新たに効くように
  なった側」である`undoApply.ts`はレビュー対象として見えにくかった）。
- 同型の漏れが他に無いかを`saveTask(`の全呼び出し箇所（`grep`で機械的に洗い出し）で確認した。
  `applyProposal.ts`の`createTaskRow`（add_task提案の新規タスク作成）も`skipCascade`を
  渡していないが、新規作成タスクは作成時点で誰からも依存されていない
  （AI提案は依存関係を作成しない）ため`computeCascadeShifts`が常に空配列を返し実害はない
  ことを確認済み（意図的に直していない。触ると「新規作成でも常にskipCascadeを付ける」という
  別ルールを持ち込むことになり、今回のスコープを超えるため）。
- 修正：`{ ...task, [op.field]: op.oldValue, updated_by: currentUserId }`の`saveTask`呼び出しに
  `{ skipCascade: true }`を追加（`due_date`以外のフィールドはB3の発火条件に該当しないため
  常時付けても副作用は無い）。
- 回帰テスト：`src/lib/ai/__tests__/undoApply.test.ts`に、先行・後続の依存があるデータで
  Undoしても後続タスクへの連鎖保存が起きないことを検証するテストを追加。

### 件4（🟠・v3.71の回帰）：複数タスクの日付変更が順序依存

`applyProposal.ts`の`applyProposalWithConfirmation`（date_change確定）は、`dialog.items`を
AIが返した順のまま`saveTask`（`skipCascade`無し＝意図的にB3を発火させる。件3と違い
こちらは反映時に後続タスクを実際に押したい設計）で反映していた。この順序が依存関係の
トポロジカル順になっていない場合（後続タスクが先・先行タスクが後）、後続タスクの確定値を
先に書き込んだ後で先行タスクを反映すると、そのB3自動リスケ連鎖が後続タスクの確定値を
黙って上書きしてしまっていた。

- **これもv3.71の回帰**：以前は`supabase.from(...)`の直接UPDATEで、B3という概念自体が
  無かったため、反映順序は結果に影響しなかった。v3.71で`saveTask`経由になりB3が効くように
  なったことで、初めて「反映順序」が意味を持つようになった。
- 新規`src/lib/dependencies/topoSort.ts`の`sortTaskIdsByDependencyOrder(taskIds, deps)`
  （純粋関数）が、対象タスク集合を依存関係の先行→後続順に並べ替える。反映前にこれを通し、
  先行タスクを先に反映することで「各タスク自身の確定値の書き込みが必ずそのタスクへの
  最後の書き込みになる」ことを保証する。
- **循環時の扱いは既存の`cycleCheck.ts`と整合させた**：`canAddDependency`が依存追加時に
  循環を必ず弾くため通常は循環が混入しないが、防御的に`reschedule.ts`の
  `computeCascadeShiftsMulti`と同じ安全側の割り切り（トポロジカル順で全ノードを網羅できない
  ＝循環ありと判定したら、並べ替えを諦めて元の順序のまま返す。クラッシュ・無限ループにしない）
  を採用した。
- 対象は`dialog.items`（タスクの期日変更）のみ。`pj_end_date_items`（PJ終了日の変更）は
  PJ間に依存関係の概念が無いため並べ替え不要。
- テストケース：`src/lib/dependencies/__tests__/topoSort.test.ts`（依存無し／逆順→正順への
  並べ替え／鎖状依存／集合外ノードを介した依存は無視／論理削除済み依存は無視／相対順序の
  保持／循環データでも例外・無限ループにならず元の順序を返す／空配列／複数の独立した依存の
  混在）。`applyProposal.test.ts`に、実際のB3カスケードを発火させて確定値が上書きされない
  ことを検証する統合テストを追加。

### 件5（🟡）：`saveMember`にゲスト分岐が無かった

`appStore.ts`の`saveMember`は、`saveProject`等の他の書き込み系アクションと違い
`isGuestMode()`分岐を持っていなかった。ゲストが通知設定を変更すると、`upsertMember`が
choke pointで必ず失敗し「保存に失敗しました」という誤ったトーストが出ていた。

- `saveProject`と同型の分岐を追加：ゲストのときは`upsertMember`を呼ばず、ローカル生成の
  `updated_at`でstateだけ同期する。
- 回帰テスト：`src/stores/__tests__/guestWriteBranches.test.ts`に`saveMember`のゲスト分岐・
  非ゲストの既存経路を追加。

---

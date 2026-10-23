## 76. 長く使うと重くなる問題・黙った再読み込みの対策（v3.146・2026-10-14）

利用者報告：「色々な画面を触っていると、だんだん画面が重くなり、ブラックアウトしたり強制リロードされたりする」。コードの静的調査（リスナー・タイマー・購読・観察器・Blob・store の肥大化）で「画面を切り替えるたびに増え続けるもの」は見つからず、原因は次の2つだった。**jsdom での mount/unmount 反復計測と実機のメモリ計測は未実施**（下の計測で確かめる）。

### 1. 全件の読み直しをやめた（Section 1.5・13 の「AppDataProvider が realtime 購読を担う」記述はこれで置き換わる）

- **原因**：`AppDataContext` が tasks/projects の変更のたびに 400ms 後に `load()`（全テーブルの再取得）を呼んでいた。自分の保存も realtime で自分へ返るため、ガントのドラッグ・一括シフト・AI 反映のたびに15テーブルの全件取得と全画面の再描画が走った。同じ変更は `App.tsx` の `subscribeToRealtime(applyRemoteChange)`（11表の差分反映）でも受けており二重だった。
- **対応**：`AppDataContext` の購読を撤去し、realtime は `App.tsx` の差分反映に一本化。`AppDataContext` は初回 `load()` だけを担う。
- **load() を呼ぶのは「取りこぼしを埋める」2つの場合だけ**（`src/lib/supabase/resync.ts`）：①チャンネルが CHANNEL_ERROR/TIMED_OUT/CLOSED のあと SUBSCRIBED に復帰したとき（`subscribeToRealtime` の `onResync`。最初の SUBSCRIBED では呼ばない）②タブが10分以上非表示だったあと前面に戻ったとき（`createHiddenReturnGate`）。連続して揺れても `createResyncRunner` が30秒の最短間隔で連打を止める。
- 🔴 購読の effect の依存は `loading` ではなく「初回ロード済みか」（`realtimeReady`）。`load()` は実行のたびに `loading` を true→false にするため、`loading` を依存にすると load のたびに購読を張り直し、その間のイベントを取りこぼす。
- **applyRemoteChange が load() の代わりを果たせるかの確認（穴の有無）**：11表（tasks・projects・todos・key_results・task_forces・milestones・members・task_task_forces・task_projects・project_task_forces・task_dependencies）は差分で反映される。DB トリガーで他の行が変わるもの（`sync_task_group_ids`＝BEFORE トリガーで tasks 行自身に載る／`cascade_project_group_ids_to_tasks`＝tasks を UPDATE し `trg_tasks_updated_at` で updated_at が進むため stale 判定を通る）も realtime で届く。**見つかった穴は1つ：tasks/projects の行を生のまま入れていたため、配列列が null の旧データで `load()` 経由の行と形が食い違う**（`todo_ids`/`assignee_member_ids`/`tags`/`owner_member_ids`/`member_ids`）。`src/lib/supabase/rowNormalize.ts` の `normalizeTaskRow`/`normalizeProjectRow`（`fetchCriticalData` と共有）を通してから入れるようにして解消した。**残る既知の限界**：realtime の購読対象外の表（groups・objectives・member_tags 等）は従来どおり届かない（旧実装も tasks/projects の変更でしか load しておらず、これらは元から対象外）／RLS の可視範囲が変わったとき（招待の受諾直後等）は届かない→復帰時の load() と、各画面の明示 reload（`window.location.reload()`）で拾う。
- **明示の `reload()` の扱い**：`ConsultationPanel`（提案の反映・AI 提案の適用）と `useAIConsultation`（反映・Undo）の `reload()` は残した。これらは `applyProposal`/`undoApply` が store.ts を直接書く経路で、appStore の楽観更新を通らず、objectives 等の realtime 対象外の表も触りうる。**AI 反映の直後の1回であり、realtime のエコー（`applyRemoteChange`）は冪等なので二重に load() が走ることは無い**（`load()` は進行中なら `_pendingLoad` に畳まれる）。

- **v3.153：置き換えが自分の保存を巻き戻さない**。load() の取得中に成功した保存（`syncUpdatedAt` の記録）は、置き換え直後に `keepNewerLocal` が手元の行を採る（Section 5「保存の競合の原因になる2件の修正」）。realtime のエコーが届かなくても `updated_at` が固定されない。

### 2. チャンクの先読みと、取得失敗時の扱い（`src/lib/lazyWithRetry.ts`・v3.163で改訂）

- **原因（v3.146 時点の調査）**：Vercel Hobby は Skew Protection が無く、デプロイ後は旧ビルドのハッシュ付きチャンクが 404 になる。古いタブが未読込の lazy 画面（`lazyWithRetry` 24画面）を開くと取得に失敗する。v3.146 は黙った reload をやめて案内＋全体バナーにしたが、これが「リロードしないと使えない」の正体になっていた（v3.163 で撤去）。
- **【本命】先読み**：ログイン後（ゲスト含む）の初回描画が落ち着いたら、`lazyWithRetry` の登録簿に入った全画面のチャンクと、添付解析系（`docxText`・`xlsxText`・`pptxText`・`htmlText`・`pdfAttachment`・`pdfText`。`consultationAttachmentLoader`・`FileAttachButton` 等が生の `import()` するもの）を**1本ずつ順番に**読み込む。一度解決したモジュールはタブ内に残るので、その後デプロイがあっても古いタブが壊れない。
  - `lazyWithRetry(factory, name)` が factory を登録簿に載せる（`registerPrefetchChunk` で生の import も足せる）。`prefetchAllChunks()` は登録順・1本ずつ（並行しない）・1本ごとに150ms空け・1本の失敗で止まらない（`console.debug` のみ。`client_error_logs` には記録しない）。
  - 起動は `ChunkPrefetcher`（`App.tsx` の通常・ゲスト両方のメイン描画に1つずつ）→ `startChunkPrefetch()`（`lib/prefetchChunks.ts`）：4秒後に `requestIdleCallback`（無ければ即実行）。タブ内で1回だけ。**開発サーバー（`import.meta.env.DEV`）では走らせない。** デモデータセット（`lib/demo/*`）と i18n の英語辞書は対象外（使う人が限られる＝Section 19）。
  - 新しい `lazyWithRetry` は自動で先読み対象になる。生の動的 import を足したら `lib/prefetchChunks.ts` の登録に1行足す。
- **それでも取得に失敗したとき**（先読み完了前に新版が出た等）：`loadChunkOrFallback` が1回だけ1秒待って再取得 → なお失敗なら、`client_error_logs` に `code="chunk-load"` を画面ごとに1回記録し、`attemptChunkRecoveryReload`（`src/lib/chunkRecovery.ts`）で安全か判定する。
  - **安全**（未保存の編集なし＝`hasUnsavedEditors`・入力中でない＝`isInputFocused`・モーダルなし＝`isModalOpen`・AI会話中でない＝`isAutoUpdateAiBusy`・ゲストでない・直近1分に自動再読み込みしていない）なら**黙って `window.location.reload()`**（画面遷移と同じ扱い）。画面は読み込み中のままにして案内を一瞬出さない。ループ防止は `sessionStorage`（`chunk_reload_v1`＝時刻）で**1分に1回まで**。記録を書けない環境では再読み込みしない。ゲストを除くのは自動更新（v3.152）と同じ理由（ゲストの編集はメモリにしか無い）。
  - **安全でなければ**、その画面の位置だけに `ChunkLoadFailed`（再読み込みの案内。`reloadWithGuard`＝Section 46 を通してから reload）を出す。他の画面・既存の操作は使えるまま。**全体バナーは出さない。**
- 失敗は**例外にしない**（`ErrorBoundary`・`unhandledrejection` に流れない）。`lazyWithRetry` の外で起きた動的 import の失敗（`FileAttachButton` 等）は通常の経路で記録される（先読みで解決済みなら起きにくい）。
- **記録**：`clientErrorLog.ts` の無視リストから動的 import 失敗の2パターンを外してあり、`lazyWithRetry` が `code="chunk-load"`・context に `chunk-load:<画面名> v<APP_VERSION>` を付けて `logDiagnostic`（`src/lib/errors/diagnosticLog.ts`。実体は `main.tsx` が `createDirectLogger` で差し込む）から画面ごとにセッション中1回だけ送る。fingerprint は画面名ごと（版の数字は正規化で束ねる）。**super_admin への「新しいエラー」通知（Section 67）が、デプロイのたびに画面ごとに1件ずつ出うる**（同じ fingerprint は1時間に1回・1人の super_admin につき1時間10件まで）。先読みが効けば減る。多すぎるようなら chunk-load を通知の対象外にする（`log_client_error` 側の変更が要る）。
- **ブラックアウト（Chrome がタブを落とす）は記録できない**（タブ自体が死ぬため）。次の計測で間接的に捉える。

### 3. 計測の仕組み（`src/lib/diagnostics/`）

- `healthMonitor.ts`：`AuthenticatedApp` が起動し、5分ごとに ①Chrome の `performance.memory.usedJSHeapSize` が700MB以上なら `code="memory-high"` ②直近10分の `load()` 実行回数が10回を**超えたら** `code="load-burst"` を、**各セッション1回だけ** `logDiagnostic` で送る。context に MB・経過分・現在の画面（`getClientErrorScreen`）・load() の累計回数。メモリが取れない環境（Chrome 以外）は何もしない。ゲストでは動かさない。タイマーはアンマウントで確実に解除。
- `loadCounter.ts`：`appStore.load()` の実行開始を `recordLoad()` で数える（保持する時刻は200件上限で、計測自体が溜まり続けない）。
- source は既存の CHECK 制約に合う `"report"`（DB は変更しない）。`memory-high`・`load-burst` は message が固定で、`computeFingerprint` が `DIAGNOSTIC_CODES` のとき context をまとめ方に使わない＝code ごとに1行に束ねる（MB・画面名・回数は初回の context に残る）。
- 送る頻度：同じ fingerprint は1分に1回・1タブ1時間30件まで（既存の間引き）に加え、各診断はセッション中1回。

### 機械チェック・テスト

`src/context/__tests__/noFullReloadOnChange.test.ts`（AppDataContext が channel・setTimeout を持たない／App.tsx の購読が `onResync` 経由・依存が `[realtimeReady, applyRemoteChange, load]`／visibilitychange の購読と解除。Section 59 に従いコメントを除去して走査。修正前の HEAD に同じ検出を当てて全項目が赤になることを確認済み）・`resync.test.ts`・`realtimeResync.test.ts`・`realtimeApplyRelated.test.ts`・`loadCountsLoads.test.ts`・`healthMonitor.test.ts`・`loadCounter.test.ts`・`lazyWithRetry.test.ts`（全体バナー用イベントが出ない・先読みは登録順に1本ずつ・1本の失敗で止まらない・記録は画面ごと1回。修正前のコードで赤くなることを確認済み）・`chunkRecovery.test.ts`（安全なら reload・未保存／入力中／モーダル／AI会話中／ゲスト／直近1分の記録があれば案内に落とす）・`directLogger.test.ts`。

### 山本さんの実機での確認

Chrome のタスクマネージャー（Shift+Esc）でこのタブのメモリを見て、どの画面の往復・どの操作で増えるか。デプロイ直後に画面を開いて、再読み込みの案内が出る（黙って reload しない）こと。管理画面「エラー」タブに `chunk-load`・`memory-high`・`load-burst` が出るかどうか。

### やらないこと

- jsdom での mount/unmount 反復計測（メモリ増加の有無は実機の計測で判断する）。
- ガント・グラフ等の個別の描画最適化・store の配列の上限（今回の調査では増殖経路は見つからなかった）。
- `MIN_CLIENT_VERSION` の引き上げ・マイグレーション（DB・RLS・Edge Function・localStorage の形式は変更なし）。

### v3.171：Supabase の Disk IO 対策（長く非表示のタブの Realtime 停止・DB を読む定期処理の間引き）

本番は Free・Nano（RAM 411MB・Swap 常時張り付き）で、平日に Disk IO 残量が減っていた。pg_stat_statements で目立ったのは Realtime の変更取得（`realtime.list_changes`）・ベルの `in_app_notifications` 取得（約22万回）・購読の張り直し（`realtime.subscription` への書込 約23万回）。Pro 移管までのつなぎとして、アプリ側で負荷を減らした。DB・RLS・Edge Function の変更なし（`MIN_CLIENT_VERSION` は上げない）。

- **長く非表示のタブは Realtime を切る**：`document` が hidden のまま10分（`HIDDEN_PAUSE_MS`）続いたら、`src/lib/supabase/realtimePause.ts` が「停止」の合図を出す（`installHiddenPause`＝AuthenticatedApp で1回起動。`createHiddenPauseController` が純関数）。購読する側が各自で応じる：`App.tsx` の購読 effect が `subscribeToRealtime` の戻り値（app-sync・app-sync-optional の2チャンネル）を外し、`InAppNotificationBell` が通知チャンネルを外す。**3本とも外れると supabase-js（realtime-js の `removeChannel`）が websocket 自体も閉じる**（`node_modules` の `RealtimeClient.removeChannel` で確認。別途 `disconnect()` は不要）。visible に戻ったら張り直す。
  - **取りこぼしは全件再取得で埋める**：再開時は `resync()`（`createResyncRunner`＝既存の復帰時の全件 load）を1回。張り直しの `onFirstSubscribed`（差分取得）は `resumed` のとき渡さず、二重に走らせない。非表示から戻ったときの既存の `createHiddenReturnGate`（10分）判定は残し、停止中の復帰は `onVisibility` 側で `isRealtimePaused()` を見て重ねない（30秒後にもう1回 load が走るのを防ぐ）。購読 effect が停止中に作り直されても購読は張らない。
  - **見張り・状態表示との整合**：停止中は `setRealtimeChannelState("paused")`、再開直後〜最初の購読状態が来るまでは `"resuming"`。`realtimeEchoWatch.expectEcho` はこの2状態のとき見張らない（`realtime-silent` を誤記録しない）。`subscribeToRealtime`／`subscribeInAppNotifications` は解除後に古いチャンネルから届く状態通知を無視する（`disposed`。`createReconnectTracker` の「切断からの復帰」判定にも状態表示にも混ぜない＝停止を切断と誤認して復帰の全件再取得を二重に起こさない）。
  - **10分未満の非表示では何も変えない**（タイマーが走る前に戻ればクリアするだけ）。
- **ベルの未読数取得を間引く**（`InAppNotificationBell.tsx`・`src/lib/notifications/bellPolling.ts`）：非表示の間は `refreshCount` が何もしない（Realtime イベント・SW の push・定期のいずれでも。前面に戻ったとき `visibilitychange` で1回だけ取る）。実行中に届いた要求は重ねず、終わってから1回だけ取り直す（`countBusyRef`）。定期取得は1分ごとに `shouldPollBell` で判定：Realtime が SUBSCRIBED（`subscribeInAppNotifications` の第3引数 `onLive`）の間は15分、切れているときだけ従来の3分。**完全には止めない**（`in_app_notifications` が publication に無くても黙って SUBSCRIBED になりうるため）。
- **ほかの定期処理**：`AdminView` の AI使用量の30秒 reload は非表示中は止め、前面に戻ったら1回（`src/lib/visibility.ts` の `isDocumentHidden`）。`ReloadNoticeBanner`（version.json＝静的ファイル）・`healthMonitor`（DB を読まない）・`MainLayout` の3秒ごとのお知らせツアー判定（DB を読まない）・Schema／Backup／Reminder のヘルスバナー（マウント時1回のみ）は対象外。
- **購読テーブルの棚卸し（変更はしていない・候補のみ）**：`realtime.ts` の本線11表＋任意1表（project_sections）＋通知。書込が多い・全利用者に配る価値が高いのは tasks／projects／task_dependencies／milestones／in_app_notifications。**外せそうな候補は key_results・task_forces・todos・project_task_forces・task_task_forces・task_projects・project_sections**（管理者の画面でしか編集されない／v3.149 で入力欄を撤去して新規書込がほぼ無い／復帰時の全件再取得と各画面の明示 reload で足りる）。members は表示名・色の同期が目的で書込は稀だが、担当者表示に直結するため残すのが無難。外す場合は `realtime.ts` の TABLES と `appStore.applyRemoteChange` の分岐・`fetchChangesSince` の対象・`realtimeResync.test.ts` の購読数を一緒に直し、publication からは `ALTER PUBLICATION supabase_realtime DROP TABLE` を別マイグレで行う。
- **機械チェック**：`src/lib/supabase/__tests__/realtimePause.test.ts`（10分の境界・再開・二重通知・dispose＋App／ベルの配線をコメント除去のソース走査＝Section 59）・`src/components/notifications/__tests__/bellDiskIo.test.ts`（実際に描画。非表示で取らない・SUBSCRIBED の間は3分で取らない・要求を重ねない・10分で解除／復帰で張り直し）・`bellPolling.test.ts`・`src/lib/__tests__/visibilityPollingWiring.test.ts`・`realtimeEchoWatch.test.ts`（paused／resuming）・`notificationRealtime.test.ts`・`realtimeResync.test.ts`（解除後の通知無視）。修正前のコードに当てて新規テストが赤くなることを確認済み。
- **山本さんの実機確認**：①ブラウザの別タブへ10分以上切り替えて戻る→データが最新になり、DevTools の Network の WS が一度閉じて再接続されていること ②非表示中に別の人がタスクを変更→戻ったあと反映されていること ③ベルの未読数が戻ったときに更新されること ④AI使用量タブを開いたまま別タブにしても通信が止まること。
- **残るリスク**：復帰直後の全件再取得（30秒の最短間隔つき）が、多数の利用者が同時刻に戻る朝一番に重なる可能性（Free・Nano では復帰の集中が新たな山になりうる）。再開の接続待ち（`resuming`）の間に自分が保存すると、エコー見張りは見張らないが他者の変更の受信は復帰の全件再取得で埋まるまで遅れる。

### v3.172：個人OKRストアの取得競合・ユーザー切替（巡回53回目・D OKR サブ領域⑤）

`stores/personalOkrUiStore.ts` はモジュール単位のシングルトンで、明示のログアウト（`handleLogout`＝再読み込み）以外では状態が残る。
- 🔴 **サインアウト・ユーザー切替でストアを空に戻す**：`personalOkrUiStore` 自身が `onAuthStateChange` を購読し（このモジュールは「自分」タブを開いたとき初めて読み込まれる＝Section 19 のため App.tsx からは参照しない）、`decideAuthReset`（`lib/personalOkr/authReset.ts`）で SIGNED_OUT・ユーザー変更を判定して `resetPersonalOkrUiStore()`。ゲストと匿名セッションのイベントは無視。リセットで `epoch` が進み、進行中の取得・AI呼び出しの結果は捨てられる（非同期アクションは開始時の epoch を控え、戻ったときに不一致なら何もしない）。**非同期アクションを足すときは同じ epoch ガードを入れる。**
- **同じ対象の取得は `dedupe`（inflight）で1本にまとめる**。KR詳細の取得中の印は `detailLoadingKrIds`（Set）。取得結果は `mergeFetchedRows`（`lib/personalOkr/fetchMerge.ts`）で手元の新しい行（updated_at が大きい・取得中に作った行）を残してから載せる。
- **AI解析・下書き生成は「解析中の印」を DB確認の await より前に立てる**（後だと確認中の2回目がガードを抜けて二重課金）。結果を載せるとき `*FetchedKeys` にも入れ、遅れて届いた取得結果で消さない。
- 週の紐づけ一覧の取得失敗は未取得のまま残し（空で確定させない）、`linkWeekTask`／`unlinkWeekTask` は一覧が読めないと中止する。
- KR詳細・月次の取得失敗は `detailError`（`formatErrorForUser`）を `PersonalOkrView` に表示（再読み込みボタン付き）。以前は誰も表示しておらず、データが無いように見えていた。
- 仕様判断待ちは `docs/REFACTORING.md` M65（個人OKRのデータは購読も定期取得も無く、v3.171 の復帰時の全件再取得の対象外）・M66（ConflictError 後に再読み込みの手段が無い）。
- テスト：`stores/__tests__/personalOkrUiStoreRaces.test.ts`（修正前のストアで13件中12件が赤になることを確認済み）・`lib/personalOkr/__tests__/fetchMergeAndAuthReset.test.ts`。

### v3.173：realtime の張り直しが効かない不具合（巡回54回目・データ基盤）

- 🔴 **購読チャンネルの名前は購読ごとに変える**（`realtime.ts` の `seq`：`app-sync:<n>`・`app-sync-optional:<n>`）。realtime-js の `supabase.channel(topic)` は一覧に同名のチャンネルが残っていればそれを返し、`removeChannel` は leave の応答待ちで一覧から消えるまで遅れる。`realtimeEpoch` を進める自己回復（realtime-silent の60秒・Section 77 v3.158）は解除の直後に同期的に購読し直すため、固定名だと解除中の古いチャンネルに `subscribe` しても何も起きず、**購読が無いまま残って状態通知（SUBSCRIBED）も来ない**（再読み込みまで realtime が死ぬ）。`notificationRealtime.ts` は元から名前に連番を付けていた。購読を作る新しいコードも同じにすること。テスト：`lib/supabase/__tests__/realtimeResubscribe.test.ts`（修正前で赤を確認）。
- 仕様判断待ち：`docs/REFACTORING.md` M68（張り直しの差分取得の起点がセッション開始）・M69（停止からの再開の取りこぼしの窓）。

### v3.174：ドロップダウンを Esc で閉じるとモーダルごと閉じる不具合（巡回55回目・共通UI）

- 🔴 `useConfirmClose`（個人OKRの編集モーダル5つ）の Esc は、`role="dialog"`（ConfirmModal）に加えて **`role="listbox"`（開いている `CustomSelect` のパネル）が DOM にある間は無視する**（`isEscapeOwnedByOverlay`）。以前はドロップダウンを Esc で閉じると同じ Esc でモーダルも閉じ、未編集なら確認なしで閉じていた。`CustomSelect` のパネルに `role="listbox"` を付けたことが前提（テストが検査）。
- 同型の未対応：`useConfirmClose` 以外の Esc で閉じるモーダルは判定が無い（`docs/REFACTORING.md` M70）。
- テスト：`hooks/__tests__/confirmCloseEscape.test.ts`（修正前は4件とも赤）。

### v3.175：認証の入口の2件（巡回56回目・App Shell・認証・入口）

- 🔴 **認証済みだったタブの SIGNED_OUT（セッション失効・別タブのサインアウト）は `clearCurrentUser()`＋再読み込みで切る**（`lib/account/signedOutCleanup.ts` の `shouldReloadOnSignedOut`。再設定画面・ゲスト・未ログイン画面では動かない）。以前は `authenticated=false` にするだけで、`appStore` の前ユーザーのデータと localStorage の「前回ユーザー」が残り、同じタブで別の人がログインすると前の人のメンバー行に自動ログインしうる状態だった。明示のログアウト（`handleLogout`）と同じ「迷ったらリロード」方針。新しいストアを足してもここで一括して切れる。
- 🔴 **初回データ取得の失敗はアクセス拒否画面より先に `StartupLoadFailedScreen` を返す**（`lib/account/startupLoadFailed.ts`）。取得失敗で `members` が空のまま「未登録」と案内していた。システム空判定のRPCは取得エラー中は走らせない。
- `AccessDeniedScreen` は自前で `signOut()` しない（`handleLogout` に任せる。失敗はトーストで出る）。
- 仕様判断待ち：`docs/REFACTORING.md` M71（不一致時の案内文）・M72（`autoMatch` の②前回ユーザーへのフォールバック）・M73（ゲスト遮断に `channel()` が無い）。
- テスト：`__tests__/authEntryWiring.test.ts`・`lib/account/__tests__/signedOutCleanup.test.ts`（修正前は赤）。

### v3.176：前回ユーザーの自動ログインはメール一致のときだけ・アクセス拒否画面の案内（巡回56回目 M71・M72）

- 🔴 **`autoMatch` の②（localStorage の前回ユーザー）は、Auth メールと前回ユーザーの `members.email` が一致するときだけ自動ログインする**（`lib/account/savedUserMatch.ts` の `resolveSavedUserAutoLogin`。大文字小文字・前後の空白は無視）。一致しない・前回ユーザーの email が空・Auth メールが取れないときは自動ログインせず、`clearCurrentUser()` で前回ユーザーを消して選択画面（`UserSelectScreen`）へ進む。以前は id だけで引いており、同じブラウザで別の人（個人Gmail等）が入ると前の人の行でログインしうる状態だった。①（Auth メール→members のメール一致）は変更なし。
- Auth メールと members を切り離す機能は無い：ゲストは `AuthenticatedApp` を通らず、初回ブートストラップは `isWizardDone` 判定が先、スーパー管理者の代理・デモ機能は無い。`UserSelectScreen`（メンバー選択）は①②が成立しなかったときの入口として残り、メール未設定の既存メンバーが自分を選ぶと `handleLogin` が Auth メールを補完する（②の救済はこの経路に一本化された）。
- `AccessDeniedScreen` の案内（`auth.accessDenied.body1/2/3`・ja/en）：ログイン中のメールを表示したうえで、「メンバー登録は会社のメールアドレスで行われています。個人のメールアドレス（Gmail 等）でログインしていないか確認してください。」・ログアウトボタン「ログアウトして登録済みのアドレスで入り直す」・「解決しない場合は管理者に連絡し…」を出す。
- テスト：`lib/account/__tests__/savedUserMatch.test.ts`・`components/auth/__tests__/accessDeniedGuidance.test.tsx`（修正前のコードで赤になることを確認済み）。DB 変更なし・MIN_CLIENT_VERSION は上げない。

### v3.177：グループ機能まわりの2件（巡回57回目・A 計画ビュー）

- 🔴 **`normalizeTaskSection` は手元の `projectSections` に無い id を空へ戻さない**（削除済み・別PJ・PJなしだけ戻す）。グループの取得失敗（周辺表の警告）や、`project_sections`（`app-sync-optional`）が `tasks`（`app-sync`）より後に届く間に、そのタスクを保存すると、他の人のグループ分けが DB から消えていた。存在しない・削除済み・別PJの最終判断は DB のトリガー（`enforce_task_section_integrity`）。
- `reorderProjectSections` は最終の並びを先に1回で画面へ反映してから1件ずつ保存する（途中の並びが画面に出ない）。
- 仕様判断待ち：`docs/REFACTORING.md` M74（Undo の `saveTask` が待たれない）・M75（削除されたグループ宛てのその場追加の下書きが見えないまま残る）・M76（並べ替えの途中失敗で `sort_order` が重なる）。
- テスト：`lib/section/__tests__/sections.test.ts`・`stores/__tests__/sectionReorderOptimistic.test.ts`（修正前は赤）。DB 変更なし・MIN_CLIENT_VERSION は上げない。

### v3.178：ガントのショートカットと選択の後始末（巡回58回目・A 計画ビュー ガント）

- 🔴 **ガント自身のキー（T・+・-・Ctrl+A・Enter）は共通判定（`shouldIgnoreCommandKey`／`isModalOpen`／`isInteractiveTarget`）を通す。** 以前は入力欄判定だけで、モーダル（一括の複製ダイアログ・確認ダイアログ・他のモーダル）の裏でも発火し、Ctrl+A が背後のタスクを全選択していた。チェックボックスにフォーカスがあるときは入力扱いになり（v3.160 でチェックボックスを足してから）、押した直後は Ctrl+A・T・+/- が効かなかった。ボタン・チェックボックス上の Enter は詳細を開かない。
- **消えたタスクは選択から外す**（`pruneSelection`）。他の人の削除（realtime）で一括バーの件数と実際の対象がずれていた。
- **一括シフトで一部の保存が失敗したら、トーストに「N件は保存に失敗したため移動していません」を含める**（成功件数だけ出していた）。
- 仕様判断待ち：`docs/REFACTORING.md` M77（フィルタ・折りたたみで見えなくなった選択済みタスクも一括操作の対象になる）・M78（バーのドラッグの単体保存が失敗したときの未処理の Promise 拒否。M74 と同型）。
- テスト：`ganttCheckboxWiring.test.ts`・`keys.test.ts`・`selectionWithChildren.test.ts`・`bulkShiftTasks.test.ts`（修正前は赤）。DB 変更なし・MIN_CLIENT_VERSION は上げない。

### v3.179：カンバン・ワークロードの後始末（巡回59回目・A 計画ビュー カンバン／ワークロード／ダッシュボード）

- **カンバンの Ctrl+A・Esc もガントと同じ共通判定（`shouldIgnoreCommandKey`／`isModalOpen`）を通す。** 確認ダイアログ・IME 変換中・他で処理済みのときは発火しない。複製モーダル表示中は登録しない。
- **同じ列へドロップしても保存しない**（更新日時と変更履歴だけが動いていた）。単体ドロップの保存失敗（先行タスク未完了のゲートを含む）は `saveTask` がトーストと再読込で扱い済みのため `.catch` で握り、未処理の Promise 拒否にしない。
- **ワークロードの PJ 絞り込みは、選んでいた PJ が一覧から消えたら「全プロジェクト」に戻す**（全員 0 件に見えていた）。
- 仕様判断待ち：`docs/REFACTORING.md` M79（ダッシュボード KPI の「進行中」「今週の完了率」が親タスクを含み二重計上）・M80（カンバンの一括操作・Ctrl+A の対象が「完了を隠す」「保留・中止を表示しない」で見えない列のタスクも含む可能性）。
- テスト：`components/kanban/__tests__/kanbanKeysAndDrop.test.ts`（修正前は赤）。DB 変更なし・MIN_CLIENT_VERSION は上げない。

---

---

### v3.180：個人OKRも復帰時の全件再取得の対象に（M65）

個人OKRのストアは「自分」タブを開いたとき初めて読み込まれる（Section 19）ため、`App.tsx`は直接importできない。`lib/personalOkr/resyncRegistry.ts`に窓口を置き、ストアが読み込まれたときに`resyncAll`を登録する。`App.tsx`のresyncランナー（切断→復帰・10分以上非表示からの復帰・30秒の最短間隔）が`load()`と同時に`requestPersonalOkrResync()`を呼ぶので、問い合わせが増えるのは既存の復帰時だけ。`resyncAll`は`krsLoaded`等のフラグを戻さず（スケルトンが点滅しない）、KR一覧・月（1クエリ）・開いているKRの週/メモ/紐づけ・全体タブだけを取り直す。他のKRは詳細の読み込み済み印を外して次に開いたとき取り直す。ゲスト・未読み込みなら何もしない。

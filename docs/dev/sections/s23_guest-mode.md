## 23. ゲスト（サンプル閲覧）モードの設計（必須・v3.28、v3.29でAI限定開放を追加、v3.30で回数制限の可用性バグを修正、v3.31で回数の明示UIを追加、v3.32でオンボーディングツアーの破綻を解消）

### 2026-08-06に判明した旧実装の欠陥

Phase 1（`src/lib/guestMode.ts`）で作った「ゲスト」は、実際には**到達不能な死んだコード**だった上、仮に到達できても**ゲストに実部署の業務データが全部見えてしまう**構造だった。理由：
- 入口（`UserSelectScreen.tsx`）の表示条件（`members.length > 0`）と到達条件（Auth email 一致の `autoMatch()` が不成立）が、どちらも「RLSがメンバーとして認識するか」に依存する同一条件のため構造的に両立しなかった。
- ゲストは独立した権限主体ではなく、ログイン済み実ユーザーのセッションに被せた見た目だけのペルソナ。書き込みブロックは `from(table)` の insert/update/upsert/delete だけを対象にしており、**select（読み取り）・rpc・functions.invoke・storage は素通り**していた。RLSは自部署の実データをそのまま返すため、読み取りを許すとゲストに実業務データが全部見えてしまう。

### 現在の設計（この前提を崩す変更を入れないこと）

**ゲストはSupabaseに一切接続しない。** これが「実部署のデータをゲストに見せない」ことの唯一の安全性の根拠。読み取りだけを許して「必要なテーブルだけ絞る」といった中間案は取らない（絞り漏れが必ず起きる。原則全部止める方が構造的に安全）。

- **入口**：`LoginScreen.tsx` の「サンプルを見る」ボタン。Supabase Authのサインインは行わない（アカウント不要）。押すと `App.tsx` の `handleGuestEnter` が `setGuestMode(true)` → `src/lib/demo/loadDemoDataset()`（動的import）でサンプルデータを取得 → `appStore.loadDemoData()` でストアへ直接注入 → `guestActive` フラグをtrueにして `MainLayout` を直接表示する。**`AppDataProvider`（Supabase `load()`・realtime購読）の配下には一切置かない**（`App.tsx` の分岐が `authenticated` 判定より前に `guestActive` を見る）。
- **choke point**：`src/lib/supabase/client.ts` の `supabase` Proxy が `assertGuestBlocked()` という単一の関数で `from()`（読み書き両方）・`rpc()`・`functions.invoke()`・`storage.from()` の全経路をブロックする。新しい経路を追加してもこのProxyの `get` トラップを通る限り自動的に塞がれる。
- **サンプルデータ**：`src/lib/demo/dataset.ts`。全エンティティの id は `demo-` 接頭辞、`group_id` は `DEMO_GROUP_ID`（`grp-demo`）で統一（`__tests__/dataset.test.ts` が機械的に検証）。実在の顧客名・PJ名・人名は使わない。動的importでのみ読み込む（Section 19：通常利用者はダウンロードしない）。
- **ゲスト自身の担当タスク**：マイページ既定ウィジェット（今週のタスク／自分のワークロード）を空にしないため、`src/lib/demo/guestPersona.ts` がランタイム専用の後処理として `GUEST_MEMBER`（`id: "__guest__"`。既存の `guestMode.ts` の定数）を members に追加し、`GUEST_ASSIGNED_TASK_IDS`（`constants.ts`）に該当するタスクの担当者をゲストへ付け替える。`dataset.ts` 自体の出力（`buildDemoDataset()`）は「全id demo-接頭辞」を保ったまま不変。
- **AI機能は今回は使わせない**：`invokeAI.ts` / `apiClient.ts`（`callAIConsultation`）の先頭でゲストなら明示的なエラー（`common.guest.aiBlocked`）を投げる。`client.ts` の `functions.invoke` ブロックが二重の防衛線になる。
- **UI側の編集制限**（従来どおり）：`isGuestMember(currentUser)` で `MainLayout.tsx` 等が設定・FAB・作成ボタンを非表示にする。この判定は `currentUser.id === "__guest__"` を見るだけなので、ゲストの currentUser は必ず `GUEST_MEMBER` そのものを使うこと（サンプルの実メンバーに currentUser を差し替えない。差し替えるとこのUI制限が効かなくなる）。
- **退出**：既存のログアウト経路（`onLogout` → `App.tsx` の `handleLogout`）をそのまま使う。ゲストは認証セッションを持たないため `signOut()` は実質no-op（`auth-js` はローカルにアクセストークンが無ければネットワーク呼び出し自体をスキップする）。`window.location.reload()` でログイン画面に戻る。

### Phase 3（実装済み・v3.29／v3.30で回数制限の可用性バグを修正）：ゲストへのAI機能限定開放

ゲストにAI機能（相談・分析・レポート生成など既存機能）を、回数制限つきで開放した。**「原則全部止める」という設計の骨格は崩していない**（例外は `functions.invoke("ai-consult")` だけ）。

- **匿名認証は遅延生成**：ゲストの通常操作（サンプル閲覧）は今までどおりSupabaseに一切接続しない。AIを初めて使うときだけ `src/lib/supabase/guestAiAuth.ts` の `ensureGuestAiSession()` が `supabase.auth.signInAnonymously()` でセッションを作る（Edge Functionが有効なJWTを要求するため）。`supabase/client.ts` のProxyは `"auth"` プロパティを一切インターセプトしないため、この呼び出し自体はゲストモードでもブロックされない。
- **choke pointの例外は1つだけ**：`client.ts` の `isGuestInvokeBlocked(functionName)` が `functionName === "ai-consult"` のときだけ `false`（=ブロックしない）を返す。他の関数名・`from()`/`rpc()`/`storage` は Phase 3 でも一切緩めていない。
- **ゲスト判定はJWTの `is_anonymous` クレームだけで行う（サーバー側・クライアントを信用しない）**：`supabase/functions/ai-consult/index.ts` が `auth.getUser()` の戻り値の `user.is_anonymous` を見る。クライアントから送られたフラグは一切見ない（偽装できるため）。
- **回数制限はDBで原子的に強制（v3.30で条件付き加算に修正）**：
  - `guest_ai_usage_daily`（ブラウザ別＝匿名Authユーザー別・日次）／`guest_ai_usage_global_daily`（全ゲスト共通・日次）の2テーブル（`supabase/migrations/20260807_add_guest_ai_quota.sql`）。
  - **【v3.29の欠陥・修正済み】** 初版の `consume_guest_ai_quota()` は「無条件で両方のカウンタをインクリメントしてから事後判定する」設計だった。このため**拒否されたリクエストも全体枠を消費してしまい、1ブラウザが上限（3回）を超えて何度も押すだけで全体枠（10回/日）を1人で食い潰せる**可用性バグがあった（コストは守られていた＝拒否された試行はAnthropicを呼ばないため課金は発生しない。壊れるのは可用性のみ）。本番適用前のレビューで発見し、マイグレーションファイル自体を直接修正した（新規マイグレは追加していない）。
  - `consume_guest_ai_quota(p_anon_user_id, p_browser_limit, p_global_limit)` は「**上限未満のときだけ加算する条件付き加算**」を担う SECURITY DEFINER 関数。`INSERT ... ON CONFLICT DO UPDATE ... WHERE call_count < 上限` の形で、上限に達していれば `RETURNING` が0行（=NULL）になり判定できる。判定と加算を同一SQL文に閉じているため、別クエリに分けた場合のTOCTOUレースは発生しない。全体枠を先に条件付きで加算し、それが通ってからブラウザ別枠を条件付きで加算する。**ブラウザ別枠で拒否された場合は、直前に加算した全体枠を同一トランザクション内で必ず1減算して取り消す**（拒否されたリクエストがどちらのカウンタも消費しないための補償）。全体枠で拒否された場合はブラウザ別枠に一切触れていないため補償は不要。拒否理由の優先順位は「全体枠切れを優先して伝える」を維持（このブラウザ自身は個人枠内でも、実際は共有枠が尽きているのに「あなたが使い切った」と誤案内しないため）。`authenticated`/`anon` にはEXECUTEを渡さず `service_role` だけが呼べる（ゲストが直接叩いて全体枠を食い潰す経路を作らないため）。
  - **しきい値の数字は `supabase/functions/ai-consult/index.ts` の定数1箇所**（`GUEST_AI_PER_BROWSER_DAILY_LIMIT`＝既定3・`GUEST_AI_GLOBAL_DAILY_LIMIT`＝既定10。環境変数で上書き可）で管理し、RPC呼び出し時に引数としてSQL側へ渡す。SQL側には数字を一切埋め込まない。
  - `supabase/functions/ai-consult/guestQuota.ts` の `simulateConsumeGuestAiQuota()`（Deno/ブラウザ依存の無い参照実装）は、SQL関数と手順を1対1で対応させたテスト専用のミラー。**本番の判定経路ではない**（本番の判定・加算は `consume_guest_ai_quota()` の中で完結しており、Edge Functionはその戻り値 `allowed`/`reason` をそのまま使うだけ）。このリポジトリのテスト環境（Vitest/Node）では実際のPostgresを起動してSQL関数を直接検証する手段が無いため、この参照実装で境界値・拒否時の非消費・補償をテストで固定している（SQL側を変更したらこの参照実装とコメントも必ず一緒に見直すこと）。
  - 個人上限超過は `GUEST_DAILY_LIMIT_EXCEEDED`（「サンプルでのAI利用は1日◯回までです」）、全体上限超過は `GUEST_GLOBAL_LIMIT_EXCEEDED`（「本日のサンプルAI利用枠が上限に達しました」）と、別のエラーコード・別の文言で区別する（`apiClient.ts`/`invokeAI.ts` がそれぞれ `AIError`/`Error` に変換して日本語メッセージまで通す）。上限到達時はAIのみ停止し、サンプルの閲覧は継続できる。
- **既存の認証ユーザー向けレート制限は無変更**：Edge Function内メモリの「認証ユーザーごと20回/分」はそのまま残っており、匿名ユーザーにも同様に適用される（ゲスト回数制限とは独立の別レイヤー）。
- **ゲストのAI利用の管理者への可視化**：`ai_usage_logs` に `is_guest` 列を追加し、Edge FunctionがサービスロールでAnthropic応答成功後に `member_id="__guest__"`・`is_guest=true` の1行をINSERTする（クライアントからのINSERTは`from()`ブロックで常に失敗するため、この経路が唯一の記録手段）。管理画面「AI使用量」タブ（`AdminView.tsx` の `AIUsageSection`）に「🧪 ゲスト（サンプル利用）」の全期間合計行を表示する（部署の絞り込みは適用しない。ゲストはどの部署にも属さないため）。
- **併せて是正した既存ドリフト**：`ai_usage_logs` にはINSERT用ポリシーが本番に存在するが一度もマイグレーション化・`schema.sql`化されていなかった。同マイグレーションで明文化した（本番への実害は無し。参照用DDLの是正）。

### 回数の明示UI（v3.31・使う前に上限を伝える）

上限到達後にエラーで初めて知る状態を避けるため、AIを**使う前に**「1日◯回まで」を明示する。

- **表示は参考値・強制は今までどおりサーバー側だけ**という関係は崩さない。`src/lib/guestAiQuotaCounter.ts`（localStorageベースの利用回数カウンタ）は表示専用で、DBへの問い合わせ・RPC・`functions.invoke`は一切行わない（ゲストがSupabaseに接続しない設計を崩さないため）。実際の制限判定は引き続き `consume_guest_ai_quota()`（SQL）が行う。
- **加算ポイントは2箇所**：`src/lib/ai/invokeAI.ts` と `src/lib/ai/apiClient.ts`。どちらも AI 呼び出しが**成功したときだけ** `recordGuestAiUse()` を呼ぶ。429（`GUEST_DAILY_LIMIT_EXCEEDED`/`GUEST_GLOBAL_LIMIT_EXCEEDED`）や他のエラー時は加算しない。
- **表示コンポーネントは `src/components/common/GuestAiQuotaNotice.tsx` 1つ**（banner/inlineの2バリアント）。ゲストでないときは常に null を返すため、呼び出し側は分岐を書かずに置くだけでよい。設置箇所は4つ：`MainLayout.tsx`（既存ゲストバナー内）・`ConsultationPanel.tsx`（相談パネルのタブ説明バー内）・`ProjectKarte.tsx`／`DashboardView.tsx`（PJ分析実行ボタン付近）。加えて `LoginScreen.tsx`（`auth.guest.desc`）で入る前にも回数を明示する。**ボタンの無効化はしない**（クライアント側の参考値だけで誤って締め出すと、サーバー側ではまだ枠が残っているのに使えなくなる事故が起きるため）。
- **上限値の二重管理に注意**：`GUEST_AI_DAILY_LIMIT`（`guestAiQuotaCounter.ts`）は `supabase/functions/ai-consult/index.ts` の `GUEST_AI_PER_BROWSER_DAILY_LIMIT`（環境変数で上書き可）と別々の場所にハードコードされている。環境変数で上限を変更した場合、この表示用の定数を直さないと表示だけがズレる（強制自体は正しく動き続ける）。上限を変えるときは両方直すこと。
- **テスト容易性**：`vitest.config.ts` が `environment: "node"` のため localStorage が無い（`chunkSizeGate.ts` と同じ制約）。`guestAiQuotaCounter.ts` は日付跨ぎ・加算・下限クランプの判定を `resolveGuestAiUsedCount`/`resolveGuestAiRemaining` という純粋関数に分離してテストする。`GuestAiQuotaNotice` も同じ理由で `useT()` フックを使わず、`useLangStore.getState()` + `translate()` の「素の関数」方式（`invokeAI.ts` の `tOutside` と同じ流儀）にしている（Reactレンダラー無しで直接呼び出してテストするため）。

### ゲストのオンボーディングツアー（v3.32・破綻を解消）

`TourProvider` は `MainLayout` の内側にあり、ゲストの描画経路（`App.tsx` の `guestActive` 分岐 → `MainLayout`）も通るため、ツアー機能自体はゲストでも動く。完了フラグは `localStorage`（v3.138以降はメンバーID別の `tour_completed_v1:<memberId>`。ゲストは固定の `tour_completed_v1:guest`。Section 65）のためSupabase非接触の設計とも衝突しない。一方、ツアー定義（`first-time.ts`）はログイン済みの実ユーザーを前提に書かれており、そのままゲストに出すと2つの実害があった。

- **`fab` ステップ**：右下＋ボタン（FAB）の説明だが、ゲストではFABが非表示。`target` を持たない中央表示ステップのため `skipIfMissing` が効かず（`TourProvider.tsx` の `findTarget` は `target` 未指定なら常に `null` を返す＝`skipIfMissing` はターゲット付きステップにしか意味を持たない）、「存在しないボタン」の説明がそのまま出てしまっていた。
- **`ai-consult-demo` ステップ**：`action: "demo-ai-consult"` で実際にAI相談を1回送信する実演。ゲストのAI利用は1日3回（Section 23上部参照）のため、ツアーを最後まで見るだけで枠を1回消費してしまっていた。

**解決方針**：`src/components/tour/tours/index.ts` の `buildTours({ isGuest })`（純粋関数）が、`isGuest=true` のときだけ `firstTimeTour` の複製を作り直す。

- `fab` ステップを配列から除去する。
- `ai-consult-demo` ステップは `action`・`target` を持たせず `placement: "center"` の説明のみステップに差し替える（実演を無くすと `target: "ai-panel"` が開かれないため見つからず消えてしまう＝`skipIfMissing` に任せると何も表示されなくなる。中央表示にして必ず出す設計にした）。内容は「AIには自分で相談できること」「サンプルのAI利用は1日3回まで」の2点。
- `welcome` ステップの本文に「表示されているのは架空のサンプルデータである」旨を1行加える。
- `firstTimeTour`（モジュールレベル定数）自体は書き換えない。新しい配列・新しいオブジェクトを都度組み立てて返すため、通常ログインユーザー（`isGuest=false`。`ALL_TOURS` をそのまま返す）には一切影響しない。

`MainLayout.tsx` は `useMemo(() => buildTours({ isGuest: isGuestMember(props.currentUser) }), [props.currentUser])` で `tours` を組み立てて `TourProvider` に渡す（毎レンダーで新しいオブジェクトを作らないことで `TourProvider` 内の `useCallback` の作り直し＝不要な再レンダーを避ける）。`TourProvider.tsx` 本体・`skipIfMissing` の仕組みは変更していない（ツアー定義側だけで解決できたため）。回帰防止テストは `src/components/tour/tours/__tests__/buildTours.test.ts`。

### ゲストのOKRモード体験（v3.67・2026-08-12）

山本さんの依頼：「ゲストモードから、OKRモードを体験できるようにもしてください」。個人OKR（Section 24）の全機能（KRタブ・今月の計画・週の目標状態・これから・AIパネル）をゲストにも開放した。**AI機能まで含めて全部体験できるようにする、という山本さんの決定**に基づく。

- **導線**：サイドバー／モバイルヘッダーの「計画／OKR」切替（`AppModeToggle`）は元々 `isGuest` で分岐していなかった（ゲストでも常に表示済み）。OKRモードの初回ゲート（`okrModeGate.ts`・Section 19 ⑥）もゲストは元々対象外（Supabase非接触のため承認を求める意味が無く直接入る）。**この2点はどちらも変更不要**（既存の設計で既に正しく動いていた）。
- **🔴 実装方針＝ストア側にゲスト分岐。`client.ts` のProxyは1文字も緩めていない。** `personalOkrUiStore.ts` の各アクション（`loadKrs`/`ensureKrDetailLoaded`/`ensureWeekTasksLoaded`/`saveKr`/`deleteKr`/`saveMonth`/`saveWeek`/`saveMemo`/`deleteMemo`/`linkWeekTask`/`unlinkWeekTask`/`ensureOutlookLoaded`）が先頭で `isGuestMode()` を見て、ゲストなら低レベルCRUD（`lib/supabase/personalOkrStore.ts`）を一切呼ばずstateだけを更新する（メモリ上でのみ成立・リロードで消える）。`loadKrs`はゲストのとき`src/lib/demo/personalOkrDataset.ts`（動的importのみ・Section 19）からサンプルデータを注入する。
- **サンプルデータ**：個人KR3本（KR1はグループOKR側サンプル（Section 8のdataset.ts）のTF「基幹システム更新TF」に紐づく`kr_kind="group_kr"`・KR2/KR3は`general`/`company_common`）・ウェイト合計100%。当月＋前月（今日の日付から動的計算。今日が四半期の1か月目のときは当月のみ）の月次計画。週の目標状態は「現在の週より前は評価済み（◯△✕混在）・現在以降は未評価」で機械計算（残り週数・評価待ちの週）が意味を持つデータにした。メモ計4件。週とタスクの紐づけは`dataset.ts`の実在タスク（ベースライン遅延1件・先行待ち1件）を参照し、AheadBlockの「紐づくタスク：遅延・先行待ち」表示も空にならないようにした。実在の顧客名・PJ名・人名は使わない（既存`dataset.ts`と同じ規約。id接頭辞`demo-`）。機械チェックは`src/lib/demo/__tests__/personalOkrDataset.test.ts`（規模・id接頭辞・静的import禁止・dataset.ts側タスクidとの整合性）。
- **AI機能はそのまま開放されていた**：`invokeAI.ts`は`AIIntent`の値を一切見ず、ゲストなら匿名セッションを遅延生成して`ai-consult`を素通しする汎用実装（Phase 3・v3.29から変更なし）。そのため「✦ 見立てを出す」（`runOutlookAnalysis`・intent=`okr-personal-outlook`）とAIパネル（`PersonalOkrAiPanel`・intent=`okr-personal-chat`）は**コード変更なしでゲストでも動く**。🔴 唯一の追加対応は解析結果の保存先：`personal_kr_outlooks`にはゲストは書けないため、`runOutlookAnalysis`は`insertPersonalKrOutlook`の呼び出しだけをゲスト分岐でスキップし、結果はstateへメモリ保持する（AI呼び出し自体・`ensureOutlookLoaded`のfingerprint比較ロジックは非ゲストと共通）。
- **ゲストのAI使用量は既に計上される**：`ai-consult`Edge Functionの`user.is_anonymous`分岐は`body.intent`をそのまま`consultation_type`に使う汎用実装のため、`okr-personal-outlook`/`okr-personal-chat`も追加コード無しで管理画面「AI使用量」タブの「🧪 ゲスト（サンプル利用）」に計上される（Section 23参照）。
- **回数表示（`GuestAiQuotaNotice`）**：`AheadBlock.tsx`（「✦ 見立てを出す」ボタンの隣）と`PersonalOkrAiPanel.tsx`（タブ説明バー内）に`variant="inline"`で設置。ゲストでなければnullを返す既存コンポーネントのため呼び出し側に分岐は書いていない。
- **「保存されません」の明示**：全画面共通のゲストバナー（`layout.guestBanner`）は、v3.69で日常編集を開放したことに合わせて文言を「編集はできません」から「編集した内容はこのブラウザでのみ有効です。再読み込みすると元に戻ります。」に変更した。OKRモードの「自分」タブだけは今も別文言（`layout.guestBannerOkr`＝「この画面の入力は保存されません（画面を閉じると消えます）」）に切り替える（`appMode==="okr"`のときだけ）。新しいダイアログは追加していない（Human in the loopの原則どおり、常設の一言で足りると判断）。
- **機械チェック（`client.ts`のProxyを緩めていないことの固定）**：`src/lib/supabase/__tests__/client.test.ts`に、`GUEST_ALLOWED_FUNCTIONS`のSetリテラルを`client.ts`から直接ソース走査し`["ai-consult"]`以外を許さないテストを追加した（`modalStyles.test.ts`と同じ「ソースを読んで検査する」方式）。次に誰かが安易に例外を増やせないようにする固定。
- **ゲスト分岐の回帰テスト**：`src/stores/__tests__/personalOkrUiStore.test.ts`が、ゲストのとき低レベルCRUD（`personalOkrStore.ts`）が一切呼ばれないこと・AI呼び出し（`analyzePersonalKrOutlook`）は素通しされること・`insertPersonalKrOutlook`は呼ばれないこと・非ゲストの既存経路が変わっていないことを検証する。
- **Kintone取込（`PersonalOkrImportModal`）もコード変更なしでゲストで動く**：`saveKr`/`saveMonth`を経由するため、上記のストア分岐にそのまま乗る（AI抽出＝intent`okr-personal-import`も`invokeAI.ts`が汎用開放しているため素通しする）。今回の依頼範囲外だが、副次的に動作する（Supabase非接触の原則は崩していない）。

### ゲストの日常編集の開放（v3.69・2026-08-12）

山本さんの依頼：「編集もできるようにしてほしい。編集結果はその接続セッションでしか保存されず、リロード後はリセットされるようにしてほしい。編集の使い勝手を見てもらいたい」。対象は日常編集（タスクの追加・編集・削除・ステータス変更／カンバンD&D／ガントのバー操作／PJの作成・編集／マイルストーンの追加・編集・削除／AI提案の反映）。設定画面（`AdminView`）配下は対象外のまま。

- **🔴 `client.ts`のProxyは1文字も緩めていない。** 方針はv3.67の`personalOkrUiStore.ts`と同じ：保存処理の入口（`appStore`の各アクション・`applyProposal.ts`・`undoApply.ts`）に`isGuestMode()`分岐を入れ、Supabaseを呼ばずメモリ上のstateだけを更新する。
- **appStoreの書き込み系アクション**：`saveTask`（choke point本体は無改修。B1依存ゲート・B4ベースライン捕捉・親自動完了・B3自動リスケ連鎖の判定・実行はDB呼び出しより前後にあるため、DB呼び出しだけを分岐してもゲストにそのまま効く）・`deleteTask`・`restoreTask`・`saveProject`・`deleteProject`・`saveMilestone`・`deleteMilestone`・`addTaskDependency`（B1循環チェック等は分岐の前段にあるため無改修で効く）・`removeTaskDependency`・`addTaskTaskForce`/`removeTaskTaskForce`・`addTaskProject`/`removeTaskProject`（タスク編集モーダル／サイドパネルのTF・PJ関連付け欄）が、DB呼び出し（`upsertX`/`softDeleteX`/`insertX`/`deleteX`）をスキップしローカル生成の`updated_at`でstateだけ同期する。`addProjectTaskForce`/`removeProjectTaskForce`はAdminView専用（開放範囲外）だが型を揃えるため防御的に同様の分岐を追加した（実際には到達しない）。
- **楽観ロック**：`saveWithLock`が返すDB側の実`updated_at`（Section 5・トリガー適用後の値）の代わりに、ゲストはクライアント生成の`new Date().toISOString()`をstore同期に使う。ゲストは単独利用のため他者との競合は起きず、`ConflictError`が誤って投げられる心配は無い。
- **AI提案の反映（`applyProposal.ts`）・Undo（`undoApply.ts`）**：この2ファイルは元々`appStore`のchoke pointを経由せず`supabase.from(...)`を直接呼ぶ実装（実ユーザーでも同じ・Section 6-10）。ゲストのときは`src/lib/ai/guestApplyStore.ts`（新規）の直接state操作（`guestGetTask`/`guestGetProject`/`guestPatchTask`/`guestPatchProject`/`guestPatchProjectTasks`/`guestInsertTask`/`guestInsertProject`/`guestActiveMembers`/`guestMemberShortName`）に分岐する。`appStore`のアクションは呼ばない（実ユーザーの直接UPDATE/INSERTと完全に同じ「対象フィールドだけの更新」に揃えるため。B1/B4等は元々AI提案の反映では実ユーザーも通っていない）。
- **UI開放の判定を集約**：`src/lib/guest/guestCapability.ts`の`canGuestEdit(isGuest, target)`（`GuestEditTarget`＝`task`/`kanban`/`gantt`/`project`/`milestone`/`aiApply`/`adminSettings`）。ゲストに何を出すかの判定を1箇所にまとめた純粋関数（非ゲストは常にtrue・ゲストは許可Setのtargetだけtrue）。`MainLayout.tsx`のFAB・`CommandPalette`の`canCreate`・`src/lib/project/projectRowMenu.ts`（サイドバーPJ行の「⋮」）がこれ経由に変わった。タスク編集モーダル・サイドパネル・カンバン・ガント・マイルストーンモーダルは元々`isGuest`のUI側ガードを持たず`appStore`のアクションを呼ぶだけだったため、appStore側の分岐だけで動くようになった（UI側の変更は不要と確認済み）。
- **バナーとリセット**：ゲストバナー（計画モード）は「編集した内容はこのブラウザでのみ有効です。再読み込みすると元に戻ります。」に変更（です・ます調）。バナー内に「↺ サンプルを初期状態に戻す」ボタンを追加：`confirmDialog()`（`window.confirm`ではない）で確認後、`loadDemoDataset()`を再実行して`appStore.loadDemoData()`に注入する（デモデータのidは固定なので、開いたままのモーダル等が壊れることはない）。OKRモード「自分」タブのゲストデータ（`personalOkrUiStore`）は今回の対象外のため、ボタンは`appMode==="plan"`のときだけ表示する。

---

---

### v3.181：`channel`／`removeChannel` も choke point で止める（M73）

`supabase/client.ts` の Proxy は `from`・`rpc`・`functions.invoke`・`storage.from` に加えて `channel`・`removeChannel` も `assertGuestBlocked()` で止める。ゲストでは `blockedChannel()`（`on`／`subscribe`／`unsubscribe`／`send` は自分を返し、`subscribe` のコールバックは呼ばない＝SUBSCRIBED は永久に来ない）と `Promise.resolve("ok")` を返し、実クライアントにチャンネル・WebSocket を作らない。呼び出し元（`realtime.ts`・`notificationRealtime.ts`）はゲストでは元々動かない設計だが、分岐が崩れたときの二重防御になる。`client.test.ts` に「ゲストで `channel()` を呼んでも `getChannels()` が増えない」を追加（修正前のコードで赤を確認）。

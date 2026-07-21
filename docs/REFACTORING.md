# リファクタリング記録・ガイド

> このファイルはどのPCのClaude Codeからも参照できるよう、リポジトリで管理しています。
> セッション開始時に「リファクタリングをしたい」と言われたら、このファイルを読んでください。

---

## セッションルール（毎回必ず守る）

1. **作業前に `git pull` してからリファクタリングを開始する**（コンフリクト防止）
2. **1ファイル or 1テーマずつコミット → プッシュ**（コンフリクトリスク分散）
3. **変更のたびに `npx tsc --noEmit` でエラーゼロを確認**
4. **高リスク項目（H1・H4）は手をつけない**

---

## 巡回台帳（2026-07-21新設）

[`docs/dev/module-map.md`](./dev/module-map.md) の13ユニットを行に持つ台帳。コード規模が大きくなり
一度に全部は点検できないため、「いつどのユニットを最後に点検したか」を記録し、時間のあるときに
最も点検が古いユニットから巡回する運用にする。

**「最終点検日」は"リファクタ観点で人間かAIが技術的負債を洗い出した日"**（機能追加で触っただけの日とは区別する）。
下表の日付は `git log` と本ファイルの「完了済み」欄を突き合わせて確認したもの（推測ではない）。

| ユニット | 最終点検日 | 最終リファクタ日 | 規模感（主要ファイル行数目安） | 既知の課題（既存の中優先度/低優先度/高リスク表と相互参照） | 備考 |
|---|---|---|---|---|---|
| App Shell | 2026-07-06 | 2026-07-06（`63259ab`App.tsxフック順序・`aa554e8`MainLayoutモバイルラボa11y修正） | 約2,290行（App/main/MainLayout） | 既存表になし | 07-06以降はNAV_ITEMS追加（workload等）等の機能追加のみで点検は入っていない |
| 認証・入口 | 2026-07-21 | 2026-07-21（12回目：SetupWizardのエラー握りつぶし修正＋Supabase移行前の死んだ「デモ版」バナー修正） | 約950行（LoginScreen/SetupWizard/UserSelectScreen/guestMode計） | M25（新規テナント初回メンバー作成のRLSブートストラップ欠落・要設計判断）／M26（LoginScreenの汎用エラーメッセージ・セキュリティとのトレードオフにつき要判断）／M27（docs/guides内の認証関連ヘルプがSupabase Auth導入前の記述のまま） | 12回目巡回で全体点検完了。マルチテナンシー・is_admin/is_super_admin導入後の整合性を精査した結果、SetupWizardの新規メンバー作成にgroup_idが一切設定されない設計上の欠落を発見（M25として記録・修正は見送り） |
| A 計画ビュー | 2026-07-07 | 2026-07-07（`ListView`のborder幅reflowバグ根本修正）／2026-07-06（M11ロールアップ集約`5feb485`） | 約11,930行（dashboard/gantt/kanban/list/task/milestone/workload計） | M9 TaskCard共通化（高難度・未着手）／M12 スタイル定数共通化（要設計判断） | **2026-07-17〜19に依存関係(B1-B4)・ワークロード・ガント/ダッシュ/リスト/カンバン刷新が集中投入され、点検日以降の増分が最大**。次点検の最有力候補 |
| B AI相談 | 2026-07-06 | 2026-07-06（`69b5e52`exhaustive-deps実バグ修正／`d523586`未使用変数スイープ） | 約2,919行 | M10 ConsultationPanel整合性再確認（低優先） | — |
| C 会議読み込み | 2026-07-06 | 2026-07-06（a11yスイープでMeetingImportPanelのドロップゾーン対応） | 約1,448行 | 既存表になし | 技術的負債の専用点検は未実施（a11y横断調査で軽く触れたのみ） |
| D OKR | 2026-07-21 | 2026-07-21（11回目：`quarterPlanStore.ts`の未使用export`finalizeQuarterPlan`を削除＋TF四半期割り当てに関する古いガイド記述6ファイルを実態（TaskForce.quarter列＋クォータータブ）に合わせ修正）／2026-07-21（10回目：`KrJointSessionFlow.tsx`保存進捗バーの合計値off-by-oneを修正＋`krSessionExtractor.ts`の単一KRモード廃止後に死蔵していた抽出関数2件を削除＋関連ユーザー向けガイド3件の「単一KRモード」記述を実態に合わせ更新）／2026-07-21（9回目：`KrWhyPanel.tsx`の未使用必須Props`currentUser`を`_currentUser`にリネームし意図を明記）／2026-07-21（8回目：`KrReportPanel.tsx`のTeams送信エラー表示をformatErrorForUserに統一＋`krReportClient.ts`の死んだ`usage`フィールドを削除）／2026-07-21（7回目：`OkrDashboardView.tsx`のKrSessionHistory保存/削除エラー握りつぶしを修正＋死んだ`urgent`フラグ除去）／2026-07-21（6回目：`krMeetingNoteStore.ts`の正規表現エスケープバグ＋JSDoc乖離を修正）／2026-07-21（5回目：KR分析AIの死んだプロンプト段落`linked_pj_names`を削除） | 約7,562行（okr/lab計） | 既存表になし | **D OKRユニット全体（約7,562行）を5〜11回目の巡回（7セッション）で分割点検完了。** 週次循環ワークフロー①会議ノート・②セッション記録＆分析・③分析・④レポート作成・なぜなぜ分析・クォーター計画の全サブ領域をカバー。未修正のまま残置した既知課題（設計判断が要るため次回候補）：`okrAnalysisStore.ts`の未使用export2件・非効率取得1件（5回目発見）／`krMeetingNoteStore.ts`の`softDeleteKrMeetingNote`未使用export（6回目発見・M21）／`OkrDashboardView.tsx`のfreeformセッション編集モード未対応（7回目発見・M22）／`krReportStore.ts`の`softDeleteKrReport`未使用export（8回目発見・M23）／`appStore.ts`の`quarterlyKrTaskForces`state・`addQuarterlyKrTaskForce`/`removeQuarterlyKrTaskForce`アクション・`store.ts`の対応するSupabase関数が2026-05-26のTaskForce.quarter列移行後、呼び出し元0件のまま丸ごと死蔵（11回目発見・M24。DBテーブル自体を残すか含め設計判断＋テーブルdrop要否の検討が必要なため未着手） |
| E PJ別AI分析 | 2026-07-21 | 2026-07-21（死んだプロンプト段落を削除） | 約317行 | 既存表になし | 初回巡回実施。小さい実害のある死蔵コード1件を修正。DashboardViewのポートフォリオ分析（assignee_loads集計）がcomputeWorkload.tsの負荷集計と似た計算を再実装している重複はM17として次回候補へ記録 |
| F 管理・設定 | 2026-07-19 | 2026-07-19（v2.63〜67 AdminView刷新：Card/DangerZone抽出・色トークン化） | 約3,270行（AdminView.tsx単体） | **H1（AdminView.tsx完全分割）は保留のまま現存・触らない** | 見た目/構造の刷新は完了したが、H1本体（機能分割）は未着手のまま |
| G オンボーディング | 2026-07-21 | 2026-07-21（ガイドトップのAI紫グラデーションをトークン化・ツアー2ステップにskipIfMissing付与） | 約1,117行（tour/guide計） | M19（統合ツアーが11ステップでtour-guidelines.md §9の上限7〜9を超過。次回候補）／M20（タイトル絵文字の付け方が3ステップで基準§4からズレ。次回候補） | 4回目巡回で点検。台帳上「未点検」だった最後の1ユニット。小さい実害のある2件を修正、ツアー本文の構成変更を伴う2件はM19/M20として次回候補へ |
| H グラフ | 2026-07-21 | 2026-07-21（凡例クリックの再レンダー漏れを修正） | 約790行（GraphView.tsx） | M16（Realtime更新でpan/zoom/凡例絞り込み/ピン留め位置がリセットされる。次回候補へ記録） | 初回巡回実施。小さい実バグ1件を修正、大きめの1件は設計判断が要るためM16として記録 |
| I 通知 | 2026-07-21 | 2026-07-21（未使用select列`status`を削除） | 約390行（フロントhook+Edge Function） | M18（`notify_pref="teams"`が実質dead。次回候補へ記録） | 3回目巡回で点検。小さい実害の薄い1件を修正。Edge Function側（`supabase/functions/notify-deadlines`）はgit push対象外・個別デプロイ運用の点に注意（今回の修正も要手動デプロイ） |
| データ基盤 | 2026-07-06 | 2026-07-06（M11ロールアップ集約・taskHierarchy統合）／2026-07-03に参照安定性バグ実修正（zustandセレクタのメモ化漏れ） | 約3,426行 | OKR系テーブルのRLS未分離（マルチテナンシー残課題・別トラック管理） | v2.29〜32で依存関係/ベースラインstateが追加され複雑度上昇 |
| AI基盤 | 2026-07-21 | 2026-07-21（13回目：`invokeAI.ts`のRATE_LIMIT_EXCEEDED生コード表示バグ修正＋未使用`sanitizeTaskComment`削除＋AIIntentコメント/CLAUDE.md乖離修正） | **約785行**（module-map.md定義の`lib/ai/{invokeAI,apiClient,usageLog,sanitize,types,uiGuide}.ts`＋Edge Function`ai-consult/index.ts`のみ。旧「約5,262行」は`lib/ai/`ディレクトリ全体＝B/C/D/E/F等他モジュール所属ファイルも含めた行数で、AI基盤単体の値ではなかった＝規模感の誤記を訂正） | ai-consultの`max_tokens`上限（2026-07-02追加）は**再デプロイ済みと判明**（`supabase functions list`のversion 13・updated_at 2026-07-02T05:23:54Z＝コミット直後、`supabase functions download`との差分0で確認。旧残課題は解消済みとして削除）。M28（`uiGuide.ts`の`FEATURE_LIST_SECTION`がv2.28以降の大型機能追加（ワークロード/依存関係/ショートカット/保留・中止ステータス等）に追従できておらずAIの自己紹介が陳腐化。CLAUDE.md Section 17のチェックリスト運用が徹底されていない実例。次回候補） | 13回目巡回で全体点検完了。CORS（`ALLOWED_ORIGINS`）・レート制限（`RATE_LIMIT_PER_MIN`既定20）はSupabase側`secrets list`で設定済みを確認（Section 18準拠） |
| 共通UI | 2026-07-17 | 2026-07-17（v2.33・`createPortal`系の全数調査＋pointer-events漏れ修正） | 約3,120行 | 既存表になし | 新規追加のCard/DangerZone/ShortcutsPanel/CommandPalette等は追加時の点検のみで専用のリファクタ点検は未実施 |
| ユーティリティ/フック | 2026-07-06 | 2026-07-06（taskHierarchy統合・未使用変数スイープ） | 約2,042行（lib直下+hooks直下） | L3 Task.comment型統一（低優先・確認のみ） | selectionRange/kanbanOrder/groupSummary等の新規ファイルはA計画ビュー側の実装として分類（本行の対象外） |

### 巡回ルール
- 次にどのユニットを触るか迷ったら、台帳で「最終点検日」が最古（または「未点検」）のユニットを優先する
- 1セッションにつき原則1ユニット、トークン予算20〜30k厳守（既存ルールを踏襲）
- 触った後は必ず台帳の該当行（最終点検日・最終リファクタ日・備考）を更新してからコミットする
- 高リスク項目（既存表のH1・H4）は台帳経由でも変わらず触らない

---

## 完了済み（2026-07-21）巡回台帳の13回目の巡回：AI基盤（ユニット全体）

12回目終了時点で台帳を精査した結果、「AI基盤」（最終点検日2026-06-26）が全ユニット中最古と判明したため選定。
`docs/dev/module-map.md`定義の`lib/ai/{invokeAI,apiClient,usageLog,sanitize,types,uiGuide}.ts`＋Edge Function
`supabase/functions/ai-consult/index.ts`（実測合計785行）を1セッションで全体点検。

**規模感の訂正**：台帳の旧記載「約5,262行」は実際には`lib/ai/`ディレクトリ全体（27ファイル・5,163行＋Edge
Function）の行数だった。module-map.mdの定義上、`payloadBuilder`/`systemPrompt`/`applyProposal`/
`krSessionExtractor`等はB（AI相談）・D（OKR）・C（会議読み込み）・E（PJ別AI分析）・F（管理・設定）の
各モジュール所属ファイルであり、AI基盤（AI呼び出しの唯一のゲート＋使用量計上）としての対象範囲ではない。
実測785行は1セッション予算（700〜1,800行）に収まったため、サブ領域分割はせず一度に全体点検した。

| 項目 | 内容 | コミット |
|------|------|---------|
| **実バグ：invokeAI.tsのRATE_LIMIT_EXCEEDED生コード表示** | Edge Functionはレート制限超過時に`{error:"RATE_LIMIT_EXCEEDED", message:"1分あたりの利用上限に達しました…"}`を返すが、`invokeAI.ts`の`extractEdgeError`はこのケースを個別処理しておらず`if (d.error) return d.error`のフォールバックで生コード文字列"RATE_LIMIT_EXCEEDED"をそのままユーザーに表示していた（レガシー経路の`apiClient.ts`＝AI相談チャットのみは既に同種の分岐で正しくハンドリング済みだったが、`invokeAI`経由の全AI機能＝kr-report/kr-quarter-plan/meeting-extract/project-analysis/todo-decompose等ではこの不親切な表示が起きていた）。`apiClient.ts`と同じ分岐を追加し修正 | ローカルコミット参照 |
| **未使用exportの削除** | `sanitize.ts`の`sanitizeTaskComment`はテストからのみ呼ばれ、初回コミット（`9aa7eb2`）以来一度も本番コード（`payloadBuilder.ts`）から呼ばれていなかった（本番は`sanitizeComment`を直接インライン呼び出し）。`git log -S`で追加以来の呼び出し元0件を確認し削除 | ローカルコミット参照 |
| **AIIntentドキュメント乖離の修正** | `invokeAI.ts`冒頭のAIIntent一覧コメント（ASCIIアートの箱）とCLAUDE.md Section 6-1bのコード例が、型定義に実在する`"all-projects-analysis"`（E PJ別AI分析・v2.8頃導入）を欠いたままだった。両方に追記して型定義と一致させた | ローカルコミット参照 |
| **max_tokens再デプロイ未実施（既知課題）の解消確認** | `supabase functions list --project-ref`でai-consultの`version:13`・`updated_at`が2026-07-02T05:23:54Z（コミット`614c7a6`の約18分後）であることを確認し、`supabase functions download`で取得した実デプロイ済みソースとローカル`index.ts`を`diff`＝完全一致（0差分）。2026-07-02に`MAX_TOKENS_CAP`追加と同時に既にデプロイ済みだったと判明。台帳の残課題記載を解消として更新 | — |
| **CORS/レート制限の現状確認** | `supabase secrets list`で`ALLOWED_ORIGINS`（設定済み・2026-07-03更新）を確認。`RATE_LIMIT_PER_MIN`は未設定シークレットのためコード既定値20で稼働中（Section 18準拠） | — |

次回候補として記録：M28＝`uiGuide.ts`の`FEATURE_LIST_SECTION`（AIへの機能一覧説明・systemPromptに埋め込まれAIの自己紹介として使われる）が、v2.28（ワークロードビュー）以降に追加された大型機能（タスク依存関係B1-B5・ガントの複数選択/クリティカルパス/進捗フィル/過負荷可視化・全ビュー共通ショートカット・ステータス5値化＝保留/中止等）に一切追従できておらず、AIがユーザーに「できること」を古い機能一覧のまま案内する状態になっている（CLAUDE.md Section 17のチェックリストが機能追加のたびに徹底されていなかった実例）。内容の取捨選択に編集判断が要るため、今回は修正せず次回候補に記録するのみ。

`npx tsc --noEmit`エラー0／`npx vitest run` 421件全通過（新規4件＋既存419件－削除2件）／`npx eslint src`は変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／`npm run build`成功。

## 完了済み（2026-07-21）巡回台帳の12回目の巡回：認証・入口（ユニット全体）

11回目終了時点で台帳を精査した結果、「認証・入口」（最終点検日2026-05-29）が全ユニット中最古と判明したため選定。
`components/auth/{LoginScreen,SetupWizard,UserSelectScreen}.tsx`＋`lib/guestMode.ts`（計約950行）を1セッションで
全体点検。マルチテナンシー（2026-06-26〜07-02導入）・is_admin/is_super_admin権限モデルとの整合性、
アプリ内ヘルプ（docs/guides）の認証関連記述も含めて確認した。

| 項目 | 内容 | コミット |
|------|------|---------|
| **エラー握りつぶし（グランドルール違反・実害あり・修正）** | `SetupWizard.tsx`の`handleComplete`（初回セットアップでメンバーを一括保存する処理）のcatch節が、実際の例外オブジェクト`e`を一切受け取らず（`catch {`）、`"保存に失敗しました。Supabaseの設定を確認してください。"`という固定文言だけを表示していた。CLAUDE.md Section 15が禁止する「何が起きたか分からない」パターンそのもの。しかも本セットアップは新しい部署（グループ）を丸ごと立ち上げる最初のオンボーディング画面であり、ここで失敗すると原因の手がかりがゼロのまま詰まる（実害が大きい）。`formatErrorForUser("保存に失敗しました", e)`に統一 | （次のコミット） |
| **仕様変更後に死んだ記述（実害あり・修正）** | `SetupWizard.tsx`のステップ1に「⚠ 現在はデモ版です。データはこのブラウザのみに保存されます。Supabase移行後にチーム全員でデータを共有できます。」という警告バナーがあったが、`git log`で確認するとこの文言は初回コミット（Supabase移行前のlocalStorageのみのプロトタイプ時代）に書かれたもので、直後のコミット`bb835a1`（Supabase認証・データ層移行）以降ずっと更新されず残置されていた。実際には本画面自体が`saveMember`（Supabase保存・チーム全員とリアルタイム共有）を呼んでおり、内容は現状と正反対（「共有されない」と案内しているのに実際は即座に共有される）。ブランドAID等、将来新しい部署が本アプリで自分のグループを立ち上げる際にも必ず通る画面のため、正しい内容（Supabaseに保存されチーム全員で共有される旨）に書き換え、視覚トーンも警告色(⚠/warning)から情報色(ℹ/info)へ変更 | （次のコミット） |

見つけたが直さなかった課題（設計判断が要るため次回候補へ・M25/M26/M27として下記「未完了・次回候補」に記録）：
①（**M25・最重要**）`SetupWizard.tsx`が新規作成するメンバーに`group_id`を一切設定しておらず、`appStore.saveMember`の
フォールバック（`get().currentGroupId ?? undefined`）に委ねているが、SetupWizard実行時点では`currentGroupId`は
一度も`null`から更新されない（`setCurrentGroupId`はメンバー自動マッチ成功後にのみ呼ばれるため）。マルチテナンシー
導入後のRLS（`members_group`ポリシー：`group_id = current_member_group_id() OR current_member_is_super_admin()`。
`current_member_group_id()`は`email = auth.email()`で自分のmembers行を検索）を実際に読むと、真に新しいテナント
（該当emailにマッチするmembers行がまだ存在しない状態）の最初のメンバー作成では、挿入行の`group_id`が何であれ
`current_member_group_id()`も`NULL`（自分の行がまだ無いため）・`current_member_is_super_admin()`も`false`となり、
INSERTのWITH CHECKが`NULL OR false`＝真ではない、と評価されRLSに拒否される可能性が高いと判明。これまで
`grp-egg`しか実在しない（移行時に既存行が一括バックフィル済み）ため一度も顕在化していないが、AID自身を含め
今後どこかの部署が本当に「メンバー0人の新規グループ」としてSetupWizard経由で立ち上げようとした瞬間に
起こりうる。RLSポリシーの再設計（新規グループ向けブートストラップ許可の追加）か、運用を「新規部署は
スーパー管理者がアプリ経由で先に自分のmembers行を作ってから他メンバーを招待する」方式に倒すかの設計判断が
必要なセキュリティ領域のため、コードは変更せず記録のみに留めた
②（M26）`LoginScreen.tsx`の失敗時メッセージは`signIn`/`signUp`の実際のSupabaseエラーを一切見せず、ログイン失敗は
常に`auth.error.loginFailed`（メール/パスワードが正しくありません）固定・新規登録失敗も「既に登録済み」の
判別以外は`auth.error.signupFailed`固定という設計。CLAUDE.md Section 15の趣旨（詳細を見せる）とは逆方向だが、
ログイン画面で詳細なSupabaseエラー（レート制限コード・ユーザー存在有無等）を出すとユーザー列挙等のセキュリティ
リスクにつながりうるため、意図的な設計である可能性が高いと判断。診断性とセキュリティのトレードオフの設計判断が
要るため次回候補へ
③（M27）アプリ内ヘルプ`docs/guides/01_onboarding/first-day.md`・`06_troubleshooting/faq.md`・`03_roles/admin.md`・
`05_admin/objective-kr-tf.md`（いずれも`last_updated: 2026-05-15`）が、Supabase Auth（メール/パスワードでの
ログイン・新規登録＝LoginScreen、2026-03-18導入）に一切触れておらず、「メンバー選択画面で自分の名前を選ぶ」が
ログインの最初のステップであるかのように書かれている。実際にはその前段でLoginScreenでの認証が必須。
admin.mdの「メアドを登録（ログイン用）」という記述も、membersの`email`列を設定するだけでログインできるかの
ように読めるが、実際はそれとは別にSupabase Auth側のアカウント作成（本人の「新規登録」または管理者による
別途発行）が必要で、`email`一致は自動マッチングのためだけに使われる。正しい記述へ書き換えるには実際の運用
（各自が自己登録するのか、管理者が先にAuthアカウントを発行するのか）の確認が要るため、今回は書き換えず
記録のみ

`UserSelectScreen.tsx`・`guestMode.ts`はESLintクリーン・型健全・技術的負債は見つからなかった
（`UserSelectScreen.tsx`が`useT()`未使用で日本語ハードコードのままなのは、`docs/dev/i18n-plan.md`で
「Phase 1はLoginScreenのみ完了」と明記済みの既定計画どおりであり不具合ではない）。`guestMode.ts`の
`GUEST_MEMBER`アバター色（`#9ca3af`/`#ffffff`）がCSS変数トークンでなく直書きだが、他のアバター色
（`AVATAR_COLORS`）と違い単なる固定グレーで見た目への実害がほぼ無く、次回候補に挙げるほどではないと判断し
見送った。`LoginScreen.tsx`・`i18n/auth.ts`の翻訳キー（ja/en計23件）は全て一致しダングリングキーなし。

`npx tsc --noEmit`クリーン・vitest 419/419 pass（新規テスト無し・回帰なし。UI文言＋エラー表示のみの変更のため）・
eslint 24 errors/11 warnings（HEAD時点と完全一致・新規0件。SetupWizard.tsxの`no-irregular-whitespace`2件は
2026-05-29のsweepで「日本語名分割に使う全角スペース正規表現で機能上必須」と判定済みの既知パターンと同種）・
build成功で確認。**これで「認証・入口」ユニット（約950行）の点検が完了したため、台帳の「最終点検日」を
2026-07-21に更新**（備考欄も経緯を集約）。

## 完了済み（2026-07-21）巡回台帳の11回目の巡回：D OKR（残りサブ領域・ユニット全体完結）

10回目までで週次循環ワークフロー①②③④・なぜなぜ分析は点検済み。残っていた最後のサブ領域
`components/lab/KrQuarterPlanPanel.tsx`（1,247行）＋`lib/ai/{krQuarterPlanClient,krQuarterPlanPrompt}.ts`
（計約398行）＋`lib/supabase/quarterPlanStore.ts`（77行）＋`lib/okr/{eligibleTaskForces,tfQuarter}.ts`
（計約57行、計約1,778行）を選定。これでD OKRユニット全体（約7,562行）の点検が完了する。

| 項目 | 内容 | コミット |
|------|------|---------|
| **仕様変更後に死んだドキュメント記述（実害あり・修正）** | `lib/okr/{eligibleTaskForces,tfQuarter}.ts`のコメントを読むと、2026-05-26に「TF→四半期の判定」が`quarterly_kr_task_forces`（QKTF）テーブルベースから`TaskForce.quarter`列ベース（`effectiveTfQuarter`）へ移行済みと判明。ところがアプリ内ヘルプ6ファイル（`03_roles/admin.md`・`04_workflows/quarter-rollover.md`・`05_admin/objective-kr-tf.md`・`05_admin/settings-overview.md`・`_meta/glossary.md`・`02_modes/okr/00_cycle.md`、いずれも`last_updated: 2026-05-15`で移行前のまま未更新）が、今も「設定 → 四半期TF割り当て」という存在しない管理画面セクションを案内し続けていた。実際にAdminView.tsxを確認すると、現在は「タスクフォース」セクション上部のクォータータブ（1Q〜4Q）でTFを直接「移動」する方式に統一されており、QKTFの`insertQuarterlyKrTaskForce`/`deleteQuarterlyKrTaskForce`を呼ぶUIはコードベースに存在しない。D OKRの巡回で繰り返し見つかっている「仕様変更後に死んだドキュメント記述」パターン（3回目・10回目に続き3件目）で、かつ四半期切替という実際に管理者が定期的に行う手順ガイドが対象のため実害が大きいと判断し、実際のUI（クォータータブ＋TF移動）に合わせて6ファイルを修正。存在しない`docs/guides/02_modes/okr/04_quarter-plan.md`への「（執筆中）」リンク3箇所・frontmatterの`related`タグ1件も除去 | `855a325` |
| **呼び出し元0件の未使用export関数（実害小・修正）** | `quarterPlanStore.ts`の`finalizeQuarterPlan`（既存計画を読み込みstatusだけ"finalized"に書き換えて再保存する関数）がエクスポートされていたが、呼び出し元がコードベース内に0件だった。実際の確定操作は`KrQuarterPlanPanel.tsx`の`handleSave("finalized")`が、現在のReact state（`planSummary`/`planTfs`/`planRisk`）を直接`saveQuarterPlan`へstatus="finalized"付きで渡す形で完結しており、この関数は最初から使われていなかったと見られる。5回目（`okrAnalysisStore.ts`）・6回目（`krMeetingNoteStore.ts`の`softDeleteKrMeetingNote`）・8回目（`krReportStore.ts`の`softDeleteKrReport`）と同種のパターンだが、それらは「削除UIが無いための未使用」でUX判断が必要なため据え置いてきたのに対し、本件は同機能を果たす別経路が既にあるだけの純粋な重複死蔵コードのため、UX判断を要さず削除 | `b85423d` |

見つけたが直さなかった課題（設計判断が要るため次回候補へ・M24として下記「未完了・次回候補」に記録）：
`appStore.ts`の`quarterlyKrTaskForces` state・`addQuarterlyKrTaskForce`/`removeQuarterlyKrTaskForce`アクション、
`store.ts`の対応するfetch（2箇所）・`insertQuarterlyKrTaskForce`/`deleteQuarterlyKrTaskForce`関数が、
上記ガイド記述と同じ2026-05-26のTaskForce.quarter移行後、UIからの呼び出し元が丸ごと0件のまま残置されている
（`quarterlyKrTaskForces` stateはfetchするだけで読むコンポーネントが無い）。フロントエンドのコード削除自体は
安全に行えるが、DB側の`quarterly_kr_task_forces`テーブル・関連migration・`docs/dev/data-model.md`の扱い
（テーブル自体をdropするかは別のマイグレ判断）まで含めると設計判断が要るため、今回は現状記録のみに留めた。

`KrQuarterPlanPanel.tsx`本体はESLintクリーン（既存の`label-has-associated-control` 3件はM15記載の
既知のa11yバックログと同種・修正対象外）。`currentUser: _currentUser`の未使用命名は9回目に確認した
`KrQuarterPlanPanel.tsx`と同じ設計（Phase 1はlocalStorage保存のためユーザー紐付け不要）にファイル冒頭
コメントで既に対応済みだった（今回の対象そのものだったため新規の修正は不要）。`krQuarterPlanClient.ts`・
`krQuarterPlanPrompt.ts`はAI境界ルールと矛盾する死蔵段落なし・`usage`等の死蔵フィールドもなし
（8回目に見つけた`krReportClient.ts`の`usage`は孤立した1件だったと再確認）。`buildContext`内の3つの
`catch (e) { console.warn(...) }`（前Q会議ノート・宣言・分析の取得失敗）は7回目・8回目に確認済みの
「D OKRラボ機能群で一貫した設計判断（主操作は成功扱いのまま補助的な取得失敗だけ静かにログする）」と
同種のため対象外。`lib/okr/{eligibleTaskForces,tfQuarter}.ts`はいずれも複数ファイルから実際に使われて
おり死蔵なし・ロジックも健全。

`npx tsc --noEmit`クリーン・vitest 419/419 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**これでD OKRユニット全体（約7,562行）の点検が
5〜11回目（7セッション）を通じて完了したため、台帳の「最終点検日」を2026-07-21に更新**（備考欄も
経緯を集約）。

## 完了済み（2026-07-21）巡回台帳の10回目の巡回：D OKR（部分点検・②セッション記録＆分析）

9回目に続きD OKR（規模約7,562行・1セッションに収まらないため継続してサブ領域単位）。
残っていたサブ領域`components/lab/{KrJointSessionFlow,KrQuarterPlanPanel}.tsx`
（1,030〜1,247行）のうち、OKR循環ワークフロー②セッション記録＆分析の本体
`components/lab/KrJointSessionFlow.tsx`（1,030行）＋そのAI抽出クライアント
`lib/ai/krSessionExtractor.ts`（当初573行）＋データ層`lib/supabase/krSessionStore.ts`
（153行、計約1,756行）を選定。選定理由：`KrQuarterPlanPanel.tsx`（1,247行）より
小さく、かつ「合同セッションモード」（`extractJointCheckinData`/`extractJointWinSessionData`）
を伴う複雑なファイルのため規模だけでなく複雑さの観点からも優先度が高いと判断した。

| 項目 | 内容 | コミット |
|------|------|---------|
| **保存進捗バーの合計値off-by-one（実害小・修正）** | `handleSave`（チェックイン/ウィンセッション保存時）の進捗合計`total`が`selected.reduce((n, p) => n + 1 + 1 + declCount, 1)`と、reduceの初期値に`1`を与えていた。ループ内で加算する各ステップ（session保存1・kr_analysis保存1・宣言N件）はどれも`cur++`で正しくカウントされる一方、初期値の`1`に対応する実際の保存ステップは存在しない（freeform分岐の`total = 1 + validFollowUps.length`と比較すると、そちらは初期値なしで実際のsession保存1件分のみを表しており対照的だった）。結果として保存処理中の進捗表示（SaveProgressLoader）の分母が常に実際のステップ数より1多く表示され、ループ完走時点で「N-1/N」のような表示になっていた（保存完了時に`setProgress({ current: total, total })`で強制的にN/Nへ上書きされるため最終表示は正常に見え、ユーザー影響は保存中の一瞬の表示のみ）。reduceの初期値を`0`に修正 | `（次のコミット）` |
| **仕様変更後に死んだ抽出関数2件（実害小・修正）** | `krSessionExtractor.ts`の`extractCheckinData`／`extractWinSessionData`（単一KR用のチェックイン/ウィンセッション抽出関数、対応するプロンプト定数`CHECKIN_EXTRACT_PROMPT`/`WIN_SESSION_EXTRACT_PROMPT`込み）が、コードベース全体・テストとも呼び出し元0件で残置されていた。`git log`で追跡すると2026-05-18の`d547b69`（「セッション記録を合同フロー一本に統合・単一KRパネル廃止」）で単一KR専用UI`KrSessionPanel.tsx`（1,411行）が削除された際、それが呼んでいた`krSessionExtractor.ts`側の抽出関数だけが削除対象から漏れていた（D OKRで繰り返し見つかっている「仕様変更後に死んだ選択肢・設定」パターン、かつ「呼び出し元0件の未使用export関数」パターンの複合）。同ファイル内の`validateCheckin`/`validateWinSession`は合同抽出（`validateCheckinKrEntry`/`validateWinKrEntry`）から引き続き使われているため残し、孤立していた2エクスポート関数＋専用プロンプト定数のみ削除 | `（次のコミット）` |
| **ユーザー向けガイド3件の死んだ「単一KRモード」記述（実害あり・修正）** | 上記の単一KRパネル廃止（`d547b69`）から2ヶ月以上、アプリ内ヘルプ（`HelpButton modeKey="okr.session"`が開く`docs/guides/02_modes/okr/02_session.md`）と`docs/guides/03_roles/facilitator.md`が「モード切替（上部バー）：合同／単一KR」という、実際には存在しないUIトグルを案内し続けていた（`src/components/okr/README.md`の一覧表記も同様）。過去の点検で見つかる「死んだ選択肢」はコード内のプロンプト死蔵段落が多かったが、今回はユーザーが実際に読む操作ガイドが対象で実害が最も大きい（ファシリテーターが存在しないボタンを探すことになる）。現在の`KrJointSessionFlow.tsx`は「対象KR」チェックを1つだけ残せば単一KR相当の記録になる設計のため、その旨に書き換え。`docs/okr-cycle-design.md`は当時の設計変遷を示す履歴的記録のため対象外とした | `（次のコミット）` |

`krSessionExtractor.ts`のfreeform抽出（`extractFreeformSession`）・合同抽出2関数はAI境界ルールと
矛盾する死蔵段落は見つからなかった。`KrJointSessionFlow.tsx`本体はESLintクリーン（`any`型なし・
exhaustive-deps違反なし）。`handleExtract`/`handleSave`の主要catch節は`formatErrorForUser`経由で
グランドルールSection 15に準拠済み、Objective分析・KR分析の副次保存失敗を`console.warn`のみで
済ませる3箇所は8回目に確認済みの「D OKRラボ機能群で一貫した設計判断（主操作は成功扱いのまま補助的な
保存失敗だけ静かにログする）」と同種のため対象外とした。`krSessionStore.ts`の`fetchKrSessions`/
`updateKrSession`/`softDeleteKrSession`はいずれも他ファイル（`OkrDashboardView.tsx`・
`OkrKrAnalysisPanel.tsx`・`KrReportPanel.tsx`・`KrWhyPanel.tsx`・`KrQuarterPlanPanel.tsx`・
`DashboardView.tsx`）から実際に使われており死蔵なし。

`npx tsc --noEmit`クリーン・vitest 419/419 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の9回目の巡回：D OKR（部分点検・なぜなぜ分析）

8回目に続きD OKR（規模約7,562行・1セッションに収まらないため継続してサブ領域単位）。
残っていたサブ領域`components/lab/{KrJointSessionFlow,KrWhyPanel,KrQuarterPlanPanel}.tsx`
（787〜1,247行）のうち最小の`KrWhyPanel.tsx`（787行）＋そのAIクライアント`lib/ai/krWhyClient.ts`
（80行、計約867行）を選定。選定理由：3ファイルとも単体で787〜1,247行あり過去4回
（738/903/1,174/1,153行）と同程度の予算制約があるため1ファイルのみ選ぶ必要があったところ、
残り2ファイル（`KrJointSessionFlow.tsx`1,030行・`KrQuarterPlanPanel.tsx`1,247行）より
小さい`KrWhyPanel.tsx`を選び、機能的にセットのAIクライアント（80行）を合わせても867行に収まったため。

| 項目 | 内容 | コミット |
|------|------|---------|
| **型定義と実際の呼び出し元の乖離（実害小・修正）** | `KrWhyPanel`の`Props`型に`currentUser: Member`が必須フィールドとして定義され、呼び出し元（`OkrDashboardView.tsx`・`MainLayout.tsx`の2箇所）は実際のMemberを渡していたが、コンポーネント本体は分割代入で`currentUser`を一切受け取っておらず（`{ onClose, inline, initialKrId }`のみ）、値は静かに握りつぶされていた。同じ`components/lab/`の兄弟ファイルを確認すると、`KrReportPanel.tsx`・`KrJointSessionFlow.tsx`は`currentUser.id`をDB保存の`created_by`/`updated_by`に実際に使っており、`KrQuarterPlanPanel.tsx`だけは`currentUser: _currentUser`とアンダースコア接頭辞で「意図的に未使用」と明示していた（Phase 1がlocalStorage保存のためユーザー紐付け不要・将来Supabase移行時に使う設計とコメントで確認済み）。`KrWhyPanel`のなぜなぜ分析サマリーも同じくlocalStorageのみに保存されユーザー紐付けが無い設計（`docs/okr-cycle-design.md`に「なぜなぜは当面そのまま」と明記）のため、`KrQuarterPlanPanel.tsx`と全く同じ理由で未使用のはずだが、そちらは意図を示すアンダースコア命名がされておらず、分割代入から静かに省かれているだけだった（読み手には「型定義と実装が食い違っている」ようにしか見えない）。ESLintの`no-unused-vars`は分割代入されていない値には反応しないため検知されずに残っていた。`KrQuarterPlanPanel.tsx`と同じ`_currentUser`命名＋理由コメントに統一し、意図的な未使用であることを明示 | （次のコミット） |

`krWhyClient.ts`はSYSTEM_PROMPT・型・呼び出し元とも整合しておりAI境界ルールと矛盾する死蔵段落は
見つからなかった。ファイル内のローカル関数`getCurrentQuarter(date: Date): string`（AIへの
コンテキスト文中に「1Q（1〜3月）」の形式で四半期ラベルを埋め込むための表示専用フォーマッタ）は、
`lib/date.ts`の`currentQuarter()`/`dateToQuarter()`（TF絞り込み用に`"1Q"`のようなコード値のみを
返す）と計算ロジックが並行しているが、返す文字列の用途・フォーマットが明確に異なる（月範囲の
日本語ラベルが必要）ため、重複ではなく意図の異なる別関数と判断し据え置き（次回候補にも入れない
軽微な観察）。TypingMessage/ThinkingDots等の表示用サブコンポーネント・`buildContext`のTF/ToDo/
セッション履歴の組み立てロジックはESLintクリーン（既存の`no-irregular-whitespace`
198行目の全角スペースはM15記載の既知の意図的使用・`label-has-associated-control` 2件も
アプリ全体のa11yバックログ・いずれも修正対象外）・`any`型なし・exhaustive-deps違反なし。
`handleStart`/`handleSendAnswer`/`handleGenerateSummary`の3つのcatch節は全て既に
`formatErrorForUser`経由でグランドルールSection 15に準拠済みだった（修正不要）。

`npx tsc --noEmit`クリーン・vitest 419/419 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の8回目の巡回：D OKR（部分点検・④レポート作成）

7回目に続きD OKR（規模約7,562行・1セッションに収まらないため継続してサブ領域単位）。
残っていたサブ領域のうち、OKR循環ワークフロー④レポート作成の本体`components/lab/KrReportPanel.tsx`
（687行）＋そのAIクライアント`lib/ai/krReportClient.ts`（38行）・システムプロンプト
`lib/ai/krReportPrompt.ts`（301行）＋データ層`lib/supabase/krReportStore.ts`（127行、計約1,153行）を選定。
選定理由：`components/lab/*`4ファイルは単体でも687〜1,247行あり過去2回（738行・903行）と同程度の予算制約が
あるため1ファイルのみ選ぶ必要があったところ、`KrJointSessionFlow.tsx`（1,030行）・`KrWhyPanel.tsx`
（787行）・`KrQuarterPlanPanel.tsx`（1,247行）より小さい`KrReportPanel.tsx`（687行）を選び、
機能的にセットの3ファイル（AIクライアント・プロンプト・ストア、計約466行）を合わせても
1,153行に収まったため。

| 項目 | 内容 | コミット |
|------|------|---------|
| **エラー表示の不統一（グランドルール軽微違反・実害小・修正）** | `KrReportPanel.tsx`の`handleSendToTeams`（Teams送信ボタン）のcatch節が`showToast(\`Teams送信エラー: ${e instanceof Error ? e.message : String(e)}\`, "error")`と、`e.message`を直接テンプレートリテラルに埋め込んで表示していた。同じファイル内の他4箇所のcatch（レポート生成・保存・確定・確定取り消し）は全て`formatErrorForUser`経由で統一されており、この1箇所だけが取り残されていた（CLAUDE.md Section 15の禁止例とほぼ同型のパターン）。`formatErrorForUser("Teams送信に失敗しました", e)`に統一 | （次のコミット） |
| **呼び出し元0件の未使用フィールド（実害小・修正）** | `lib/ai/krReportClient.ts`の`KrReportResult`型に`usage: { input_tokens, output_tokens }`フィールドがあり`callKrReportAI`が毎回値を詰めて返していたが、呼び出し元`KrReportPanel.tsx`は`result.html`しか参照しておらず`usage`は一度も読まれていなかった。使用量計測自体は`invokeAI()`内部の`logAIUsage()`が呼び出し時点で自動的に行う設計（CLAUDE.md Section 16）のため、このフィールドは元々不要だった。同じ役割を持つ他3つのAIクライアント（`krWhyClient.ts`・`krQuarterPlanClient.ts`・`krSessionExtractor.ts`）を確認したところ、いずれも`usage`フィールドを持たない設計になっており、`krReportClient.ts`だけの孤立した死蔵フィールドと判明。削除 | （次のコミット） |

`krReportPrompt.ts`はAI境界ルールと矛盾する死蔵段落（`linked_pj_names`等）は見つからず、
`KrReportContext`型と`buildKrReportContext`の実装・`callKrReportAI`の呼び出しは整合していた。
`krReportStore.ts`の`softDeleteKrReport`（レポートの論理削除関数）はエクスポートされているが、
呼び出し元がコードベース内に0件（レポート削除UI自体が存在しない）と判明。5回目に見つけた
`okrAnalysisStore.ts`の未使用export2件・6回目に見つけた`krMeetingNoteStore.ts`の
`softDeleteKrMeetingNote`と同種のパターン。削除UIを追加するか関数ごと削除するかはUX判断が
要るため今回は見送り、次回候補へ記録（下記「未完了・次回候補」M23）。

`KrReportPanel.tsx`本体の残るcatch節（レポート取得・最新分析取得の2箇所の`console.warn`のみの
背景フェッチ）は、`KrJointSessionFlow.tsx`（副次的な分析保存の失敗を`console.warn`のみで済ませる
箇所が2箇所）・`KrQuarterPlanPanel.tsx`（前Q参照データの取得失敗を`console.warn`のみで済ませる
箇所が3箇所）と同種の「主操作は成功扱いのまま、補助的な読み込み/保存の失敗だけ静かにログする」という
D OKRラボ機能群で複数ファイルにまたがり一貫した設計判断と確認できたため、7回目に見つけた
`OkrDashboardView.tsx`のケース（同ディレクトリの兄弟ファイルだけが`formatErrorForUser`を使い
当該ファイルのみ使っていない、という孤立した取り残し）とは性質が異なると判断し、対象外とした。

`npx tsc --noEmit`クリーン・vitest 401/401 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の7回目の巡回：D OKR（部分点検・OkrDashboardView.tsx）

6回目に続きD OKR（規模約7,562行・1セッションに収まらないため継続してサブ領域単位）。
残っていたサブ領域のうち`components/okr/OkrDashboardView.tsx`（約1,174行、単体でちょうど良い規模）を選定。
選定理由：タスク依頼メモで有力候補とされていた通り、残りサブ領域（本ファイル／`components/lab/*`4ファイル計約3,751行／
AIクライアント群／Supabaseストア群／`lib/okr/*`）の中で唯一単体ファイルとして1セッション予算（20〜30k）に
過去2回（738行・903行）と同程度で収まる規模だったため。`components/lab/*`は合計約3,751行あり単体では大きすぎ、
複数ファイルにまたがる依存関係コンポーネント（`KrJointSessionFlow`等）は分割点検が難しいため次回以降に回した。

| 項目 | 内容 | コミット |
|------|------|---------|
| **エラー握りつぶし（グランドルール違反・実害中・修正）** | `OkrDashboardView.tsx`内の`KrSessionHistory`（セッション履歴の編集・削除UI）の`handleSave`/`handleDelete`が、catch節でエラーを一切表示せず`// error silently — user can retry`というコメントだけで握りつぶしていた。同じ`components/okr/`ディレクトリの`KrMeetingNotePanel.tsx`・`OkrKrAnalysisPanel.tsx`は既にCLAUDE.md Section 15のグランドルール（保存・削除等のcatchは`formatErrorForUser()`経由で必ずエラーコード・details・hintを表示）を守っており、本ファイルだけが取り残されていた。保存失敗（DB制約違反・ネットワークエラー等）が起きても山本さん含む利用者に一切通知されず「押したのに反応しない」ように見える実害があったため、`formatErrorForUser`でのエラー表示に統一（表示先はsibling filesと同じ`ErrBox`相当のインラインスタイル） | `cfa84bf` |
| **死んだ`urgent`フラグ（実害小・修正）** | 週次ガイダンスバナーの`guidanceBanner`オブジェクトが`urgent: boolean`フィールドを持ち、テキストの`fontWeight`をこの値で切り替えていたが、`useMemo`内の2つのreturn文はいずれも`urgent: false`を固定値で返しており、`true`にする分岐がコードベース全体に存在しなかった（`grep`で全文検索し確認）。常に"400"にしかならない死んだ分岐だったため、`urgent`フィールドごと削除しfontWeightを固定値"400"に簡略化 | `cfa84bf` |

見つけたが直さなかった課題（設計判断が要るため次回候補へ・M22として下記「未完了・次回候補」に記録）：
`KrSessionHistory`の編集モードの「種類」ラジオボタンが`checkin`/`win_session`の2択のみで、`freeform`
（③その他のOKR議論）セッションを編集しようとすると`editDraft.session_type`が`"freeform"`のままどちらの
ラジオにも一致せず、両方とも未選択に見える（実際にどちらかをクリックしない限りデータが壊れるわけではないが、
「今の種類が何か」が編集画面から読み取れない）。またfreeform固有の`summary`/`decisions`/`kr_mentions`欄は
編集モードに存在せず閲覧のみ（`SessionDetailBlock`側）。freeformセッションの編集機能を作り込むか、
freeformセッションは編集不可としてUIで明示するかはUX判断が要るため見送り。

`OkrDashboardView.tsx`本体はESLintクリーン（既存の`no-irregular-whitespace` 1件＝210行目の全角スペースは
意図的な表示用区切りでM15記載の既知パターンと同種・修正対象外）。`exhaustive-deps`違反・`any`型は無し。
`activeTool === "analysis"`（旧③分析タブ）は現在のタブUIからは到達不能に見えるが、`MainLayout.tsx`が
localStorageに保存された旧バージョンの値を読み込んだ場合の後方互換として意図的に残置されているコメントを確認し
（コード内コメント「"analysis" / "overview" は localStorage 互換のため型に残す」）、デッドコードではないと判断（修正不要）。

`npx tsc --noEmit`クリーン・vitest 401/401 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の6回目の巡回：D OKR（部分点検・①会議ノートサブ領域）

5回目に続きD OKR（規模約7,562行・1セッションに収まらないため継続してサブ領域単位）。
残っていたサブ領域のうち、OKR循環ワークフロー①会議ノートの本体`components/okr/KrMeetingNotePanel.tsx`
（594行）＋そのデータ層`lib/supabase/krMeetingNoteStore.ts`（309行、計約903行）を選定。
選定理由：残りサブ領域の中で1セッション予算に収まる規模（700〜1000行目安）にちょうど収まり、
「コンポーネント本体＋対応するSupabaseストア」という機能的にまとまった単位で切り出せるため。

| 項目 | 内容 | コミット |
|------|------|---------|
| **正規表現エスケープバグ（潜在バグ・実害小・修正）** | `krMeetingNoteStore.ts`の`extractMdSection`（AI分析マークダウンから「次の一手」等のセクション本文を抽出する内部関数）が、セクション名中の正規表現特殊文字をエスケープする際に置換文字列を`"\\\\$&"`（4バックスラッシュ）と誤記しており、本来1個であるべきエスケープ用バックスラッシュが2個挿入されていた。実際に動かして確認したところ、特殊文字（例：ASCIIの丸括弧）を含むセクション名では対応する箇所が意図しない正規表現トークン（例：新しいキャプチャグループの開始）として解釈され、抽出が失敗する状態だった。現在呼び出されている実際のセクション名（「次の一手（来週・次月へ）」等）は全角括弧のみでASCII特殊文字を含まないため現状は無症状（dormant）だが、将来セクション名にASCII特殊文字が入ると顕在化する潜在バグのため、標準的なregex-escapeパターン（`"\\$&"`・2バックスラッシュ）に修正 | `884af98` |
| **JSDocと実装の乖離（実害小・修正）** | `carriedEntriesFrom`（前週ノートのTFエントリを「下書き」として引き継ぐ関数）のJSDocが「次の一手・現在の状態(%)・理由・TODO：そのままコピー」「①先週動かした前提・仮説：前週の『③次にやる一手』を素材として差し込む」と説明していたが、実装（および関数直前のインラインコメント）は週次記入項目（hypotheses/facts/next_actions/progress_pct/progress_reason/todo）を全て空にする設計になっていた。`git blame`で追うと、当初は前週の値を素材として差し込む設計だったが、後に「前週の内容はUI側で`PrevRef`として参照表示（編集不可）」する方式へ変更された際、実装・インラインコメントは更新されたがJSDocだけ更新が漏れていた（D OKRで繰り返し見つかっている「仕様変更後に死んだ文書」パターン）。実装に合わせてJSDocを書き換え | `884af98` |

`KrMeetingNotePanel.tsx`はESLintクリーン（既存のno-irregular-whitespace 1件＝486行目の全角スペースは
意図的な表示用区切りでM15記載の既知パターンと同種・修正対象外）。`fetchTfEntryHistory`・`buildCarryMemo`・
`carriedEntriesFrom`・`fetchKrMeetingNoteById`は`OkrKrAnalysisPanel.tsx`・`KrQuarterPlanPanel.tsx`・
`KrMeetingNotePanel.tsx`から利用されており死蔵ではないが、`softDeleteKrMeetingNote`はエクスポートされて
いるのに呼び出し元が0件（会議ノートの削除UIが存在しない）と判明。5回目に見つけた`okrAnalysisStore.ts`の
未使用export2件と同種のパターンで、削除UIを追加すべきか関数ごと削除すべきかはUX判断が要るため今回は
修正せず次回候補へ記録（下記「未完了・次回候補」M21）。

`npx tsc --noEmit`クリーン・vitest 401/401 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の5回目の巡回：D OKR（部分点検・サブ領域のみ）

台帳の「最終点検日」が最古だったD OKR（2026-07-06）を選定。ただし規模が約7,562行と
過去4回（317〜1,117行）よりずっと大きく1セッションの予算に収まらないため、
`components/okr/OkrKrAnalysisPanel.tsx`（③分析パネル。KR単位/Objective単位のAI分析を
1画面で切替）＋その2つのAIクライアント`lib/ai/okrKrAnalysisClient.ts`・
`lib/ai/okrObjectiveAnalysisClient.ts`（規模計約738行）のサブ領域のみを今回の点検範囲とした。
選定理由：`okrKrAnalysisClient.ts`・`okrObjectiveAnalysisClient.ts`は2026-05-19
（`2a2b4a4`）以降ノータッチで他の候補（`OkrDashboardView.tsx`は07-07、`KrMeetingNotePanel.tsx`は
07-06に触られている）より放置期間が長く、E PJ別AI分析（2回目巡回）で見つかった
「AI境界ルールと矛盾する死蔵プロンプト段落」と同種のパターンが起きやすい箇所と判断した。

| 項目 | 内容 | コミット |
|------|------|---------|
| **死んだプロンプト段落（実害小・修正）** | `okrKrAnalysisClient.ts`のSYSTEM_PROMPTに「linked_pj_names（このTFに貢献するPJの名前）が与えられている場合」という条件付き指示があったが、`KrAnalysisTf`型にそのフィールドは存在せず、`buildUserMessage`も一度もこの値を出力していなかった。`git log`で追跡すると、2026-05-19の`2a2b4a4`（3つの主要system promptに新フィールド参照ヒントを一括追記した回）で仕込まれ、兄弟コミットの`projectAnalysisClient.ts`側（同じ`linked_tf_numbers`系の死蔵段落）は2回目巡回（E PJ別AI分析）で既に削除済みだったが、`okrKrAnalysisClient.ts`側は今回まで見落とされていた。常にfalseの条件分岐を毎回AIに送るだけの死蔵指示だったため削除 | `38ebd77` |

`okrObjectiveAnalysisClient.ts`は型・出力とも整合しており修正不要と判断。`OkrKrAnalysisPanel.tsx`は
ESLintクリーン・`any`なし・exhaustive-deps違反なしで技術的負債は見つからなかった。

見つけたが直さなかった課題（設計判断が要るため次回候補へ）：`lib/supabase/okrAnalysisStore.ts`の
`softDeleteOkrAnalysis`・`fetchLatestObjectiveAnalysis`の2関数がファイル内・呼び出し元とも未使用
（`OkrKrAnalysisPanel.tsx`にAI分析結果の削除UIが無く、Objective分析の最新取得は`fetchObjectiveAnalyses`の
`rows[0]`で代替されている）。実害は薄いが、削除するか使う（削除UIを追加する）かはUX判断が要るため
今回は見送り。また`fetchLatestOkrAnalysis`/`fetchLatestObjectiveAnalysis`はいずれも全履歴を取得してから
`rows[0]`を返す実装で、KR/Objective分析実行のたびに毎回全件フェッチしている（`Promise.all`でKR数分
並列発生）。件数が少ないうちは実害はないが、母数が増えると軽い非効率になりうる（`.order().limit(1)`化は
次回候補）。

`npx tsc --noEmit`クリーン・vitest 401/401 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。**ユニット全体の点検は完了していないため「最終点検日」は
2026-07-06のまま据え置き**（台帳の備考欄に持ち越しサブ領域を明記）。

## 完了済み（2026-07-21）巡回台帳の4回目の巡回：G オンボーディング

台帳の「未点検」ユニットが本ユニットのみ残っていたため選定（規模約1,117行）。
`docs/dev/tour-guidelines.md`・CLAUDE.md Section 14.5に沿って、ツアー本体
（`TourProvider.tsx`／`tours/first-time.ts`／`tours/types.ts`／`tours/index.ts`）と
ガイド（`GuideModeView.tsx`／`GuideOverlay.tsx`／`HelpButton.tsx`）、`lib/docs/{manifest,types}.ts`
を確認。

| 項目 | 内容 | コミット |
|------|------|---------|
| **AI紫グラデーションのハードコード（実害小・修正）** | `GuideModeView.tsx`のガイドトップ「ツアーを再生する」ボタンが`linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`をハードコードしていた。既存の`--gradient-ai`トークン（`globals.css`）と値がbyte-for-byte同一だが、ダークモード用の派生値（`#818cf8`/`#a78bfa`）には追従していなかった。他10ファイル以上で確立済みの`var(--gradient-ai)`に統一 | `ed70e07` |
| **ツアー2ステップのskipIfMissing漏れ（実害小・修正）** | `first-time.ts`の8つのターゲット付きステップのうち2つ（`ai-mode-meeting`／`pj-karte-btn`）だけ`skipIfMissing`が付いていなかった。tour-guidelines.md §6「ターゲット付きステップはskipIfMissing: trueを基本」に反しており、特に`pj-ai-analyze-btn`（PJ単体AI分析ボタン）はPJが1件も無いデモ環境だと存在しないため、要素が見つからずステップが進まなくなるリスクがあった。他6ステップに合わせて追加 | `d65d70f` |

見つけたが直さなかった課題（ツアー本文の構成変更を伴うため次回候補へ・M19/M20として下記「未完了・次回候補」に記録）：
①統合ツアー（`first-time.ts`）が11ステップで構成されており、tour-guidelines.md §9の
「1ツアーあたり7〜9ステップを上限」を超過している。②タイトルの絵文字の付け方（§4「絵文字は1つだけ」）が
3ステップでずれている（2ステップに絵文字が無い／1ステップに2つ付いている）。いずれも文面・構成の
再設計を伴い、tour-guidelines.mdの基準に慎重に従う必要があるため、その場の小修正では済まないと判断し見送った。

`TourProvider.tsx`・`GuideOverlay.tsx`・`HelpButton.tsx`・`lib/docs/manifest.ts`・`lib/docs/types.ts`は
eslintクリーン・型も健全（`any`なし・exhaustive-deps違反なし）で、修正すべき技術的負債は見つからなかった。
`GuideOverlay.tsx`等の暗幕`rgba(0,0,0,0.45)`直書きはアプリ全体で20箇所以上共有されている確立済みの
パターン（v2.67と同じ判断基準）のため対象外とした。

`tsc --noEmit`クリーン・vitest 396/396 pass（新規テスト無し・回帰なし）・eslint 24 errors/11 warnings
（HEAD時点と完全一致・新規0件）・build成功で確認。

## 完了済み（2026-07-21）巡回台帳の3回目の巡回：I 通知

台帳の「未点検」ユニット（G・I）のうち、1セッションの予算（20〜30k）に収まりやすい規模
（約388行・G オンボーディングの約1,117行より大幅に小さい）のI 通知を選定。フロント
（`src/hooks/useDeadlineNotifications.ts`）とEdge Function（`supabase/functions/notify-deadlines/index.ts`）
の2ファイルを確認。

| 項目 | 内容 | コミット |
|------|------|---------|
| **未使用select列（実害小・修正）** | `notify-deadlines/index.ts`のtasksクエリが`status`列をselectしていたが、`TaskRow`型にそもそも定義されておらずコード内で一度も参照されていなかった（未完了フィルタは既にサーバー側`.neq("status","done")`で完結済み）。死蔵selectを削除 | `3c7c4cd` |

`useDeadlineNotifications.ts`はESLintクリーン・useEffectの依存配列（`[currentUserId, tasks, members]`）も
tasks/membersはrefで読むだけの設計だが「データ変化時にも即再評価する」ための意図的な依存として妥当と判断（実害なし）。

見つけたが直さなかった課題（設計判断が要るため次回候補へ）：`DashboardView.tsx`のリマインダー選択に
`notify_pref="teams"`という選択肢があるが、`notify-deadlines`のEdge Function側は2026-07-02の変更で
「notify_prefに関係なく全メンバー宛てにチーム全体レポートとしてTeamsへ送る」設計に変わっており
（`docs/dev/deadline-notifications.md`に明記済みの意図的仕様）、ユーザーが「teams」を選んでも
「none」を選んだ場合と app 内の挙動は完全に同一（どちらも`useDeadlineNotifications`のブラウザ通知は
発火しない）。選択肢自体が実質死んでいるように見えるが、削除するかラベルを変えるかは
UX判断が要るためM18として次回候補へ記録（修正は見送り）。

`tsc --noEmit`クリーン・vitest 396/396 pass・eslint 24 errors/11 warnings（HEAD時点と完全一致・新規0件）・
build成功で確認。`supabase/functions/**`はtsconfig.jsonのincludeに含まれずeslintも対象外
（Deno別ランタイムのため）。**Edge Function側の変更はgit push対象外・要別途手動デプロイ**（山本さん作業）。

## 完了済み（2026-07-21）巡回台帳の2回目の巡回：E PJ別AI分析

台帳の「未点検」ユニット（E・G・I）の中から、1セッションの予算に収まりやすい規模（317行・最小）の
E PJ別AI分析を選定。3ファイル（`projectAnalysisClient.ts`／`allProjectsAnalysisClient.ts`／
`projectAnalysisStore.ts`）と呼び出し元（`ProjectKarte.tsx`／`DashboardView.tsx`）を確認。

| 項目 | 内容 | コミット |
|------|------|---------|
| **死んだプロンプト段落（実害小・修正）** | `projectAnalysisClient.ts`のSYSTEM_PROMPTに「OKR寄与の観点（linked_tf_numbers が与えられている場合）」という段落があったが、`ProjectAnalysisInput`型にそのフィールドは存在せず、呼び出し元`ProjectKarte.tsx`も`linkedKrNames`を「表示のみ。AIには渡さない」と明記して意図的にAIへ渡していなかった（ファイル冒頭のAI境界ルールコメント＝「❌ KR / TF / Objectiveの情報は一切渡さない」と自己矛盾していた）。常にfalseの条件分岐を毎回AIに送るだけの死蔵指示だったため削除 | `4b5cc36` |

`projectAnalysisStore.ts`が`project_analyses`に対し`.delete()`を呼んでいる点はCLAUDE.md Section 4の
「物理削除は絶対禁止」に抵触するように見えたため`schema.sql`を確認したが、このテーブルは元々
`is_deleted`列を持たない設計（最新2件のみ保持する意図的な履歴ログ・`admin_change_logs`の
pg_cron自動削除と同じ扱い）と判明し、問題なしと判断（修正不要）。

`tsc --noEmit`クリーン・vitest 396/396 pass・eslint 24 errors/11 warnings（HEAD時点と完全一致・新規0件）・
build成功で確認。

## 完了済み（2026-07-21）巡回台帳の初回巡回：H グラフ（GraphView.tsx）

台帳の「未点検」ユニットの中からH グラフを選び初点検。見つけた実バグのうち小さく安全なもの1件を修正、
設計判断が要るもの1件は`M16`として次回候補へ記録（内容は上記「未完了・次回候補」参照）。

| 項目 | 内容 | コミット |
|------|------|---------|
| **凡例クリックのハイライト表示が更新されない実バグ** | `toggleType`（凡例クリックでノードタイプの表示/非表示を切替）が`stateRef.current.hiddenTypes`というミュータブルなrefを書き換えてCanvasの`draw()`は呼ぶが、Reactの再レンダーを一切トリガーしていなかった。凡例ボタンの`opacity`（薄く表示するか）はJSX側で毎レンダー時に`stateRef.current?.hiddenTypes.has(type)`を読んでいるだけのため、Canvas上のノードは非表示になるのに凡例ボタンの見た目は初回描画のまま変わらなかった。`useState`のカウンタを1つ追加し、`toggleType`内で`setLegendVersion(v => v + 1)`を呼んで再レンダーを起こすことで解消 | （次のコミット） |

`tsc --noEmit`クリーン・vitest 396/396 pass・build成功で確認。ESLintは既存の`no-irregular-whitespace`（1件・702行目の全角スペース、M15記載の既知の意図的使用）のみで変更前後同一。

## 完了済み（2026-07-07）実バグ：ListViewドラッグ移動中のカクつき・フリーズ

CLAUDE.md v2.25に詳細記録。要約：`ListTaskRow`の`border-top`/`border-bottom`が
ドロップ位置ハイライト時だけ「幅」を1px/0px→2pxに変えていたため、ホバーで行の
高さがズレ→マウスが行外に出る→dragleave→枠が戻り高さも戻る→マウスが行内に
戻りdragover再発火、という自己誘発的な往復（reflowフィードバックループ）が
発生し続けていた。border幅は常に固定し、強調表示は全てbox-shadow（inset・
レイアウトに影響しないペイントのみ）に統一して解消。KanbanViewの列ドロップ枠
（元から「2px固定・色だけ変更」）との比較が診断の決め手になった。

## 完了済み（2026-07-06）Phase 4 a11yスイープ（`no-static-element-interactions`/`click-events-have-key-events`全解消）

| 項目 | 内容 | コミット |
|------|------|---------|
| **カテゴリ分類（サブエージェント調査）** | 34ファイル・75箇所（計133 problems）を4分類：A=モーダル背景クリック閉じる（既存の閉じるボタンがあり安全）、B=stopPropagationラッパー（クリックしても何も起きない）、C=本当にインタラクティブ（role/tabIndex/onKeyDown実装が必要）、D=マウス専用（ドラッグ・リサイズ等でキーボード代替不可） | — |
| **A/B：eslint-disable + 理由コメント（約20ファイル）** | 背景クリック閉じる・stopPropagationラッパーは、閉じる操作自体が別のキーボード操作可能なボタンで担保されているため、既存の`DashboardView.tsx`の書き方に合わせ理由コメント付きで disable | `9756212` `ccf51bb` `453224a` `aa554e8` |
| **C：role="button" tabIndex onKeyDown 実装（約20箇所）** | ProjectKarte/DashboardView/GanttView(グループ見出し)/OkrDashboardView(KRカード)/InlineEditText・Date・Assignee/AdminView(マイルストーン行)/SessionHistoryPanel/KanbanView(TaskCard本体)/ListView(モバイル行)/MeetingImportPanel(ドロップゾーン・色スウォッチ)/ProjectStructureView(役割・層名・グループ名編集) 等に実装し、実際にキーボードで操作可能にした | `f5a77e4` `44a4c08` `d3778e3` |
| **D：eslint-disable（ドラッグ/リサイズ系、約10箇所）** | Ganttのリサイズハンドル・列幅ディバイダー、ListViewのドラッグハンドル、FileAttachButton/KrJointSessionFlowのドロップゾーン等。いずれも別途キーボード操作可能な代替手段（クリックボタン・直接入力）が存在することを確認済み | 同上 |
| **MainLayout モバイルラボボトムシートの実修正** | 唯一「項目を選ばずに閉じる手段が背景クリックしかない」ケースだったため、eslint-disableで済ませず`role="button" tabIndex onKeyDown`（Enter/Space/Escape）を追加し実際にキーボードで閉じられるようにした | `aa554e8` |
| **ProjectStructureView デッドコード削除** | `_hasDropdown`/`setHasDropdown`は`setHasDropdown(true)`を呼ぶ箇所が皆無で常にfalse＝到達不能と判明したため、state宣言とオーバーレイJSXごと削除 | `d3778e3` |

対象2ルールは133 problems（75箇所・34ファイル）→ **0** に。tsc/vitest(158)/buildは全コミットで確認。残る`label-has-associated-control`等は別ルールにつきM15として次回候補へ。

## 完了済み（2026-07-06）実バグ3件 + 機械的スイープ2件

| 項目 | 内容 | コミット |
|------|------|---------|
| **AdminView.tsx フック順序違反** | 管理者ガードの早期returnが`useAppStore`/`useState`より前にあり、メンバーデータの非同期読み込み中にガード判定が変わるとフック数がずれてクラッシュしうる状態だった（TaskEditModalで過去に修正した画面真っ白と同一パターン）。全フック宣言の後にガードを移動 | `87bf228` |
| **App.tsx フック順序違反＋依存配列漏れ** | `isMisconfigured`早期returnがフックより前（モジュール定数のため実害は低いが解消）。`AuthenticatedApp`内`useEffect`に`setCurrentGroupId`（zustand安定参照）が漏れていたのを追加 | `63259ab` |
| **GanttView.tsx スクロール位置保存バグ** | `handleGanttScroll`の依存配列に`dayWidth`が漏れており、ズーム変更後も古いdayWidthで中心日付を計算・保存していた実バグ | `13b7aac` |
| **未使用変数スイープ（11件）** | ConsultationPanel/KanbanView/KrQuarterPlanPanel/MainLayout/applyProposal/appStoreの未使用props・deadコードを除去。MainLayoutのSidebarからOKRタブ再編（v2.9〜2.12）で使われなくなった5propsを削除 | `d523586` |
| **exhaustive-deps違反6件（うち2件は実バグ）** | useAIConsultation.tsの`submit()`が`currentMemberId`/OKR系4値を参照しているのに依存配列に無く、生成後にこれらが変わってもstale closureのままAI送信される実バグ。ListView.tsxの`filteredTasks`に`krTaskIds`が漏れKR切替時に絞り込みが更新されない実バグ。他4件は意図的な依存配列にeslint-disableで理由明記、または不要な依存の削除 | `69b5e52` |
| **AI紫のhexハードコード置換** | globals.css定義済みだが利用0件だった`--color-ai-*`/`--gradient-ai*`トークンを、AI相談パネル・AI分析ボタン・KRレポート/なぜなぜ/クォーター計画/セッション記録・AIプログレスローダー等13ファイルの「AI機能を示す紫」に適用（30箇所超）。PJカラーパレット・状態バッジ・OKR選択状態など無関係な紫（同系統の色を流用しているだけの箇所）は対象外と判断し据え置き。グラデーション角度は元の値を保持 | `bb2dd8e` |

いずれも `tsc --noEmit` クリーン・vitest 155/155 pass・build成功で検証。ESLint 200→171 problems（rules-of-hooks 10→0、no-unused-vars 11→0、exhaustive-deps 8→0）。

## 完了済み（2026-05-29）simplify スイープ A / C ＋ 旧PJ作成系統の削除

| 項目 | 内容 | コミット |
|------|------|---------|
| 旧PJ作成系統の削除 | AI相談の `add_project` 提案にPJ作成が一本化済み（フェーズ2完了）のため、未使用の `AiProjectCreateModal.tsx`（＋空になった `components/project/`）と専用バックエンド `projectPlanClient.ts` を削除 | `0ab6776` |
| **A: 死にコード/未使用スイープ** | 未使用 import/ローカル変数/catch 束縛/死に state/不要 eslint-disable を除去、文として使われた短絡・三項を if 化、死に関数 `CenterMessage` 削除（13ファイル）。no-unused-vars 30→7（残7はコンポーネント props/args で別途） | `02a1b5e` |
| **C: active() 集約（= M6）** | `EXPR.filter(x => !x.is_deleted)` → `active(EXPR)` を 65箇所 / 24ファイルで置換。複合条件・型付きコールバックは据え置き。冗長な `(x ?? [])` ガードは `active` が吸収するため除去 | `ec7c886` |
| B: irregular-whitespace（対象外と判明） | 11件は全て意図的な U+3000。5件は全角スペースを拾う正規表現（JS `\s` は U+3000 を含まないため機能上必須）、6件は日本語の表示用スペース。変換は挙動か可読性を損なうため**変更なし** | — |

いずれも `tsc --noEmit` クリーン・vitest 135/135 pass で検証。

## 完了済み（2026-04-25〜26）

| 項目 | 内容 | ファイル |
|------|------|---------|
| M2 | QuickAddTaskModal を MainLayout から切り出し | `src/components/task/QuickAddTaskModal.tsx` |
| M3 | AppDataContext の value を useMemo でラップ | `src/context/AppDataContext.tsx` |
| M4 | SVGアイコンを NavIcons.tsx に集約 | `src/components/common/icons/NavIcons.tsx` |
| M5 | STATUS/PRIORITY 定数を taskMeta.ts に集約 | `src/lib/taskMeta.ts` |
| M7 | localStorage キーを KEYS as const に集約 | `src/lib/localData/localStore.ts` |
| - | 日付ユーティリティを date.ts に集約 | `src/lib/date.ts` |
| - | getErrorMessage を errorMessage.ts に集約 | `src/lib/errorMessage.ts` |
| - | renderLinks（URL自動リンク）を共通化 | `src/lib/renderLinks.tsx` |
| - | AI専用型を ai/types.ts に分離（循環依存解消） | `src/lib/ai/types.ts` |
| L4 | AutoTextarea の JS フォールバック削除（CSS field-sizing で代替） | `src/components/admin/AdminView.tsx` |
| L5 | CLAUDE.md の `todo_id → todo_ids` 記述更新 | `CLAUDE.md` |

## 完了済み（2026-05-08）メンバータグ Phase Tag-1（DB＋管理画面）

| 項目 | 内容 |
|------|------|
| **DB マイグレーション** | `member_tags` テーブル（kind: static/all_members/kr_members/tf_members の4種類対応・Phase 1 は static のみ運用）と junction `member_tag_members` を追加。RLS・updated_at トリガ・index も整備。`schema.sql` 同期 |
| **型** | `MemberTag` / `MemberTagKind` / `MemberTagMember` を `localData/types.ts` に追加 |
| **ストア** | `upsertMemberTag` / `softDeleteMemberTag` / `replaceMemberTagMembers`（差し替え戦略：既存削除→一括INSERT）を追加。fetchAllData にも統合 |
| **AppStore** | zustand に `memberTags` / `memberTagMembers` state、`saveMemberTag(tag, memberIds)` / `deleteMemberTag` アクション追加 |
| **管理画面** | 「メンバータグ」タブを新設（TagsSection）。タグの新規追加・編集・削除・メンバー紐付け（チェックボックス multi-select・全員選択/全解除ボタン）・タグ一覧表示・空状態の案内 |
| **マイグ未適用への配慮** | fetchAllData は `member_tags` / `member_tag_members` の取得失敗時にも他テーブルが動くようフォールバック（空配列） |

Phase Tag-2 / Tag-3（タスクへの紐付け／ AI への展開／ all_members 自動同期）は未実装。

## 完了済み（2026-05-08）グランドルール「エラー表示」追加 + 既存catchを一括置換

| 項目 | 内容 | コミット |
|------|------|---------|
| **CLAUDE.md Section 15 新設** | 「エラーが発生しました」だけの表示を禁止し、`formatErrorForUser()` 経由で必ずエラーコード・details・hint を表示するルールを明文化 | `1c26691` |
| **errorMessage.ts 拡張** | `formatErrorForUser(prefix, e)` を追加。Supabase の PostgrestError（`code` / `details` / `hint`）も整形して `"保存に失敗しました [42703] column \"summary\" does not exist"` のように表示 | 同上 |
| **既存 catch を 10 ファイル一括置換** | KrSessionPanel / KrWhyPanel / KrQuarterPlanPanel / KrReportPanel / ConsultationPanel / AiProjectCreateModal / MeetingImportPanel / TodoDecomposeModal / applyProposal / undoApply | 同上 |
| **errorMessage テスト 10本** | `formatErrorForUser` の Supabase エラー整形・details 重複回避・プリミティブ受容をカバー（合計 71 テスト pass） | 同上 |

## 完了済み（2026-05-08）OKR freeform セッション追加（Phase D-1 + D-2）

| 項目 | 内容 | コミット |
|------|------|---------|
| **DB マイグレーション** | `kr_sessions.session_type` の CHECK 制約に `'freeform'` を追加。`summary` / `decisions` / `kr_mentions` の3列を追加（既存セッションには空文字デフォルトで影響なし）。`schema.sql` も同期 | （次のコミット） |
| **AI 抽出器拡張** | `extractFreeformSession()` を追加。OKR/TF が議題中心の自由形式会議から「議論サマリ・決定事項・言及されたKR・フォローアップタスク」をJSON抽出。`FREEFORM_EXTRACT_PROMPT` 新設。AIIntent タグは既存の `kr-session-extract` を共用（同種の payload 性質） | 同上 |
| **抽出器テスト 8本** | `krSessionExtractor.test.ts` で `extractFreeformSession` の正常系・異常系（壊れたJSON・型不正・配列でない等）をカバー。`vi.mock("../invokeAI")` で実 API を呼ばずテスト | 同上 |
| **KrSessionPanel UI** | session type 選択肢に「その他のOKR議論」を追加（3択）。`FreeformConfirmStep` を新設し、議論サマリ・決定事項リスト・言及KRリスト・フォローアップタスクをそれぞれ編集可。保存時は `kr_sessions` の3列＋`kr_declarations` (result_status=null) として記録 | 同上 |
| **連動修正** | `OkrDashboardView` の SESSION_TYPE_LABEL/ICON と EditDraft 型に freeform 対応。`KrQuarterPlanPanel` のシグナル履歴は freeform を除外（signal=null のため履歴に意味がない） | 同上 |

合計 69 テスト pass・型チェック OK・ビルド成功。

## 完了済み（2026-05-08）A11y Phase 1：ESLint + jsx-a11y 導入

| 項目 | 内容 | コミット |
|------|------|---------|
| **ESLint v9 + jsx-a11y セットアップ** | `eslint`・`@eslint/js`・`typescript-eslint`・`eslint-plugin-react`・`eslint-plugin-react-hooks`・`eslint-plugin-jsx-a11y`・`globals` を devDeps 追加。flat config (`eslint.config.js`) で React 18 + jsx-a11y recommended ルール一式を `error` で固定。`npm run lint` / `lint:fix` 追加 | （次のコミット） |
| **fix: TaskEditModal の React Hooks ルール違反 8件**（実バグ） | `if (!originalTask) return null;` が `useMemo`/`useCallback` より前に置かれ、Hooks の呼び出し順序が条件分岐していた（`react-hooks/rules-of-hooks` 違反）。null guard を Hook 内部に移し、early return を全 Hooks の後ろに移動。これにより React の hooks 不整合エラーで画面真っ白になるリスクが除去された | 同上 |

### 残違反のベースライン（180 problems = 131 errors + 49 warnings）

ESLint 導入時点でのベースライン。次セッション以降のスイープ対象：

| ルール | 件数 | 種別 | 備考 |
|---|---|---|---|
| `jsx-a11y/no-static-element-interactions` | 50 errors | a11y | div onClick → button 化 |
| `jsx-a11y/click-events-have-key-events` | 43 errors | a11y | 上のペア（同箇所が両方計上） |
| `jsx-a11y/label-has-associated-control` | 20 errors | a11y | フォームの label 紐づけ |
| `no-irregular-whitespace` | 10 errors | 品質 | OkrDashboardView.tsx 1ファイルに集中 |
| `jsx-a11y/no-autofocus` | 8 warnings | a11y | autoFocus の撤去 |
| `react-hooks/exhaustive-deps` | 7 warnings | 品質 | useCallback/useMemo 依存配列 |
| `jsx-a11y/no-noninteractive-element-interactions` | 3 warnings | a11y | li/span の click |
| `@typescript-eslint/no-unused-expressions` | 2 errors | 品質 | ListView.tsx |
| `no-useless-escape` | 1 error | 品質 | meetingExtractor.ts |
| `@typescript-eslint/no-unused-vars` | 30 warnings | クリーンアップ | 未使用 import |
| ~~`react-hooks/rules-of-hooks`~~ | ~~8 errors~~ | ~~実バグ~~ | **解消済（このコミットで修正）** |

実 a11y 違反は 50 + 20 + 11 ≒ 81 ヶ所相当。実質作業は **1ファイル単位の機械的 sweep**（次セッションで実施）。

## 完了済み（2026-05-08）テスト基盤 Phase A・B・C

合計 53 テスト・3 ファイル。`npm test` で全部回る。

| 項目 | 内容 | コミット |
|------|------|---------|
| **vitest セットアップ** | `vitest` 3 + `@vitest/coverage-v8` を devDeps 追加。`vitest.config.ts` 作成。`npm test` / `test:watch` / `test:coverage` スクリプト追加 | `feec28b` |
| **sanitize テスト 13本** | `src/lib/ai/__tests__/sanitize.test.ts` でネットワークパス／UNC／ローカルパス／メール／複合／イミュータブル性をカバー | `feec28b` |
| **fix: UNCパス正規表現が URL を破壊するバグ** | `sanitizeComment` の UNCパス検出（`//host/path`）が `https://example.com/...` の `//example.com/...` 部分にもマッチして AI ペイロードの URL を `https:[ファイルパス省略]` に壊していた。負の後読み `(?<!:)` で URL を除外 | `feec28b` |
| **payloadBuilder テスト 22本** | AI境界（contribution_memo・okr_context が漏れない）／論理削除/archived の除外／shortId とマップ／コメントサニタイズ統合／会計四半期判定（1月=1Q・12月→翌年1Q）／メンバー工数集計／OKRモード（is_deleted KR/TF 除外）／ToDo 仮想PJ化／retry_hint をカバー。`deepHasKey` ヘルパーで漏洩を再帰検査 | `f4b8714` |
| **applyProposal テスト 18本** | Supabase クライアントを `vi.mock` で thenable な query builder に差し替え。**物理削除しないこと（CLAUDE.md Section 4）を機械保証**（`.delete()` 呼び出しを検知すればテスト失敗）／scope_reduce/pause が `is_deleted=true` で UPDATE すること／needs_confirmation 系（date_change・assignee）が SELECT のみで UPDATE しないこと／risk・no_tasks・deadline_risk が SELECT+UPDATE の2ステップ＋楽観ロック付きで comment 追記すること／競合検知エラー／add_task の INSERT 時 status="todo"・is_deleted=false／空名タスクのスキップ／milestone/info の error 返却／確認後の date_change/assignee/add_task 確定処理をカバー | （次のコミット） |

## 完了済み（2026-05-01〜02）大規模対応

| 項目 | 内容 | コミット |
|------|------|---------|
| - | **lazy load**: ビュー/ラボパネルを `React.lazy` 化（初回バンドル 105kB→95kB gzip） | `0ed8e50` |
| - | **DB 最適化**: 索引24本追加・schema.sql 統合・admin_change_logs 自動削除（pg_cron）・サーバー側 is_deleted フィルタ | `6d15e47` |
| - | **localStorage 一元化**: KEYS / LS_KEY ビルダー + `migrateLocalStorage()` でスキーマバージョン管理 | `f73e4a6` |
| - | **Refined Stationery テーマ**: インクブルーへ・暖色寄り紙質背景・Noto Serif JP 補助フェイス | `7a20394` |
| - | **致命的レビュー指摘 ①〜⑥ 修正**: ErrorBoundary・楽観ロック（`saveWithLock` + `ConflictError`）・catch 握りつぶし修正・AIIntent 型ガード・active() ヘルパー・AI 紫トークン化（基盤） | `48e4e9d` |
| **H4 完了** | **zustand 移行（旧 H1 高リスク扱いの本体）**: AppDataContext を 40行 Wrapper に縮小、22 コンポーネントを `useAppStore(s => s.X)` selector 形式に移行。再レンダー範囲の絞り込み実現 | `3d04b3e` `288c3e6` |
| - | リスト一括操作（チェックボックス＋ステータス/担当者/削除一括変更）、サイドバー「自分のPJ」フィルタ、なぜなぜTFを現Q絞り込み | `0793f57` |

---

## 未完了・次回候補

### 中優先度
| 項目 | 内容 | 難度 | 備考 |
|------|------|------|------|
| ~~M1~~ | ~~GanttView コンポーネント分割（ヘッダー・バー・ラベル列を別コンポーネントへ）~~ | — | **完了（2026-07-06 / `80493da`）** パフォーマンス改修の一環でTaskBarRow・PJ/ToDo/人別ラベル行をGanttParts.tsxへ分割・React.memo化 |
| ~~M6~~ | ~~`is_deleted` フィルタを `active()` ヘルパーで集約~~ | — | **完了（2026-05-29 / `ec7c886`）** 単一条件 65箇所を集約。複合条件・型付きコールバックは意図的に据え置き |
| M8 | globals.css 整理（アニメーション定義の整理） | 低 | 未使用CSS変数なし確認済み。アニメーションの整理のみ |
| M9 | TaskCard 共通化（KanbanView・ListView のカード部品共通化） | 高 | 各ビューで構造が大きく異なるため慎重に |
| M10 | ConsultationPanel 整合性確認（AI境界ルール遵守チェック） | 低 | 基本的に問題なし。念のため再確認程度 |
| M16 | GraphView：Realtimeでのデータ更新のたびpan/zoom/凡例の絞り込み/ドラッグでピン留めしたノード位置がリセットされる | 中〜高 | 初期化`useEffect`の依存配列が`[nodes, edges, resize]`で、`nodes`/`edges`はuseMemo経由でtasks/objectives等の変化のたびに再計算される。他者がタスクを1件更新しただけで`stateRef.current`が丸ごと再生成されるため発生。直すには「transform/hiddenTypes/pinned位置は保持しつつノード集合だけ差分更新する」設計が要る（ノードID単位でマージし、新規ノードのみ初期位置を割り当てる等）。2026-07-21のH グラフ点検で発見・小さい修正では済まないため次回候補へ |
| ~~M11~~ | ~~親子ステータス・進捗集計の一元化~~ | — | **完了（2026-07-06 / `5feb485`）** ListViewの`derivedByParentId`が`taskHierarchy.ts`の`rollupStatus`/`parentProgress`と同じロジックを再実装していた分を`buildParentDerivedMap()`に統合。回帰テスト3本追加。**残課題**：GanttView`orderTasksHierarchically`・ListView`buildRows`（表示順序・ネスト構築）はステータス集計とは別の関心事のため対象外とした。統合するとかえって複雑になる可能性があり、着手する場合は要設計判断 |
| M12 | スタイル定数の共通化 | **要設計判断（2026-07-06調査で判明）** | 当初「機械的sweep」と見立てたが精査の結果、`inputStyle`/`ghostBtnStyle`等は各ファイルでpadding/fontSize/borderRadiusが微妙に異なり意図的なチューニングと判明。モーダルオーバーレイ（`position:fixed,inset:0`）はzIndexが90〜9999まで箇所ごとに異なり重なり順を担っている。単純統合は複数画面の見た目・重なり順を壊すリスクがあるため、サイズバリアント設計（例：sm/md/lg）を先に決めてから着手すること |
| ~~M13~~ | ~~KanbanView内蔵`AddTaskModal`とQuickAddTaskModalの統合~~ | — | **完了（2026-07-06 / `95409b1`・CLAUDE.md v2.21）** QuickAddTaskModalに統一。優先度欄を移植、工数・複数TF/追加PJ紐づけは山本さん承認の上で廃止（作成後にTaskEditModalで設定）。KanbanViewから約300行削減・バンドルサイズ19KB→10KB |
| ~~M14~~ | ~~ListViewモバイルカード行のReact.memo化~~ | — | **完了（2026-07-06 / `ca087f9`）** ListMobileTaskRowとして切り出しmemo化。担当者配列・親ステータス/進捗も参照安定化 |
| M15 | a11yスイープ残課題（`label-has-associated-control` 11件・`no-irregular-whitespace` 13件・`no-autofocus` 6件・`no-noninteractive-*` 6件） | 低〜中 | Phase 4完了（下記）の残り。label紐づけは`<label htmlFor>`か`aria-label`付与、irregular-whitespaceは前回調査済み分（全角スペース意図的使用）以外を要確認 |
| M17 | DashboardView.tsxの全PJ横断分析（`runAllProjectsAnalysis`）が担当者ごとの未完了タスク件数（`assignee_loads`）を独自に`loadMap`で再集計しており、`lib/workload/computeWorkload.ts`の`getMemberActiveTasks`（ワークロードビューが使う同種の集計）とロジックが似通っている | 低〜中 | 2026-07-21のE PJ別AI分析点検で発見。`computeWorkload.ts`はメンバー単位・こちらはPJ単位で集計方向が違うため単純な関数共有では済まない可能性があり、統合するなら集計関数のシグネチャ設計から要検討 |
| M18 | ダッシュボードのリマインダー選択（`DashboardView.tsx`）に`notify_pref`の選択肢として「💬 Teamsまとめ」があるが、`notify-deadlines`のEdge Functionは2026-07-02の変更で「個人opt-in」から「notify_prefを見ず全員へ配信」に方式転換済み（`docs/dev/deadline-notifications.md`に明記）。そのため「teams」を選んでも「none」を選んだ場合とアプリの実挙動は完全に同一（差が出るのは`browser`を選んだときだけ）。選択肢を削除する／ラベルを「（全員に自動送信されます）」等へ修正する／将来の個別Teams配信機能の受け皿として意図的に残す、のいずれを取るかはUX判断が必要 | 低 | 2026-07-21のI 通知点検で発見。コード上のバグではなく2026-07-02の仕様変更後にUI文言側の追従が漏れていた形。修正は見送り |
| M19 | 統合ツアー（`src/components/tour/tours/first-time.ts`）が「welcome」〜「done」まで11ステップで構成されており、`docs/dev/tour-guidelines.md` §9の「1ツアーあたり7〜9ステップを上限（疲労防止）。超える場合はテーマで分割するか、後半を任意の続編ツアーにする」を超過している | 中 | 2026-07-21のG オンボーディング点検で発見。ステップ削減・テーマ分割（例：基本操作編／AI機能編の2本立て）・続編ツアー化のいずれを取るかは内容の再設計が要るためtour-guidelines.md §11チェックリストに沿って慎重に着手すること |
| M20 | 統合ツアーのタイトル絵文字の付け方が`tour-guidelines.md` §4「タイトルの絵文字は1つだけ・意味のあるもの」からズレている：「sidebar」「nav」の2ステップは絵文字が0個、「pj-karte-btn」（📊 ここが「✨ AI分析」ボタンです）は2個ついている | 低 | 2026-07-21のG オンボーディング点検で発見。0個の2ステップにどの絵文字を足すか、2個の1ステップでどちらを残すかは文言選定の判断が要るため次回候補へ。M19（ステップ分割）と合わせて本文を触るタイミングでまとめて対応するのが効率的 |
| M21 | `lib/supabase/krMeetingNoteStore.ts`の`softDeleteKrMeetingNote`（会議ノートの論理削除関数）がエクスポートされているが、呼び出し元がコードベース内に0件（会議ノートを削除するUI自体が存在しない） | 低 | 2026-07-21のD OKR 6回目巡回（①会議ノート）で発見。5回目に見つけた`okrAnalysisStore.ts`の未使用export2件と同種のパターン。会議ノート削除UIを追加する（他層＝KR/TF/PJ等と同じ論理削除UXに揃える）か、使われていない関数を削除するかはUX判断が要るため次回候補へ |
| M22 | `OkrDashboardView.tsx`の`KrSessionHistory`（セッション履歴の編集UI）が、`freeform`（③その他のOKR議論）セッションを編集しようとすると「種類」ラジオボタンが`checkin`/`win_session`の2択しかなく現在の種類を表示できない。またfreeform固有の`summary`/`decisions`/`kr_mentions`欄は編集モードに存在せず閲覧専用のまま | 中 | 2026-07-21のD OKR 7回目巡回で発見。freeformセッションの編集機能を作り込む（3種類目のラジオ＋専用欄追加）か、freeformは編集不可とUI上で明示するかはUX判断が要るため次回候補へ |
| M23 | `lib/supabase/krReportStore.ts`の`softDeleteKrReport`（KRレポートの論理削除関数）がエクスポートされているが、呼び出し元がコードベース内に0件（レポート削除UI自体が存在しない） | 低 | 2026-07-21のD OKR 8回目巡回（④レポート作成）で発見。5回目`okrAnalysisStore.ts`・6回目`krMeetingNoteStore.ts`の`softDeleteKrMeetingNote`と同種のパターン。レポート削除UIを追加する（他層と同じ論理削除UXに揃える）か、使われていない関数を削除するかはUX判断が要るため次回候補へ |
| M24 | `appStore.ts`の`quarterlyKrTaskForces` state・`addQuarterlyKrTaskForce`/`removeQuarterlyKrTaskForce`アクション、`store.ts`の対応するfetch（2箇所）・`insertQuarterlyKrTaskForce`/`deleteQuarterlyKrTaskForce`関数が、2026-05-26のTF→四半期判定モデル移行（`quarterly_kr_task_forces`テーブルベース→`TaskForce.quarter`列ベース）後、UIからの呼び出し元が丸ごと0件のまま残置されている（`quarterlyKrTaskForces` stateはfetchするだけで読むコンポーネントが無い） | 中 | 2026-07-21のD OKR 11回目巡回（クォーター計画・最終サブ領域）で発見。フロントエンドのコード削除自体（state・アクション・store関数）は安全に行えるが、DB側の`quarterly_kr_task_forces`テーブル・関連migration・`docs/dev/data-model.md`の扱い（テーブル自体をdropするかは別のマイグレ判断）まで含めると設計判断が要るため次回候補へ。フロント削除のみを先行させる場合も`docs/dev/data-model.md`のER図・テーブル一覧の記述更新を合わせて行うこと |
| M25 | `SetupWizard.tsx`が新規作成するメンバーに`group_id`を一切設定せず、`appStore.saveMember`の`get().currentGroupId ?? undefined`フォールバックに委ねているが、SetupWizard実行時点では`currentGroupId`が一度も更新されない（`null`のまま）。マルチテナンシーのRLS（`members_group`：`group_id = current_member_group_id() OR current_member_is_super_admin()`。`current_member_group_id()`は`email = auth.email()`でmembers行を検索）の下では、該当emailにマッチするmembers行がまだ存在しない真に新しいテナントの最初のメンバー作成時、`current_member_group_id()`も`current_member_is_super_admin()`もNULL/falseとなりINSERTがRLSに拒否される可能性が高い | **高（要セキュリティ設計判断）** | 2026-07-21の認証・入口12回目巡回で発見。既存の`grp-egg`は移行時の一括バックフィルで存在するため未顕在化だが、AID自身を含め今後「メンバー0人の新規グループ」がSetupWizard経由で立ち上がろうとした瞬間に起こりうる。RLSポリシーへのブートストラップ許可追加か、運用を「スーパー管理者が先に自分のmembers行を作ってから招待」方式に倒すかの判断が必要なためコードは変更せず記録のみ |
| M26 | `LoginScreen.tsx`のログイン/新規登録失敗時メッセージが、実際のSupabaseエラー内容を一切見せず`auth.error.loginFailed`/`auth.error.signupFailed`（emailAlreadyRegisteredのみ個別判定）に固定表示している。CLAUDE.md Section 15の趣旨（詳細を見せて診断可能にする）とは逆方向だが、ログイン画面で詳細を出すとユーザー列挙等のセキュリティリスクにつながりうる意図的設計の可能性が高い | 低〜中 | 2026-07-21の認証・入口12回目巡回で発見。診断性とセキュリティのトレードオフの設計判断が要るため次回候補へ |
| M27 | アプリ内ヘルプ`docs/guides/01_onboarding/first-day.md`・`06_troubleshooting/faq.md`・`03_roles/admin.md`・`05_admin/objective-kr-tf.md`（いずれも`last_updated: 2026-05-15`）がSupabase Auth（メール/パスワードのログイン・新規登録＝LoginScreen、2026-03-18導入）に一切触れておらず、「メンバー選択画面で自分の名前を選ぶ」がログインの最初のステップであるかのように書かれている。admin.mdの「メアドを登録（ログイン用）」もmembers.emailを設定するだけでログインできるかのように読める | 中 | 2026-07-21の認証・入口12回目巡回で発見。正しい記述に書き換えるには実際の運用（自己登録か管理者発行か）の確認が要るため次回候補へ |

### 低優先度
| 項目 | 内容 | 難度 | 備考 |
|------|------|------|------|
| L1 | TFRow の props 削減（editing state を内部化） | 中 | 親側の「1つだけ編集中」制御ロジックに影響する可能性あり |
| ~~L2~~ | ~~useMemo の依存配列見直し（過不足チェック）~~ | — | **完了（2026-07-06）** exhaustive-deps違反6件を解消（2件は実バグ：useAIConsultation stale closure・ListView krTaskIds未反映） |
| L3 | 型定義の整理（Task.comment が string | undefined か string かの統一） | 低 | `comment: string` で統一済みの可能性あり。確認のみ |

### 高リスク
| 項目 | 内容 | 状態 |
|------|------|------|
| H1 | AdminView.tsx の完全分割（2026-07-06時点で3,081行まで増加） | **保留**（state 依存が複雑・効果が見合うか要見極め） |
| H4 | AppDataContext を Custom Hook 群に分割 | **完了（zustand 移行で代替）** 2026-05-02 / `288c3e6` |

### シニアレビュー指摘の残課題（2026-05-02 監査時点）
| 項目 | 内容 | 工数目安 |
|------|------|---------|
| ~~A11y Phase 2: a11y スイープ~~ | ~~ESLint 導入済（`npm run lint`）。残 131 errors / 49 warnings（実 a11y 違反 81 箇所相当）をファイル単位で sweep~~ | **完了（2026-07-06）** `no-static-element-interactions`/`click-events-have-key-events` の2ルール（計133 problems/75箇所/34ファイル）を全解消。残る `label-has-associated-control`(11)・`no-irregular-whitespace`(13)・`no-autofocus`(6)・`no-noninteractive-*`(6) は別ルールにつき次回候補へ |
| **RLS 細分化** | 全テーブル `using (true)` を owner/role ベースに（業務側でロール定義決定後） | 1 週間 |
| ~~**テスト基盤**~~ | ~~vitest セットアップ + sanitize/payloadBuilder/applyProposal の最低限テスト~~ | **Phase A・B・C 全て完了（2026-05-08・1セッション）** |
| ~~AI 紫の全置換~~ | ~~hex を `var(--color-ai-*)` に置換~~ | **完了（2026-07-06 / `bb2dd8e`）** AI機能を示す紫のみ対象（30箇所超）。PJカラー等の無関係な紫は対象外と判断 |
| ~~`active()` の全適用~~ | ~~各コンポーネントの `.filter(x => !x.is_deleted)` を集約~~ | **完了（2026-05-29 / `ec7c886`）** 単一条件 65箇所を集約済み |

---

## 今後のリファクタリングセッションの進め方

```
1. このファイルを読む（Claude Code が自動で読む）
2. git pull してから開始
3. 「次回候補」から1〜2テーマ選んで実施
4. 完了したら「完了済み」に移動 → コミット＆プッシュ
5. 1セッション 20〜30k トークン以内を目安に
```

---

## コスト参考
- 2026-04-25〜26 セッション：約 50k トークン消費
  - うち約 15〜20k はマージコンフリクト解消（`git pull` 忘れによる無駄）
  - 作業自体は 30〜35k トークンが妥当な見積もり

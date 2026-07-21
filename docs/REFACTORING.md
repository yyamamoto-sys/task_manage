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
| 認証・入口 | 2026-05-29 | 2026-05-29（`02a1b5e` simplifyスイープAでSetupWizardのデッドコード除去） | 約904行 | 既存表になし | LoginScreenのi18n Phase1化（07-02）は機能追加であり技術的負債の点検ではない |
| A 計画ビュー | 2026-07-07 | 2026-07-07（`ListView`のborder幅reflowバグ根本修正）／2026-07-06（M11ロールアップ集約`5feb485`） | 約11,930行（dashboard/gantt/kanban/list/task/milestone/workload計） | M9 TaskCard共通化（高難度・未着手）／M12 スタイル定数共通化（要設計判断） | **2026-07-17〜19に依存関係(B1-B4)・ワークロード・ガント/ダッシュ/リスト/カンバン刷新が集中投入され、点検日以降の増分が最大**。次点検の最有力候補 |
| B AI相談 | 2026-07-06 | 2026-07-06（`69b5e52`exhaustive-deps実バグ修正／`d523586`未使用変数スイープ） | 約2,919行 | M10 ConsultationPanel整合性再確認（低優先） | — |
| C 会議読み込み | 2026-07-06 | 2026-07-06（a11yスイープでMeetingImportPanelのドロップゾーン対応） | 約1,448行 | 既存表になし | 技術的負債の専用点検は未実施（a11y横断調査で軽く触れたのみ） |
| D OKR | 2026-07-06 | 2026-07-06（a11yスイープでKRカード対応／未使用変数スイープでKrQuarterPlanPanel対応） | 約7,562行（okr/lab計） | 既存表になし | 週次循環ワークフロー（①会議ノート→②セッション→③分析→④レポート）が複雑化しており、専用の技術的負債点検は2026-05-13の機能実装以降未実施。次点検の有力候補 |
| E PJ別AI分析 | 未点検 | 未点検 | 約317行 | 既存表になし | 小規模。今回`allProjectsAnalysisClient.ts`（全PJ横断分析）の存在をmodule-mapに追記 |
| F 管理・設定 | 2026-07-19 | 2026-07-19（v2.63〜67 AdminView刷新：Card/DangerZone抽出・色トークン化） | 約3,270行（AdminView.tsx単体） | **H1（AdminView.tsx完全分割）は保留のまま現存・触らない** | 見た目/構造の刷新は完了したが、H1本体（機能分割）は未着手のまま |
| G オンボーディング | 未点検 | 未点検 | 約1,117行（tour/guide計） | 既存表になし | アニメーション統一（07-07）で表面的に触れたのみで技術的負債観点の点検記録はない |
| H グラフ | 未点検 | 未点検 | 約790行（GraphView.tsx） | 既存表になし | Canvas物理シミュレーションで複雑になりやすい領域。次点検の有力候補 |
| I 通知 | 未点検 | 未点検 | 約388行（フロントhook+Edge Function） | 既存表になし | 小規模。Edge Function側（`supabase/functions/notify-deadlines`）はgit push対象外・個別デプロイ運用の点に注意 |
| データ基盤 | 2026-07-06 | 2026-07-06（M11ロールアップ集約・taskHierarchy統合）／2026-07-03に参照安定性バグ実修正（zustandセレクタのメモ化漏れ） | 約3,426行 | OKR系テーブルのRLS未分離（マルチテナンシー残課題・別トラック管理） | v2.29〜32で依存関係/ベースラインstateが追加され複雑度上昇 |
| AI基盤 | 2026-06-26 | 2026-06-26（Edge Function CORS/レート制限のセキュリティ強化`af80481`） | 約5,262行 | ai-consultの`max_tokens`上限追加（2026-07-02）はコード変更済みだがEdge Function再デプロイ未実施（別途project memory記載の残課題） | — |
| 共通UI | 2026-07-17 | 2026-07-17（v2.33・`createPortal`系の全数調査＋pointer-events漏れ修正） | 約3,120行 | 既存表になし | 新規追加のCard/DangerZone/ShortcutsPanel/CommandPalette等は追加時の点検のみで専用のリファクタ点検は未実施 |
| ユーティリティ/フック | 2026-07-06 | 2026-07-06（taskHierarchy統合・未使用変数スイープ） | 約2,042行（lib直下+hooks直下） | L3 Task.comment型統一（低優先・確認のみ） | selectionRange/kanbanOrder/groupSummary等の新規ファイルはA計画ビュー側の実装として分類（本行の対象外） |

### 巡回ルール
- 次にどのユニットを触るか迷ったら、台帳で「最終点検日」が最古（または「未点検」）のユニットを優先する
- 1セッションにつき原則1ユニット、トークン予算20〜30k厳守（既存ルールを踏襲）
- 触った後は必ず台帳の該当行（最終点検日・最終リファクタ日・備考）を更新してからコミットする
- 高リスク項目（既存表のH1・H4）は台帳経由でも変わらず触らない

---

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
| ~~M11~~ | ~~親子ステータス・進捗集計の一元化~~ | — | **完了（2026-07-06 / `5feb485`）** ListViewの`derivedByParentId`が`taskHierarchy.ts`の`rollupStatus`/`parentProgress`と同じロジックを再実装していた分を`buildParentDerivedMap()`に統合。回帰テスト3本追加。**残課題**：GanttView`orderTasksHierarchically`・ListView`buildRows`（表示順序・ネスト構築）はステータス集計とは別の関心事のため対象外とした。統合するとかえって複雑になる可能性があり、着手する場合は要設計判断 |
| M12 | スタイル定数の共通化 | **要設計判断（2026-07-06調査で判明）** | 当初「機械的sweep」と見立てたが精査の結果、`inputStyle`/`ghostBtnStyle`等は各ファイルでpadding/fontSize/borderRadiusが微妙に異なり意図的なチューニングと判明。モーダルオーバーレイ（`position:fixed,inset:0`）はzIndexが90〜9999まで箇所ごとに異なり重なり順を担っている。単純統合は複数画面の見た目・重なり順を壊すリスクがあるため、サイズバリアント設計（例：sm/md/lg）を先に決めてから着手すること |
| ~~M13~~ | ~~KanbanView内蔵`AddTaskModal`とQuickAddTaskModalの統合~~ | — | **完了（2026-07-06 / `95409b1`・CLAUDE.md v2.21）** QuickAddTaskModalに統一。優先度欄を移植、工数・複数TF/追加PJ紐づけは山本さん承認の上で廃止（作成後にTaskEditModalで設定）。KanbanViewから約300行削減・バンドルサイズ19KB→10KB |
| ~~M14~~ | ~~ListViewモバイルカード行のReact.memo化~~ | — | **完了（2026-07-06 / `ca087f9`）** ListMobileTaskRowとして切り出しmemo化。担当者配列・親ステータス/進捗も参照安定化 |
| M15 | a11yスイープ残課題（`label-has-associated-control` 11件・`no-irregular-whitespace` 13件・`no-autofocus` 6件・`no-noninteractive-*` 6件） | 低〜中 | Phase 4完了（下記）の残り。label紐づけは`<label htmlFor>`か`aria-label`付与、irregular-whitespaceは前回調査済み分（全角スペース意図的使用）以外を要確認 |

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

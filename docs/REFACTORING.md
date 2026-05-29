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
| M1 | GanttView コンポーネント分割（ヘッダー・バー・ラベル列を別コンポーネントへ） | 中 | 日付 utils 抽出は完了。コンポーネント分割のみ残り |
| ~~M6~~ | ~~`is_deleted` フィルタを `active()` ヘルパーで集約~~ | — | **完了（2026-05-29 / `ec7c886`）** 単一条件 65箇所を集約。複合条件・型付きコールバックは意図的に据え置き |
| M8 | globals.css 整理（アニメーション定義の整理） | 低 | 未使用CSS変数なし確認済み。アニメーションの整理のみ |
| M9 | TaskCard 共通化（KanbanView・ListView のカード部品共通化） | 高 | 各ビューで構造が大きく異なるため慎重に |
| M10 | ConsultationPanel 整合性確認（AI境界ルール遵守チェック） | 低 | 基本的に問題なし。念のため再確認程度 |

### 低優先度
| 項目 | 内容 | 難度 | 備考 |
|------|------|------|------|
| L1 | TFRow の props 削減（editing state を内部化） | 中 | 親側の「1つだけ編集中」制御ロジックに影響する可能性あり |
| L2 | useMemo の依存配列見直し（過不足チェック） | 低 | eslint-plugin-react-hooks で自動検出可能 |
| L3 | 型定義の整理（Task.comment が string | undefined か string かの統一） | 低 | `comment: string` で統一済みの可能性あり。確認のみ |

### 高リスク
| 項目 | 内容 | 状態 |
|------|------|------|
| H1 | AdminView.tsx の完全分割（2400行 → 複数ファイル） | **保留**（state 依存が複雑・効果が見合うか要見極め） |
| H4 | AppDataContext を Custom Hook 群に分割 | **完了（zustand 移行で代替）** 2026-05-02 / `288c3e6` |

### シニアレビュー指摘の残課題（2026-05-02 監査時点）
| 項目 | 内容 | 工数目安 |
|------|------|---------|
| A11y Phase 2: a11y スイープ | ESLint 導入済（`npm run lint`）。残 131 errors / 49 warnings（実 a11y 違反 81 箇所相当）をファイル単位で sweep | 1〜1.5 週 |
| **RLS 細分化** | 全テーブル `using (true)` を owner/role ベースに（業務側でロール定義決定後） | 1 週間 |
| ~~**テスト基盤**~~ | ~~vitest セットアップ + sanitize/payloadBuilder/applyProposal の最低限テスト~~ | **Phase A・B・C 全て完了（2026-05-08・1セッション）** |
| AI 紫の全置換 | 54箇所の hex を `var(--color-ai-*)` に置換（基盤は `globals.css` で完了済み） | 機械的 sweep |
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

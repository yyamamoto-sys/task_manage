# カレンダー機能（CalendarLabView）改善調査レポート

調査日：2026-07-22　調査担当：strategist（企画エージェント）
対象：`src/components/lab/CalendarLabView.tsx`（384行）・呼び出し元 `src/components/layout/MainLayout.tsx`

過去のダッシュボード・カンバン改善（`git log` 上のCLAUDE.md v2.54〜v2.57／v2.68〜v2.72）と同じ型
「①現状の棚卸し → ②一般ツール調査 → ③突き合わせ → ④優先度提言（高優先／中優先／非推奨）」に従う。
本レポートは調査・提言のみで、実装は行っていない。

---

## 1. 現状把握

### 1.1 機能一覧（コード確認済み）

| 機能 | 内容 |
|---|---|
| 表示形式 | 月間カレンダーのみ（週・日・アジェンダ表示は無し） |
| 表示対象 | タスクの**期日（due_date）のみ**（`due_date` が無いタスクは表示自体から除外・44行目）。`start_date` は一切参照していない |
| マイルストーン | PJに紐づく◆マーカーをその日のセルに表示（ホバーで名称ツールチップ） |
| フィルタ | 👤自分のみ（`isAssignedTo`）／🙈完了を隠す（`status==="done"` のみ判定）／📁PJ絞り込み（複数選択トグル） |
| 備考欄 | 📝印刷用の自由記述欄（localStorage永続化・上司への注釈用） |
| 印刷 | 🖨️ボタンで `.cal-body` のみを印刷（`@media print` は `globals.css` に集約） |
| 起動方法 | サイドバー下部／モバイルヘッダーの🗓️ボタンから起動する**全画面オーバーレイ**（zIndex 250）。`MainLayout.tsx` が唯一の呼び出し元 |
| タスククリック | `onOpenTask` 経由でTaskEditModal（zIndex 300）を開く。編集・作成の直接操作は無し（読み取り専用ビュー） |
| 今日移動 | 「今日」ボタン・前月/次月ボタンのみ。週送りは無い |
| 表示日数 | 常に6週間（42セル）固定グリッド |

### 1.2 データフロー・制約

- `selectScopedTasks`/`selectScopedProjects` で部署スコープ済み（マルチテナンシー対応OK）
- 表示グリッド範囲（`gridRange`）外のタスク・マイルストーンは事前にスキップしパフォーマンスを確保（全期間ループを避ける設計）
- 1セルにつきタスクは最大4件表示、5件目以降は「+N件」の件数表記のみ（内訳は見えない）
- モバイル対応の分岐コードは無し（`useIsMobile` 等の参照なし）。7列×6行のCSS Gridがそのままモバイル幅に縮小される設計

### 1.3 v2.74〜v2.76（ステータス5値化）への追従状況 —— **未追従（実バグ）**

`src/lib/taskMeta.ts` には他ビュー（ガント・リスト・カンバン・ダッシュボード）が既に使っている以下のヘルパーが存在する。

```typescript
// src/lib/taskMeta.ts
export function isActiveTaskStatus(status): boolean       // todo/in_progressのみ
export function isPausedOrCancelledStatus(status): boolean // cancelled/on_hold
export function suppressOverdue(status): boolean           // done/cancelled/on_holdは期限超過表示を抑制
export function isCompletedForProgress(status): boolean    // done/cancelledは進捗上「完了」扱い
```

`CalendarLabView.tsx` のimportは `isAssignedTo` のみで、上記4関数はいずれも未使用。実際のコードは：

```typescript
// 91行目：完了を隠すフィルタ
if (hideDone && t.status === "done") continue;   // cancelled/on_holdは隠れない

// 345〜347行目：期限超過の赤字判定
const isDone = t.status === "done";
const isOverdue = ds <= todayStr && !isDone;      // cancelled/on_holdでも赤字強調されてしまう
```

**影響**：中止（cancelled）・保留（on_hold）にしたタスクが「🙈完了を隠す」をONにしても表示され続け、
かつ過去日付なら赤字（期限超過）で強調されてしまう。他の全ビュー（ガント v2.74・ダッシュボード v2.74・
リスト/カンバン v2.74）は既に是正済みで、カレンダーだけ取り残されている状態。

このズレが生じた理由も裏付けが取れている：リファクタ巡回台帳（`docs/REFACTORING.md`）の第6回巡回メモに
「`CalendarLabView.tsx`／`ProjectStructureView.tsx` はmodule-map.mdの正式なD OKR対象外と判明（ラボ系の
別ユニット扱い）」とあり、v2.74のステータス拡張時の横展開対象からも、その後の12ユニット巡回一巡（2026-07-22
完結）の対象からも外れたまま今日に至っている。

---

## 2. 一般ツールの標準機能調査（一次情報）

Asana／monday.com／ClickUp／Notion（プロジェクト・タスク管理系）とGoogle Calendar／Outlook（汎用カレンダー）、
Jira（PM系リファレンス）を横断して調査した結果、以下が業界標準として広く収束している。

| 機能 | 収束状況 | 出典 |
|---|---|---|
| 月／週／日（＋アジェンダ）の表示切替 | Asana・monday.com・ClickUp・Outlookで共通収束 | [monday.com Calendar Guide](https://monday.com/blog/project-management/monday-calendar/)／[Outlook Support](https://support.microsoft.com/en-us/office/change-how-you-view-your-outlook-calendar-a4e0dfd2-89a1-4770-9197-a3e786f4cd8f)／[ClickUp Calendar Help](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view) |
| ドラッグ&ドロップで日付を変更（リスケジュール） | Asana・ClickUp・Notion・Google Calendarで共通収束 | [Asana Forum](https://forum.asana.com/t/allow-to-drag-start-and-due-dates-in-calendar-view/1114161)／[ClickUp Help](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view)／[Notion Help](https://www.notion.com/help/guides/calendar-view-databases) |
| 開始日〜終了日にまたがる複数日イベントのバー表示 | Asana（Timeline統合）・Google Calendar（All-day行でのドラッグ作成）で収束 | [Asana Features](https://asana.com/features/project-management/project-views)／[Google Calendar Community](https://support.google.com/calendar/thread/215888274/modify-event-duration-over-multiple-days-in-month-view) |
| 色分け（ステータス／優先度／担当者／リスト） | monday.com・ClickUpで明示的機能として収束 | [monday.com Calendar Guide](https://monday.com/blog/project-management/monday-calendar/)／[ClickUp Help](https://help.clickup.com/hc/en-us/articles/7756018621207-Customize-and-categorize-tasks-in-Calendar-view) |
| フィルタ（グループ／担当者／ステータス） | monday.com・Notion・ClickUpで共通収束 | [monday.com Calendar Guide](https://monday.com/blog/project-management/monday-calendar/)／[Notion Help](https://www.notion.com/help/guides/calendar-view-databases) |
| カレンダーから直接新規作成 | Notion・ClickUp・Google Calendarで共通収束 | [Notion Help](https://www.notion.com/help/guides/calendar-view-databases)／[ClickUp Help](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view) |
| 週末の表示・非表示切替 | monday.com（除外オプション）・Outlook（Work Week表示）で収束 | [monday.com Calendar Guide](https://monday.com/blog/project-management/monday-calendar/)／[Outlook Support](https://support.microsoft.com/en-us/office/change-how-you-view-your-outlook-calendar-a4e0dfd2-89a1-4770-9197-a3e786f4cd8f) |
| 今日のハイライト | Google Calendarで標準機能として言及 | [Google Calendar Community](https://support.google.com/calendar/thread/284820914) |
| ワークロード（負荷）との連携表示 | Asanaが公式機能として統合 | [Asana Features](https://asana.com/features/project-management/project-views) |
| マイルストーンのダイヤ表示 | Jira Roadmapで標準機能 | [Atlassian Support](https://support.atlassian.com/jira-software-cloud/docs/schedule-and-track-work-in-the-calendar-view/) |
| 外部カレンダー（Google/Outlook）同期 | ClickUpで標準機能として言及 | [ClickUp Features](https://clickup.com/features/calendar-view) |
| AIによる自動スケジューリング／タイムブロッキング | ClickUpが2026年新機能として展開中 | [ClickUp Features](https://clickup.com/features/calendar-view) |
| 日次のタイムブロック（時間帯ドラッグ配置） | ClickUpが日/週ビューの機能として明記 | [ClickUp Help](https://help.clickup.com/hc/en-us/articles/6310085740183-Intro-to-Calendar-view) |

---

## 3. ギャップ分析と優先度

### 3.1 高優先

#### ① ステータス5値化への追従（実バグ修正）
- **何をするか**：`hideDone` 判定を `isPausedOrCancelledStatus` も含めて拡張（「完了・保留・中止を隠す」に文言変更も検討）。期限超過の赤字判定 `isOverdue` を `suppressOverdue` 経由に変更。
- **なぜ有用か**：一般ツール調査とは独立の論点。**自社の既存ルール（v2.74〜76）に単に追従していないだけ**であり、他ビュー全てと挙動が食い違っている状態を是正するもの。10名弱チームであっても「保留にしたタスクがカレンダー上だけ赤字のまま残る」のは実運用上の混乱要因になる。
- **重さ**：軽い。DBマイグレ不要。`taskMeta.ts` の既存関数をimportして条件式を差し替えるだけ。

#### ② タスクの視覚的階層強化（優先度・滞留の表現追加）
- **何をするか**：カード左端に優先度ストライプ（カンバンの `TASK_PRIORITY_STRIPE_COLOR` を流用）、または滞留（`isTaskStagnant`）バッジをカレンダーのタスク行にも表示する。
- **なぜ有用か**：現状カレンダーのタスク行はPJカラードット1つのみで視覚差が乏しい。ダッシュボード・カンバン改善で確立した「色の意味の統一」の流儀をカレンダーにも横展開する（strategistの過去の学習ログにある「他ビューに実装済みのロジック・視覚言語の横展開」パターン）。既存ロジックの再利用のため低コストで高い一貫性向上効果がある。
- **重さ**：軽い。既存の`taskMeta.ts`／`ganttUtils.ts`の定数・判定関数を再利用するのみ。DBマイグレ不要。

#### ③ カレンダーから直接タスク作成（日付セルクリックで新規作成）
- **何をするか**：日付セルの空白部分をクリック（またはホバー時に「＋」）すると、その日を`due_date`初期値としてQuickAddTaskModalを開く。
- **なぜ有用か**：現状は完全な読み取り専用ビューで、カレンダー上で見つけた「空いている日」に予定を入れる、という一般ツールで最も基本的な導線が無い。Notion／ClickUp／Google Calendarで共通の最重要導線。QuickAddTaskModalには既に`defaultTfId`/`defaultTodoId`のような「初期値を渡すだけ」のprop拡張パターンがあるため、`defaultDueDate`propを同様に追加するだけで済む。
- **重さ**：軽め。既存モーダルへのprop追加＋セルへのonClickハンドラのみ。DBマイグレ不要。

### 3.2 中優先

#### ④ 週表示の追加
- **何をするか**：月表示に加えて週単位の表示モードを追加し、1セルあたりの表示可能件数を増やす（月表示だと1日4件超は「+N件」に埋もれる）。
- **なぜ有用か**：月末や繁忙期に締切が集中すると、月表示の4件上限に埋もれて「+N件」の中身を見るために結局リストビューを開き直す、という状況が起きうる。一般ツール（monday.com・Outlook・ClickUp）は月/週/日の切替がほぼ標準。ただし10名弱・タスク管理用途では、週表示を導入しても日表示ほどの粒度は不要（③非推奨参照）。
- **重さ**：中程度。既存の月間グリッド計算（`cells`/`gridRange`）とは別に週グリッドの日付範囲計算・レイアウトが必要（ロジック自体は`gridRange`計算の応用で新規性は低い）。DBマイグレ不要。

#### ⑤ 期間バー表示（start_date〜due_dateのマルチデー表現）
- **何をするか**：`start_date`が設定されているタスクは、期日の点表示に加えて開始日〜期日にまたがる帯（バー）をセルをまたいで描画する。
- **なぜ有用か**：現状`start_date`は一切参照されておらず、複数日にわたるタスクの「期間感」が月間カレンダー上で全く見えない。Google Calendar／Asana／ClickUp／Notionいずれも複数日イベントの帯表示が標準。ただし**ガントビューが既に同じ情報（開始〜期日のバー・依存関係・進捗フィル）をより高機能に提供している**ため、カレンダー側での実装は「暦の文脈で期間を見たい」というニッチな価値にとどまる。
- **重さ**：中〜重め。CSS Gridの各セルは独立した`<div>`のため、セルをまたぐ帯を描くには絶対配置座標の計算（ガントのDOM実測方式やマイルストーン帯の`position:relative`方式に近い設計）が必要。既存のガント`computeMilestoneBands`的な考え方は流用できるが新規実装量は相応にある。

#### ⑥ 週末の表示・非表示切替
- **何をするか**：月表示のまま土日列を折りたたむ／グレーアウトする程度のライトな切替を用意する。
- **なぜ有用か**：monday.com・Outlookで一般的だが、月間の「暦の形」自体を保つカレンダーというこのビューの性質上、土日を消すと月全体のレイアウトが崩れる（Outlookも月表示では非対応と判明している）。ライトなトーン変更程度に留めるなら低コストで実装可能。
- **重さ**：軽い（トグル＋CSSのみ）。ただし優先度は中〜低（要望の強さ次第）。

### 3.3 非推奨（理由付き）

| 項目 | 非推奨理由 |
|---|---|
| **ドラッグ&ドロップでの日付変更** | 一般ツールでは標準だが、**ガントビューが既にB1〜B5（依存ゲート・矢印可視化・自動リスケ連鎖・ベースライン差分・ドラッグ結線）まで実装済みで日付操作の主戦場になっている**。カレンダーにも同じ操作を持たせると、B3自動リスケ連鎖・B1完了ゲートとの整合を月間グリッド側でも作り込む必要が生じ、実装・保守コストに対して得られる価値が薄い（機能重複）。「カレンダーは見る・印刷する場所、日付をいじるのはガント」という役割分担を維持する方が10名弱チームには合う |
| **日表示・時間帯単位のタイムブロッキング** | ClickUpのAI自動スケジューリング等は時間単位の予定管理を前提とするが、本アプリは`estimated_hours`はあっても時刻（hour/minute）の概念を持たない。v2.21で「工数入力欄の廃止」の経緯（外部請求のない社内ツールとして時間管理を意図的に簡素化した判断）とも逆行する |
| **外部カレンダー（Google/Outlook）同期** | 社内タスク・PJ情報を外部カレンダーサービスへ同期するのは、ブランドコアの外部送信原則（原則禁止・例外は事前承認済みのもののみ）に抵触しうる。Teams週次通知（既存・稼働中）で十分にカバーされている |
| **AIによる自動スケジューリング（ClickUp Calendar AI型）** | Human-in-the-loop設計思想（AIは処理・下書きまで、最終確定は人間）に反する。AIが空き時間を判断して自動でタスクを差し込む機能は本アプリの設計方針と相容れない |
| **ワークロードとの統合表示（Asana型）** | 既にワークロードビュー（v2.28・メンバー別負荷の専用画面）が存在するため機能重複。カレンダー側に負荷サマリーを追加すると同じ情報が2箇所に散らばる |

---

## 4. デザイン診断（情報設計として何が見づらいか）

ダッシュボード・カンバン改善で確立した「視覚的優先順位・色の意味の一貫性・情報密度」の観点で棚卸しした。

1. **色の意味がPJカラー1色に単純化されすぎている**：期限超過の赤字だけが唯一の状態表現で、優先度・滞留・ステータスの視覚差が無い。カンバン（優先度ストライプ・滞留バッジ）やダッシュボード（KPIのセマンティック色）で確立した「色に意味を持たせる」設計がカレンダーだけ手薄（→3.1②で解消提案）。
2. **情報密度の上限が硬い**：1セル最大4件・5件目以降は「+N件」で内訳が見えない。月末に締切が集中するタスク管理の実態（ダッシュボードの「締切の見通し」グラフが可視化する「山場」がまさにこれ）と、カレンダー側の表示上限がかみ合っていない（→3.2④週表示で緩和）。
3. **完了/保留/中止の状態表現がステータス拡張に追従していない**：上記1.3で述べた実バグ。視覚的にも「隠したはずの保留タスクが赤字で残る」という一貫性の欠如を生んでいる。
4. **今日・週末の強調は妥当**：`isToday`のoutline＋背景、日曜=danger／土曜=infoの配色は他ビューと一貫しており問題なし。据え置きでよい。
5. **モバイル対応の形跡が無い**：`useIsMobile`等の分岐が一切なく、7列×6行の固定グリッドがそのまま縮小される。42セルの月間表示はモバイル幅では数字と点だけになり実用に耐えない可能性が高い（実機確認は山本さんに依頼したいポイント）。ラボ機能ゆえ許容されてきたと推測されるが、格上げを検討するなら要対応。
6. **新規作成導線の欠如**：読み取り専用ビューであることが「一覧性はあるが行動につながらない」という弱さになっている（→3.1③で解消提案）。

---

## 5. 位置づけの提案：ラボ機能のままか、正式ビューへの格上げか

**現時点ではラボ機能のまま据え置き、まず3.1の高優先3件（実バグ修正・視覚階層・直接作成）を先に実施した上で改めて判断することを提案する。**

- カレンダーは「上司への印刷報告」という他の正式ビュー（ダッシュボード・カンバン・ガント・リスト・ワークロード）には無い明確な用途を持っており、位置づけ自体は無価値ではない。
- 一方で、**v2.74のステータス拡張に唯一追従できていない画面**という状態のまま正式ビュー（NAV_ITEMS）に格上げすると、他画面と挙動が食い違うビューを表舞台に出すことになり、リファクタ巡回のような定期点検の対象からも外れやすい「ラボ＝対象外」という扱いを一旦解消する意味がない。
- 高優先3件を実施しステータス整合性が取れた段階で、「印刷報告」という独自価値に加えて「日常的に見るビューとして耐えるか」を山本さんに実機で確認いただき、そこで初めて格上げを判断するのが安全な順序と考える。

---

## まとめ（優先度別サマリ）

- **高優先**：①ステータス5値化への追従（実バグ）／②優先度・滞留の視覚階層追加／③カレンダーからの直接作成
- **中優先**：④週表示の追加／⑤期間バー表示／⑥週末の表示・非表示切替
- **非推奨**：ドラッグ&ドロップ日付変更（ガントと機能重複）／日表示・タイムブロッキング（工数入力廃止の経緯と逆行）／外部カレンダー同期（外部送信原則に抵触しうる）／AI自動スケジューリング（Human-in-the-loop違反）／ワークロード統合表示（既存ワークロードビューと重複）

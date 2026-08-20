# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v3.82
#
最終更新：2026-08-19（v3.82）

**変更履歴は [docs/dev/CHANGELOG.md](docs/dev/CHANGELOG.md) に分離しました（v1.0〜v3.19）。**
新しいバージョンの履歴はこのファイルに書かず、CHANGELOG.md の末尾に追記してください。
このファイルは「現在の設計の正本」であり、履歴の置き場ではありません。
> このファイルはAIエージェント（Claude Code / Cursor等）がコードを読み書きする際に
> 設計意図・制約・禁止事項を正確に把握するための最重要ドキュメントです。
> コードを変更する前に必ずこのファイルを読んでください。

---

## 0. プロジェクト概要

**アプリ名**：グループ計画管理アプリ（仮）
**開発者**：チームメンバー
**開発手法**：バイブコーディング（Claude Code / Cursor等によるAI支援開発）
**目的**：チーム全員がプロジェクト・タスクの進捗を一元管理し、変更コストの削減とチーム全体の可視性向上を実現する
**利用者**：チームメンバー全員（10名弱）
**利用環境**：PCブラウザ / Microsoft Teams埋め込み

---

## 1. 技術スタック

| 項目 | 選定 | 理由 |
|---|---|---|
| フロントエンド | TypeScript + React | 型安全・AI補助開発との相性 |
| データベース | Supabase（PostgreSQL） | 無料枠で十分・多対多リレーション対応・RLS設定可 |
| AI連携 | Anthropic Claude API（claude-sonnet-4-6） | OKR/PJ/タスクの相談・分析・レポート生成等に使用（2026-05-13以降 OKR関連情報も投入可） |
| AI中継 | Supabase Edge Function（ai-consult） | APIキーをサーバーサイドにのみ保持するため |
| 通知連携 | Microsoft Teams Webhook | タスク完了・期限通知 |
| ホスティング | Vercel | GitHubへのpushで自動デプロイ（main branch） |

**⚠ 確認が必要な事項（未解決）**
- ~~Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要~~
  → **2026-08-07に確認済み（社内的にクリア）。** 山本さんが「Supabase保存はすでに問題ない」と確認した。この記述が残っていたために `quarterPlanStore.ts` が localStorage 実装のまま取り残されていた（2026-08-07にSupabase移行・v3.38。`docs/dev/okr-redesign-plan.md` §9参照）。**この決着が付いたことは記録として残す（放置するとまた誰かが同じ判断をやり直すため）。**
- Claude APIへのデータ送信について社内ポリシーとの整合性確認が必要（今回の確認範囲外・未解決のまま）
- Teams埋め込みアプリとしての申請手続き確認が必要（今回の確認範囲外・未解決のまま）

---

## 1.5. 状態管理アーキテクチャ（v2.3 で更新）

### zustand ベース・全 selector 化（2026-05-02 完了）

全アプリデータは **`src/stores/appStore.ts` の zustand ストア** に集約。
コンポーネントは selector 形式で必要な state slice のみ subscribe する。

```typescript
// ✅ 正しい使い方：個別 selector
const tasks    = useAppStore(s => s.tasks);
const saveTask = useAppStore(s => s.saveTask);

// ❌ 旧コード（撤去済み）：useAppData() の全 state 購読は使わない
const { tasks, saveTask } = useAppData();
```

`AppDataProvider`（`src/context/AppDataContext.tsx`）は初回 load と Supabase realtime
購読の lifecycle 管理のみを担う薄い Wrapper。`useAppData()` は撤去済み。

### グローバル副作用

- **エラーバウンダリ**：`src/components/common/ErrorBoundary.tsx` を `main.tsx` ルートに配置。
  render 時例外で画面真っ白にならず、fallback UI と再読み込みボタンを表示する。
- **保存エラー通知**：`appStore.ts` の `handleSaveError` が `ConflictError` を判別して
  Toast 通知 + load() で楽観更新前の state に戻す。

---

## 1.6. マルチテナンシー（部署／グループ）とロール（2026-06-26〜07-02 で導入）

> **【重要】このセクションは実装済みだがCLAUDE.mdへの追記が長らく漏れていた（2026-07-03発覚・追記）。**
> 全社展開に向けて、部署（グループ）単位でデータを分離する仕組みが本番導入済み。既存データはすべて `grp-egg`（EGG）グループへ移行済み。

### groups テーブル

```sql
CREATE TABLE groups (
  id         text PRIMARY KEY,   -- 例: 'grp-egg'
  name       text NOT NULL,      -- 例: 'EGG'
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);
```

### 対象テーブルと分離範囲

- `members` / `projects` / `tasks` に `group_id` 列を追加。RLSで自部署のみ参照・操作可能。
- **【2026-07-24（v3.03）でRLS分離完了】OKRコア階層（objectives / key_results / task_forces / todos）は自前の`group_id`列＋DBトリガーでDBレベルの部署分離が完了した。** `objectives.group_id`は2026-07-23（v2.94）に追加済み。`key_results.group_id`（← `objective_id`経由）・`task_forces.group_id`（← `kr_id`経由＝Objective経由）・`todos.group_id`（← `tf_id`経由）は2026-07-24（v3.03・`migrations/20260724_scope_okr_core_tables.sql`）で追加。親を辿るJOINではなく各テーブルが自前の列を持ち、BEFORE INSERT/UPDATEトリガー（`sync_kr_group_id`/`sync_tf_group_id`/`sync_todo_group_id`）が常に親から自動注入する（フロントはgroup_idを一切送らない＝無改修）。親のgroup_id変更はAFTER UPDATEトリガー（`cascade_objective_group_id_to_krs`/`cascade_kr_group_id_to_tfs`/`cascade_tf_group_id_to_todos`）で子・孫へ連鎖する。RLSは`group_id = ANY(current_member_group_ids())`（単一列のため`= ANY`。配列同士の`&&`ではない）。UI側の絞り込み（`src/lib/okr/deptScope.ts`）は2026-07-24（v3.02）のピッカー対応で既に網羅済みだったため、今回はDB側のアクセス制御のみが変更点。**⚠️ `migrations/20260724_scope_okr_core_tables.sql`は山本さんが手動でSupabase SQL Editorに適用する必要がある（dev→prodの順）。適用前後で監査クエリ2本（緩いポリシー残存検出・バックフィル漏れ検出。マイグレファイル末尾）を必ず実行すること。**
- **OKR周辺テーブル（kr_sessions / kr_declarations / kr_meeting_notes / kr_note_tf_entries / okr_analyses / kr_reports / quarterly_objectives / quarterly_kr_task_forces）は引き続きRLS未対応**（`authenticated full access`のまま。コア階層とは別に第2弾でまとめて対応する方針。Section 9のG参照）。member_tags本体は全社共通マスタとして従来どおり全公開のまま（部署概念が無いため対象外）。
- **`quarterly_objectives.group_id`（v3.00・2026-07-23）**：objectivesと同型でgroup_id列を追加（`src/lib/okr/deptScope.ts`の`quarterlyObjectivesInGroup`等）。**ただしQuarterlyObjective / QuarterlyKrTaskForceは2026-05-26のTF四半期判定モデル移行（→`task_forces.quarter`列）以降どの画面からも表示されない死蔵データ**（`docs/REFACTORING.md` M24）。OKR PDF取込の「四半期OKR」選択時にQuarterlyObjectiveを1件作成するが、これは取込元の記録目的の骨組みのみで、四半期の実体は引き続きTF.quarterで表現される（KR/TFをQuarterlyObjective配下に紐づける処理はしていない）。

### ロール（2階層・直交）

| ロール | 列 | 権限範囲 |
|---|---|---|
| 部署管理者 | `members.is_admin` | 自部署内のメンバー・データ管理 |
| 全社スーパー管理者 | `members.is_super_admin` | 部署をまたいだ全データアクセス・部署（groups）の作成／削除 |

一方がもう一方を含意しない。全社スーパー管理者でなくても部署管理者にはなれるし、その逆も可。

### RLSの要点（3つのSECURITY DEFINER関数）

- `current_member_group_id()` — 自分の所属 `group_id` を返す（membersテーブル自体のRLSを迂回するためSECURITY DEFINER）
- `current_member_is_admin()` — 部署管理者か
- `current_member_is_super_admin()` — 全社スーパー管理者か

いずれも `SET search_path = ''` で固定済み（関数ハイジャック対策）。`members` / `projects` / `tasks` は
`group_id = current_member_group_id() OR current_member_is_super_admin()` で参照制御する。

### groups テーブル自体の書き込み権限

- **参照**：全認証ユーザー可
- **新規作成**：全社スーパー管理者のみ
- **改名・編集**：全社スーパー管理者、または自部署のadmin
- **削除**：全社スーパー管理者のみ。かつ**アクティブメンバーが1人でもいる部署はトリガーで物理的に削除をブロック**（統廃合等でどうしても削除したい場合はスーパー管理者権限で強制削除は可能）

### 権限昇格ガード（`guard_member_privilege_columns` トリガー）

`members.is_admin` / `is_super_admin` / `group_id` はクライアントから自由に書き換えられない。BEFORE INSERT/UPDATEトリガーが以下のルールで守る：

- 既存の（全社／部署）管理者は他人の行を含めて変更可
- **ブートストラップ猶予**：company-wide に `is_super_admin=true` が1人もいない間は、自分自身の行に限り自己昇格を許可（他人の代理昇格は不可）。同様に、対象部署に `is_admin=true` が1人もいない間は、その部署内で自己昇格を許可
- 上記に当たらない変更は、該当列だけ静かに元の値へ巻き戻される（表示名などの他フィールドの保存は妨げない）

**新しいマイグレーションを適用した直後は、company-wide/部署ともに管理者0人＝ブートストラップ窓が開いた状態になる。窓を開けたまま放置せず、適用直後にオーナー自身がアプリの管理画面（MembersSection）から自分の行を昇格させ、窓を閉じること。** SQL Editorはservice roleでRLSを素通りするため、この昇格操作は必ずアプリ経由（クライアント経由のUPDATE）で行う。

### 過去に実際に起きた事故と教訓（重要）

2026-06-26の初回実装（`20260626_add_multitenancy.sql`）には、移行期間の猶予のつもりで
`group_id = current_member_group_id() OR current_member_group_id() IS NULL` という一文が入っていた。
しかし実際には**新規サインアップ直後でmembersにまだ登録されていない全ユーザーに対して、全部署のmembers/projects/tasksを無制限公開してしまう抜け穴**になっていた（`current_member_group_id()`がNULLを返すと猶予条項がtrueになり、group_id一致チェックが素通りする）。2026-07-02のセキュリティ調査で発見し、`20260702b_fix_multitenancy_rls.sql`でNULL抜け穴を除去した。

**教訓：RLSに「移行期間の猶予」を書くときは、それが「未認証・未登録ユーザーに何を許してしまうか」を必ず検証すること。** OR条件でNULL/未登録状態を許可する書き方は特に危険。

### オンボーディング経路（2026-07-22追加・M25対応）

RLSは「自分のgroup_idと一致するか、super-adminか」でしか可視性を判定できないため、**まだmembersに登録されていない認証ユーザーには何も見えない**。これは「本当にシステムが空（初回セットアップすべき）」なのか「システムには既に他の誰かがいるが、自分がまだ登録されていないだけ」なのかをクライアント側だけでは区別できないという問題を生む（既知課題M25）。この区別と、真の初回セットアップの実行を、RLSを迂回するSECURITY DEFINER関数2本に切り出して解決した。

- **`is_system_bootstrapped()`** — 「アクティブなmembersが1件でも存在するか」だけを返す（真偽値のみ・情報漏洩の最小化）。未登録の認証ユーザーからも呼べる（`GRANT EXECUTE TO authenticated`）。`App.tsx`の`AuthenticatedApp`は`isWizardDone`がfalseになるケースに限りこれを呼び、`false`（本当に空）なら`SetupWizard`、`true`（既に誰かいる）または呼び出し失敗（マイグレ未適用など）なら新設の`AccessDeniedScreen`（`src/components/auth/AccessDeniedScreen.tsx`。ログイン中のメールアドレス表示・管理者への登録依頼案内・ログアウトボタン）を表示する。**populated/errorのどちらも一律アクセス拒否側に倒す**（安全側の判断。理由＝ここで誤ってSetupWizardを出すと、未登録の第三者がgroup_id無しの宙に浮いたメンバー行を作ろうとする経路を開いてしまうため。実際にはRLSのWITH CHECKで弾かれるが、ユーザーに不親切な失敗を見せるより最初から正しく案内する方が安全かつ親切）。
- **`bootstrap_first_group_and_member(p_group_name, p_display_name, p_short_name, p_initials, p_color_bg, p_color_text)`** — 「membersが0件のときに限り」部署（groups）と最初のメンバー（`is_admin=true` かつ `is_super_admin=true`）を作成する。通常のクライアントINSERTは`groups_insert_admin`ポリシー（super-admin限定のWITH CHECK）に阻まれるため、真の初回セットアップ専用の抜け道として用意した。**安全性の要＝関数内の「membersが0件」ガード**（0件でなければ例外を投げて何もしない。これが2回目以降にこの関数が呼ばれて誰でもsuper_adminになれてしまう穴を防ぐ唯一の防波堤）。emailはクライアントの引数からではなく必ず`auth.email()`から取得（なりすまし防止）。同時呼び出しのTOCTOUレースは`pg_advisory_xact_lock`で直列化。`SetupWizard.tsx`は部署名入力欄を追加し、メンバーリストの先頭（有効な）1件を「あなた」としてこの関数に渡す。残りのメンバーは、ブートストラップ後に`currentGroupId`が設定され自分がsuper-adminになった状態で通常の`saveMember`経由で登録する（super-adminはRLS上どの部署の行も作成できるため通る）。
- 「ブートストラップ猶予」（本セクション上部の権限昇格ガード）は既存行のUPDATEによる自己昇格のみを対象としていたが、`bootstrap_first_group_and_member()`はそれとは別に「membersが0件のときのみ許可されるINSERT専用の抜け道」を明文化したもの。両者は独立した安全装置。
- 既存EGG等、既にmembersが1件以上ある環境では`is_system_bootstrapped()`が常にtrueを返すため`SetupWizard`には到達せず、`bootstrap_first_group_and_member()`もmembers非0件で必ず拒否される（既存ユーザーへの影響なし）。

### 複数部署アクセス（メンバーの兼務・プロジェクトの部署横断）＝フェーズ1（DBのみ・2026-07-22）〜フェーズ2（フロント・2026-07-23完了）

`members`/`projects`/`tasks`に`group_ids text[]`（アクセス可能な部署の全リスト）を新設。既存の`group_id`（ホーム部署）は不変・並存する。RLSは`group_id = current_member_group_id()`（単一値比較）から`group_ids && current_member_group_ids()`（配列オーバーラップ）に置き換え済み（super-admin全部署アクセスの条項は維持）。`tasks.group_ids`はアプリから直接編集させずDBトリガー（`sync_task_group_ids`）が唯一の真実（プロジェクト紐づきはPJのgroup_idsを継承・独立タスクはホーム部署のみ）。`group_ids`の直接付与・剥奪はsuper-admin限定（`guard_member_privilege_columns`拡張）。プラン正本は`quirky-exploring-sundae.md`（メモリ`memory/projects/project_taskmanage_multi_department.md`参照）。
**フロントエンド対応の現状（v2.91時点・フェーズ2完了）**：`Member.group_ids`/`Project.group_ids`（`lib/localData/types.ts`）と、AdminView.tsxの部署絞り込みセレクタ（本セクション末尾の設定画面部署絞り込み参照）で読み取り専用の絞り込みには対応済み。`currentUserIsSuperAdmin` state（`appStore.ts`）を新設し、`App.tsx`の`autoMatch()`でログイン時に`members.is_super_admin`から設定。`selectScopedTasks`/`selectScopedProjects`/`selectScopedTaskDependencies`/`selectScopedMembers`は「super-adminは`currentGroupId`一致（+`group_id==null`）で絞る／非super-adminは一切フィルタせず元配列をそのまま返す」に分岐済み（非super-adminはRLSが既に自部署＋兼務先だけ返しているため、クライアントで単一値比較を重ねると兼務2部署目がUIから消えるのを防ぐため）。サイドバー（`MainLayout.tsx`）に「表示部署」切替UI（アクセス可能な部署が2件以上のときだけ表示）を追加し、`currentGroupId`を切り替えられる。**ただし「1メンバー/1PJに複数部署を明示的に付与するUI」はまだ無い**（新規作成は常に単一のホーム部署=group_idのみで作成され、DBトリガーがgroup_idsへ自動反映する形）。また非super-adminの兼務者にとっては、この切替UIは表示の絞り込みには効かず「新規作成時のデフォルト所属部署を選ぶ」程度の意味にとどまる（表示は常に自部署＋兼務先の全部が見える。意図的な割り切り＝詳細はv2.91changelog参照）。

### 関連migrationファイル

- `supabase/migrations/20260626_add_multitenancy.sql` — 初回導入（groups/group_id/RLS）
- `supabase/migrations/20260702b_fix_multitenancy_rls.sql` — NULL抜け穴修正・管理者限定化・自己昇格ガード
- `supabase/migrations/20260702c_add_super_admin_and_department_governance.sql` — 全社スーパー管理者・部署ガバナンス強化
- `supabase/migrations/20260722_add_onboarding_bootstrap.sql` — オンボーディング経路の是正（M25対応）。`is_system_bootstrapped()` / `bootstrap_first_group_and_member()`
- `supabase/migrations/20260722b_add_multi_department_access.sql` — 複数部署アクセス フェーズ1（DBのみ）。`group_ids`列・CHECK制約・`current_member_group_ids()`・RLS配列化・tasksトリガー・guard関数拡張
- `supabase/migrations/20260723b_add_objective_group_id.sql` — OKR/TFの部署別表示（v2.94）。`objectives.group_id`列・既存Objectiveのgrp-eggへのバックフィル。RLSは変更しない（表示絞り込みのみ）
- `supabase/migrations/20260723c_add_quarterly_objective_group_id.sql` — 四半期OKRの部署別化（v3.00）。`quarterly_objectives.group_id`列・既存行を親Objective経由でバックフィル。RLSは変更しない
- `supabase/migrations/20260724_scope_okr_core_tables.sql` — OKRコア階層のDBレベル部署分離（v3.03）。`key_results`/`task_forces`/`todos`に`group_id`列を追加・バックフィル。自動注入トリガー（`sync_kr_group_id`等）・カスケードトリガー（`cascade_objective_group_id_to_krs`等）・objectives/key_results/task_forces/todos 4テーブルのRLSを`authenticated full access`から`group_id = ANY(current_member_group_ids())`の個別ポリシーに差し替え。⚠️山本さんが手動適用（dev→prod）

---

## 2. 情報の6層構造（最重要）

このアプリの設計原則の核心。コードのどこを触るときも必ずこの構造を意識すること。

### OKR系統（Object > KR > TF > ToDo > Task）

```
Layer 1: Objective（O）          ← ラベル管理・削除不可
Layer 2: Key Result（KR）        ← ラベル管理
Layer 3: Task Force（TF）        ← ラベル管理
Layer 4: ToDo                    ← ラベル管理
Layer 5: Task                    ← AI管理
```

> **【2026-05-13 変更】OKR関連情報（O / KR / TF / ToDo）も AI に渡してよいことになった。**
> 以前あった「AIの境界線（O/KR/TFは一切渡さない）」は撤廃。下記「AI境界ルール」参照。

### プロジェクト系統（独立・OKRと無関係に存在可）

```
Project（PJ）                    ← AI管理・AIに渡す
  └── Task                       ← AI管理・AIに渡す
```

### Taskの紐づきパターン（いずれか、または両方）

```
① Project only:  Task.project_id = "uuid", Task.todo_ids = []
② ToDo only:     Task.project_id = null,   Task.todo_ids = ["uuid"]
③ 両方:          Task.project_id = "uuid", Task.todo_ids = ["uuid"]
```

### AI境界ルール（2026-05-13 改定）

**OKR関連情報（Objective / KR / TF / ToDo）も AI に渡してよい。** かつての「O/KR/TF は一切渡さない／ToDo はタイトルのみ」という制約は撤廃された（社内確認の結果）。`contribution_memo`（PJのKR貢献メモ）も渡してよい。

ただし以下は引き続き守る：
- **APIキーはクライアントに露出させない。** AI呼び出しは必ず `クライアント → Supabase Edge Function（ai-consult） → Anthropic API` の経路（`invokeAI.ts` 経由）。
- **`invokeAI()` の `intent: AIIntent` 引数は必須**（下記 6-1b）。「この呼び出しは何の目的でどんなデータを渡しているか」をコード上で表明し、`ai_usage_logs` に機能別の使用量として記録するため。OKRデータ漏洩防止という主旨ではなくなったが、ラベルとして残す。
- 必要のないデータをむやみに大量に送らない（プロンプトサイズ・コスト・誤読の観点。これは設計上の良識であって禁止事項ではない）。
- payloadBuilder.ts 経由の通常タスク管理AI機能は、当面は従来の PJ/Task 中心のペイロードのまま（OKR情報を足すかは個別判断。足してもルール違反ではない）。

`payloadBuilder.ts` の「ToDo 単位のタスクグループを仮想プロジェクトとして表現する」実装は引き続き有効（ペイロード構造の都合であって境界ルールとは別）。

---

## 3. データモデル（確定版）

### 3-1. OKR層（ラベル管理）

```typescript
interface Objective {
  id: string;
  title: string;
  period: string;          // 例："2026年度"
  is_current: boolean;     // true=現行、false=アーカイブ（部署ごとに1件が現行。Section 1.6参照）
  group_id?: string | null; // 所属部署（v2.94・2026-07-23）
  archived_at?: Date;
  created_at: Date;
  updated_at: Date;
  updated_by: string;      // member_id
}

// 【v3.03・2026-07-24】KeyResult/TaskForce/ToDoはいずれもDB側に group_id 列を持つが、
// TypeScript型（src/lib/localData/types.ts）には意図的に含めていない。BEFORE INSERT/UPDATE
// トリガー（sync_kr_group_id/sync_tf_group_id/sync_todo_group_id）が親から常に自動注入する
// ため、フロントは一切送らない（送っても無視される）。Section 1.6参照。

interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  description?: string;
  due_date?: Date;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}

interface TaskForce {
  id: string;
  kr_id: string;
  tf_number: string;       // "1"〜"9" の数値文字列。UI上は1〜9のドロップダウン選択（手動入力廃止）
  name: string;
  description?: string;
  leader_member_id?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

### 3-2b. ToDo層（OKR管理）

ToDoは TF の下に存在する「中タスク」。複数の Task（小タスク）で構成される。
**AIには渡さない。タイトルのみ仮想プロジェクト名としてAIペイロードに含める。**

```typescript
interface ToDo {
  id: string;
  tf_id: string;           // 所属するTaskForceのID
  title: string;           // 複数行入力可（説明的なテキストになることが多い）
  due_date: string | null; // 任意。YYYY-MM-DD形式
  memo: string;            // 任意の備考（デフォルト: ""）
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
}
```

### 3-2. PJ層（AI管理）

```typescript
interface Project {
  id: string;
  name: string;
  purpose: string;          // 必須：何のためのPJか一行で
  contribution_memo?: string; // PJがどのKRにどう貢献するかのメモ（2026-05-13以降 AIに渡してもよい）
  owner_member_id: string;
  start_date?: Date;
  end_date?: Date;
  status: 'active' | 'completed' | 'archived';
  color_tag?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}

// PJ ↔ TF 多対多
interface ProjectTaskForce {
  project_id: string;
  tf_id: string;
  created_at: Date;
}

// PJ ↔ Member 多対多
interface ProjectMember {
  project_id: string;
  member_id: string;
  created_at: Date;
}
```

### 3-3. Task層（AI管理）

```typescript
interface Task {
  id: string;
  name: string;
  project_id: string | null; // ← NULL許可（ToDo単独紐づけの場合はnull）
  todo_ids: string[];        // ← ToDoへの紐づき（複数可・任意）。project_idと併用可
  assignee_member_id: string;        // DBの主FK（先頭1人）
  assignee_member_ids: string[];     // UI専用。複数担当者。fetchCriticalData で正規化（v2.24）
  status: 'todo' | 'in_progress' | 'done' | 'on_hold' | 'cancelled'; // 5値（v2.74で保留/中止を追加）
  priority?: 'high' | 'mid' | 'low';
  start_date?: Date;
  due_date?: Date;
  estimated_hours?: number;
  comment: string;          // NOT NULL DEFAULT ''（DB制約に合わせ必須。URL・ネットワークパスを含む可能性あり）
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}
```

### 3-5. マイルストーン（未実装・設計済み）

PJに紐づく期日マーカー。GanttViewで◆表示する。

```typescript
interface Milestone {
  id: string;
  project_id: string;   // 必須。所属するPJのID
  name: string;         // マイルストーン名（例："設計完了"）
  date: string;         // YYYY-MM-DD形式
  is_deleted: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

#### Supabase テーブル定義

```sql
CREATE TABLE milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  date        DATE NOT NULL,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);
-- RLS: authenticated ユーザーのみ read/write
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON milestones
  FOR ALL USING (auth.role() = 'authenticated');
```

#### 実装手順（帰宅後に実施）

1. **Supabase** でテーブル作成（上記SQL）
2. **types.ts** に `Milestone` 型を追加
3. **AppDataContext.tsx** に `milestones` データ・`saveMilestone`・`deleteMilestone` を追加
4. **store.ts** に `fetchMilestones`・`upsertMilestone`・`softDeleteMilestone` を追加
5. **GanttView.tsx** でマイルストーンを◆として描画（PJバー行の上に重ねる）
6. **AdminView.tsx** にマイルストーン管理UI（PJごとにリスト＋追加フォーム）
7. **applyProposal.ts** の milestone ケースを `needs_confirmation` に変更

#### applyProposal の milestone 実装方針

```typescript
// milestone → needs_confirmation を返す（date_changeと同じ確認フロー）
// ConfirmationDialog.action_type に "milestone" を追加する
// confirmedValues: key = milestone.id（新規の場合は仮UUID）, value = 確定した日付
```

---

### 3-4. メンバーマスタ

```typescript
interface Member {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  teams_account?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

---

### 3-6. タスク依存関係（B1：依存ゲート／B2：ガント矢印可視化／B3：自動リスケ連鎖／B4：ベースライン差分・2026-07-17実装）

PMツール化の第二機能。任意の2タスク間の先行→後続関係（FS依存1種のみ）。親子関係（parent_task_id）
とは完全に独立の別概念で、UI上も別ブロックとして表示する（混同させないことが重要なUX要件）。
段階リリースの詳細・設計判断の経緯は project_task_manage.md「機能B」参照。

```typescript
interface TaskDependency {
  id: string;
  predecessor_task_id: string; // 先に完了すべきタスク
  successor_task_id: string;   // それを待つタスク
  is_deleted: boolean;
  group_id?: string | null;    // マルチテナント（新規テーブルのためDB上はNOT NULL）
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

**ゲートの挙動（appStore.saveTask が唯一の choke point）：**
- **完了（status→"done"）**：未完了（done以外・非削除）の先行タスクが1件でもあればハードブロック。
  トースト表示＋例外を投げ、楽観更新・DB書き込みは一切行わない。
- **着手（todo→"in_progress"）**：未完了の先行タスクがあっても非ブロッキングのソフト警告トーストのみ。
  着手自体は止めない（Human-in-the-loop：完了は硬く、着手は柔らかく）。

**🔴 v3.71より前はAI提案の反映（`src/lib/ai/applyProposal.ts`・`undoApply.ts`）だけがこの
choke pointを経由していなかった**（`supabase.from(...)`を直接呼ぶ独自実装。実ユーザーでも
ゲストでも同じ）。そのためB1（本節）・B3（自動リスケ連鎖）・B4（ベースライン捕捉）がAI提案
経由の変更にだけ効かないという食い違いがあった。v3.71で`useAppStore.getState()`の
アクション（`saveTask`/`saveProject`/`deleteTask`/`restoreTask`/`deleteProject`/`restoreProject`）
経由に統一し、ゲスト分岐も appStore 側の既存の `isGuestMode()` 分岐にそのまま乗るようにした
（専用の `guestApplyStore.ts` は不要になり撤去）。複数タスク・複数PJを対象にする提案は
1件ずつ choke point を通すため、書き込みはトランザクションではなく、一部だけがB1ゲート等で
弾かれても他の項目は反映を続ける（成功分はUndo対象に積み、失敗分は`ApplyResult.warning`で
利用者に知らせる。全滅時のみ`type:"error"`）。日付変更でB3の自動リスケ連鎖が発生した場合は
既存のトースト（「N件のタスクの日付を自動調整しました」＋Undo）がそのまま出る（B3専用の
通知をAI提案側に追加する必要はない）。

**循環防止**：DB制約では「A→B→…→A」を表現できないため、追加操作は必ず
`lib/dependencies/cycleCheck.ts` の `canAddDependency`（DFS）を通す。自己依存・重複も同時に弾く。

**B2：ガント矢印可視化（デスクトップ GanttView のみ）**：先行バー右端→後続バー左端を直角エルボー
（逆方向はS字迂回）で結び、矢じり付きで描画する。行のY座標を数式で再計算せず、`data-task-id` 属性
付きのバー要素を `getBoundingClientRect()` で実測する設計（PJ別/ToDo別/人別×折りたたみ×フィルタの
全組合せに対してレイアウトロジックを二重化しないため）。純粋関数は
`src/components/gantt/ganttDependencyArrows.ts`（`buildDependencyElbowPoints`／`pointsToPathD`／
`computeDependencyRenders`）。依存の相手が画面外（フィルタ除外・折りたたみ・別グループ）のときは
矢印を描かず、見えている側のバーに⏱バッジ（ツールチップで相手タスク名）を出す。`hoveredTaskId`に
接続する矢印だけ強調。ツールバーの「🔗依存」トグル（既定ON・`KEYS.GANTT_SHOW_DEPS`）で表示/非表示
切替可。`GanttMobileView`とAI提案プレビュー（`isPreview`）は対象外。

**B4：ベースライン差分（当初計画 vs 実際）**：`tasks.baseline_start_date`/`baseline_due_date`
（nullable date列）。捕捉タイミングは「`start_date`・`due_date`が初めて両方揃った時点」の1回のみ。
`src/lib/baseline/baselineCapture.ts`の`resolveBaselineFields`（純粋関数）が「凍結すべきか／既存の
凍結値を維持すべきか」を判定し、`appStore.saveTask`（B1と同じ choke point）から呼ぶ。一度セットされ
たら二度と自動上書きしない（日付をクリアしても凍結値は残る）。暦日計算（土日祝を飛ばさない）。既存
タスクで両日付が既に揃っている行はマイグレ適用時点の値をバックフィル済み（＝以後の変更だけが遅延と
して計測される）。可視化は`src/components/gantt/ganttUtils.ts`の`calcGhostBar`（baseline日付を差し
込んで`calcTaskBar`を呼ぶだけ）・`computeDelayDays`（暦日差。正=遅延・負=前倒し）・
`formatDelayLabel`。ガントの`TaskBarRow`が薄い破線アウトラインのゴーストバー（実バーより下の層）と
「遅延◯日」/「◯日前倒し」ラベルを描画。ツールバーの「▤ベースライン」トグル（既定ON・
`KEYS.GANTT_SHOW_BASELINE`）で表示/非表示切替可。`GanttMobileView`は対象外。手動での再ベースラインUI
は無い（自動捕捉のみ）。

**B3：自動リスケジュール連鎖（constraint-only push）**：先行タスクの（更新後の）期日が後続タスクの
開始日を追い越した時だけ、後続を「ぶつからない位置まで」後ろ倒しする。余裕があるタスクは動かさない
（同日開始は可＝ギャップ強制なし）。押す方向のみ（先行が前倒しになっても後続を自動で引き寄せない）。
複数先行は全先行の期日の最大値で判定。純粋関数は`src/lib/dependencies/reschedule.ts`の
`computeCascadeShifts`（origin＝編集されたタスクから辿れる後続群をBFSで収集し、Kahnのアルゴリズムで
トポロジカル順に並べてから1パスで全シフトを一括計算。保存が保存を呼ぶ無限ループを避ける）。
後続に開始日・期日のどちらか無いタスクはスキップ（FS計算・作業期間保持ができないため）。
`appStore.saveTask`（B1・B4と同じ choke point）で、ローカル編集の永続化後・due_dateが実際に変化した
時だけ呼ぶ（renameなど無関係編集でのサプライズ発火を防ぐ）。シフトは`{ skipCascade: true }`付きで
saveTask経由で適用（再cascade抑止のガード。第2引数`options?: { skipCascade?: boolean }`は省略時
false＝通常のローカル編集）。動いた件数をまとめて1つのトースト「N件のタスクの日付を自動調整しました」
＋「元に戻す」で通知、Undoも`skipCascade: true`で全タスクを旧日付に復元する（Undo自体は再cascadeしない）。
**トリガはローカルユーザーの編集のみ**：realtimeで他クライアントの変更を受信したとき
（`applyRemoteChange`）はstateを直接更新する別経路のため、cascadeは一切発火しない（各クライアントが
多重cascadeすると混乱するため）。多人数競合は既存の直列化saveTask経由で逐次適用し、途中の楽観ロック
競合はskip+reloadで整合回復する（トランザクションにはしない＝割り切り）。DBマイグレ不要・新規列も
作らない（「自動調整された」ことは既存のB4ゴーストバー＋「遅延◯日」表示で可視化されるため、
B3専用の永続フラグは持たない）。

**B5：ドラッグ結線（ガント上でハンドルをドラッグして依存を直接結ぶ）**：タスクバーにホバーすると
バー端の外側（右端リサイズのヒット領域とは重ならない位置）に開始/期日の2つのハンドル（円）が出る
（🔗依存トグルON時のみ）。向きの規約はFS依存固定＝**期日(due)側の端点＝先行、開始(start)側の端点＝
後続**。どちらのハンドルから引き始めても、ドロップ先が具体的なハンドルでなくバー本体（側未確定）の
ときはドラッグ元の側から自動的に逆側を補って解決する（start同士・due同士はNG）。純粋関数は
`src/lib/dependencies/linkDirection.ts`の`resolveLinkDirection`。ドラッグ中はB4リサイズと同じ
window mousemove/mouseup流儀で追従し、`document.elementFromPoint`でドロップ候補を判定・SVGで
プレビュー線を描画（無効な組み合わせは赤色化・`canAddDependency`で先読み判定）。作成自体は既存の
`addTaskDependency`をそのまま呼ぶため、自己依存・重複・循環はB1のゲート＋トーストがそのまま効く。
ドラッグ中は他のバー操作（編集モーダル・リサイズ開始）を抑制。`GanttMobileView`は対象外。

**B1/B2/B3/B4/B5のスコープ外（次フェーズ以降）**：SS/FF/SF等の依存種別・ラグ・クリティカルパス自動計算・
営業日カレンダー（土日祝考慮）は未実装。

### 3-7. 選択したタスクを複製（v3.72）

山本さんの依頼：セミナーシリーズ企画のように「第1回の工程をそのままPJ内で複製して第2回を作る」。
investigatorの調査（7製品の公式ドキュメント）で「期間（日付範囲）で切り取って複製する」方式は
どの製品にも存在せず、束ねる単位は「階層」「明示選択」「フォルダ／PJ全体」の3つと判明。
山本さんの判断で「明示選択」方式（Primavera P6のCopy Activity Optionsに近い）を採用した。

- **起動口**：`src/hooks/useBulkTaskActions.ts`が使う既存の複数選択（ListView/KanbanView共有）
  に「📋 複製」ボタンを追加。新しい選択方式は発明していない。
- **計算ロジックの再利用**：日付移動は`src/lib/project/inheritTaskDates.ts`の純粋関数
  （`computeInheritOffsetDays`/`computeInheritedTaskDates`）をv3.57から無改修で再利用。
  依存関係の複製（先行・後続の両方が対象内の組だけ）は`src/lib/project/taskInheritance.ts`の
  `buildInheritedDependencies`をそのまま再利用（project_idを一切参照しない汎用実装のため
  変更不要だった）。タスク本体の複製は新設の`src/lib/project/duplicateSelectedTasks.ts`
  （`buildDuplicatedTasks`/`buildDuplicatedTaskForceLinks`/`buildDuplicatedTaskProjectLinks`）
  ——`taskInheritance.ts`の`buildInheritedTasks`は1つの新規PJ（newProjectId固定）への複製を
  前提にしているため使えず（この機能は**同じPJ内**で複製する＝project_idは複製元のまま保つ）、
  専用に用意した。
- **引き継ぐ／リセットする**：タスク名（名前の一括置換を任意で適用）・担当者・優先度・
  見積工数・コメント・PJ紐づけ（project_idそのまま）・TF紐づけ（`task_task_forces`）・
  追加PJ紐づけ（`task_projects`）・ToDo紐づけ（`todo_ids`）・タグは引き継ぐ。ステータスは
  `todo`にリセット・完了関連は`appStore.saveTask`の choke point が自動でクリアする。
  ベースライン（B4）・`finalized_mentions`は意図的に複製せず、複製後のタスクとして
  改めて捕捉・空の状態にする。
- **親子関係が選択範囲をまたぐ場合**：子だけ選択・親は未選択なら、複製後は親を持たない
  独立したトップレベルタスクになる（`buildInheritedTasks`と同じ既存の判断を踏襲）。
  親だけ選択・子は未選択なら、その子は複製されない（「選択していないものは増えない」を
  一貫させ、利用者が驚かない動作にした）。どちらの場合もモーダルの「複製対象の確認」に
  件数を明示する。
- **マイルストーンは複製対象にしない**：選択の起点がタスク選択のみで、マイルストーンを
  選ぶ既存UIが無いため（追加すると主要ユースケースから外れる）。一方、日付の基準
  （アンカー）の選択肢には、選択したタスクが単一PJに閉じている場合のみ、そのPJの
  マイルストーンも含める。
- **保存順序とB3対策**：`ProjectCreateModal`の「他PJから引き継ぐ」と同じ順序（親を先に
  `saveTask({skipCascade:true})`→成功したIDだけで子を保存→両端が保存成功したタスクだけを
  `addTaskDependency`→最後にTF/PJ紐づけを`addTaskTaskForce`/`addTaskProject`で追加）。
  `skipCascade:true`は、複製直後の新タスクはまだ依存関係を持たずB3は本来空振りするが、
  一括作成系（`ProjectCreateModal`・`runBulkShift`）と同じ防御的な付与として揃えた。
  トランザクションではないため個々の保存の失敗は他を止めず、成功件数・失敗件数をトーストで
  知らせる（`alertDialog`／`window.alert`は使わない）。
- **UI**：`src/components/task/DuplicateTasksModal.tsx`。Section 21の契約
  （`modalStyles.ts`）に従う。プレビュー・名前置換は任意入力欄で、確定前に必ず表示する。

---

## 4. 削除・アーカイブ設計（確定）

### 基本方針：全層論理削除（is_deleted フラグ）

物理削除は絶対に行わない。

```typescript
// ❌ 物理削除は絶対禁止
await supabase.from('tasks').delete().eq('id', taskId);

// ✅ 論理削除
await supabase.from('tasks')
  .update({ is_deleted: true, deleted_at: new Date(), deleted_by: currentUserId })
  .eq('id', taskId);
```

### 層ごとの挙動

| 層 | 操作 | 挙動 | ダイアログ | 復元 |
|---|---|---|---|---|
| O | 削除不可・期切替 | is_current=false + archived_at記録。新Oを作成してis_current=true | なし | 参照のみ |
| KR | 論理削除 | 非表示。TFはKR欠番で残る | あり | 変更履歴から可 |
| TF | 論理削除 | 非表示。PJの紐づきのみ解除 | あり | 変更履歴から可 |
| PJ | 論理削除 | PJ＋紐づく全タスクを一括論理削除 | あり（件数表示） | 変更履歴からPJ＋タスク一括復元可 |
| Task | 論理削除 | 一覧から非表示 | あり | 変更履歴から可 |
| Member | 論理削除 | 非表示。担当タスクの assignee_member_id を null に変更 | あり（件数表示） | 変更履歴から可 |

### PJのライフサイクル状態（`status`）とサイドバー表示（v3.49・2026-08-11／v3.50で是正・2026-08-11）

`projects.status`（`active` / `completed` / `archived`）は上表の論理削除（`is_deleted`）とは別軸。
削除ではなく「今どのフェーズか」を表す。サイドバー・ダッシュボード・カンバン・ガント・リスト・
稼働状況・コマンドパレット・タスク追加系モーダルが共有する `MainLayout.tsx` の
`projects`（`filterSidebarProjects`。`src/lib/project/sidebarProjectFilter.ts`・純粋関数）は
次のルール：

- **既定では active のみ表示する。** completed・archived はどちらも既定で隠す。
- **「完了・アーカイブも表示」トグル**（`KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED`。既定OFF・
  localStorageに記憶）でON にすると、completed・archived の両方がまとめて表示される。
- **選択中のPJが隠れて宙に浮く問題への対応**：トグルOFFのままcompleted/archived済みPJを選択して
  いると、一覧からそのPJだけが消えてハイライトが行方不明になる。`filterSidebarProjects` は
  `pinnedProjectId`（＝選択中のPJ id）を渡すとcompleted/archived判定だけを免除し、選択中のPJは
  常に一覧に残す（トグルを勝手にON にする案・選択を強制解除する案も検討し、「見ているものが
  急に消えない」を優先してこちらを採用した）。**mineOnly（自分のPJのみ）の絞り込みまでは
  免除しない**（既存の「mineOnly中に担当外のactive PJを選んでも一覧からは消える」挙動と
  一貫させるため）。
- **視覚的な区別**：一覧上でcompleted・archivedはどちらも鈍色（`--color-text-tertiary`）で
  表示するが、マークは archived=🗄・completed=✅ で区別する（同じ見た目にしない）。
- **揃えた範囲**：`MainLayout.tsx` の `projects` を共有するダッシュボード・カンバン・ガント・
  リスト・稼働状況ビュー・コマンドパレット・タスク追加/マイルストーン追加モーダルは全て
  自動的にこのルールに揃った（単一の変数を共有しているため）。体制図（`ProjectStructureView`）
  は元々`status !== "archived"`で運用済み（completedは出す）だが、これはこのSectionのルールと
  別の運用として維持している（次項の「意図的に揃えなかった範囲」参照）。
- **意図的に揃えなかった範囲**：`TaskEditModal`のPJピッカー（`active(allProjects)`＝status不問で
  is_deletedのみ除外）と`ProjectCreateModal`の「他PJから引き継ぐ」元PJ選択（`selectScopedProjects`
  そのまま）は、既存タスクの現在の紐づき先を選択肢から消さない／過去の完了・アーカイブ済みPJから
  でも引き継げるようにする、という別の目的があるため変更していない。`AdminView`のPJ一覧・編集は
  部署横断の棚卸し用途のため全ステータス表示のまま（次項参照）。

**🔴 v3.49→v3.50の訂正（経緯の記録）**：v3.49では「active・completedは常に表示・archivedのみ
トグルで隠す」という設計にしたが、これは統括の事前診断ミスに基づく誤った指示によるもので、
山本さんの要望（「完了してもサイドバーに残り続けて不便。片付けたい」）と逆方向の変更だった。
v3.49導入前の実態は`status==="active"`のみを通す＝completedもarchivedも一律で隠れる、が正しい
挙動だった。v3.50で「既定ではactiveのみ表示」に戻し、「アーカイブを表示」トグルを
「完了・アーカイブも表示」に統合してcompleted/archivedの両方をこの1トグルで扱うようにした。
**同じ判断を繰り返さないための記録**：機能追加の前提を「元の実装がこうだったから」で決め打ちせず、
コードを実際に読んで確認すること。

### PJ設定画面（Section 8参照）とAdminViewのPJ編集の使い分け（v3.49）

PJの基本情報を編集できる画面は2つある。役割が違うため両方残す：

- **AdminView「作業設定→PJ」タブ**：部署管理者・全社スーパー管理者向け。部署横断で全PJ・
  全ステータスを一覧編集する棚卸し画面。PJの削除（論理削除）もここだけ。
- **PJ設定画面（`ProjectSettingsModal`）**：PJカルテの「⚙ このPJの設定」から開く。
  今見ているPJ1件に絞った日常操作の入口（基本情報・招待・関わるメンバー）。
  基本情報タブの編集権限はAdminViewと同じ条件（既存の権限モデルを広げていない）。

### サイドバーPJ行の「⋮」メニュー（v3.54）

山本さんの指摘（2026-08-12）：「PJの設定などの場所がわかりにくい」。サイドバーの各PJ行に
「⋮」（縦三点）を追加し、そこから設定画面を開く／状態を変えられるようにした。

- **表示**：行ホバー時・フォーカス時・選択中のPJのときのみ表示する（`globals.css`の
  `.pj-row-menu-trigger`。常時表示すると行が賑やかになりすぎるため）。折りたたみ時（幅48px）・
  ゲスト・「全PJ表示」行には出さない。
- **構造**：`NavItem`は行全体が1個の`<button>`のため「⋮」を内側に置けない（buttonの入れ子は
  不可）。PJ行だけ`NavItem`をやめ、`[選択ボタン][⋮トリガー]`を並べたラッパー`<div className="pj-row">`
  に変えた（`MainLayout.tsx`の`Sidebar`。折りたたみ時は従来通り`NavItem`のまま）。
- **メニュー項目**（`src/lib/project/projectRowMenu.ts`の`buildProjectRowMenuItems()`・純粋関数）：
  「⚙ このPJの設定」は常に出す。状態変更ボタンは編集権限がある人だけに出し、
  `active`なら「✅ 完了にする」「🗄 アーカイブ」の2つ、`completed`/`archived`なら
  代わりに「↩ activeに戻す」1つだけを出す（complete/archiveを同時に出さない）。
  ゲストには空配列（呼び出し側でも`⋮`自体を描画しないため二重の防御）。
- **🔴 権限判定は新しく発明していない**：`ProjectSettingsModal`の基本情報編集権限
  （部署管理者・全社スーパー管理者。部署内にis_adminが1人もいなければ全員可のブートストラップ）を
  `src/lib/project/projectEditPermission.ts`の`canEditProjectBasicInfo()`に切り出し、
  `ProjectSettingsModal.tsx`とサイドバーの両方から呼ぶ（判定ロジックの複製をやめた）。
- **「⚙ このPJの設定」は既存の`ProjectSettingsModal`をそのまま開く**（新しい設定画面は
  作っていない）。`Sidebar`が`settingsModalProjectId`を持ち、未絞り込みの
  `useAppStore(s => s.projects)`から対象PJを探す（sidebarの表示用`projects`prop＝
  `filterSidebarProjects`済みのリストから探すと、モーダルを開いた後に別の操作でstatusが
  変わり一覧から消えた瞬間にモーダルまで閉じてしまうため、意図的に別ソースを使っている）。
- **保存・Undo**：状態変更は既存の`appStore.saveProject`（choke point・楽観ロック込み）を
  経由する。確認ダイアログは挟まず、実行後にトースト＋「元に戻す」を出す
  （`useBulkTaskActions.ts`の一括操作トーストと同じ流儀。Undoで戻せるため確認ダイアログは
  不要と判断した）。選択中のPJを完了・アーカイブした場合は`pinnedProjectId`の仕組み
  （本Section前項）にそのまま乗るため、一覧から消えずに残る。
- **ポップオーバーの実装**：`src/components/project/ProjectRowMenu.tsx`。`CustomSelect.tsx`と
  同じ「トリガーの`getBoundingClientRect()`からfixed座標を算出し`createPortal`で`body`直下に
  描画する」方式。画面外にはみ出さないよう右端・下端をクランプする。Escape・外側クリック・
  スクロール/リサイズで閉じる。**Section 21（中央寄せモーダルの高さ上限契約）の対象外**：
  `alignItems:center + justifyContent:center`で中央寄せする全画面オーバーレイではなく、
  `CustomSelect.tsx`のドロップダウンパネルと同種の「トリガーに追従する小さいポップオーバー」
  のため、そもそも対象のパターンに一致しない（`CustomSelect.tsx`がSection 21の除外リストに
  入っていないのと同じ理由）。

### サイドバーの「OKRタスク」セクションを描画停止（v3.54）

山本さんの指示（2026-08-12）：「メニューバーの『OKRタスク』はあまり使われないので、
一旦非表示にしましょう。PJがTFと紐づけられる仕様になっていれば十分」。

- 計画モードのサイドバーにあった「OKRタスク」セクション（KR一覧。クリックすると
  Gantt/Kanban/Listを`selectedKrId`（`krTaskIds`）で絞り込む）の**描画だけ**を止めた
  （v3.40のOKRモード グループ側白紙化と同じ「描画経路を切るだけ」方式。ファイルは
  削除・移動していない）。
- **絞り込みロジック（`selectedKrId`/`krTaskIds`）・`keyResultsInGroup`・DBテーブル・
  `project_task_forces`（PJ↔TF紐づけ）は一切触っていない。** 入口（サイドバーのKRクリック）が
  無くなったため`selectedKrId`は常に`null`のままになるが、絞り込み自体のコードは壊れていない。
- 復帰手順は`src/components/layout/ARCHIVED.md`（新設）に記録した。`src/components/okr/
  ARCHIVED.md`は対象がOKRモードのグループ側コンポーネント（`okr/`/`lab/`配下のファイル）で
  ドメインが異なるため、混同を避けて`layout/`配下に別ファイルを作った。
- `KEYS.SIDEBAR_OKR_OPEN`・i18nキー（`layout.sidebar.okrSection*`）は削除していない
  （`localStore.ts`のコメントに「v3.54で描画停止」を追記）。トグルstate自体
  （`okrOpen`/`toggleOkrOpen`）はJSXが無くなり本当に使われなくなったため削除した
  （復帰時の書き戻し方は`layout/ARCHIVED.md`参照）。

### Objectiveの期切替フロー

```
1. 管理画面 > OKR管理 > 「新しい期に切り替える」ボタン
2. 現行のO・KR・TF全体をアーカイブ（is_current=false, archived_at=now）
3. 新しいOのタイトルと期ラベルを入力して作成（is_current=true）
4. 過去の期は管理画面「過去の期を見る」から参照のみ可能
```

---

## 5. 同時編集の競合制御（確定）

### 方針：updated_at による競合検知

対象画面：タスク編集・PJ編集・管理画面（OKR/TF/PJ/Member）・カンバンのステータス変更

```typescript
// 保存時のSQL（Supabase）
const { data, error } = await supabase
  .from('tasks')
  .update({ ...updateData, updated_at: new Date(), updated_by: currentUserId })
  .eq('id', taskId)
  .eq('updated_at', originalUpdatedAt); // 開いた時点のupdated_atと一致する場合のみ更新

// 0件更新 = 競合発生 → 警告を表示
```

### 警告メッセージ

```
⚠ このタスクは保存できません

[更新者名]が[相対時間]前に「[フィールド名]」を変更しました。
最新の内容を確認してから再度編集してください。

[最新の内容を見る]　[それでも上書きする]
```

「それでも上書きする」を選択した場合は updated_at チェックなしで強制保存し、変更履歴に「競合上書き」フラグを残す。

### 実装状況（2026-05-02）

`src/lib/supabase/store.ts` に `saveWithLock()` ヘルパーと `ConflictError` を実装し、
主要エンティティ（tasks/projects/task_forces/todos/key_results/members/milestones/
quarterly_objectives）の upsert を全て楽観ロック経由に変更。

- 競合時：`ConflictError` を投げる
- AppStore の `handleSaveError` で検知 → 「他のメンバーが先に編集していたため最新の内容に戻しました」トースト + load() で整合性回復
- **「それでも上書きする」UI は未実装**（Section 9 で論点化）。現状はリロード前提

### 仕様（2026-05-12 多人数運用対応版）

`saveWithLock` の API：

```typescript
async function saveWithLock<T extends { id: string }>(
  table: string,
  row: T,
  expectedUpdatedAt?: string,  // フォームをロードした時点の updated_at
): Promise<string>             // DB に書き込んだ新しい updated_at を返す
```

**ロック値の優先順位：**
1. `expectedUpdatedAt`（明示的に渡された値・本物のフォーム時点楽観ロック）
2. SELECT で取得した DB の現在値（TOCTOU フォールバック）
3. 両方 null（古い行）→ ロックなし更新

**呼び出し側のルール：**

```typescript
// ❌ クライアント側で updated_at を上書きしない
const updated: Task = {
  ...originalTask,
  // ... fields ...
  updated_at: new Date().toISOString(),  // ← 絶対に書かない
  updated_by: currentUser.id,
};

// ✅ updated_at は触らない。zustand 側で expectedUpdatedAt を渡す
const updated: Task = {
  ...originalTask,
  // ... fields ...
  updated_by: currentUser.id,
};
```

**zustand の各 `saveX` アクションがやること：**
1. set() で楽観更新する前に、store の現在値から `updated_at` を取って `expectedUpdatedAt` とする
2. `upsertX(row, expectedUpdatedAt)` を呼ぶ
3. 成功したら戻ってきた新しい `updated_at` で store を同期（`syncUpdatedAt` ヘルパー）

これにより：
- ✅ ユーザーAがフォームを開いている間にユーザーBが同じ行を更新したら ConflictError で検出
- ✅ 同じユーザーの連続保存も毎回 store の updated_at が更新されるので通る
- ✅ クライアントが間違って `row.updated_at` を新しくしても `expectedUpdatedAt` が別なので影響なし

**【重要】 DB の BEFORE UPDATE トリガーへの対応：**

schema.sql には `trg_*_updated_at` という BEFORE UPDATE トリガーが貼られており、
クライアントが送った `updated_at` 値は `NEW.updated_at = NOW()` で**サーバー側で
強制的に上書きされる**。そのため `saveWithLock` の戻り値（store 同期用）は
クライアントが生成した newUpdatedAt ではなく、`.select("id,updated_at")` で
**DB から返ってきた trigger 適用後の実値**を採用する。

これを怠ると：
- 1回目の保存：成功 → store には client 値、DB には trigger 値（数 μs ずれる）
- 2回目の保存：expectedUpdatedAt = client 値（古い）≠ DB の trigger 値 → **ConflictError**

実際 2026-05-12 にこの問題が顕在化して修正済（コミット参照）。

**回帰防止：** `src/lib/supabase/__tests__/store.test.ts` に 8 本のテスト
（expectedUpdatedAt 明示時のロック・他者書き込み検出・フォールバック挙動・
トリガー上書き後の実値を返すこと等）。

---

## 6. AI連携設計（確定）

### 6-1. 絶対的な禁止事項（2026-05-13 改定）

```typescript
// ❌ 絶対禁止：APIキーをクライアントに露出させる
const response = await fetch("https://api.anthropic.com/v1/messages", {
  headers: { "x-api-key": "sk-ant-..." } // ブラウザに露出する
});

// ✅ 正しい経路（AI呼び出しは必ず invokeAI() を経由）
// クライアント → Supabase Edge Function（ai-consult） → Anthropic API
```

> **【変更】OKR関連情報（O/KR/TF/ToDo）や `contribution_memo` を AI に渡すことは禁止ではなくなった**
> （社内確認の結果。Section 2「AI境界ルール」参照）。残る絶対禁止事項は「APIキーのクライアント露出」と
> 「`invokeAI()` を経由しない直叩き」のみ。

### 6-1b. AIIntent 型ガード（呼び出し目的のラベル＋使用量計測）

`src/lib/ai/invokeAI.ts` の `invokeAI()` は **`intent: AIIntent` パラメータ必須**。
かつては「OKRデータが誤った経路で送られないようコード上で表明させる」目的だったが、現在は
**「この呼び出しは何の機能で、どんなデータを渡しているか」のラベル**として機能する
（そのまま `ai_usage_logs.consultation_type` に保存され、AI使用量タブで機能別集計に使われる）。

```typescript
export type AIIntent =
  | "task-management"      // payloadBuilder 経由・通常のタスク管理相談
  | "kr-report"            // KR レポート生成
  | "kr-quarter-plan"      // クォーター計画
  | "kr-session-extract"   // セッション議事録抽出
  | "kr-why"               // なぜなぜ分析
  | "okr-analysis"         // KR単位のAI分析（会議ノート＋KRセッション・宣言＋TFタスク）
  | "meeting-extract"      // 会議文字起こしからタスク抽出
  | "project-plan"         // AI で PJ 設計
  | "project-analysis"     // 単一PJの健全性分析
  | "all-projects-analysis" // 全PJ横断ポートフォリオ分析
  | "todo-decompose"       // ToDo 分解
  | "okr-import"           // Kintone OKR(PDF/テキスト)からObjective/KR/TF構造を抽出
  | "okr-personal-import"  // Kintone個人OKR(PDF/テキスト)から個人KR/月次計画/振り返りを抽出
  | "okr-personal-outlook" // 個人OKR「これから」の見立て・週ごとの一手・バンドのAI判定（自動トリガー・キャッシュあり）
  | "okr-personal-chat";   // 個人OKR用AIパネルの対話形式の相談（明示操作・ターンごとに発生）
```

新しい AI 機能を追加するときは、この型に新タグを追加し、当該 prompt builder に
「何のデータを渡しているか」をコメントで明示すること（漏洩防止というより可読性・記録のため）。
タグなしの呼び出しはコンパイルエラー。

### 6-1c. max_tokensの目安（v3.45・2026-08-10）

JSON構造の抽出（OKR取込・会議抽出等）は **8192で足りる**（`okrImportExtractor.ts`・
`personalOkrImportExtractor.ts`が実績値）。**16000（や16384のCap近辺）に上げると、PDF等の
大きな添付を併用した際にEdge Functionのワーカーがリソース上限で落ちる
（546 WORKER_RESOURCE_LIMIT。2026-08-10の実例。Section 19 ⑦参照）。** 出力が長くなりがちな
複数タスクの構造化提案（`apiClient.ts`のメイン相談）のように添付ファイルを伴わない用途は
16384（Edge Function側`MAX_TOKENS_CAP`）まで上げてよいが、**添付ファイルを伴うAI機能は
8192を既定にする**こと。安易にmax_tokensだけを上げて出力切れを解消しようとしない
（`stop_reason==="max_tokens"`を検知して分かりやすいエラーにする方が安全。
`personalOkrImportExtractor.ts`の実装・`consultationRunner.ts`の先例参照）。

### 6-2. APIキーの管理

- APIキーは Supabase の環境変数（ANTHROPIC_API_KEY）にのみ保持する
- .env ファイルを Git にコミットしない（.gitignore に必ず追加）
- クライアントは Supabase Auth トークンで Edge Function に認証する

### 6-3. AIに渡すデータ構造

```typescript
interface AIConsultationPayload {
  context: {
    today: string;                   // 例："2026-03-17"
    today_formatted: string;         // 例："2026年3月17日（火）"
    fiscal_year: { start, end, first_half_end, second_half_start, second_half_end };
    quarters: {
      definition: "1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月";
      current_quarter: string;       // 例："1Q"
      current_quarter_end: string;
      next_quarter: string;
      next_quarter_start: string;
      next_quarter_end: string;
    };
    target_deadline: string | null;  // deadline_checkモードのみ使用
    member_workload: MemberWorkload[]; // メンバーごとの工数状況
  };
  consultation_type: ConsultationType;
  consultation: string;
  scope: "related_pj" | "all_pj" | "member_tasks";
  projects: AIProject[];             // 現状は pj_purpose のみ（contribution_memo は未投入。投入しても可）
  retry_hint?: string;               // リトライ時のみ
}
```

### 6-4. コメントのサニタイズ（必須）

```typescript
// AIに渡す前に必ず呼び出す（payloadBuilder.tsで実装済み）
export function sanitizeComment(comment: string): string {
  return comment
    .replace(/\\\\[^\s]*/g, "[ファイルパス省略]")    // ネットワークパス
    .replace(/\/\/[a-zA-Z0-9._-]+\/[^\s]*/g, "[ファイルパス省略]") // UNCパス
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[メールアドレス省略]")
    .trim();
}
```

### 6-5. shortIdMapの管理

```typescript
// payloadBuilderはshortIdMapと一緒にpayloadを返す
interface BuildPayloadResult {
  payload: AIConsultationPayload;
  shortIdMap: Map<string, string>; // key: "task_001", value: UUID
}

// useAIConsultationのstateで保持し、applyProposalに渡す
const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(new Map());

// セッションリセット時に初期化する
setShortIdMap(new Map());
```

### 6-6. consultation_typeの5種類（厳守）

| 種類 | 説明 |
|---|---|
| `change` | 変更の影響整理（デフォルト） |
| `simulate` | What-If シミュレーション |
| `diagnose` | 現状診断（変更なしでリスクを洗い出す） |
| `deadline_check` | 締め切り逆算（target_deadlineが必須） |
| `scope_change` | PJ停止・スコープ縮小 |

勝手に種類を追加しないこと。追加する場合はsystem_prompt_design_v3.mdも同時に更新する。

### 6-7. マルチターン（会話履歴）の管理

```typescript
// 会話履歴はDBに保存しない。React stateのみ。
// パネルを閉じたら消える設計を崩さないこと。
// セキュリティ上の理由：履歴にはPJ・タスクデータが含まれる。

// トークン上限の管理（ターン数ベース）
// 10ターン → warning（「新しい相談を始める」を表示）
// トークン超過 → truncateOldTurns（直近5ターンを保持して古いターンを削除）
```

### 6-8. date_certaintyの画面表示ルール

| 値 | 表示 | 「反映する」ボタン |
|---|---|---|
| `"exact"` | 特別な表示なし | 活性 |
| `"approximate"` | ⚠ 「日数は要確認」バッジ | 活性 |
| `"unknown"` | ❓ 「日数未定」バッジ | 非活性 |

**例外**：`add_task`・`add_project`（`proposalMapper.ts`の`canApply`）は、日付が未定（`"unknown"`）でも
反映ボタンを活性のままにする。新規タスク・新規PJの提案は日付が仮決めでも「確認して作成」画面で
編集できるため、date_certainty による非活性化の対象外とする意図的な設計（date_change・assignee等の
既存データ変更とは異なり、作成系は空欄のまま作ってから後で編集すればよいため）。

### 6-9. simulation_stateの画面表示ルール

```typescript
// is_simulation=true の場合：
// - 提案カードに「🔵 シミュレーション」バナーを表示
// - 「反映する」ボタンを非活性にする
// - 「この仮定で確定する」ボタンで通常フローに移行
```

### 6-10. applyProposalのDB操作ルール

```typescript
// date_change・assignee → needs_confirmationを返す
//   確認ダイアログでユーザーが値を確認・入力後にapplyProposalWithConfirmationを呼ぶ
//
// risk・no_tasks・deadline_risk → appStore.saveTask経由でcommentに追記
//   supabase.rpc()は使わない（v3.71より前は2ステップSELECT+UPDATEを自前実装していたが、
//   saveTaskのchoke point自体が同種の楽観ロックを持つため今は委譲している）。
//
// scope_reduce・pause → appStore.deleteTask/deleteProject経由の論理削除（is_deleted=true）
//
// milestone → 現在未対応。errorを返す。
//   マイルストーンテーブルの設計完了後にneeds_confirmationに変更する。
```

**🔴 v3.71でchoke point統一**：上記いずれも`supabase.from(...)`を直接呼ばず、
`useAppStore.getState()`のアクション経由でDBに反映する（Section 3-6参照）。読み取り
（確認ダイアログ表示用のプレビュー）も常に`useAppStore.getState()`のstateを見る
（実ユーザー・ゲストで分岐しない。以前は実ユーザーのみ`supabase.from(...).select()`で
都度フレッシュな値を取っていたが、store状態は他の画面もこれを信頼して動いているため
統一した）。

### 6-11. applyProposalWithConfirmationの引数

```typescript
// shortIdMapは引数に含めない（第3引数は不要）
// 理由：confirmedValuesのキーはDBから取得したUUIDそのものであり、逆引き不要
export async function applyProposalWithConfirmation(
  dialog: ConfirmationDialog,
  confirmedValues: Record<string, string> // key: UUID, value: 新しい日付orメンバーID
): Promise<ApplyResult>
```

### 6-12. useAIConsultationのexportルール

```typescript
// 実際のexport（2026-07-21・巡回20回目で更新。loadingMessageは2026-04-30のAIProgressLoader
// 導入でLoadingView側が固定フェーズ表示に切り替わり表示先を失っていたため削除）
return {
  callState, session, tokenStatus, shortIdMap,
  proposals, followUpSuggestions, errorMessage,       // AI応答の表示に使う派生state
  submit, reset,
  undoStack, canUndo, pushUndoSnapshot, undo, undoUntil, // Undo機能（後から追加）
};

// useFollowUpはexportしない
// 理由：FollowUpButtonsのonSelectはinputTextへの挿入のみ行う。
//       即APIコールするuseFollowUpは誤用の危険があるため削除済み。
```

### 6-13. システムプロンプトの格納場所

`/src/lib/ai/systemPrompt.ts` に定数として管理する。
直接コード内にインラインで書かない。
変更する場合は system_prompt_design_v3.md のバージョンも上げること。

### 6-14. 四半期定義

```
1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月
年度：1月〜12月
上半期：1〜6月 / 下半期：7〜12月
年度末：12月31日
```

### 6-15. エクスポート仕様（優先度順）

1. **CSV**（最初に実装）
2. **Excel（.xlsx）**（動くものができてから）
3. **PDF**（最後・難易度高・将来検討）

---

## 7. 変更履歴の設計

### 管理画面の変更履歴（2週間保存）

```typescript
interface AdminChangeLog {
  id: string;
  layer: 'objective' | 'kr' | 'tf' | 'project' | 'member';
  action: 'create' | 'update' | 'delete' | 'restore' | 'period_switch';
  target_id: string;
  target_name: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  performed_by: string;
  performed_at: Date;
  is_conflict_override: boolean;
}
// 保存期間：performed_at < NOW() - INTERVAL '14 days' のレコードは定期削除
```

### タスク変更履歴（最低限）

```typescript
interface TaskChangeLog {
  task_id: string;
  updated_at: Date;
  updated_by: string;
}
```

---

## 8. 画面一覧と設計済みの画面

| 画面 | 状態 | 備考 |
|---|---|---|
| セットアップウィザード | ✅ 実装済み | 初回起動時のみ表示 |
| 管理画面 | ✅ 実装済み | カテゴリ分け左ナビ（v2.63）＋件数サマリー行・モダンCard体裁（v2.64）：作業設定（PJ/TF/Objective・KR）／人（メンバー/メンバータグ）／組織（グループ・部署）／レポート（AI使用量）。部署管理者・全社スーパー管理者が編集可。メンバー・PJ・TFの「＋追加」はマイルストーン追加と同じポップアップモーダル形式（v2.86）。**【v3.60で変更】設定画面ローカルの部署絞り込みセレクタは廃止し、サイドバーの「表示部署」（`appStore.currentGroupId`）に一本化した**（山本さん指示。編集対象の部署がサイドバーと設定画面で食い違う状態を無くす）。メンバー/PJ/OKR系/タグ/AI使用量/招待PJ一覧はいずれも`currentGroupId`基準で絞り込む。アクセス可能な部署が2つ以上のユーザーにだけ「編集対象の部署：◯◯（サイドバーの「表示部署」に従います）」という読み取り専用の表示を出す（部署を切り替えたい場合はサイドバー側で行う）。`currentGroupId`が未確定でアクセス可能な部署を一意に決められない場合は「全部署を見せる」には絶対にせず、`src/lib/admin/resolveAdminGroupId.ts`（純粋関数・テスト有）が部署が1件しかない場合のみ確定させ、それ以外はガード画面（「表示する部署を判定できません」）を出す。**副作用の是正**：プロジェクト招待用の部署（`is_invite_group=true`）はサイドバーの表示部署の選択肢から常に除外される（`filterInviteGroupsForSidebar`。CLAUDE.md Section 25）ため、この部署のみに属する「ゲストメンバー（招待受諾者）」はMembersSectionの部署絞り込みリストには現れない。これを埋めるため、`src/lib/admin/guestMembers.ts`の`isGuestOnlyMember()`で判定した該当者を、部署絞り込みとは別枠の「ゲストメンバー（プロジェクト招待で参加）」カードに常時表示する（該当者がいない部署ではカード自体を出さない）。プロジェクト招待タブ（`InvitesSection`）は元々PJ自体のホーム部署（招待用部署ではない）で絞り込んでいるため、この変更による影響は無い |
| OKR PDF取込（`OkrImportModal`） | ✅ 実装済み（v2.92） | 設定画面「Objective・KR」タブの「📄 PDFから取込」ボタンから起動。KintoneのOKR画面PDF/テキストをAIが解析しObjective/KR/TFを構造抽出→人が確認・編集（担当リーダーの自動突合含む）→登録。二重登録防止のため登録先（新しい期のObjectiveとして作成／既存Objectiveに追記）を選択可 |
| ダッシュボード | ✅ 実装済み | OKR進捗・今週タスク・アラート・フィルター付き |
| カンバンビュー | ✅ 実装済み | ドラッグ&ドロップ対応。タスク追加はFABに一本化（右上ボタンは廃止） |
| ガントビュー | ✅ 実装済み | PJ別・人別の2ビューモード。PJバー・マイルストーン・今日線・トグル開閉 |
| リストビュー | ✅ 実装済み | 列カスタマイズ・サイドパネル・エクスポート |
| タスク追加FAB | ✅ 実装済み | 全画面共通・右下固定。TF・ToDo・PJ・担当者・開始日・期日・メモを設定可。最上位作成時は子タスクを一括追加可 |
| PJ作成モーダル | ✅ 実装済み | **v3.59でステップ式（5ステップ／まっさらな新規作成は2ステップ）に作り直した**：①作成方法・引継ぎ元PJ→②日程の引き継ぎ方→③インポートタスク→④インポートメンバー→⑤名前をつけて作成（確認＋基本情報入力）。各ステップに進捗表示（`n / 総数`＋ステップ名）と初見向けの短い案内文を置く。ステップ遷移と「次へ」に進めるかの判定は`lib/project/projectCreateSteps.ts`の`resolveSteps(mode)`/`canGoNext(step, state)`（純粋関数・テスト有）に切り出した。モーダルの高さは本文ラッパーに`minHeight:300px`を持たせてステップ切替時のガタつきを抑える（Section 21の契約自体は不変＝`modalStyles.ts`をそのまま使用）。**日付の引き継ぎ（v3.59で選択肢を2つに整理）**：「スケジュール間隔を引き継ぐ」（元PJのマイルストーンを1つ「基準」として選び、新PJではいつに置くかを入力。基準以外のマイルストーンは「他のマイルストーンも引き継ぐ」チェックボックス1つで一括on/off＝旧実装の「行ごとのチェックボックス＋基準ラジオ」の二重構造を解体）と「日付を引き継がない」の2択のみ。**v3.58で入れた「元PJの開始日を基準にする」はv3.59で撤去した**（山本さん指示。選択肢が3つあると初見の利用者に何を求められているか伝わらないため、2つに整理）。引き継ぎ元PJにマイルストーンが1件も無い場合は「スケジュール間隔を引き継ぐ」自体を選べなくし理由を明記、既定は「日付を引き継がない」にする（`defaultDateStrategy`）。純粋関数は`lib/project/inheritTaskDates.ts`（`computeInheritOffsetDays`/`shiftDateByOffset`/`computeInheritedTaskDates`/`computeInheritedMilestoneDate`。旧「元PJ開始日基準」用の回帰テストは、UI選択肢が撤去されても計算自体は変わらないため関数レベルのテストとして残す）。タスク・マイルストーン複製本体は`lib/project/taskInheritance.ts`（`buildInheritedTasks`/`buildInheritedMilestones`/`buildInheritedDependencies`）。メンバー引き継ぎの候補は元PJの`member_ids`∪全タスク担当者（`lib/project/inheritMembers.ts`）で、独立の`project_members`テーブルは存在しないため`lib/project/projectMembers.ts`（PJ設定画面「関わるメンバー」表示用の別目的の集約関数）は流用しない。選んだメンバーは新PJの`member_ids`としてプロジェクト作成の1回のupsertに含めるため、追加の書き込み・順序問題は発生しない。 |
| タスク編集モーダル | ✅ 実装済み | ToDo紐づけフィールド含む |
| AIに変更を相談パネル | ✅ 実装済み | マルチターン・5モード・確認ダイアログ |
| ConfirmationDialogModal | ✅ 実装済み | date_change/assignee確認用 |
| ツアー機能 | ✅ 実装済み | ⚠ 位置指定をpx固定→要素基準に修正が必要（技術的負債） |
| グラフビュー（ラボ機能） | ✅ 実装済み | Canvas+カスタム物理シミュレーション。サイドバーのラボセクションから起動 |
| OKRモード（個人OKR） | ✅ 実装済み（Phase 1・v3.36〜v3.39／Phase 2取込・v3.41／Phase 3前半「これから」機械計算・v3.51／Phase 3後半AI解析＋AIパネル・v3.52） | サイドバー「🎯 OKR」で切替。個人の四半期KRをタブ管理し、KRごとに月切替→今月の計画（Kintone取込または手入力）→週の目標状態（◯△✕自己評価）→**これから（当月のみ。機械計算＝残り週数・自己評価の積み上げ・未設定週・紐づくタスクの遅延/停滞/先行待ち ＋ AI解析＝見立て・週ごとの一手・捨てる候補・バンドのAI判定。対象KRタブを開いたときのみ発火・入力が前回と同じなら再解析しない）**→メモを記録する。「迷ったらAIに聞く」から計画モードと同じ型のAIパネル（`PersonalOkrAiPanel`）を開ける。「📥 Kintoneから取込」（`PersonalOkrImportModal`）でKintoneの個人四半期OKR・月次振返り記録のPDF/テキストをAI解析→人が確認・対応づけ→登録できる。詳細はSection 24・`docs/dev/okr-redesign-plan.md` |
| OKRモード：グループ側機能（①会議ノート／②セッション記録&分析／③レポート作成／なぜなぜ分析／クォーター計画タブ） | 🗄️ **アーカイブ（v3.40・2026-08-10）** | 山本さんの判断で一旦白紙化。OKRモードは個人OKRのみになり、サイドバーのラボからも撤去した。コードは削除せず保管（`src/components/okr/ARCHIVED.md`参照）。旧クォーター計画タブは`kr_quarter_plans`（部署スコープ・Supabase）保存だった |
| KRセッション freeform モード | 🗄️ **アーカイブ（v3.40・2026-08-10）** | 旧・戦略会議など OKR/TF が議題中心の自由形式会議用（`kr_sessions.session_type='freeform'`）。上記グループ側機能アーカイブに含む。DBテーブル・データはそのまま残す |
| ローディングのヒント設定（`LoadingTipsSection`） | ✅ 実装済み（v3.13） | 設定画面の新カテゴリ「アプリ設定」→「ローディングのヒント」。全社スーパー管理者のみ。ローディング画面（データ読み込み中）に出す操作テクニックの一覧・並べ替え・編集・削除・追加。`loading_tips` テーブル（全社共通・group_idなし） |
| マイページ（ラボ機能） | ✅ Phase 1（MVP・v3.15）＋Phase 2（configSchema駆動フォーム・v3.16）＋Phase 3（ウィジェット作成仕様書・v3.17）実装済み | サイドバー「🧪 ラボ」から「🧩 マイページ」で開く全画面オーバーレイ。自分専用のウィジェット画面（📌今週のタスク／🔥期限超過・滞留／👥自分の負荷／📊締切の見通し／📈完了ペース／📝メモ／⭐ピン留めプロジェクト／🕒最近更新されたタスク／⏳先行待ちのタスク／➕クイックタスク追加の10種）を追加・削除・並べ替え・サイズ変更できる。設定を持つウィジェットは編集モードの⚙からconfigSchema駆動の設定フォームを開ける。クイックタスク追加はホスト経由でappStore choke pointを通す書き込みアクションの実例。レイアウトは`member_widget_layouts`テーブル（本人のみRLS）に永続化。設計の経緯は`docs/dev/mypage-widgets-design.md`、自作ウィジェットの作り方は`docs/dev/widget-authoring.md`（Section 14.6参照） |
| プロジェクト招待（PJ設定画面「招待」タブ／管理画面「プロジェクト招待」タブ／ログイン画面・`AccessDeniedScreen`の招待コード導線） | ✅ Phase 1〜3実装済み（v3.42〜v3.44）。**v3.49で発行UIをPJ設定画面へ統合**（旧`ProjectInviteModal.tsx`は撤去） | 社内の別部署の人を特定のPJ1件に招待する。発行・一覧・取り消し：PJ設定画面（下記）の「招待」タブ。管理：設定画面「組織」カテゴリ「プロジェクト招待」タブは部署横断の一覧表示として引き続き残す。受諾：ログイン画面の「招待コードをお持ちの方」（新規登録）または`AccessDeniedScreen`の同導線（既にセッションがある場合）。詳細はSection 25・`docs/dev/project-invite-plan.md` |
| PJ設定画面（`ProjectSettingsModal`。PJカルテの「⚙ このPJの設定」から開く） | ✅ 実装済み（v3.49） | 今見ているPJ1件に絞った日常操作の入口。「基本情報」（名前・目的・貢献メモ・オーナー・期間・color_tag・ステータス。**クイック操作で1クリックの完了/アーカイブ/差し戻し**）／「招待」（発行・このPJの一覧・取り消し）／「関わるメンバー」（オーナー・タスク担当者・招待で参加した人の読み取り専用一覧。新しい紐づけテーブルは作らず既存データから`lib/project/projectMembers.ts`が組み立てる）の3タブ。**AdminViewの「作業設定→PJ」タブとの使い分け**：AdminViewは部署横断で全PJ・全ステータスを一覧編集する管理者向けの棚卸し画面として残す（削除もそちらのみ）。この設定画面はPJオーナー・関係者が自分の見ているPJだけを日常的に触るための入口。**基本情報の編集権限はAdminViewのPJ編集と同じ**（部署管理者/全社スーパー管理者。部署内にis_adminが1人もいなければ全員編集可のブートストラップ含む）で、権限が無い場合は読み取り表示になる。招待の発行は権限に関わらず全メンバー可（Section 25の決定を維持）。「関わるメンバー」タブは常に読み取り専用 |

### UI/UX仕様（2026年4月確定）

- **フォント**: M PLUS Rounded 1c（Google Fonts）+ 日本語フォールバックスタック
- **カラー**: すべて `var(--color-*)` CSS変数で管理。ハードコード禁止
- **角丸**: `--radius-sm: 6px` / `--radius-md: 10px` / `--radius-lg: 16px`
- **テキストエリア**: `field-sizing: content` で自動伸縮（Chrome 123+ / Firefox 128+ / Safari 17.4+）
- **フォントサイズ切り替え**: 管理画面に小/中/大（zoom: 0.85/1/1.15）を実装
- **TFアクションボタン**: ToDo・Q移動・編集・解除を2×2グリッドに配置
- **四半期自動判定**: 現在日付から自動的に現在のQを選択（1〜3月=1Q、4〜6月=2Q等）
- **UI文言の文体（2026-08-12確定）**: アプリ内のUI文言（画面表示・説明文・ボタン・トースト等）は既存の です・ます調で統一する。「だ・である調で淡々と」は配布資料（報告書・マニュアル・ガイド・手順書）に限る別ルールであり、UIには適用しない（既存文言が全面的にです・ます調のため、新規分だけ変えると1箇所だけ浮く）。**ただし「問いかけ（〜していませんか？）」と「詩的表現」を使わない禁止事項は、文末がです・ます調でもUI文言に等しく適用する**（修辞疑問はAI臭さの原因になる）。既存文言の一斉書き直しは行わない。

---

## 9. 未解決の設計論点

| 番号 | 論点 | 優先度 | 備考 |
|---|---|---|---|
| A | KRの進捗率の計算ロジック（手動 vs 自動） | 高 | ダッシュボードのバーに影響 |
| B | ツアー吹き出しの位置指定をpx固定→要素基準に変更 | 中 | Teams埋め込みでズレる |
| D | Teamsへの埋め込みに伴うウィンドウサイズ対応 | 中 | — |
| E | マイルストーン実装（設計完了・帰宅後に実施） | 中 | 下記Section 3-5参照。4ファイル変更が必要 |
| F | PDF出力の実装方法（サーバーサイド vs Print API） | 低 | 将来検討 |
| G | OKR周辺テーブル（kr_sessions/kr_declarations/kr_meeting_notes/kr_note_tf_entries/okr_analyses/kr_reports/quarterly_objectives/quarterly_kr_task_forces）のRLSが部署分離未対応 | 中 | Section 1.6参照。**コア階層（objectives/key_results/task_forces/todos）はv3.03（2026-07-24）でDBレベルの部署分離（RLS＋自動注入トリガー）完了。UI側の表示絞り込みもv3.02で網羅完了済み。** 残るのはOKR周辺テーブルのみ。第2弾でまとめて対応する方針 |

---

## 10. 開発時の注意事項

### TypeScriptの型定義を徹底すること

```typescript
// ❌ any を使わない
const task: any = getTask();

// ✅ 必ず型を定義する
const task: Task = getTask();
```

### コンポーネントと関数に設計意図コメントを必ず書くこと

```typescript
/**
 * 【設計意図】
 * AIへの相談時にデータをサニタイズする関数。
 * ネットワークパスは社内機密情報の漏洩リスクがあるためAIに渡す前に除去する。
 * この関数を経由せずにコメントデータをAIに渡してはいけない。
 */
export function sanitizeComment(comment: string): string { ... }
```

### Supabase の RLS（行レベルセキュリティ）を必ず設定すること

全テーブルに `authenticated` ユーザーのみアクセス可能なRLSポリシーを設定する。

### 物理削除は絶対に実装しないこと（Section 4参照）

### useAIConsultation Hook経由でのみAIを呼ぶこと

```typescript
// ❌ 直接呼ばない
import { callAIConsultation } from "../lib/ai/apiClient";

// ✅ Hookを経由する
const { submit } = useAIConsultation(projectIds);
```

---

## 11. このドキュメントの更新ルール

- 設計変更があった場合は必ずこのファイルを更新すること
- Phase 5（実装）で判明した設計変更は Section 9（未解決論点）に追記してから対応する
- 未解決の論点が解決したら Section 9 から削除して該当Sectionに追記する
- **バージョンアップ時の変更履歴は、CLAUDE.md本体には書かず [docs/dev/CHANGELOG.md](docs/dev/CHANGELOG.md) の末尾に追記すること**（2026-07-31：冒頭に履歴を積み上げる旧方式が肥大化の原因になったため分離した。CLAUDE.mdは「現在の設計の正本」に専念する）
- **バージョンを上げるときは `src/lib/version.ts` の `APP_VERSION` も必ず一緒に更新すること**（2026-08-06・v3.25で追加）。画面隅のバージョン表示（サイドバー最下部・ログイン画面・モバイルラボシート）が参照する唯一の正本であり、このファイル冒頭のバージョン表記と一致することを `src/lib/__tests__/version.test.ts` が機械的に検査する。片方だけ上げるとこのテストが落ちるので気づける（modalStyles.test.ts と同じ「ソースを読んで検査する」方式）
- **🔴 バージョンを上げるときは次の4点セットを必ず更新すること**（2026-08-12・v3.63で追加。Section 29参照）：①`src/lib/version.ts` の `APP_VERSION` ②このファイル冒頭のバージョン表記 ③`docs/dev/CHANGELOG.md`（開発者向け・技術的な記述のまま末尾に追記） ④`src/lib/releaseNotes.ts`（利用者向け・「何ができるようになったか」の粒度に書き直したものを配列の先頭に追記）。①②の一致は`version.test.ts`、①④の一致（`RELEASE_NOTES[0].version`）は`src/lib/__tests__/releaseNotes.test.ts`が機械的に検査する。③と④は読み手が違う（開発者 vs 利用者）ため統合しない別ファイルのまま運用する
- **リリース時、DBスキーマに変更を伴うマイグレーションを追加した場合は `src/lib/schema/schemaChecks.ts` に検査項目を1行足すこと**（2026-08-06・v3.26で追加。Section 22参照）。マイグレSQLを書いて終わりにせず、この配列への追記までがワンセット。
- 最終更新：2026-08-19（v3.82）

---

## 12. 関連設計書ファイル一覧

| ファイル | 内容 | バージョン |
|---|---|---|
| `system_prompt_design_v3.md` | AIシステムプロンプト・ペイロード構造・エラー処理 | v3.0 |
| `api_call_design_v1.md` | APIコール設計・型定義・セッション管理 | v1.0 |
| `response_rendering_design_v1.ts` | レスポンス構造化・画面反映設計 | v1.0 |
| `it_dept_consultation.docx` | IT部門向けセキュリティ確認資料 | — |
| `cost_estimation.html` | AIコスト試算書 | — |
| `docs/dev/CHANGELOG.md` | 変更履歴（v1.0〜） | — |

---

## 13. ファイル構成（実装時の配置先）

```
src/
├── stores/
│   └── appStore.ts               # zustand ストア（全アプリデータの単一真実）
├── lib/
│   ├── ai/
│   │   ├── invokeAI.ts           # AI 呼び出しの唯一のゲート（AIIntent 必須）
│   │   ├── types.ts              # AI連携の全型定義（AIErrorCode含む）
│   │   ├── systemPrompt.ts       # システムプロンプト定数
│   │   ├── apiClient.ts          # Claude API呼び出し（Edge Function経由）
│   │   ├── payloadBuilder.ts     # ペイロード構築・サニタイズ・shortIdMap生成
│   │   ├── responseParser.ts     # AIレスポンスのパース・バリデーション
│   │   ├── proposalMapper.ts     # AIResponse→UI表示用型への変換
│   │   ├── applyProposal.ts      # 提案のDB反映処理
│   │   ├── sessionManager.ts     # 会話セッション管理（DBに保存しない）
│   │   ├── krQuarterPlanPrompt.ts  # クォーター計画AI：クォーター計算・コンテキスト生成・システムプロンプト
│   │   └── krQuarterPlanClient.ts  # クォーター計画AI：対話・計画書生成・JSONパーサー
│   ├── date/
│   │   └── holidays.ts           # 日本の祝日判定の薄いラッパー（isHoliday）。japanese-holidays
│   │                              # を直接あちこちで呼ばず必ずここ経由（v3.05）
│   ├── localData/
│   │   └── localStore.ts         # localStorage キー一元化（KEYS / LS_KEY / migrateLocalStorage / active()）
│   ├── i18n.ts                    # 軽量自前i18n（translate()・ja静的import/en動的import＝loadEnDict()。v3.19）
│   ├── chunkSizeGate.ts           # 閾値超えReact.lazyチャンクのDL確認ゲート判定（resolveChunkGateStatus・
│   │                              # dist/chunk-sizes.json実測を読む。v3.19。Section 19参照）
│   ├── lazyWithRetry.ts           # React.lazyの動的import失敗時に1回だけリロードして復旧させるラッパー
│   ├── dependencies/              # タスク依存関係（B1/B3/B5）の純粋ロジック
│   │   ├── cycleCheck.ts         # wouldCreateCycle / canAddDependency（自己依存・重複・循環のDFSチェック）
│   │   ├── gate.ts               # getIncompletePredecessors / formatBlockerNames（完了ゲート・着手警告）
│   │   ├── reschedule.ts         # B3：computeCascadeShifts（制約充足プッシュの自動リスケ連鎖・純粋関数）
│   │   └── linkDirection.ts      # B5：resolveLinkDirection（ガント上のドラッグ結線の先行/後続解決・純粋関数）
│   ├── dragReorder.ts             # タスクD&D並べ替えの純粋ロジック（computeDropZoneFromRatio /
│   │                              # computeSiblingReorderIds。ListView/GanttView共有。v3.01）
│   └── supabase/
│       ├── client.ts             # Supabaseクライアント初期化
│       ├── auth.ts               # セッション取得（getSession）
│       ├── store.ts              # 低レベル CRUD + saveWithLock（楽観ロック）+ ConflictError
│       └── quarterPlanStore.ts   # クォーター計画保存（kr_quarter_plansテーブル・部署スコープRLS。v3.38でSupabase移行済み）
├── context/
│   └── AppDataContext.tsx        # 初回 load + Supabase realtime 購読の lifecycle 管理（薄い Wrapper）
├── hooks/
│   ├── useAIConsultation.ts      # AI相談機能のReact Hook（唯一の呼び出し口）
│   ├── useBulkTaskActions.ts     # 一括操作（ステータス/優先度/担当者変更・削除）。ListView/KanbanView共有
│   └── useTaskDragReorder.ts     # タスクD&D並べ替え（並び替え・親子付け替え・親解除）。
│                                  # ListView/GanttView（PJ別ビューのラベル列）共有（v3.01）
└── components/
    ├── common/
    │   ├── ErrorBoundary.tsx     # ルート ErrorBoundary（main.tsx で配置）
    │   ├── Card.tsx              # 共通Card/SummaryTile/SummaryRow（DashboardViewのCard/KpiTile表現を
    │   │                         # 他画面向けに抽出。現状はAdminView.tsxが利用）
    │   ├── LangToggle.tsx        # EN/JA切替トグル（isLoadingEn中はスピナー表示。v3.19）
    │   ├── ChunkDownloadGate.tsx # withChunkDownloadGate()：閾値超えReact.lazyチャンクのDL確認UI（v3.19。
    │   │                         # Section 19参照。MainLayout.tsxの全lazyコンポーネントに適用）
    │   └── ShortcutsPanel.tsx    # 全ビュー共通ショートカット一覧パネル（旧gantt/GanttShortcutsPanelを汎用化）。
    │                             # MainLayoutが唯一の描画元・画面右下の常設「⌨ショートカット」ボタンとガント凡例の
    │                             # リンク両方から同じstateで開く
    ├── layout/
    │   └── MainLayout.tsx                 # メインレイアウト・ナビゲーション・QuickAddTaskModal（FAB）
    ├── consultation/
    │   ├── ConsultationPanel.tsx          # 相談パネル本体
    │   ├── ProposalCard.tsx               # 提案カード
    │   ├── ConfirmationDialogModal.tsx    # 日程・担当者変更の確認ダイアログ
    │   ├── ChatHistory.tsx                # 会話履歴表示
    │   ├── FollowUpButtons.tsx            # 次の相談候補ボタン
    │   ├── SimulationBanner.tsx           # シミュレーションモードの警告バナー
    │   ├── LoadingView.tsx                # ローディング表示
    │   └── ErrorView.tsx                  # エラー表示
    ├── gantt/
    │   ├── GanttView.tsx                  # ガントビュー（PJ別・人別の2モード）
    │   └── ganttDependencyArrows.ts       # B2：依存矢印の座標計算（純粋関数のみ。DOM実測はGanttView側）
    ├── kanban/
    │   └── KanbanView.tsx                 # カンバンビュー（ドラッグ&ドロップ）
    ├── graph/
    │   └── GraphView.tsx                  # ラボ機能：関係性グラフビュー（Canvas+物理シミュレーション）
    ├── lab/
    │   ├── KrSessionPanel.tsx             # OKRセッション記録・文字起こし抽出
    │   ├── KrReportPanel.tsx              # OKRレポート生成
    │   ├── KrWhyPanel.tsx                 # なぜなぜ分析AI対話
    │   └── KrQuarterPlanPanel.tsx         # クォーター計画AI対話・計画書生成・編集・保存
    ├── task/
    │   └── TaskEditModal.tsx              # タスク編集モーダル（ToDo紐づけフィールド含む）
    └── admin/
        └── AdminView.tsx                  # 管理画面（カテゴリ分け左ナビ：作業設定/人/組織/レポート。計7項目）

supabase/
└── functions/
    └── ai-consult/
        └── index.ts              # Edge Function（APIキーはここにのみ存在）
```

---

*このドキュメントはClaudeとの設計セッションによって作成されました。*

---

## 14. リファクタリング管理

定期的なコードリファクタリングの記録・ガイドは以下で管理しています。
**リファクタリング作業を始める前に必ずこのファイルを読んでください。**

```
docs/REFACTORING.md  ← 完了済み・未完了・進め方・コスト記録
```

**セッション開始の合言葉**：「リファクタリングをしたい」と言われたら `docs/REFACTORING.md` を読んでから提案すること。

---

## 14.5. ツアー（オンボーディング）改修の必読ルール（必須）

オンボーディングツアー（`src/components/tour/` 配下）の見た目・動き・文面には統一基準があります。

```
docs/dev/tour-guidelines.md  ← 背景の明度・モーション・トンマナ・吹き出し構造・トークンの基準
```

**`src/components/tour/**`（TourProvider・tours/*.ts）や、ツアーの暗幕・吹き出し・アニメ・ステップ文面を
変更する前に、必ず `docs/dev/tour-guidelines.md` を読み、その基準（暗さ・余白・角丸・イージング・
絵文字や番号の付け方・吹き出しテンプレート）に従うこと。** 明度やアニメを個別にハードコードしない。

**セッション中の合言葉**：「ツアーを直したい／ツアーを追加したい」と言われたら、まず
`docs/dev/tour-guidelines.md` を読んでから着手・提案すること。

---

## 14.6. マイページ用ウィジェット改修の必読ルール（必須）

ラボ機能「マイページ」のウィジェット（`src/components/lab/widgets/` 配下）には、契約・作法・
禁止事項をまとめた専用の仕様書があります。

```
docs/dev/widget-authoring.md  ← WidgetContextの完全リファレンス・configSchemaの全type一覧・
                                  禁止事項・choke pointを通す理由・提出前チェックリスト
```

**マイページ用ウィジェットを追加・変更する前に、必ず `docs/dev/widget-authoring.md` を読み、
その契約（`useAppStore`/`supabase` の直接使用禁止・`WidgetContext` だけを唯一の入口とする・
`configSchema` 駆動の設定フォーム等）に従うこと。** この契約は
`src/components/lab/widgets/__tests__/widgetContract.test.ts` で機械的にも強制されている
（違反すると `npx vitest run` が落ちる）。

**セッション中の合言葉**：「ウィジェットを作りたい／マイページに機能を足したい」と言われたら、
まず `docs/dev/widget-authoring.md` を読んでから着手・提案すること。

---

## 15. グランドルール：ユーザー向けエラー表示（必須）

ユーザーに見せるエラーメッセージは「何が起きたか」「次に何をすればよいか」が判別できる粒度で表示する。

### 禁止

```typescript
// ❌ 禁止：何が起きたか分からないため原因究明できない
catch (e) {
  setError("エラーが発生しました");
}

// ❌ 禁止：message だけだとエラーコードが消えるので Supabase 側の原因究明ができない
catch (e) {
  setError(e instanceof Error ? e.message : "エラーが発生しました");
}
```

### 必須：`formatErrorForUser()` を経由する

```typescript
import { formatErrorForUser } from "../../lib/errorMessage";

// ✅ 推奨：エラーコード・details・hint を含めて表示
catch (e) {
  setError(formatErrorForUser("保存に失敗しました", e));
}
```

`formatErrorForUser` は Supabase の `PostgrestError`（code / details / hint）も含めて整形する。

表示例：
- `保存に失敗しました [42703] column "summary" does not exist`
- `保存に失敗しました [23514] new row violates check constraint "kr_sessions_session_type_check"`
- `保存に失敗しました [PGRST116] Cannot find a relationship ...`

### 例外：内部用途で「メッセージ文字列だけ」が必要な場合

`getErrorMessage()` を使う（ログ出力・UI 以外の場所）。

### このルールは新規コードに必ず適用する

既存コードもユーザー操作の起点（保存・削除・AI呼び出し等の catch）から順次 `formatErrorForUser` に置き換える。新規コードで `"エラーが発生しました"` 文字列を直接 setError しているのを見つけたら指摘・修正すること。

### 【要注意】`supabase.functions.invoke()` の非2xxは `data` を見るだけでは原因が全部消える（2026-08-10発覚・v3.43で修正）

`supabase.functions.invoke("ai-consult", ...)` が非2xxを返したとき、supabase-js は**`data` を必ず `null` にし**、Edge Function が返したレスポンス本文（`{ error, message, detail, status }`）は戻り値の **`response`**（`FunctionsHttpError` の場合は `Response` オブジェクト）にしか入らない。

```typescript
// ❌ 禁止：非2xx時は data が null になるため、Edge Function側の丁寧な分岐
//   （ANTHROPIC_ERROR / RATE_LIMIT_EXCEEDED 等）に一切到達せず、常に汎用フォールバック
//   文言に落ちる（実際にこれで数日ぶん原因が見えなくなった）。
const { data, error } = await supabase.functions.invoke("ai-consult", { body });
if (error) throw new Error(extractEdgeError(data, error.message)); // data は常にnull

// ✅ 必須：response（Response）の本文を読む。data はテスト等での後方互換のときだけ使う
const { data, error, response } = await supabase.functions.invoke("ai-consult", { body });
if (error) throw new Error(await buildInvokeErrorMessage(data, error, response));
```

実装は `src/lib/ai/edgeFunctionError.ts`（`readEdgeErrorPayload` / `extractEdgeError` / `buildInvokeErrorMessage`）に集約されており、`invokeAI.ts` と `callAIConsultation`（`apiClient.ts`）の両方がこれを経由する。新しく `supabase.functions.invoke()` を直接呼ぶコードを書くときは、必ずこのモジュール（または同じ判断）を経由し、`data` だけでエラー本文を組み立てないこと。

---

## 16. グランドルール：AI 使用量の計測（必須）

新しい AI 機能を実装する際は、**必ず ai_usage_logs に使用量が記録される経路を通す**こと。これにより管理画面の「AI使用量」タブで全機能の入出力トークン・コストが見える化される。

### 必須：`invokeAI()` を経由する

```typescript
import { invokeAI } from "../ai/invokeAI";

// ✅ 推奨：invokeAI 経由 → 内部で logAIUsage() が自動的に呼ばれる
const response = await invokeAI(systemPrompt, messages, 4096, "kr-report");
const text = response.content[0].text;
```

`invokeAI` は呼び出し成功後に `logAIUsage(intent, response.usage)` を必ず実行する。**新しい AI 機能を追加するときは何もしなくてよい**——`invokeAI` を経由しているだけで自動的に計上される。

### 禁止：Supabase Edge Function を直接叩く

```typescript
// ❌ 禁止：invokeAI を経由しないと使用量が記録されない
const { data } = await supabase.functions.invoke("ai-consult", { body: {...} });
```

新しい AI 機能で `supabase.functions.invoke("ai-consult", ...)` を直接呼んでいるコードを見つけたら、`invokeAI` 経由に直すこと。

### 例外：`callAIConsultation`（apiClient.ts）

通常のタスク管理相談だけは歴史的経緯で `callAIConsultation` が直接 `supabase.functions.invoke` を呼ぶ別経路になっている。**この経路では `useAIConsultation.submit` 側で個別に `insertAiUsageLog` を呼んで計上している**。

新しい AI 機能でこのパターンを真似ない。必ず `invokeAI` を使う。

### AIIntent タグの追加

新しい AI 機能を追加するときは `src/lib/ai/invokeAI.ts` の `AIIntent` 型に新しいタグを追加する（CLAUDE.md Section 6-1b 参照）。このタグがそのまま `ai_usage_logs.consultation_type` に保存され、AI 使用量タブで機能別の集計に使える。

```typescript
// 例：新機能「会議サマリ生成」を追加するとき
export type AIIntent =
  | "task-management"
  | "kr-report"
  // ... 既存
  | "meeting-summary";  // ← 新規追加
```

### このルールは新規 AI 機能を実装する時に必ず確認する

「AI を呼ぶ → invokeAI 経由か？」「AIIntent に新タグは追加したか？」をレビュー時にチェックする。

## 17. グランドルール：AIと実UIの乖離防止（必須）

### 原則
AIが案内するボタン名・機能説明が実UIと食い違うと、ユーザーが混乱する（例：「確認する」ボタンを案内するが実際は存在しない）。
これを構造的に防ぐために、以下のルールを遵守すること。

### ボタン名は `src/lib/ai/uiGuide.ts` で一元管理する

```typescript
// src/lib/ai/uiGuide.ts
export const BTN_CONFIRM_CREATE = "確認して作成";   // 新規PJ提案カード
export const BTN_APPLY_CONFIRMED = "確定して反映";  // 確認ダイアログ確定ボタン
export const BTN_APPLY = "反映する";               // 一般提案カード
```

**ボタンラベルを変更するとき**：
1. `uiGuide.ts` の定数を変更する → UIコンポーネントとsystemPromptへ自動反映
2. `uiGuide.ts` の `FEATURE_LIST_SECTION` を更新する（機能追加・削除・変更時）

**絶対にやってはいけないこと**：
- `systemPrompt.ts` にボタン名のハードコードを追加する（`uiGuide.ts` の定数を使うこと）
- `ProposalCard.tsx` や `ConfirmationDialogModal.tsx` のラベルを文字列リテラルで書く

### 機能を追加・削除・変更したとき

`uiGuide.ts` の `FEATURE_LIST_SECTION` 定数を必ず更新すること。
この定数がそのまま systemPrompt に埋め込まれ、AIの機能認識の正本となる。

### 更新チェックリスト（機能変更時）

- [ ] UIコンポーネントのボタンラベルを変更した → `uiGuide.ts` の定数を先に変更したか？
- [ ] 新機能を追加した → `uiGuide.ts` の `FEATURE_LIST_SECTION` に追記したか？
- [ ] 機能を削除・変更した → `FEATURE_LIST_SECTION` から該当行を削除・修正したか？
- [ ] AIプロンプトに新しいUIの説明を書いた → ハードコードではなく定数経由か？

## 18. グランドルール：AI Edge Function のセキュリティ最小セット（必須）

AI 機能付き内製アプリを Supabase Edge Function + Vercel 構成で作る場合、以下2点を必ず実装すること。

### ① CORS ドメイン制限

```typescript
// ❌ 禁止：ワイルドカードは誰でも API を叩ける
const corsHeaders = { "Access-Control-Allow-Origin": "*" };

// ✅ 必須：ALLOWED_ORIGINS 環境変数で本番ドメインを限定する
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean),
]);
function getCorsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? "*";
  return { "Access-Control-Allow-Origin": allow, ... };
}
```

**Supabase ダッシュボードで設定する環境変数：**

| 変数名 | 値の例 |
|--------|--------|
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |

### ② ユーザーごとのレート制限

```typescript
// ✅ 認証後にユーザーIDでレート制限（コスト暴走・ループバグ防止）
const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "20");
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } { ... }

// 超過時は 429 + { error: "RATE_LIMIT_EXCEEDED" } を返す
```

**クライアント側（apiClient.ts）でのハンドリング：**

```typescript
if (errData?.error === "RATE_LIMIT_EXCEEDED") {
  throw new AIError("RATE_LIMIT", errData.message as string);
}
```

### なぜ必要か

| 対策 | 防ぐリスク |
|------|-----------|
| CORS ドメイン制限 | 別サイトの JS から API を叩かれるクロスサイト悪用 |
| レート制限 | ループバグ・悪意ある連打による Anthropic API コスト暴走 |

RLS（認証チェック）は「ログインしていない人」を弾く。CORS + レート制限はその上の「コスト防衛・悪用防止」の層。3つ合わせて AI 機能の最小セキュリティセット。

### このルールは新しい Edge Function を追加するとき必ず確認する

- [ ] CORS が `*` になっていないか？ → `ALLOWED_ORIGINS` 環境変数方式に変える
- [ ] レート制限があるか？ → ユーザーID別・1分N回の in-memory チェックを入れる
- [ ] クライアント側に `RATE_LIMIT_EXCEEDED` ハンドラがあるか？ → ユーザーへの日本語メッセージまで通すこと

---

## 19. グランドルール：ダウンロード量の最小化（必須・v3.19、v3.20で②の実例追加）

**使用者が限られる重量級機能は `React.lazy` で分割し、閾値超えチャンクは確認ダイアログを通す。**
「全員が毎回使うわけではない機能を、全員に黙って毎回ダウンロードさせない」がこのルールの目的。

### ① まず `React.lazy` で分割する

新しい重量級ビュー・ラボ機能・管理画面タブを追加するときは、`MainLayout.tsx` の
既存パターン（`lazyWithRetry(factory, name)`）に必ず乗せる。切替頻度の低い機能を
初回バンドルに混ぜない。

### ② 言語辞書のように「使う人が限られるデータ」は静的importにしない

日本語（既定言語）は静的import・英語は動的import（`src/lib/i18n.ts` の `loadEnDict()` パターン）。
「全員が使うとは限らないデータ」を静的importで束ねると、使わない人にも必ずダウンロードさせて
しまう。en辞書のようにモジュールを `<name>.ja.ts` / `<name>.en.ts` に分割し、`import type` で
型だけを参照させることで、使わない側の実行時コードを一切バンドルに含めない設計にする。

### ③ 閾値を超えるチャンクは「承認して記憶」で確認する

`src/lib/chunkSizeGate.ts` の `CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES`（暫定200KB・gzip後）を
超えるチャンクを初めて要求するときは、`src/components/common/ChunkDownloadGate.tsx` の
`withChunkDownloadGate()` でラップし「◯KBのデータをダウンロードします。よろしいですか」の
確認を挟む。一度承認したら `localStorage` にチャンク名ごとの真偽フラグのみを記録し、次回から
聞かない（Human in the loop パターン③「承認して記憶」。`ClaudeCodeForWork/CLAUDE.md` 参照）。
**localStorageにはフラグだけを保存し、データ本体を保存しない。**

### ④ チャンクサイズは必ずビルド出力から実測する（ハードコード禁止）

`vite.config.ts` の `chunk-size-manifest` プラグインが `generateBundle` フックで実際の
チャンクコードからraw/gzipサイズを実測し `dist/chunk-sizes.json` を書き出す。閾値判定は
必ずこの実測値を使うこと。コード中にサイズをハードコードすると、ビルド内容とズレて嘘の
数字になる（＝「ビルドすれば自動で正しい数字になる」ことを満たす設計にする）。

### このルールは新機能を実装するとき必ず確認する

- [ ] 全員が毎回使うわけではない画面・パネルか？ → `lazyWithRetry` + `withChunkDownloadGate` に乗せる
- [ ] 使う人が限られるデータ（言語辞書・大きな静的データ等）を静的importしていないか？
- [ ] サイズ判定はハードコードでなく `dist/chunk-sizes.json`（ビルド実測）から取っているか？

### ⑤ チャンク名だけを見て「異常に大きい」と誤診しない（v3.20 追記）

`dist/chunk-sizes.json` のチャンク名は、Rollupが**代表として選んだファイル名**であり、
中身がそのファイル自身のコードだけとは限らない。以下は調査済みで、削減不可能な必須コスト
と確定している。次に大きいチャンクを見た人が同じ勘違いで調査時間を使わないための記録。

- **`CustomSelect` チャンク（gzip 約46KB）**：中身の97.5%は `react-dom` 本体。
  `CustomSelect.tsx` 自身は10KB・327行の普通のコンポーネントにすぎない。
  `createPortal` を `"react-dom"` から直接importするファイルが、常時ロード経路（静的import）
  と遅延ロード経路（動的import）の両方から参照されているため、Rollupが `react-dom` を
  共有チャンクとして切り出し、その代表名にたまたま `CustomSelect` が選ばれただけ。
- **`appStore` チャンク（gzip 約60KB）**：大半は Supabase 公式SDK本体。起動時に必ず要る
  ため（zustandストアがSupabaseクライアントに依存）削減しにくい。

チャンクが大きいこと自体が問題なのではなく、「使う人が限られる機能が常時ロード経路に
混ざっていないか」が本ルールの本質。上記2つはどちらも起動時必須の依存であり対象外。

### ⑥ モード単位の初回ゲート（v3.39・チャンク単位のゲートとの違い）

③のチャンクDLゲート（`ChunkDownloadGate.tsx`）は「**コードチャンクのダウンロード**」を
対象にするのに対し、OKRモードには別の対象を持つ初回ゲートがある：`src/lib/okr/okrModeGate.ts`
（判定の純粋関数）＋`src/components/okr/OkrModeIntroModal.tsx`（紹介ポップアップ）が、
「**OKRモードで使うデータのフェッチ**」を承認対象にする。「plan」→「okr」への切替（`MainLayout.tsx`
の `handleToggleAppMode`。choke point）を初めて行うときだけ、OKRモードでできることの紹介と
「データを読み込みます」の一言を挟み、承認したら `localStorage`（`KEYS.OKR_MODE_INTRO_APPROVED`）
に真偽値だけを記録して次回から聞かない（Human in the loop パターン③）。ゲスト（サンプル閲覧）は
Supabaseに一切接続しない設計（Section 23）のため対象外——承認を求める意味が無く、常に
ポップアップを出さず直接入る（承認フラグ自体も書かない）。
新しくモード単位・画面単位でデータフェッチのボリュームが増える機能を作るときは、
「コードのダウンロード」と「データのフェッチ」のどちらが重いのかを見極め、対応するゲート
（③のチャンクゲート／このモードゲート／両方）を検討すること。

### ⑦ Edge Functionに大きな添付をbase64で送るとワーカーのリソース上限で落ちる（v3.45・2026-08-10）

OKRモード「Kintoneから取込」で670KBのPDFを解析すると、Supabase Edge Functionが
`546 WORKER_RESOURCE_LIMIT`（`Function failed due to not having enough compute resources`）で
落ちる事故が起きた。原因はPDFをbase64エンコードしてEdge Functionへ送っていたこと
（670KB→約894KB。Edge Functionが`req.json()`でパースし、Anthropicへ転送する際に
`JSON.stringify`で再構築するため、複数コピーが同時にメモリへ載る）。

**Supabaseは関数ごとにメモリ/CPUの上限を上げる設定を持たない。送る側（クライアント）を
軽くするのが唯一の解。** PDF・Word(.docx)は、Anthropic APIがdocumentブロックで直接読める
としても、クライアント側でテキスト抽出してから軽量なテキスト添付として渡す
（`src/lib/docxText.ts`・`src/lib/pdfText.ts`。`FileAttachButton.tsx`がPDF/Word/HTML判定→
専用抽出→テキスト添付、という経路に一元化している）。新しく大きなファイル種別の添付に
対応するときも、base64のdocumentブロックで送る前にこの制約を必ず思い出すこと。

✅ **既知の未解消リスクはv3.79（2026-08-19）で解消済み（旧記録）**：`src/components/admin/OkrImportModal.tsx`（グループOKR取込）と`src/components/meeting/MeetingImportPanel.tsx`（会議文字起こし取込）は、`FileAttachButton.tsx`の共通経路を使わず、PDFをbase64のdocumentブロックとして直接構築する独自実装を持っていた（`setPdfAttachment({ mediaType: "application/pdf", ..., isText: false })`）。v3.79でこの2画面も`src/lib/pdfAttachment.ts`経由のテキスト抽出に揃え、PDFを扱う全経路が統一された。詳細はSection 37参照。

**新しいAI機能で大きな添付を扱うときの`max_tokens`の目安はSection 6-1c参照。**

### ⑧ 546はペイロードのサイズだけでなく「1回の呼び出しの実行時間」でも起きる（v3.46・2026-08-10）

⑦の対応（PDFのクライアント側テキスト抽出・v3.45）でペイロードサイズの問題を解消した後も、
`personalOkrImportExtractor.ts`で同じ`546 WORKER_RESOURCE_LIMIT`が再発した（テキスト抽出自体は
成功していた）。**Supabase Edge Functionのワーカーは、送信データが軽くても、1回の呼び出しの
生成（Anthropic APIからの応答待ち＋処理）に時間がかかりすぎるとリソース上限で落ちる。**
「ペイロードを軽くすれば直る」という⑦の理解だけでは不十分で、**大きな抽出を複数回の呼び出しに
分割するのが唯一の解**（Section 28参照。個人四半期KRと月次計画・振り返りを別呼び出しにした）。
新しく大きな構造化抽出を実装するときは、添付の軽量化（⑦）と呼び出しの分割（本項）の両方を
検討すること。

---

## 20. グランドルール：全画面ラボ系ビューは position:fixed を使わずメインエリア内に収める（必須・v3.23、v3.33で方式を全面変更、v3.34で単一state化、v3.35でchoke point化）

### 用語（今後この2語で呼び分ける）

- **サイドバー**：左のメニュー領域（`MainLayout.tsx` の `Sidebar` コンポーネント。展開時は既定196px・160〜420pxの範囲でドラッグ可変／折りたたみ時48px固定／モバイルでは非表示）。折りたたみ時の幅は`SIDEBAR_WIDTH_COLLAPSED`定数（Sidebar自身の width にのみ使う）。展開時の幅は可変のため定数ではなくstate（`sidebarWidth`）で持つ（v3.66・Section 30参照）。
- **メインエリア**：サイドバーの右側の作業領域（`MainLayout.tsx` の `mainContent` 変数が描画している領域）。

### 【v3.23〜v3.32の旧方式（廃止）とその欠陥】

体制図・カレンダー・マイページ・関係性グラフ・OKRレポート／クォーター計画／なぜなぜ分析（右ドロワー）などの全画面ラボ系ビューは、当初「`position: fixed; top:0; right:0; bottom:0; left: var(--app-sidebar-w, 0px)`（サイドバー幅ぶんだけ左端をずらす）」という方式でサイドバーを覆わないようにしていた。

これは2026-08-06時点では正しく機能していたが、v3.23〜v3.24で導入された「アプリ外枠（`body { padding: 8px }` ＋ `#root { border-radius: var(--radius-lg); overflow: hidden; }` で作る角丸カード。`src/styles/globals.css`）」と根本的に相性が悪いことが判明した。

- `position: fixed` は**ビューポート基準**で描画される。`#root` の `overflow: hidden` は通常のDOM子要素（position指定を持たない要素）しかクリップできず、`position: fixed` な要素は `#root` の存在ごと無視して描画される。
- その結果、ラボ系ビューは外周8pxの余白まで塗りつぶし、角丸カードの外へはみ出していた。角も直角のままで丸縁が消えていた。
- さらに `left: var(--app-sidebar-w, 0px)` の基準もビューポートそのものであり、角丸カード自体が `body` の8px paddingぶん右にずれて浮いているため、**サイドバーを避けているつもりが、実際はサイドバー右端8pxに重なっていた**。

山本さんの指摘（2026-08-07）：「メニューバーに被らないように上からレイヤーをかぶせているみたいで、元々の丸縁の枠に収まっていないのが嫌。すべてアプリの丸縁エリアに収まるようにしてほしい」。

### 新しい契約（v3.33〜）

**全画面ラボ系ビューは `position: fixed` を使わず、メインエリア内に `flex: 1` で収める。**

- ビュー本体（GraphView・CalendarLabView・ProjectStructureView・MyPageView・KrReportPanel・KrQuarterPlanPanel・KrWhyPanelの非inline時）の root は、`position`/`top`/`right`/`bottom`/`left`/`zIndex` を一切持たない「位置指定のない flex 子要素」にする（`{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", ... }`。内部の `display`/`flexDirection`/`alignItems`/`justifyContent`（中央寄せカード型・右ドロワー型などビューごとの内部構成）はそのまま維持する）。**どこに置くかは親（呼び出し側）が決める**——これが今回の設計の要。
- **PC**：`MainLayout.tsx` の `labOverlay`（`mainContent` 内、`isGuideOpen ? guideOverlay : (isAdminOpen && !isGuest) ? adminOverlay : labOverlay ? labOverlay : appMode === "okr" ? ... : ...` の優先順位＝**ガイド＞設定＞ラボ系7ビュー＞通常のOKR/計画ビュー**）に埋め込む。`#root` の `overflow: hidden` が効くのは「position指定を持たない通常のDOM子孫」だけなので、これでようやく丸縁の内側に正しくクリップされる。ラボ系ビュー同士は `closeLabViews()` により通常同時に開かないが、万一同時にtrueでも `labOverlay` の分岐順（Graph→Calendar→Structure→MyPage→KrReport→KrWhy）で一意に決まる。
- **モバイル**：`body { padding: 0 }` で角丸カード自体が存在しないため、従来どおり全画面表示を維持する。呼び出し側（`MainLayout.tsx` のモバイル分岐）が薄い `MobileFullscreenOverlay`（`position: "fixed", inset: 0`）でビュー本体を包む。zIndexは各ビューが旧方式で持っていた値をそのまま踏襲する。
- **既に理想形の実例**：設定画面（`adminOverlay`。`MainLayout.tsx`）。`position: fixed` を使わず `flex: 1` でメインエリア内に収めているため、最初から丸縁の内側・サイドバーが見えたままになっている。今回の変更は他の全画面ラボ系ビューをこの形に揃えたもの。
- **例外（対象外）**：一時的なモーダル・ダイアログ（タスク編集・クイック追加・ガイド・確認ダイアログ・コマンドパレット・OKR取込・PJカルテ・AdminFormModal・MyPageViewの「＋ウィジェットを追加」等）は、Section 21の契約（`modalStyles.ts`）に従う限り引き続き `position: fixed` のままでよい。一時的な操作であり、丸縁の外にはみ出す・サイドバーが隠れる、のどちらも実害が小さい（Section 21はそもそも角丸カードの内外を問題にしていない）。

### 機械チェック

`src/components/__tests__/labViewContainment.test.ts` が、①`src/` 配下のどのファイルにも `var(--app-sidebar-w` という文字列が現れないこと（旧方式の手法自体が廃止されたことの固定）、②対象7ビューのファイルが、そのビュー本体（`export function <ファイル名と同じ名前>` の関数本体。中央寄せモーダル等の別関数は対象外）の中で `position:"fixed"` を使っていないこと、を機械的に検査する（`modalStyles.test.ts`/`widgetContract.test.ts` と同じソース走査方式）。

### サイドバーのナビ操作をしたら、開いているラボ系ビューを閉じる

サイドバーが常に見える設計になったことで、ラボ系ビューを開いたままサイドバーのナビ（ビュー切替・モード切替・PJ/KR/部署選択）を操作できてしまう。これを許すと「見えないメインエリアの表示だけが裏で切り替わる」混乱が起きるため、`MainLayout.tsx` の `closeLabViews()` を対象操作の入口（`setAppMode` / `handleSelectProject` / `handleSelectKr` / `handleSelectGroupNav` / Sidebarへ渡す `navSetViewMode`）で必ず呼ぶ。ツアー機能の内部遷移など、ユーザーのナビ操作ではない `setViewMode` 呼び出しには通さない（`closeLabViews` を挟むとその呼び出し元のuseEffectのexhaustive-depsで警告が出るため。原因は本文の実装コミット参照）。

### ラボ系ビューは同時に1つだけ開く（重ねるのではなく切り替える。v3.34）

**山本さんの指摘（2026-08-07）**：「ラボの各種機能を押すと、レイヤーが上から重なるように挙動する。Aを押した後にBを押して、その後またAを見ようとAを押しても、Bの下に隠れてAが見えない。重ねるのではなく画面が切り替わるようにしてほしい」。

**原因**：v3.33までは `MainLayout.tsx` がラボ機能ごとに独立した真偽値 state（`isGraphOpen` / `isCalendarOpen` / `isStructureOpen` / `isMyPageOpen` / `isKrReportOpen` / `isKrWhyOpen`）を持っていた。Bを開いてもAが閉じないため両方 `true` になり得て、`labOverlay` の分岐が**宣言順で先勝ち**（Graph→Calendar→Structure→MyPage→KrReport→KrWhy）に1つ選んでいた。押した機能が宣言順で後ろだと画面が変わらず、さらに押し直しても既に `true` なので何も起きない、という不具合だった。

**対策**：真偽値を並べる方式をやめ、`LabViewId`（v3.34時点は `"graph" | "calendar" | "structure" | "mypage" | "kr-report" | "kr-why" | "kr-session"`。**2026-08-10のOKRモード グループ側アーカイブに伴い `"kr-report"` / `"kr-why"` / `"kr-session"` を撤去し、現在は `"graph" | "calendar" | "structure" | "mypage"` の4値**（`src/components/okr/ARCHIVED.md`参照。以下の記述はv3.34〜v3.35当時の設計判断の記録として残す）1つを保持する単一state `activeLabView: LabViewId | null` に一本化した。ラボ機能を開く操作は必ず `setActiveLabView("<id>")` の1行で、前に開いていたものは自動的に閉じる——**2つ同時に開くこと自体が型レベルで不可能**になるのがこの設計の要。`closeLabViews()` は `setActiveLabView(null)` の1行になった。

`labOverlay`（`MainLayout.tsx`）は `activeLabView` に対する `switch` で分岐し、`default` 節で `LabViewId` を `never` 型の変数に代入することで、**新しいラボ機能を追加するときに `LabViewId` へ id を1つ足したのに分岐を書き忘れると型エラーで気づける**（テストを書く必要がない・型レベルの網羅性チェック）。新しいラボ機能を足すときは「`LabViewId` に1つ足す」「`labOverlay` の switch に1本分岐を足す」の2箇所で完結する。

**仕様として意図的な点**：同じ機能のボタンをもう一度押しても閉じない（開いたまま）。サイドバーのビュー切替ナビ（NAV_ITEMS）と同じ挙動に揃えるための意図的な仕様。

**KrJointSessionFlow（OKRの「セッション記録」）もこの対象に含めた**。旧方式では `position:fixed` を使わない設計のため Section 20 の v3.33 対応（position:fixed撤去）の対象外だったが、`isKrSessionOpen` 単独の真偽値でPCでは `mainContent` の**兄弟**として描画されており、開くとメインエリアの横に並んで表示され他のラボ機能と挙動が揃っていなかった。`activeLabView === "kr-session"` として統合し、他と同じく `labOverlay` 経由でメインエリア内に描画するようにした。ただしこのコンポーネント自身のrootは `minHeight:0` を持たない（他のラボビューは持つ）ため、`labOverlay` 側で `{flex:1, minWidth:0, minHeight:0, overflow:"hidden", ...}` のラッパーで包み、契約に合わせている。

サイドバーのラボサブメニュー（`Sidebar` コンポーネント）は `activeLabView` を props で受け取り、現在開いている項目を既存の `NavItem` の `active` プロップ（NAV_ITEMSと同じスタイルトークン）でハイライトする。「画面が切り替わる」ことをユーザーが視覚的に確認できるようにするため。

**ラボビューの開閉は必ず choke point のヘルパー（`openLabView(id)` / `closeLabViews()`）を通し、そのビューに紐づく一時state（編集モーダル等）を切替時にクリアする（v3.35）。** `setActiveLabView` を直接呼ぶ箇所を増やさないこと。理由は次の項目を参照。

### ビューを跨いだ「浮遊モーダル」を防ぐ（v3.35）

v3.34で単一state化した直後は、`activeLabView` が切り替わっても `graphEditTaskId`/`calendarEditTaskId`/`calendarQuickAddDate`/`myPageEditTaskId`（各ビューの「タスク編集モーダルを開く」ための一時state）をクリアしていなかった。これはv3.33までは実害が無かった（2つのラボビューを同時に開けなかったため「ビューAからビューBへ切り替える」操作自体が存在せず、この経路で一時stateが取り残される事象も起こり得なかった）が、**v3.34の単一state化によって切り替えが可能になったことで、初めて到達可能になった不具合**だった（例：GraphViewでタスクを開いて`graphEditTaskId`をセット→閉じずにCalendarへ切り替える→GraphViewは閉じたのに、そこから開いたタスク編集モーダルだけがCalendarの上に残る）。

対策として `MainLayout.tsx` に `openLabView(id: LabViewId)` を新設し、`setActiveLabView` を直接呼ぶ箇所を `openLabView` と `closeLabViews` の2つだけに限定した（choke point化）。`openLabView` は「前と違うidに変わるときだけ」上記4つの一時stateをまとめてクリアする（同じビューを開いたまま行う通常操作——例：MyPage表示中に`onOpenTask`で`myPageEditTaskId`をセットする操作——まで巻き込まないため）。`closeLabViews`はビューを閉じるときに常に4つともクリアする。**新しいラボビューを追加し、そのビューが独自の「編集モーダルを開く一時state」を持つ場合は、この2つのヘルパーに同様のクリア処理を足すこと。**

### 機械チェック（choke point）

`src/components/__tests__/labViewChokePoint.test.ts` が、`MainLayout.tsx` 内の `setActiveLabView(` 呼び出しが `openLabView`/`closeLabViews` の関数本体の外に無いことをソース走査で検査する（`labViewContainment.test.ts` と同じ方式）。

---

## 21. グランドルール：中央寄せモーダルは必ず画面内に収まる高さ上限を持つ（必須・v3.24、v3.64で中央寄せの手段を修正）

**2026-08-06に発生した実際の不具合**：`ProjectCreateModal`（「過去のPJから新規PJを作る」）で、引き継ぎ元PJのタスク一覧が伸びるとモーダルが画面の上下を突き抜け、保存ボタンに到達できずPJを作成できなくなった。原因は「箱（モーダル本体）に `maxHeight` が無く、コンテンツの高さまで無制限に伸びていた」こと。オーバーレイにも `overflow` の指定が無かったため、はみ出した部分に到達する手段が無かった。

**🔴 2026-08-12に発生した2つ目の実際の不具合（田中さんからの業務停止報告）**：`maxHeight` 対策を入れた後も、縦の可視領域が狭い環境（Chrome拡大率100%超＋ブックマークバー2段表示で作業領域の縦が削られた状態）で、`QuickAddTaskModal`（FABから開くタスク追加モーダル）の**上端が画面外に切れ、一番上にあるタスク名の入力欄に到達できず、タスクを登録できない**という不具合が発生した（ウィンドウを大きくすると直る）。原因は `maxHeight` の有無ではなく、**中央寄せの手段そのもの**だった：`alignItems:"center"` で縦方向を中央寄せすると、箱がコンテナよりわずかでも大きくなった瞬間、**上側にはみ出した分だけスクロールで絶対に到達できない領域になる**（下側のはみ出しは `overflow:"auto"` で普通にスクロールして到達できるのに、上側だけ到達不能という非対称なCSSの既知の挙動）。つまり「`overflow:"auto"` を保険として持つ」という当初の記述は不正確で、**実際には下方向にしか効いていなかった**。ブラウザの拡大率・ズームの丸め誤差で `maxHeight:100%` の境界付近になった箱は、この非対称性の影響を受け続ける。**対策は `alignItems:"center"` をやめ、箱側の `margin:"auto"`（flexboxのautoマージンによる中央寄せ）に変更したこと。** auto マージンは空きがある間は中央に配置するが、空きが無くなった（箱がコンテナより大きい）瞬間に0へ縮退し、箱はコンテナの先頭（上端）にぴったり揃う——この状態は通常のブロック要素のオーバーフローと同じ扱いになり、`overflow:"auto"` で上から下まで普通にスクロールして到達できる。（`align-items: safe center` という代替もあるが、対応ブラウザにばらつきがあるため採用しなかった。`margin:"auto"` は全ブラウザで安定して同じ挙動になる。）**次に「中央寄せなら `alignItems:center` でよい」と戻さないこと**——今回のように、縦の可視領域が狭い環境でだけ再現し、通常の開発環境（大きなウィンドウ・100%ズーム）では気づけない不具合だったため、同じ判断が繰り返されやすい。

### 契約（`src/components/common/modalStyles.ts` に集約）

- **オーバーレイ**（背景の暗幕）：`modalOverlayStyle(zIndex)` を使う。`position:fixed; inset:0` で画面いっぱいに広げ、`overflow:"auto"` を持つ（箱が想定外に大きくなっても背景側をスクロールして到達できるようにするため）。**中央寄せはオーバーレイ側では行わない**（`alignItems:"center"` / `justifyContent:"center"` は使わない。上記の不具合の原因のため）。
- **箱**（モーダル本体）：`modalBoxStyle(width)` を使う。**`maxHeight:"100%"`** で、オーバーレイの padding を除いた内側＝ビューポート内に必ず収まるようにする。**`margin:"auto"`** で中央寄せする（`alignItems:"center"` の代わり）。`display:flex; flexDirection:column; overflow:"hidden"` で、内側の本文だけにスクロールを担わせる。
- **本文**（ヘッダー・フッターに挟まれるスクロール領域）：`MODAL_BODY_STYLE`（`flex:1; minHeight:0; overflowY:"auto"`）を使う。**`minHeight:0` は必須。** フレックス子要素の既定 `min-height:auto` のせいで、箱の高さが制約されても本文が縮まずスクロールが発生しない、という典型的な罠がある。
- **フッター**（保存・キャンセル等の操作ボタン行）：`MODAL_FOOTER_STYLE`（`flexShrink:0`）を使う。コンテンツがどれだけ長くても、操作ボタンが押し縮められず常に見える状態を保つ。
- 背景の濃さ・角丸・padding・幅などの個別事情は、これらの spread の**後**に上書きしてよい（例：`{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }`）。**オーバーレイ側で `alignItems:"center"` / `justifyContent:"center"` を上書きしないこと**（2026-08-12の不具合が再発する）。

### このルールは新しいモーダル・ポップアップを追加するとき必ず確認する

- [ ] `modalStyles.ts` の共有スタイルを使っているか？（新規実装で毎回コピペし直すと必ずどこかで漏れる）
- [ ] 箱に `maxHeight` が付いているか？（無いとコンテンツの高さまで無制限に伸びて画面外に突き抜ける）
- [ ] 中央寄せは箱側の `margin:"auto"` で行っているか？（オーバーレイ側の `alignItems:"center"` だと、縦の可視領域が狭い環境で上端が到達不能になる）
- [ ] 本文に `minHeight:0` が付いているか？（無いとフレックスの既定 `min-height:auto` でスクロールしなくなる）
- [ ] 保存・キャンセル等の操作ボタンはフッターに置き `flexShrink:0` にしているか？

### 対象外

- **横からのドロワー・サイドパネル**（AI相談・`TaskSidePanel`・`MemberDetailPanel`・OKRラボの右ドロワー3つ等）。画面の高さいっぱいに出るのが正しい設計で、この契約の対象ではない。
- Section 20 の全画面ラボビュー（体制図・カレンダー・マイページ・関係性グラフ）も対象外（別の契約＝position:fixedを使わずメインエリア内にflexで収める、に従う）。
- **モーダルはサイドバーを避けない**（Section 20 とは別の話。モーダルは画面中央のままでよい）。

### 機械チェック

- `src/components/common/__tests__/modalStyles.test.ts` が、`position:"fixed"` かつ `inset:0` で中央寄せ（`alignItems:"center"` + `justifyContent:"center"`）しているオーバーレイを持つ全 `.tsx` ファイルを検出し、`modalStyles.ts` を import しているか自前で `maxHeight` を持っているかを機械的に検査する（widgetContract.test.ts と同じソース走査方式）。ドロワー・サイドパネル等は明示的な除外リスト（`EXCLUDED_FILES`）に理由付きで列挙してある（v3.33：全画面ラボビュー4ファイルは `position:fixed` を一切使わなくなり検出パターンにそもそも一致しなくなったため除外リストから外した。将来の逆行を見逃さないための対応）。
- **（v3.64で追加）** 同じテストファイル内に、`modalStyles.ts` 自身のソースを読み、`modalOverlayStyle()` が `alignItems`/`justifyContent` を一切使っていないこと・`modalBoxStyle()` が `margin:"auto"` を持っていることを検査するテストを追加した。共有関数側で `alignItems:"center"` に戻されると、20箇所全ての利用先（`ConfirmModal`／`AdminFormModal`／`TodoDecomposeModal`／`MilestoneAddModal`／`MilestoneEditModal`／`WidgetConfigModal`／`DashboardView`／`ProjectKarte`／`ChangeHistoryModal`／`ConfirmationDialogModal`／`MyPageView`／`MainLayout`（2箇所）／`OkrModeIntroModal`／`PersonalKrFormModal`／`WeekTaskLinkModal`／`ProjectCreateModal`／`ProjectSettingsModal`／`QuickAddTaskModal`）に一括で再発するため、利用先ではなく共有関数側を直接検査する。加えて、`modalStyles.ts` を使わず同型のパターンを自前実装していた9ファイル（`AdminFormModal`／`MilestoneAddModal`／`MilestoneEditModal`／`TodoDecomposeModal`／`WidgetConfigModal`／`DashboardView`／`ProjectKarte`／`ChangeHistoryModal`／`ConfirmationDialogModal`）を共有関数へ移行し、`modalOverlayStyle()` の利用者全員が箱側で `margin:"auto"`（`modalBoxStyle()` 経由または手書き）を併用していることを検査するテストも追加した（`ConfirmModal.tsx`・`MainLayout.tsx`の2箇所は箱側の中央寄せが欠けていたため同時に修正）。

---

## 22. グランドルール：マイグレーション追加時は検査項目も1行足す（必須・v3.26）

### 2026-08-06に実際に起きた事故

`20260721_add_task_status_hold_cancelled.sql`（v2.74・2026-07-21適用予定だったマイグレ）が本番に未適用のまま**約2週間気づかれず**、タスクのステータスに「保留」「中止」を選ぶと保存に失敗する不具合が、タスク編集モーダル・カンバン・リスト・ガント・AI提案の反映の**全経路**で発生し続けた。コード側は正しく `on_hold` を送っていたが、DB側の `tasks.status` CHECK 制約が3値のままだったために起きた。マイグレの適用が手作業でコードだけ先に本番へ出るため、適用漏れが「機能が静かに壊れたまま」残る構造になっている。

### 仕組み（起動時に管理者だけが検知する）

```
起動時（管理者のみ・1回）→ RPC（check_schema_health）でスキーマ検査 → 欠けていたら管理者にだけ控えめな警告バナー
```

- **検査項目は `src/lib/schema/schemaChecks.ts` に宣言的な配列として持つ**（SQL側にハードコードしない）。理由：SQL側に埋め込むと項目を追加するたびに新しいマイグレーションが必要になり、この仕組み自体が必ず形骸化する。TS側の配列に1行足すだけで済むようにしてある。
- 各項目は `{ kind, table/column/needle/name/udt, label, migration }` の形（`kind` は `"table"` / `"column"` / `"check_contains"` / `"function"` / `"function_body_contains"` / `"column_type"`）。`migration` は該当マイグレファイル名で、実在することを `src/lib/schema/__tests__/schemaChecks.test.ts` が機械的に検査する（存在しないファイル名を書くとテストが落ちる）。
- 実際の問い合わせは汎用RPC `check_schema_health(p_checks jsonb)`（`supabase/migrations/20260806_add_schema_health_check.sql`。`function_body_contains`／`column_type`はv3.80・`20260819_add_schema_health_function_body_and_column_type_check.sql`で追加）。**動的SQL（EXECUTE）は使わず**、`pg_catalog`/`information_schema` へのパラメータ化された参照だけで判定する。呼び出せるのは部署管理者・全社スーパー管理者のみ（それ以外は例外ではなく静かに空配列を返す）。
- **`kind:"function_body_contains"`（v3.80）**：関数の名前・引数を変えず本文（中身）だけを差し替えるマイグレーションは、`kind:"function"`（`pg_proc`に同名関数が存在するかしか見ない）では適用漏れを検知できない（Section 25 Phase 5・33で発見された既知の限界。v3.80で解消）。この場合は`pg_get_functiondef()`で関数定義全文を取得し、`position()`でneedle（そのマイグレーションでしか登場しない実行文の断片）を含むか判定する`kind:"function_body_contains"`を使う。**needleは変数名・コメント文言のような消えやすいものを選ばない**（将来のリファクタで名前だけ変わって検知が壊れるため）。そのマイグレーションの核心的な振る舞い（消せば機能が壊れる実行文）を選ぶこと。Section 38参照。
- **`kind:"column_type"`（v3.80）**：列は存在するが宣言と実際の型がずれる事故（2026-08-18、`projects.owner_member_ids`の実DBが`uuid[]`のまま宣言の`text[]`からドリフトしていた。v3.75の適用が「UNION types text and uuid cannot be matched」で2回失敗した実際の原因）は、`kind:"column"`（列の存在有無しか見ない）では検知できない。`information_schema.columns.udt_name`（配列型は`"_text"`/`"_uuid"`のように先頭にアンダースコアが付く内部表記）で判定する。Section 38参照。
- クライアント側（`src/components/common/SchemaHealthBanner.tsx`、`src/App.tsx` から admin にのみマウント）は起動時に1回だけ非ブロッキングで呼び、欠落があれば控えめな警告バナー（赤一色ではない warning トーン）を出す。**閉じても次回読み込み時にはまた表示される**（localStorageで永久に黙らせない。今回のように2週間放置されるのを防ぐため）。
- **スキーマを自動修正しない**（検知して知らせるだけ。Human in the loop）。
- RPC自体が未適用（この仕組み自体のマイグレが未適用）のときは、黙って無効化せず「検査を実行できません」を出す（Section 19 のDL確認ゲートが黙って無効化されうる件と同じ轍を踏まないため）。

### このルールは新しいマイグレーションを追加するとき必ず確認する

- [ ] スキーマを変える新しいマイグレ（テーブル・列・CHECK制約・関数の追加）を書いたか？ → `src/lib/schema/schemaChecks.ts` に検査項目を1行足したか？
- [ ] 追加した項目の `migration` は実際のファイル名と一致しているか？（`schemaChecks.test.ts` が機械的に検証する）
- [ ] 適用直後、管理者としてログインしてバナーが出ないこと（＝正しく適用された）を確認したか？

---

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

`TourProvider` は `MainLayout` の内側にあり、ゲストの描画経路（`App.tsx` の `guestActive` 分岐 → `MainLayout`）も通るため、ツアー機能自体はゲストでも動く。完了フラグは `localStorage`（`tour_completed_v1`）のためSupabase非接触の設計とも衝突しない。一方、ツアー定義（`first-time.ts`）はログイン済みの実ユーザーを前提に書かれており、そのままゲストに出すと2つの実害があった。

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

## 24. 個人OKR層（OKRモード再設計 Phase 1・Step A=v3.36／Step B=v3.37／Step C=v3.38／Step D=v3.39／Step E=v3.40）

**正本は [docs/dev/okr-redesign-plan.md](docs/dev/okr-redesign-plan.md)。** このセクションは要点だけを薄く残す（Section 11のルール）。詳細（列定義・段階計画・未決事項）は必ず計画書を読むこと。

- **一行で言うと**：Kintoneが正本。このアプリはKintoneに存在しない「週の層」を埋める実行層。個人四半期KR・月次計画の**編集・評価確定**はKintone側のまま変えない。
- **Step Aで追加した5テーブル**：`personal_krs`（個人四半期KR）／`personal_kr_months`（個人月次計画）／`personal_kr_weeks`（★週の目標状態。アプリだけが持つ層）／`personal_kr_week_tasks`（週とタスクの紐づけ）／`personal_kr_memos`（KRごとのメモ）。`migrations/20260807b_add_personal_okr.sql` 参照（**山本さんの手動適用が必要。未適用**。Step Bの画面は本番適用済みの前提で実装している）。
- **RLSは本人のみ**（`member_widget_layouts` と同じ流儀）。`personal_krs`/`personal_kr_memos` 以外の3テーブルは列にmember_idを持たせず、`personal_kr_owner_member_id()`/`personal_kr_week_owner_member_id()`（SECURITY DEFINER・親を辿るヘルパー関数）で判定する。判断理由はマイグレーションファイル冒頭コメント参照（20260723の「親を辿るポリシー」先例に近い＝単一所有者・低ホップ数・少量データのため）。
- **週の区切りは既存のカレンダー週ロジックを共有する**（二度書かない）。`src/components/gantt/ganttUtils.ts`（v3.09）から純粋な「月→週セグメント」部分を `src/lib/date/monthWeeks.ts`（`calendarWeekNumber`/`computeMonthWeekSegments`）へ抽出し、ganttUtils.ts はそこから import する。ガントの座標計算・挙動は一切変えていない。

### Step B：個人OKRビュー（v3.37）

- **配置**：OKRモードのメインエリアに「グループ／自分」の切替（`OkrDashboardView.tsx` 冒頭のseg）を足した。**グループ側の既存タブ構成（OKR管理/なぜなぜ/計画）は無改修**。`activeLabView`（Section 20の単一state）には足していない——ラボ系の全画面ビューではなく、OKRモードのコンテンツの一部だから。
- **重量級のためReact.lazy分割**：`src/components/okr/personal/PersonalOkrView.tsx` を `lazyWithRetry` + `withChunkDownloadGate` で読み込む（Section 19）。「グループ」タブしか使わない人はこのチャンク（gzip約10.7KB・閾値200KB未満のため確認ダイアログは出ない）を一切ダウンロードしない。
- **状態管理は専用の zustand ストアを新設**：`src/stores/personalOkrUiStore.ts`。**`appStore.ts` には足さない**（Section 19。OKRモードの「自分」タブを開かない人にpersonal_kr系テーブルへのクエリを一切発生させないため）。このストア自体も `PersonalOkrView.tsx` からのみimportされるため、`create()` の実行タイミングも「自分」タブを実際に開いた瞬間まで遅延する。KRタブ・月切替・週カード・メモ欄など複数コンポーネントが同じデータを読み書きするため、krIdごとのキャッシュ管理（月/週/メモの取得済み判定・楽観更新）を1箇所に集約する目的でzustandを選んだ（データ量自体は極小＝1人あたり四半期KR最大十数本・週は最大でもKR×6週間）。
- **🔴 週の列数は可変（5列固定にしない）**：`src/lib/personalOkr/weekLayout.ts` の `buildWeekCards()` が `computeMonthWeekSegments()` の返す件数（5〜6件）をそのまま使い、UI側（`PersonalKrPanel.tsx`）は `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))` で可変列にする。**1〜6週のいずれでも破綻しないことを `weekLayout.test.ts` で回帰テスト済み**（2026年8月＝6週・2026年2月＝5週・W1が1日だけになるケース）。
- **空の週レコードを事前に一括作成しない**：週カードはセグメントの計算結果だけで描画し、`personal_kr_weeks` の行は `goal_state` を書いた時点・自己評価を付けた時点に初めて `ensureWeek()`（`PersonalKrPanel.tsx`）が作る。
- **週とタスクの紐づけ（自動候補＋明示リンク）**：候補抽出は純粋関数 `src/lib/personalOkr/weekTaskCandidates.ts`（`computeWeekTaskCandidates`）に一元化。本人担当・期日が週内のタスクを基本に、個人KRに `task_force_id` が紐づく場合はそのTF配下（`todos.tf_id` 経由）を優先表示する。**紐づけたタスクの遅延・先行待ちの表示は既存ロジック（B4：`computeDelayDays`/`formatDelayLabel`・B1：`getIncompletePredecessors`/`formatBlockerNames`）をそのまま再利用**し、再実装していない。
- **達成度バンド**：Phase 1はAI判定（`band_ai`）が無いため `personal_kr_months.band_target`（Kintoneに書く「狙い」の手入力）のみを扱う。選択肢は`src/lib/personalOkr/bandOptions.ts`の`BAND_VALUES`（60/70/80/90/100）で、**90・100は常に取り消し線＋非活性**（3Qは基本的に置かない運用）。
- **月の可変**：`src/lib/personalOkr/quarterMonths.ts` の `classifyMonth()` が対象月を today との比較で past/current/future に分類する。past＝読み取り専用、current＝編集可、future＝「計画がまだありません」のみ（Kintone取込が無いPhase 1では未来月の手入力を許可しない）。
- **Phase 3以降は今回作らない**：「これから」（AI見立て）・AIパネル（`ConsultationPanel` 型のOKR版）・月末のKintone下書き生成ボタンはこの画面には無い（未実装の空ボタンを出さない方針。計画書§8）。
- **i18nの扱い**：新規辞書キーは追加していない。既存のOKR系コンポーネント（`OkrDashboardView.tsx`・`KrQuarterPlanPanel.tsx`等）と同じく日本語を直書きしている（英語化はPhase 2以降凍結中・`docs/dev/i18n-plan.md`）。
- **画面未実装**（Step Bのスコープ外）：Kintone取込・AI解析・`personal_kr_outlooks`・`okr_knowledge_docs` は対象外（Phase 2・3・5）。

### Step C：既存の整理（v3.38・計画書§9）

- **`quarterPlanStore.ts` を Supabase（`kr_quarter_plans`）へ移行。** 個人OKR（本人のみRLS）とは異なり、クォーター計画はKRに紐づくチーム（マネージャー）の資産のため**部署スコープ**（`group_id = ANY(current_member_group_ids())`。OKRコア階層と同じ流儀）にした。`migrations/20260807c_add_kr_quarter_plans.sql` 参照（**山本さんの手動適用が必要。未適用**）。
- **「1つの(kr_id, quarter)につきアクティブな計画は最大1件」** という元のlocalStorage実装の制約を部分UNIQUE索引（`WHERE is_deleted = false`）で保つ。保存は既存アクティブ行のid再利用＋`saveWithLock`（無ければ新規INSERT）。削除は論理削除（元は`localStorage.removeItem`という物理削除だったが変更）。
- **localStorageの旧データは黙って捨てない。** `loadLegacyLocalQuarterPlan`/`clearLegacyLocalQuarterPlan`（`quarterPlanStore.ts`）でこのブラウザに残っている旧下書きを検知し、`KrQuarterPlanPanel.tsx`のセットアップ画面に「Supabaseへ移行」／「このブラウザから削除」の選択を出す（自動移行はしない＝他端末が既にSupabase側へ保存済みの可能性があるため）。
- **`quarterly_objectives`/`quarterly_kr_task_forces`（死蔵テーブル。Section 1.6・`docs/REFACTORING.md` M24）**：`quarterly_kr_task_forces`はappStore.ts/store.tsの未使用state・アクション・fetch/insert/deleteを削除（読み書きとも参照ゼロになった）。`quarterly_objectives`はOKR PDF取込（`OkrImportModal`が「四半期OKR」選択時に記録用の骨組みを1件作成する）が今も書き込むため、この経路は**残した**（撤去すると取込機能が壊れるため）。どちらもテーブル自体は物理削除しない（Section 4）。`schema.sql`に「死蔵」の明記コメントを追加。

### Step D：OKRモードの初回ゲート＋`quarterly_objectives`の起動時フェッチ除外（v3.39）

- **`quarterly_objectives`を`fetchOkrData`（起動時Phase 2）から除外**（7→6テーブル）。appStore.ts側の読み取り用state（`quarterlyObjectives`）も参照ゼロ（グレップ確認済み）だったため撤去し、`saveQuarterlyObjective`（OkrImportModalの書き込み専用経路）だけを残した。詳細はSection 19 ⑥。
- **OKRモード（plan→okr）に初回ゲートを追加**：Section 19 ⑥参照。「起動時に全員が読むOKRコア6テーブル」とは別レイヤーで、モードそのものへの入室に承認を求める。個人OKR層の週の目標状態・自己評価（◯△✕）等の紹介文もこのゲートのポップアップに含む。

### Step E：OKRモードのグループ側を白紙化・個人OKR専用モードへ（v3.40・2026-08-10・山本さん指示）

- **一行で言うと**：「元々あったグループモードの機能は一旦白紙にしたい。個人のモードだけにしたい」（山本さん指示）。OKRモードは`PersonalOkrView`のみを表示するようになり、グループ側の機能（①会議ノート／②セッション記録&分析／③レポート作成／なぜなぜ分析／クォーター計画タブ／OKR概要・セッション履歴オーバーレイ）は全て描画経路を切ってアーカイブした。
- **サイドバーのラボからもKR系4機能を撤去**：`LabViewId`から`"kr-report"`/`"kr-why"`/`"kr-session"`を削除（4値に縮小）。クォーター計画（`KrQuarterPlanPanel`）はOKRモード内タブ（inline）のみで、サイドバーのラボからの独立導線（standalone）は元から無かった（調査済み・PC側の`labOpen`サブメニューには元々KR系項目自体が無く、モバイルのラボボトムシートにのみ`kr-report`/`kr-why`/`kr-session`の3項目があった）。
- **アーカイブの形は「描画経路を切るだけ」**：ファイルは移動・削除しない。対象ファイルの一覧・復帰手順は `src/components/okr/ARCHIVED.md` が正本。旧`OkrDashboardView.tsx`本体（タブ構成・サイクル進捗バー・概要/履歴オーバーレイ・「グループ／自分」切替seg）は丸ごと`src/components/okr/GroupOkrDashboardArchived.tsx`へ保管し、`OkrDashboardView.tsx`自体は`PersonalOkrView`だけを描画する薄いラッパーに縮小した。
- **撤去した component-local フェッチ**（旧`OkrDashboardView.tsx`にあったもの。撤去によりOKRモードで発生するクエリが実際に減った）：`fetchKrSessions`（KRごとのセッション一覧）／`fetchKrMeetingNote`／`fetchLatestOkrAnalysis`／`fetchKrReport`（選択中KR×今週のサイクル状態表示用）。ストア層（`krSessionStore`等）自体は削除していない。
- **`HelpButton modeKey="okr.cycle"`は撤去した**（案内先の`docs/guides/02_modes/okr/00_cycle.md`をガイド目次から除外したため）。
- **ガイド記事の除外方式**：`docs/guides/`はファイルを消さず、frontmatterに`archived: true`を立てて`src/lib/docs/manifest.ts`の`ALL_ENTRIES`構築時に除外する新方式を導入（`deprecated: true`とは異なり一覧に一切出ない）。対象：`02_modes/okr/00_cycle.md`〜`03_report.md`・`03_roles/kr-rep.md`・`03_roles/facilitator.md`・`04_workflows/weekly-rhythm.md`。`docs/guides/_meta/conventions.md` Section 5.1に方式を追記。`admin.objective-kr-tf`（Objective/KR/TF登録）と`meeting.import`（会議読み込み）はOKR管理データ構造・別機能のため対象外。
- **AIの機能認識（Section 17）**：`src/lib/ai/uiGuide.ts`の`FEATURE_LIST_SECTION`からグループ側の記述（3階層管理・KRセッション記録・KRレポート自動生成）を削除し、個人OKRの実装済み機能に差し替えた。
- **やらないこと（変更対象外）**：`fetchOkrData`の6テーブル（objectives/key_results/task_forces/todos/project_task_forces/task_task_forces）は起動時フェッチのまま維持（計画モードのTF/ToDoピッカー・ガント・ダッシュボードが使用）。DBテーブル（`kr_sessions`/`kr_meeting_notes`/`okr_analyses`/`kr_reports`/`kr_quarter_plans`等）・ストア層のファイルは削除しない。

### Step F：Kintone取込（Phase 2・v3.41・2026-08-10）

`PersonalOkrView`に「📥 Kintoneから取込」を追加（`PersonalOkrImportModal.tsx`）。`OkrImportModal.tsx`（グループOKR取込）と同じHuman-in-the-loopの型（PDF/テキスト→AI抽出→人が確認・編集→登録）を踏襲した。

- **入口**：既存の`FileAttachButton`/`FileDropZone`（PDF・Word・画像・テキスト対応）とテキスト貼り付け欄の両方を受ける。
- **種別判定はAIに任せる**：Kintoneの「個人OKR設定フォーム」（四半期KR）か「個人OKR_月次振返り記録」（月次計画・振り返り）かをAIが判定し`detected_doc_type`として返す（`src/lib/ai/personalOkrImportExtractor.ts`のSYSTEM_PROMPT）。確認画面には「🤖 個人四半期OKRとして読み取りました」等を明示し、誤判定時は人がセグメントボタンで切り替えられる。`AIIntent`に`"okr-personal-import"`を追加（Section 6-1b）。
- **🔴既存の`personal_krs`への対応づけが最重要**：`personal_kr_weeks`/`personal_kr_memos`は`personal_kr_id`（＝`personal_krs.id`そのもの）にしか紐づいていない。既存の同じ四半期のKRを取込で作り直すと、それまでの週の目標状態・メモが孤立して画面から消える。そのため確認画面で「対応づけ」ドロップダウン（新規作成／既存KRのどれかを選択）を必ず経由させ、**最終決定は人**にする。初期選択のヒントは`src/lib/personalOkr/importMatch.ts`の`rankExistingPersonalKrMatches()`（label・kr_kindの一致度スコアリング）が提示するが、スコアが閾値未満（`AUTO_SELECT_THRESHOLD`）なら「新規作成」を既定にする（曖昧な自動選択をしない）。実際の書き込み行（既存idの再利用or新規uuid発行）は`src/lib/personalOkr/importApplyPlan.ts`の`buildImportApplyPlan()`に一本化し、この判断をモーダル側のUIコードに分散させない。
- **グループKR/TFの候補も部署スコープ**：`kr_kind='group_kr'`のときの実リンク先（`key_result_id`/`task_force_id`）は、表示中の部署（`currentGroupId`）に絞った`keyResultsInGroup`/`taskForcesInGroup`（既存の`deptScope.ts`）から選ぶ（v3.02の「他部署のTFが選べた」事故の再発防止）。KintoneのKR番号（"KR1"）はアプリのKeyResultに対応する列を持たないため数値マッチングはできず、`rankGroupTfMatches()`はTF名・KRタイトルとヒント文字列（`group_kr_hint`）の重なりだけで候補を提示する（自動確定はしない）。
- **`kr_kind`・`band_target`・`weight_pct`の数値/enum変換はAIにやらせない**：AIには元のKintone表記（"グループKR1"等）や数値をそのまま返させ、`src/lib/personalOkr/importFieldParse.ts`の`mapKrKindHint()`/`parseBandValue()`/`parseWeightPct()`（決定的な純粋関数）で確定させる。`band_target`はKintoneの月次バンド欄が複数基準のルーブリック（説明文）であることが大半で単一目標が明記されていることは稀なため、AIには「単一の値が明記されている場合のみ数値・それ以外はnull」と指示し、null（未設定）のまま返すことを許容する。
- **既存の週・メモが失われないことをテストで固定**：`src/lib/personalOkr/__tests__/importApplyPlan.test.ts`が「既存KRに対応づけた場合は新しいuuidを発行せず既存の`personal_krs.id`をそのまま使う」「既存にあって抽出結果に無いKR・月は一切触れない」ことを回帰テストする。
- **月次計画の重複作成防止**：`personal_kr_months`は`UNIQUE(personal_kr_id, month)`制約があるため、対応づけ先の既存KRについては`ensureKrDetailLoaded()`で月次計画を確実に先読みしてから計画を組む（`PersonalOkrImportModal.tsx`の`handleApply`）。既存の月次計画が見つかればそのidを再利用して更新し、人が既に決めた`band_override`は取込で上書き・消去しない。
- **機密への配慮**：月次振返りPDFにはGM評価・面談コメントが含まれるため、入力ステップに「🔒 AIに送信される内容」を明示（送るファイル・テキストの範囲と、送らないもの＝アプリ内の既存データ）。
- **取込後も編集可能**：`personal_krs`/`personal_kr_months`の`source_label`/`imported_at`列を必ず埋め、`PersonalKrPanel.tsx`に「📥 {source_label}」バッジ（Kintoneが正本である旨のツールチップ付き）を表示する。取込後もアプリ上でこれらの列を編集できる（読み取り専用にしない）。
- **DBスキーマ変更なし**：Step Aの5テーブルで足りるため、新規マイグレーションは追加していない（`schemaChecks.ts`への追記も不要）。

### Step G：「これから」ブロック（Phase 3前半・機械計算のみ・v3.51・2026-08-11）

**AIが要るものと要らないものを分ける**（`docs/dev/okr-redesign-plan.md` §5-1）。今回作ったのは
**要らない側だけ**：既存データから即時に計算できる事実を「これから」ブロックとして描画する。
AI呼び出し（見立て・捨てる候補・原因の推定・バンドのAI判定）はPhase 3後半で実装する。

**分ける理由（2点）**：①更新中に茫然と待たせない——機械計算分は起動と同時に描画でき、AI分は
後から差し込む設計にすれば、AIの応答を待つ間も週の目標状態やメモは編集できる。②トークンを
使わない——モードを開いただけで発生する処理をゼロトークンに保ち、AI呼び出しは「開いているKR
タブ1本・入力が前回と変わったときだけ」に限定する設計（§5-2）の前提を崩さない。

- **`personal_kr_outlooks`テーブルを追加**（`migrations/20260811_add_personal_kr_outlooks.sql`。
  **2026-08-12に適用済み**＝テーブル作成・RLS有効化を確認。適用漏れは`SchemaHealthBanner`
  （Section 22）が「個人OKR：AI解析の結果とキャッシュテーブルが見つかりません」として検知した）。
  AI解析の結果を履歴として積む（UPDATEしない）。RLSは既存の
  `personal_kr_owner_member_id()`をそのまま再利用（新しいヘルパー関数を増やさない）。今回は
  テーブルを作るだけで、書き込みは無い（Phase 3後半でAI呼び出しを実装したときに初めて発生する）。
- **入力フィンガープリント**（`src/lib/personalOkr/outlookFingerprint.ts`の
  `computeOutlookInputFingerprint()`）：Phase 3後半の「前回と一致したら再解析しない」判定に使う
  純粋関数を先に用意した（今回はまだどこからも呼ばれない）。FNV-1a（32bit）による軽量ハッシュ
  （暗号強度は不要・外部ライブラリを足さない）。週配列はweekIndex昇順にソートしてから文字列化
  するため、要素の順序に依存しない。
- **「これから」の機械計算**：`src/lib/personalOkr/aheadCompute.ts`の`computeAheadFacts()`
  （残り週数・月末までの日数・週の自己評価の積み上げ＝◯△✕の件数・目標状態が未設定の週／
  評価待ちの週の一覧）と`isTargetAndEvidenceSet()`（当月末の達成目標が実質的に設定されているか）。
  紐づくタスクの状況は`src/lib/personalOkr/aheadTaskStats.ts`の`summarizeLinkedTaskStatus()`が
  集計するが、🔴 判定ロジック自体は再実装していない——ベースライン差分は既存の
  `computeDelayDays`（B4）、停滞は既存の`isTaskStagnant`（`AlertTasksWidget.tsx`と同じ判定
  関数）、先行待ちは既存の`getIncompletePredecessors`（B1）をそのままimportして使う。
- **バンドは3値を混ぜない**（`src/lib/personalOkr/bandDisplay.ts`の`resolveBandDisplay()`）：
  `band_ai`（AIの見通し）がまだ無いため、表示は`band_override`（人の決定）があればそれ、
  無ければ`band_target`（Kintoneの狙い）。バッジは「● 自分で決定」／「🎯 Kintoneの狙い」を
  明確に区別して出す。「✦ AI判定」バッジは常に無効表示の空き枠として置き、Phase 3後半で
  `band_ai`が入ったら差し替える（今は偽の判定結果を出さない）。
- **`band_override`は人が選んで保存できる**（`AheadBlock.tsx`）：バンドのボタンをクリックすると
  `personal_kr_months.band_override`/`band_override_by`/`band_override_at`を即保存する（トグルで
  解除も可）。解除時は`undefined`ではなく`null`を送る（Section 5・`personalOkrStore.ts`冒頭の
  null値送信ルール）。
- **AIが書く部分は控えめなプレースホルダのみ**（モックの`.ahead-lead`/`.trade`に相当する位置）：
  「AIによる見立ては次の更新で入ります。」とだけ表示し、偽の内容は一切出さない。
- **解析状態は「器」だけ**：「AI解析：未実施（次の更新で追加予定）」という固定文言のみを表示し、
  「解析中」「解析済み」の動的状態・再解析ボタンは置かない（今回はAI呼び出しが無いため、押せない
  ボタンを置かない方針。CLAUDE.md全体の「未実装の空ボタンを出さない」方針と同じ）。
- **表示対象は当月（`monthStatus==="current"`）のみ**：「これから」は前向きの計画ブロックのため、
  過去月・未来月には出さない（過去月の読み取り専用サマリー・未来月の「計画がまだありません」は
  既存のまま変更していない）。
- **やらないこと（Phase 3後半で実施）**：AI呼び出し（`AIIntent`への新タグ追加・
  `personal_kr_outlooks`への書き込み・`band_ai`の判定）・AIパネルのOKR版・月末の振り返り下書き
  （Phase 4）は今回作っていない。

### Step H：AI解析（見立て・バンドのAI判定）＋AIパネル（Phase 3後半・v3.52・2026-08-11）

Step Gで空けておいた「AIが必要な部分」を実装した。`personal_kr_outlooks`テーブル
（Step Gで追加・山本さんが適用済みの前提）への書き込みが今回初めて発生する。

**トリガーと抑制（§5-2のとおり）**：
- **発火はOKRモードで対象KRタブを開いたとき（＝そのKRの当月タブを表示したとき）のみ**。
  cron・全員一律のバッチは実装していない。`PersonalKrPanel.tsx`のuseEffectが
  `monthStatus==="current"`のときだけ`fingerprint`を計算し、ストアの`runOutlookAnalysis()`を
  呼ぶ（`personalOkrUiStore.ts`）。
- 🔴 **`input_fingerprint`が直近の保存値と一致していれば呼ばない**：`runOutlookAnalysis()`は
  まずDBの直近結果を1回だけ取得（`ensureOutlookLoaded()`。別端末・別セッションでも
  再解析されない前提を作る）し、`src/lib/personalOkr/outlookRunner.ts`の
  `runPersonalKrOutlookAnalysis()`（純粋関数）が「fingerprintが一致かつforceでなければ
  `analyzePersonalKrOutlook()`（＝AI呼び出し）を呼ばずcachedをそのまま使う」を判定する。
  AI呼び出しをテスト対象から分離してあるため、フィンガープリント一致時に呼ばれない／不一致
  なら呼ばれることをinvokeAI・Supabaseどちらもモックせずに検証できる
  （`outlookRunner.test.ts`）。
- **粒度は開いているKRタブ1本だけ**：`fingerprint`・`context`は選択中KR・当月に限定して
  組み立てる（他のKR・他の月はこの効果の対象外）。
- **「再解析」ボタン**（`AheadBlock.tsx`）：`force:true`でfingerprintが一致していても必ず呼ぶ。
- 🔴 **機械計算分は即時描画、AIが書く部分だけを後から差し込む**：`AheadBlock.tsx`は
  機械計算セクション（残り週数・自己評価の積み上げ等）を常に即時描画し、AIパートのみ
  `analyzing || outlookRow===undefined`のときスケルトン（3本のバー）にする。週の目標状態や
  メモは解析中でも編集できる（Step Bから変更していない）。

**入力を絞る理由と実際の内容**：`src/lib/personalOkr/personalOkrAiContext.ts`の
`buildPersonalOkrAiContextText()`が「作業1（AI解析）」「作業3（AIパネル）」共通の文脈テキストを
組み立てる。渡すのは①このKRの内容（6本文欄）②今月の計画（4欄＋狙いのバンド）③週の目標状態と
自己評価（◯△✕）④紐づくタスクの**機械計算済みの要約**（`summarizeLinkedTaskStatus()`の
件数のみ。Task[]の生データは一切渡さない）⑤メモの直近3件（各300字まで）。過去月の詳細・
部署ナレッジ（Phase 5未実装）は渡さない。546（Section 19・28）の教訓を踏まえ、渡す量を
機械的に絞ることで「1回の呼び出しを短く保つ」設計要件を満たす。

**AI呼び出し本体（`src/lib/ai/personalOkrOutlookExtractor.ts`の`analyzePersonalKrOutlook()`）**：
- 🔴 **max_tokens=4096**（見立て＋週ごとの一手＋捨てる候補1件＋バンド判定のJSONに
  8192/16000は不要。Section 6-1c）。
- **見立てとバンド判定は1回の呼び出しにまとめる**（`lead`／`moves`／`trade`／`band_ai`／
  `band_ai_reason`を同じレスポンスで返す）。
- **`stop_reason==="max_tokens"`を検知して明示的なエラーにする**（`personalOkrImportExtractor.ts`
  と同じ方針。リトライしても同じ壁にぶつかるだけなのでリトライしない）。
- 出力は`validatePersonalOkrOutlookPayload()`で構造検証する（`lead`欠落は例外・`moves`要素の
  必須項目欠落はその要素だけ弾く・`band_ai`は60/70/80/90/100以外は`null`に落とす・余剰
  プロパティは無視）。想定外の形は「弾く」——既存の抽出系クライアント
  （`personalOkrImportExtractor.ts`）と同じ検証の流儀。
- JSONパース失敗時は1回だけ自己修正リトライする（既存の抽出系と同じ作法）。
- Edge Functionは関数ごとに実行時間・メモリの上限を上げられない。落ちたら分割か入力削減
  しかない（本機能はそもそも入力が小さいため、まず1回にまとめたうえで入力を絞ることを優先し、
  分割が必要な事態を避けた設計）。

**バンドは見通しであって評価ではない**（§6）：`src/lib/personalOkr/bandDisplay.ts`の
`resolveBandDisplay()`を3引数（`bandOverride, bandAi, bandTarget`）に拡張し、優先順位は
`band_override`（決定）＞`band_ai`（見通し）＞`band_target`（狙い）。🔴 **`band_override`が
入っていれば`band_ai`の値は表示に一切使わない**——`AheadBlock.tsx`は`display.source==="ai"`の
ときだけ「✦ AI判定」バッジを出す（overrideがある間はこのバッジ自体を出さない。値をミュート
表示することもしない）。`band_ai`は月の途中でも出す「現時点の見通し」であり、人が決めた
「決定」を上書きする力を持たない（AI解析のシステムプロンプトにも明記した）。

**AIパネル（`src/components/okr/personal/PersonalOkrAiPanel.tsx`）**：
- 🔴 **計画モードと同じ右パネルの型を流用**（`ConsultationPanel.tsx`のヘッダーグラデーション・
  左端ドラッグでリサイズ可能なinline幅遷移・タブ説明バー・スクロール領域・下部固定フッターの
  構造をそのままコピー）。新しいパネルの仕組みは発明していない。提案の適用・Undo・
  Gantt/会議読み込みプレビュー等は持たない（相談・助言止まりで、DB操作は行わない）。
  `PersonalOkrView.tsx`が`ConsultationPanel`と同じ「width遷移でメインエリアが縮んで
  共存する」ラッパーで包む（`MainLayout.tsx`のインライン配置パターンと同じ）。
- 冒頭に「このパネルが見ているもの」として文脈チップ（`buildPersonalOkrAiContextChips()`）を
  明示する。スターター（質問候補。`buildPersonalOkrAiStarters()`）は当月のバンドの狙いに
  言及する4つの質問。
- **答え方**：`src/lib/ai/personalOkrChatPrompt.ts`の`buildPersonalOkrChatSystemPrompt()`が
  達成度バンドの定義に沿って「今どの水準か・上げるには何が必要か」で答えるよう指示する。
- 🔴 **入力を絞る**：文脈は作業1（AI解析）と同じ`buildPersonalOkrAiContextText()`を使う
  （同じ材料）。会話履歴は`sessionManager.ts`（既存・タスク管理AI相談と共有）で管理し、
  **DBに保存しない**（Section 6-7）。localStorageにも書かない（計画モードのAI相談パネルより
  保守的な扱い。個人の評価に関わる文脈を含むため）。
- max_tokens=2048（`src/lib/ai/personalOkrChatClient.ts`）。添付ファイルを伴わないコーチ役の
  短い回答を想定し、タスク管理の主相談（16384）より小さく絞った。`stop_reason==="max_tokens"`
  も同様に明示的なエラーにする。
- 当月タブを開いていない（`context===null`）ときはパネルを開けても「当月のタブを開いている
  ときだけAIに相談できます」と表示し、送信不可にする（AI解析と対象を揃えるため）。

**`AIIntent`は2つに分けた**（`src/lib/ai/invokeAI.ts`）：`"okr-personal-outlook"`（AI解析・
自動トリガー・キャッシュにより実際の呼び出し頻度は低い）と`"okr-personal-chat"`
（AIパネルの対話・明示操作でターンごとに発生する）。理由：使用量の集計単位として
意味のある切り方にするため——自動解析とユーザー主導の対話は発生頻度・コスト特性が
全く異なり、1つのタグにまとめると管理画面「AI使用量」タブでどちらが使用量を占めているか
分からなくなる（振り返り下書き=Phase 4の`"okr-personal-review-draft"`案とも同じ考え方）。

**やらないこと（Phase 4・5で実施）**：月末の振り返り下書き生成・部署ナレッジ
（`okr_knowledge_docs`）・グループビューは今回作っていない。

### Step I：バグ修正（v3.53・2026-08-12）

- 🔴 **KRタブの帯には`flexShrink:0`が必須。** `PersonalOkrView.tsx`のKRタブの帯は
  `overflowX:"auto"`を持つflexアイテムで、明示的な`flexShrink`が無いと自動最小サイズが0になる
  （Section 21が本文に`minHeight:0`を要求するのと対になるCSSの規則）。選択中KRの中身
  （`PersonalKrPanel`）は縦に非常に長いため、親の高さが不足するとこの帯だけが真っ先に高さ0まで
  潰れ「KRタブが1つも表示されない」ように見えていた（実機で発生・山本さんの報告）。KRタブの帯・
  「対象期」の行の両方に`flexShrink:0`を付けて固定した。再発防止テストは
  `personal/__tests__/personalOkrViewLayout.test.ts`（この2箇所をソース走査でピン止め。
  一般ルール化は誤検知が多いため見送った）。
- **「これから」のAI解析取得が失敗すると`isLoadingOutlook`が永久にtrueのままになるバグを修正**
  （`personalOkrUiStore.ts`の`ensureOutlookLoaded()`。取得失敗時も`outlookByKrMonth[key]`を
  `null`で確定させる）。`personal_kr_outlooks`未適用時にこの状態で実際に発生した。
- **週カードの`getIncompletePredecessors`（部署全体のtasks×taskDependenciesのフルスキャン）が
  「今月の計画」への1文字入力ごとに週カード全件×紐づけタスク全件ぶん再実行されていた重さを修正**
  （`PersonalKrPanel.tsx`で`linkedTasks`を参照安定化・`WeekCard.tsx`で計算結果を`useMemo`化）。
- **対象期にKRが0件のとき、実際にKRが存在する期を候補ボタンで提示する安全網を追加**
  （`src/lib/personalOkr/availablePeriods.ts`。取込先の年度・四半期がずれた場合の再発防止）。

### Step J：月の選択を「対象期」へ一元化・AI解析を明示ボタン起動に変更（v3.55・2026-08-12）

山本さんが実際に使ってみて出た3つの不満への対応。

- **課題1（月がKR切替のたびに当月へ戻る）の原因**：`PersonalOkrView.tsx`が
  `<PersonalKrPanel key={selectedKr.id} .../>` と`key`を渡していたため、KRを切り替えるたびに
  コンポーネントごと作り直され、月選択（`PersonalKrPanel.tsx`内のローカルstate）が
  `defaultMonthIndex`（＝当月）にリセットされていた。
  **対応**：月の選択を`PersonalOkrView.tsx`側へ持ち上げ、「対象期」行（年input・四半期
  セレクトの隣）にセレクタを追加した。選択肢は選択中の年・四半期から`quarterMonthSlots()`
  が導く3つ。既定値は`src/lib/personalOkr/quarterMonths.ts`の新規`resolveDefaultMonthIndex()`
  （当月がその四半期に含まれていればその月、含まれていなければ先頭の月）が決める。年・
  四半期を変えるたびにこの既定値へ追従させる（`useEffect`）。`PersonalKrPanel`は
  `monthIndex`をpropsで受け取るだけになり、内部の月タブUI（ボタン群）は撤去し、
  選択中の期・月と状態（確定済み／未来）だけを表示する静的な行に縮小した（月選択を
  二重に持たない）。
- **🔴 `key={selectedKr.id}`は外した。** KRを切り替えてもコンポーネントが作り直されなくなった
  副作用として、下書きstate（今月の計画の`positioning`/`activities`/`targetAndEvidence`/
  `risks`/`bandTarget`・メモの未送信ドラフト・週タスクリンクモーダル）が前のKRの内容を
  引きずらないことを担保する必要があった。`positioning`等を初期化するuseEffectの依存配列に
  `kr.id`を追加（以前は`monthRecord?.id`と`monthStr`だけだったため、新旧どちらのKRにも
  月次計画が無いケースで依存配列が変化せずリセットされない事故が起きうる設計だった）。
  メモの下書き（`MemoSection`内部state）・週リンクモーダル（`linker`/`weekActionError`）にも
  `kr.id`変化で明示的にクリアするuseEffectを追加した。
- **課題2（KR切替のたびに何十秒も待たされる）の確定原因**：`PersonalKrPanel.tsx`の
  useEffectが、当月のKRタブを開くたびに`runOutlookAnalysis()`（＝Anthropic API呼び出し）を
  自動発火していたこと（Step H・v3.52で実装した「発火はOKRモードで対象KRタブを開いたときの
  み」という当初設計そのもの）。KRが複数本あれば切替ごとにAI呼び出しが走り、その応答待ち
  （実測で「何十秒」）がそのままタブ切替の遅さとして体感されていた。ensureKrDetailLoaded・
  ensureWeekTasksLoadedは既にキャッシュ判定があり同じKR・同じ週への再クエリは発生しない
  ことをコード上確認済み（N+1や直列待ちの追加要因ではなかった）。
- **対応（山本さんの決定）**：AI解析は明示ボタンを押したときだけ発火する。
  `PersonalKrPanel.tsx`から自動発火のuseEffectを削除し、代わりに`ensureOutlookLoaded()`
  （保存済みの解析結果をDBから1回読むだけ・ゼロトークン）だけを当月タブ表示中に自動で呼ぶ。
  機械計算分（残り週数・積み上げ等）は元から即時描画でトークンを使わない。
  **ボタンは1つ**（`AheadBlock.tsx`）：未解析（`outlookRow`が無い）なら「✦ 見立てを出す」、
  解析済みなら「再解析」に文言が切り替わる。押し先は同じ`onReanalyze`で、force判定
  （既存の解析結果があるかどうか）は呼び出し元（`PersonalKrPanel.tsx`の
  `handleRunOutlook`）が行う——未解析なら`force`無し（キャッシュが無いのでどのみち呼ぶ）、
  解析済みなら`force:true`（fingerprintが一致していても必ず呼ぶ＝以前の「再解析」ボタンと
  同じ挙動）。`input_fingerprint`による再解析抑止のロジック（`outlookRunner.ts`）自体は
  変更していない。
- **自動で走ると誤解させる文言を排除**：`AheadBlock.tsx`の空き状態プレースホルダを
  「AIによる見立てを準備しています。」→「上の「✦ 見立てを出す」を押すと、AIが見立てを出します。」
  に変更。「AI解析：未実施」の表示にも「（ボタンを押すと実行されます）」を添えた。
- **docs/dev/okr-redesign-plan.md §5-2を実態に合わせて書き換えた**（変更理由と変更日を明記）。
- **テスト**：`quarterMonths.test.ts`に`resolveDefaultMonthIndex`のケース4件を追加（当月を
  含む四半期／含まない過去・未来の四半期／含まない別年度）。既存の
  `personalOkrViewLayout.test.ts`（flexShrink:0のソース走査）は対象期行・KRタブの帯の
  style自体を変更していないため無修正で通過。
- **やらないこと**：AI呼び出し本体（`analyzePersonalKrOutlook`）・`input_fingerprint`の
  計算方法・`AIIntent="okr-personal-outlook"`は変更していない。

### Step K：Kintone取込のトークン削減・決定的パーサを主経路にする（v3.56・2026-08-12）

**山本さんの指摘**：「Kintone画面は皆同じなので、インポートさせるPDFの型もほぼ似たようなものになる。AIに構造を推測させる必要が本来無い」。この前提で、Kintone取込（Step F）のAI依存度を段階的に下げた。取込の確認画面（既存KRへの対応づけドロップダウン等・Section 24 Step F 🔴）は一切変更していない。

- **① 決定的パーサを主経路にする**：新規`src/lib/personalOkr/kintoneTextParse.ts`（純粋関数のみ・pdfjs等に依存しない）。`personalOkrImportExtractor.ts`のSYSTEM_PROMPTに書かれたラベル規則（「●対象業務カテゴリ」「▼◯月に取り組む内容（計画）」「[自己評価：]」等の角括弧・記号表記）をそのままルールベースの正規表現に落とし、`PersonalOkrImportAnalysis`/`PersonalOkrImportMonthlyAnalysis`（AI抽出結果と同じ型）を返す。ウェイト・達成度バンド・自己評価％の数値正規化は既存の`importFieldParse.ts`の`parseWeightPct`/`parseBandValue`/`parsePercentValue`をそのまま再利用する（二重実装しない）。**山本さんは実際のKintone帳票のテキストを持っていないため、テストはSYSTEM_PROMPTの記述から組み立てた合成フィクスチャで行っている**（`kintoneTextParse.test.ts`冒頭に明記）。
- **② 信頼度ゲート（安全弁）**：`KintoneParseConfidence`（`ok`/`krCount`/`reasons`）。四半期側は「KR見出しが1件以上」「見出し番号が1から連番」「本文6欄の充足率50%以上」「見出しの括弧内から名称を抽出できている」を満たさなければ`ok=false`。月次側は「月次フィールドが1件以上検出できている」「充足率35%以上」を満たさなければ`ok=false`。`ok=false`のときは黙って従来のAI経路にフォールバックする（Kintone側の画面が変わっても壊れない設計の要）。**四半期は決定的に読めたが月次は読めない、のような部分適用も可**（読めた方だけ決定的パーサの結果を使い、AIには残りだけを投げる。丸ごとAIに投げ直さない）。
- **③ 経路の可視化**：`describeKintoneImportSource()`（同ファイル）が「⚙ 画面の構造から読み取りました（AI未使用）」／「🤖 AIで読み取りました」／混在時の表現を返す。`PersonalOkrImportModal.tsx`の確認画面に`ImportSourceNotice`として必ず表示し、「元◯◯字→AIへの送信◯◯字（0字ならAI未使用）」も併記する（山本さんが実機でどちらが動いたか報告するための唯一の手がかりのため省略しない）。
- **④ AIに渡す前に本文を削る**：新規`src/lib/personalOkr/importTextTrim.ts`（純粋関数）。AIにフォールバックする場合でも、SYSTEM_PROMPTが「抽出しないもの」と明示している領域（個人単位の月次/四半期評価サマリー・【N月限定KR】のような一時的なKR・役割等級要件や面談参考資料の付録セクション）を送信前に機械的に削る。境界が曖昧な削り方（本文中の「●」「▼」を境界にする等）はしない＝見出し文字列から次の既知セクション見出し、または文末までだけを削る（削りすぎない）。
- **⑤ AI呼び出しの1回／2回の自動切替**：`personalOkrImportExtractor.ts`に`extractPersonalOkrCombinedData()`（呼び出し1・2を1つの呼び出しに統合。既存の`validatePersonalOkrImportAnalysis()`をそのまま再利用できる形＝新設のバリデータ不要）を追加。決定的パーサの結果、四半期・月次の両方がAI必須になった場合のみ、削減後の送信本文が`PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS`（10000字。既存の警告閾値20000字の半分＝1回にまとめる判断はより慎重に取る）以下なら1回にまとめ、それを超える場合は実績のある2回分割（Section 19 ⑧・28）を維持する。**まとめ呼び出し自体が失敗した場合は2回分割へフォールバックする**（1回にまとめたことが原因の失敗を安全な経路でリトライする安全弁）。
- **モデル切替（④）は対応済みだった**：`PERSONAL_OKR_IMPORT_MODEL`は2026-08-11（v3.52・Step Hと同時期）に山本さんの指示で既に`claude-haiku-4-5`へ切替済み（Edge Functionの`ALLOWED_MODELS`に含まれる）。今回の変更対象外。決定的パーサが主経路になったことで、AIがフォールバック用途に後退し、haiku化による多少の精度差は許容できるという判断の裏付けが強まった。
- **`extractPersonalOkrImportData()`の型拡張**：`PersonalOkrImportResult`に`quarterlySource`/`monthlySource`（`"deterministic"|"ai"|"none"`）・`aiSentCharCount`・`originalCharCount`を追加した。既存の`warnings`は「まとめ呼び出し失敗→分割リトライ」のメッセージも積む。
- **テスト**：`kintoneTextParse.test.ts`（18件）・`importTextTrim.test.ts`（7件）を新設。`personalOkrImportExtractor.test.ts`にオーケストレーターの新規シナリオ（1回にまとめる／まとめ失敗時のフォールバック／閾値超えは2回分割のまま／決定的パーサのみで完結・AI呼び出しゼロ／四半期は決定的・月次だけAIの部分適用）を追加。既存のオーケストレーターテスト（分割呼び出しの検証）はダミーtranscriptが閾値以下だと新設のまとめ呼び出しに切り替わってしまうため、`LARGE_NON_KINTONE_TRANSCRIPT`（閾値超の長さ）を使うよう更新した。

### Step L：OKRモードのガイドツアー（v3.70・2026-08-12）

山本さんの依頼：「OKRモードを初めて選択した人には、OKRのガイドツアーを開始するようにしたい」「KRは基本的にOKRモードから登録する導線にしたいので、未設定の人に見せる前提で組んでほしい。ただし何も設定されていない画面では説明しようにも表示されないパラメータがあるため、サンプルデータを表示してイメージを実感してもらいたい」。

- **一行で言うと**：新しいツアー`okr-intro`（`src/components/tour/tours/okr-intro.ts`）を追加した。OKRモードを初めて開いたときに自動で始まり、対象期にKRが0本なら実データの代わりにv3.67のサンプル（`src/lib/demo/personalOkrDataset.ts`）を読み取り専用で差し込んで案内する。
- **起動口は1箇所（`PersonalOkrView.tsx`のマウント時useEffect）**：既存の初回ゲート（`OkrModeIntroModal`の承認・Section 19 ⑥）とゲストの直接入室（Section 23）は、どちらも最終的に`appMode`が`"okr"`になり`PersonalOkrView`がマウントされる点で合流する。この合流点に`if (!tour.isRunning && !tour.isCompleted(OKR_TOUR_ID)) tour.start(OKR_TOUR_ID)`を1つ置くだけで、「ゲートの承認直後」「ゲストの直接入室」の両方を1つのコードパスで満たせる（`MainLayout.tsx`側の2つの入口それぞれにツアー開始コードを重複させない）。完了・スキップは`firstTimeTour`と同じ`localStorage`（`tour_completed_v1`）で管理され、一度でも終了/スキップすれば以後は自動再生されない。
- **再生導線**：`TourProvider`の`TourContextValue`に`activeTourId: string | null`を追加した（「今動いているのはOKRツアーか」をコンポーネント側が区別するために必要）。ガイド（`GuideModeView.tsx`の`GuideHome`）は`TOUR_LIST[0]`（主要ツアー）を大きな導線のまま維持し、`TOUR_LIST.slice(1)`（OKRツアー等）を「ほかのツアー」として小さめのカードで並べ、いつでも見直せるようにした。
- **🔴🔴 サンプル差し込みは読み取り専用（保存経路を完全に塞ぐ）**：判定は`src/lib/personalOkr/tourPreviewSample.ts`の`shouldInjectOkrTourPreviewSample(isOkrTourRunning, activeKrCountInPeriod)`（純粋関数・テスト有）1点＝「OKRツアー実行中か」×「対象期のKRが0本か」だけで行う。既にKRがある人（ゲスト含む。ゲストはv3.67で既にサンプルKRが実データとして注入済みのため、この条件だけで自然に「二重差し込みしない」が成立する）はその人の実データで案内する。
  - サンプル本体は`buildDemoPersonalOkrDataset()`（v3.67と同一・新規サンプルは作らない）を`PersonalOkrView.tsx`から**動的importでのみ**読み込む（`personalOkrDataset.test.ts`が静的import禁止を機械検査するため）。週カードの遅延・先行待ちバッジを再現するため、`dataset.ts`（グループOKR側サンプル）の`tasks`/`taskDependencies`も同時に動的importし、`tasks`/`taskDependencies`propとして実データの代わりに渡す。
  - `PersonalKrPanel.tsx`に`readOnly?: boolean`propを追加。`monthEditable = !readOnly && monthStatus === "current"`の1変数で、WeekCardの`editable`・AheadBlockの`editable`（バンド決定）・今月の計画のテキストエリア/保存ボタンの大部分が連動して無効化される。加えて`handleSaveMonthPlan`/`handleSetBandOverride`/`ensureWeek`/`handleRunOutlook`/`ensureOutlookLoaded`の自動effect/`MemoSection.handleAdd`の各先頭に`if (readOnly) return`を明示し、UI側のガードが将来崩れても実データの保存アクションへは到達できないようにしている（二重の防御）。
  - **呼び出し元（`PersonalOkrView.tsx`）でも保存経路そのものを差し替える**：`previewSample`が真のとき、`onSaveMonth`/`onSaveWeek`/`onSaveMemo`/`onLinkWeekTask`/`onUnlinkWeekTask`/`ensureWeekTasksLoaded`/`ensureOutlookLoaded`/`onRunOutlookAnalysis`は実データのstoreアクション（`usePersonalOkrUiStore`）を一切渡さず、共有のno-op（`PREVIEW_NOOP_ASYNC`/`PREVIEW_NOOP`）を渡す。`onEditKr`もno-opにする（サンプルKRの編集フォームを開かせない＝そのままsaveKrされてもサンプルidは実DBに存在せず失敗するため、経路自体を断つ）。`onOpenAiPanel`も`undefined`にして「迷ったらAIに聞く」ブロックを非表示にする。
  - **AI解析結果は「未実施」に固定**：サンプルKRのidは`personal_krs`に実在しないため、実データの`ensureOutlookLoaded`を呼ぶと無意味な問い合わせになる。代わりに`buildPreviewOutlookMap()`が全サンプルKR×対象月の組を`null`で埋めた`outlookByKrMonth`を作り、`outlookRow===undefined`による無限スケルトン表示（Section 24 Step Iで踏んだ罠と同種）を避けている。
  - **画面上の明示**：「対象期」行に🔍バッジ「これはサンプル表示です（保存されません）」、`PersonalKrPanel`本体にも同内容のバナーを表示する。「✏️ このKRを編集」ボタンは`disabled`＋ツールチップ「サンプル表示中は編集できません」。
  - **「＋ KRを追加」「📥 Kintoneから取込」は常に実際の登録操作のまま**：サンプル表示中でもここから作るKRは実データとして保存される（ツアーの着地点＝Step 8のターゲット`data-tour-id="okr-registration-actions"`。`PersonalKrFormModal`の`existingKrsInPeriod`・`PersonalOkrImportModal`の`allPersonalKrs`は意図的に実データ（`activeKrs`/`krs`）のままにし、サンプルの重み40/35/25%を実KR作成のウェイト集計に混ぜない）。実際に新しいKRが保存されると、次の描画で`activeKrs.length`が0でなくなり`shouldInjectOkrTourPreviewSample`がfalseに変わるため、サンプル表示は自動的に終了して実データへ切り替わる。
- **8ステップの構成**：①モードの目的（Kintoneが正本・週の層を埋める）②対象期の選び方③KRタブ④今月の計画⑤★週の目標状態（このアプリだけの層と明示）⑥タスクとの紐づけ（遅延・先行待ちの表示）⑦これから（AIは「✦ 見立てを出す」を押したときだけ動く旨を明記）⑧登録して始める（Kintone取込／KR追加への着地＋今後の拡張予定を一言添える）。ターゲットは`okr-period`/`okr-kr-tabs`/`okr-month-plan`/`okr-week-cards`（⑤⑥で共有）/`okr-ahead`/`okr-registration-actions`（`data-tour-id`属性。全てskipIfMissing:trueでUI変更耐性を確保）。
- **未設定時の空状態文言も改善**（ツアーを見ずに来た人が最初に見る画面でもあるため）：「{年}年{Q}の個人KRがまだありません。」の一文だけだったのを、「Kintoneに個人OKRが既にある場合は「📥 Kintoneから取込」、まだ無い場合は「＋ KRを追加」から手入力で登録できます。」を追加し、取込と手入力どちらから始めればよいかを案内するようにした。
- **回帰テスト**：`tourPreviewSample.test.ts`（判定4パターン）・`okrIntroTour.test.ts`（ステップ数7〜9・id重複無し・target持ちは必ずskipIfMissing・タイトル/本文の体裁）・`buildTours.test.ts`に追加（非ゲスト/ゲストどちらも`okr-intro`を含むこと・ゲスト版は改変されないこと）。`personalOkrViewLayout.test.ts`の正規表現は`data-tour-id`属性の追加を許容するよう更新した（属性が増えても「対象期」「KRタブ」の帯の`flexShrink:0`検査自体は変わらない）。

---

## 25. プロジェクト招待（部署外メンバーの受け入れ）Phase 1〜3（v3.42〜v3.44・2026-08-10）

**正本は [docs/dev/project-invite-plan.md](docs/dev/project-invite-plan.md)。** このセクションは要点だけを薄く残す（Section 11のルール）。マイグレーションSQL全文・検証条件の詳細はそちらを読むこと。

- **一行で言うと**：新しいアクセス制御の軸を作らない。PJごとに1つ「招待用の部署」（`groups.is_invite_group=true`）を作り、既存の複数部署アクセス機構（`group_ids`配列）に乗せる。**既存テーブルのRLSは1行も変えない。**
- **今回作った範囲（Phase 1）**：`project_invites`テーブル・`groups.is_invite_group`列・SECURITY DEFINER関数2本（`create_project_invite`/`accept_project_invite`）・型（`ProjectInvite`）・ストア層（`src/lib/supabase/projectInviteStore.ts`）のみ。**発行UI・管理画面の招待一覧/取り消し・ログイン画面の導線はPhase 2/3（未実装）。**
- **決定事項（2026-08-10・山本さん）**：招待先は社内の別部署／発行権限は全メンバー／許可メールドメインは`amita-net.co.jp`（複数指定できる形）／招待された人のAI機能は無制限（回数制限なし）。
- **「発行権限は全メンバー」の代償として入れた安全弁（`create_project_invite`）**：
  1. 🔴 呼び出し者が対象PJにアクセスできるかを検証する（`can_access_group_ids(projects.group_ids)`）。この関数はSECURITY DEFINERのためRLSを迂回するので、この検証が無いと誰でも任意のPJへのアクセスを配れてしまう。
  2. 🔴 招待先メールアドレスのドメイン許可リスト検証。「@より後ろ（最後の@以降）」を取り出し配列の要素と**完全一致**するかだけを見る（部分一致・前方一致・後方一致は使わない。"user@amita-net.co.jp.evil.com" のような偽装ドメインを弾くため）。
  3. 招待で配れるアクセスは**そのPJ1件のみ**（部署全体のアクセスは配れない）。
  4. 監査：`project_invites`は発行者と同じ部署のメンバーがSELECTできる（RLSはSELECTのみ・INSERT/UPDATE/DELETEのポリシーは意図的に作らない＝書き込みはSECURITY DEFINER関数経由のみ）。
- **招待コードは平文で保存しない**：`code_hash`列にのみ保存し、平文は`create_project_invite`の戻り値で1度だけ返す。生成・ハッシュ化どちらもpgcryptoに依存せず、PostgreSQLコア組み込み関数（`gen_random_uuid()`を2連結／`sha256()`）だけで実現した（pgcryptoが有効かどうかを事前確認する必要が無い設計）。
- **受諾（`accept_project_invite`）は4条件を全て検証**：①存在・未使用・未取消 ②発行から24時間以内 ③入力メールが招待時のメールと完全一致、かつ`auth.email()`とも一致（なりすまし防止） ④コードのハッシュ照合。🔴 作成する`members`行は`is_admin`/`is_super_admin`を必ず`false`にする（権限昇格の穴を作らないため）。同時受諾のTOCTOUは`pg_advisory_xact_lock`で直列化する。
- **`guard_member_privilege_columns()`トリガーを拡張した理由**：発行者本人とPJオーナーに招待用部署への兼務を`create_project_invite`内のUPDATEで付与するが、これも通常のmembers UPDATEとして既存の「非super-adminのgroup_ids直接変更は差し戻す」ルールにぶつかり静かに差し戻されてしまう。そこで、トランザクションローカルのセッション変数（`app.allow_invite_group_grant`。PostgREST経由のクライアントは直接設定できない）を立てた場合に限り、「既存の所属を1件も失わず」「追加分が全て`is_invite_group=true`のグループである」ときだけ例外的に許可する分岐を追加した。
- **招待用部署の命名規則**：`id`は対象PJから決定的に導出（`'grp-invite-' || project_id`）。同じPJに複数回招待しても同じ部署を再利用する（`ON CONFLICT DO NOTHING`で idempotent）。
- **appStoreには足さない**：招待は管理系機能で全員が起動時に読む必要が無い（個人OKRと同じ判断。Section 19）。

### Phase 2：発行側（v3.44・2026-08-10・実装済み）

- **2-1. PJから招待する**：プロジェクトカルテ（`src/components/dashboard/ProjectKarte.tsx`。ダッシュボードでPJを選んだときに出るPJ詳細パネル）のAI分析ボタンの上に「🔗 このPJに招待する」を追加した（ゲストには非表示）。`ProjectInviteModal.tsx`（`src/components/project/`）が`create_project_invite`を呼び、**コード・招待リンクは戻り値でのみ得られるため画面に一度だけ表示する**（再表示不可を明記・コピー用ボタン付き）。招待リンクの形式は「アプリのURL（`window.location.origin + pathname`。現在のクエリ・ハッシュは引き継がない）に`?invite=<code>`を付けたもの」。エラーは`formatErrorForUser`経由で、関数が投げる日本語メッセージ（「このプロジェクトを招待する権限がありません」等）がそのまま出る。モーダルは`modalStyles.ts`の契約に従う。
  **【v3.49で移設】** PJごとの管理項目が増えたため、この発行UI（＋招待の一覧・取り消し）は`ProjectSettingsModal.tsx`（PJカルテの「⚙ このPJの設定」→「招待」タブ）に統合し、`ProjectInviteModal.tsx`単体は撤去した。呼び出す`create_project_invite`/`fetchProjectInvites`/`revokeProjectInvite`自体は変更していない（呼び出し元が変わっただけ）。詳細はSection 4「PJ設定画面とAdminViewのPJ編集の使い分け」参照。
- **2-2. 管理画面「プロジェクト招待」タブ**（`AdminView.tsx`の`InvitesSection`。カテゴリ「組織」に追加）：`fetchProjectInvites()`で一覧取得し、選択中の部署（`selectedGroupId`）に紐づくPJの招待だけに絞る（既存の部署絞り込みセレクタの流儀に合わせる。RLS自体は発行者と同じ部署に既に絞っている）。列＝対象PJ／招待先メール／発行者／発行日時／有効期限／状態（`src/lib/projectInvite/inviteStatus.ts`の`resolveInviteStatus()`が`accepted_at`/`revoked_at`/`expires_at`から導出）。**取り消し**ボタンは状態が`unused`のときだけ表示し、`revoke_project_invite` RPC（下記マイグレーション）を呼ぶ。🔴 `code_hash`は今回も一切selectしていない（`fetchProjectInvites`が列を明示的に絞る設計を継続）。

### 🔴 追加マイグレーション：取り消し機能（`revoke_project_invite`）

Phase 1のマイグレーションには取り消し用のRPCが含まれていなかった（`revoked_at`/`revoked_by`列だけ用意）。`supabase/migrations/20260810b_add_revoke_project_invite.sql`で追加した。`create_project_invite`と同じ考え方で、**呼び出し者が対象招待のPJにアクセスできるかを`can_access_group_ids`で検証する**（これが無いと他部署の招待を取り消せてしまう）。既に`accepted_at`が入っている招待は明示的なエラーで拒否する（使われた後の取り消しは無意味）。NULL猶予条項は書かず、ドル引用タグは`$fn_revoke_project_invite$`で関数固有にした。**2026-08-12に本番適用済み**＝`pg_proc`に`revoke_project_invite`が存在することを確認。`schema.sql`に同期し、`schemaChecks.ts`に検査項目（`fn_revoke_project_invite`）を追加した。

### Phase 3：受け入れ側（v3.44・2026-08-10・実装済み）

- **3-1. ログイン画面の導線**：`LoginScreen.tsx`に、既存のログインフォームとゲストの「サンプルを見る」ボタンの間に「プロジェクトの招待コードをお持ちの方はこちら」リンクを追加した（設計書§7・山本さんの当初案1(a)）。押すと同じ画面内で`mode="invite"`の登録フォーム（招待コード／メールアドレス／パスワード／表示名／略称）に切り替わる。URLに`?invite=<code>`があれば（`src/lib/projectInvite/inviteUrl.ts`の`extractInviteCodeFromSearch()`）コード欄に事前入力し、この画面を直接開いた状態で起動する。**イニシャルと色は入力欄を出さず常に自動生成する**（`src/lib/projectInvite/memberDefaults.ts`。「任意・既定値を用意する」という要件を、入力欄自体を作らない形で満たした。取込後も管理画面から編集できるため実害はない）。
- **3-2. メール確認への対応＝設計判断(a)（自動受諾）を採用**：登録フォームは`signUp(email, password)`を呼んだ直後、**`needsConfirmation`の値に関わらず**入力内容（コード・メール・表示名・略称・イニシャル・色。パスワードは含めない）を`localStorage`に一時保持する（`src/lib/projectInvite/pendingInvite.ts`）。実際の`accept_project_invite()`呼び出しはこの登録フォーム自身ではなく、**`App.tsx`の`AuthenticatedApp`に一本化した**（理由は次項）。メール確認が必要な環境では「確認メールを送信しました」画面に「招待の有効期限は24時間です。確認が遅れると招待コードが失効します」という警告を明記する。既に登録済みのメールで`signUp`した場合（Supabase Authがメール列挙対策で`identities`を空配列にして返す挙動）は`auth.ts`の`signUp()`が`alreadyRegistered`を検出し、「このメールアドレスは既に登録されています。ログインしてから...」と案内して保留データも保存しない。
- **3-3. `AccessDeniedScreen`からの導線**：認証済みだが`members`未登録のユーザーに出るこの画面に「プロジェクトの招待コードをお持ちの方はこちら」を追加した。**この経路では既にAuthセッションがあるため`accept_project_invite`を直接呼べる**（signUp不要・3-2のメール確認問題が発生しない、最も素直な経路）。手動フォールバック（別ブラウザ・localStorage消失・新しい招待を試す等）としても機能する。
- **自動受諾の実装場所となぜここか**：`App.tsx`の`AuthenticatedApp`内に新設したuseEffectが、`currentUser`が未確定かつ保留中の招待（`loadPendingProjectInvite()`）があり、かつ現在のAuth email（`getAuthEmail()`）が保留データのメールと一致する場合にのみ`accept_project_invite()`を呼ぶ。**この判定をSetupWizard/AccessDeniedScreen/UserSelectScreenのどれが表示されるかの判定より前段に置いた**——`needsConfirmation=false`（メール確認不要な環境）の場合、`App.tsx`トップレベルの`onAuthStateChange`リスナーが`signUp`成功と同時に`authenticated=true`を検知し、登録フォームが受諾処理を終える前にunmountされるレースが起こり得るため、受諾の呼び出し自体をフォームの責務にせず単一の受け口に統一した（`needsConfirmation`の真偽どちらでも同じコードパスを通る）。成功したら`window.location.reload()`する（迷ったらリロードを選ぶ方針。`handleLogout`と同じ判断）——新しく作られた`members`行をRLS越しに反映させるため。失敗（期限切れ等）したら保留データを消して（無限リトライ防止）トースト表示し、通常のAccessDeniedScreen/UserSelectScreenへフォールバックする。
- **招待受諾後に通常画面へ入れることの確認方法**：`accept_project_invite()`は`members.email`に`auth.email()`をそのまま書き込む。`App.tsx`の`autoMatch()`（既存のログイン自動マッチング）は「Auth emailと`members.email`が一致するメンバーを探す」処理であり、受諾後のreloadで`members`が再取得されればこの既存経路がそのまま働き、追加のコード変更は不要だった（コードを読んで確認済み。実機確認は山本さんが行う）。

### Phase 4：ビューを不変にする調整＋招待された人の可視性の是正（v3.47・2026-08-11）

Phase 1〜3実装後に山本さんから「既存部署の人のビューは変わらず、そのPJだけメンバーが増えている状態にしたい」という要望が入り、2点のズレを是正した。

- **(a) 発行者・PJオーナーのサイドバーに「表示部署」切替が出てしまう問題**：`create_project_invite()`が発行者本人と`projects.owner_member_id`に招待用部署を`group_ids`の兼務として付与するため、`accessibleGroups.length >= 2`になり切替UI（本セクション上部・`MainLayout.tsx`）が表示されてしまっていた。これは「ビューが変わる」ため要望に反する。**対応**：`src/lib/projectInvite/sidebarGroupVisibility.ts`の`filterInviteGroupsForSidebar()`（純粋関数）が、`MainLayout.tsx`の`accessibleGroups`から`is_invite_group=true`のグループを除外する。🔴 **招待された本人（招待用部署しか持たない）はフィルタすると選択肢が空になってしまうため、除外しない**——`filterInviteGroupsForSidebar()`は「フィルタした結果が1件も残らない場合は、除外前のリストをそのまま返す」という一般則だけで両ケースを安全に処理する（本人かどうかを個別に判定するコードを書いていない）。回帰テストは`sidebarGroupVisibility.test.ts`（通常部署1件／2件・招待用部署のみ・ホーム+招待用の兼務・招待用複数件のみ、の各ケース）。
- **(b) 招待用部署に属する人が、兼務を持たない他の部署メンバーから見えない問題**：`members`のRLS（`group_ids && current_member_group_ids() OR current_member_is_super_admin()`）は部署単位のみで判定するため、招待された人の`group_ids`（招待用部署のみ）は、兼務を持たない部署メンバーの`current_member_group_ids()`と一切重ならず見えなかった。担当者に指定しても担当者欄が「未担当」のままになる実害があった。**対応**：`supabase/migrations/20260810c_extend_members_visibility_for_invites.sql`（**2026-08-12に本番適用済み**＝`pg_policies`で`members_group`の`qual`が3条項（`current_member_group_ids` / `current_member_is_super_admin` / `visible_invite_group_ids`）になっていることを確認）で、`members`のポリシーに**追加のみ**の1条項を足した：「相手が招待用部署に属しており、かつその招待用部署が、自分がアクセスできるPJの`group_ids`に含まれているなら見える」。実装は新設のSECURITY DEFINERヘルパー`visible_invite_group_ids()`（自分がアクセスできるPJに紐づく招待用部署のidの配列を返す。`current_member_group_ids()`/`can_access_group_ids()`と同じ流儀）＋`OR group_ids && visible_invite_group_ids()`。既存2条項は1文字も変えていない。`schema.sql`に同期・`schemaChecks.ts`に検査項目（`fn_visible_invite_group_ids`）を追加した。
- **🔴 広げた範囲はここだけ**：「招待用部署に属する人」の可視性のみを広げた。部署間の可視性（部署Aの人が部署Bの人を見る）は一切変えていない。`projects`/`tasks`のRLSにも広げていない（`members`テーブル1つだけの変更）。マイグレーションの監査クエリに「部署Aの一般メンバーから、招待用部署に属さない部署Bのメンバーが見えないこと」の確認クエリを含めた。
- **「RLSは1行も変えない」という当初方針（本セクション冒頭）からの変更点**：Phase 1着手時の方針は「新しいアクセス制御の軸を作らない・既存テーブルのRLSは1行も変えない」だったが、(b)はこの方針の唯一の例外。**`members`テーブル1つだけ**、既存2条項を変更せずORで1条項を追加する形にとどめ、「新しい軸を作らない」（既存の`group_ids`配列の枠組みに乗せる）という設計思想自体は維持している。
- **✅ 可視性の非対称は v3.75（2026-08-18）で解消済み（旧・残った制約の記録）**：(b)で「部署の人→招待者」の可視性は解決したが、「招待者→部署の社内メンバー」の可視性は兼務付与（発行者本人と`projects.owner_member_id`の2人だけ）に依存したままだった。招待者の`visible_invite_group_ids()`は自分の招待用部署だけを返すため、招待者から見える社内メンバーは発行者とPJオーナーの2人に限られていた（他の社内担当者は見えない。本番の羅針盤フォーラムPJで実害発生）。**v3.75で`members`のSELECTポリシーに4条項目（新設の`visible_project_member_ids()`。「自分がアクセスできるPJに参加しているメンバー全員」を返す）を追加し、招待受諾者からもPJ参加者全員が見えるようになった**（詳細はSection 33）。**兼務付与（発行者本人・PJオーナーへの招待用部署の付与）自体はv3.75でも変更していない**——(a)の切替UI抑制の対象として引き続き必要なため残っている。ただしメンバー可視性という意味では、この兼務が無くても4条項目だけでPJ参加者全員が見えるようになったため、「発行者とPJオーナーだけ特別に見える」という非対称自体は解消された。
- **🔴 部署でスコープする画面を新設するたびに再発しうる構造（v3.60で発見・カードで回避）**：招待用部署（`is_invite_group=true`）は(a)の`filterInviteGroupsForSidebar()`により「部署で絞り込む系のUI」の選択肢から原則除外される設計のため、**招待用部署のみに属するメンバー（招待受諾者）は、部署を条件に絞り込む画面には決して現れない**。AdminViewの設定画面をサイドバーの「表示部署」に一本化した際（v3.60・Section 8参照）にこの構造が実際に踏まれ、`MembersSection`から招待受諾者が編集不能になる実害が発生した（データ自体は`visible_invite_group_ids()`のRLS拡張で見えている。UI側フィルタが不要に隠していただけ）。今回は部署絞り込みとは別枠の常時表示カード（`isGuestOnlyMember()`。`src/lib/admin/guestMembers.ts`）で回避したが、**次に「部署で絞り込む」という設計のUIを新設するときは、同じ理由で招待受諾者が漏れないかを都度確認すること**（自動で防げる仕組みは無い）。

### Phase 5：既存利用者が招待された場合の対応＋ログイン済みの受諾入口（v3.68・2026-08-12）

山本さんの指摘「PJ招待は、アプリ未使用者を対象に設計されたものだと思いますが、他部署で既にこのアプリを使っている人が招待された場合には対応していますか？」への対応。**対応していなかった**：`accept_project_invite()`は無条件で`members`に新規行をINSERTしていたため、既存メンバー（`auth.email()`と一致する有効なmembers行を既に持つ人）が受諾すると`members_email_unique`（部分一意インデックス）に阻まれ23505エラーになる上、**そもそも入口が無かった**（ログイン済みだと`autoMatch()`が成功して通常画面に入るため`AccessDeniedScreen`にすら到達せず、招待コードはURLに残ったまま無視される）。

- **既存メンバー分岐（`supabase/migrations/20260812_accept_invite_for_existing_member.sql`）**：`accept_project_invite()`内で、検証条件1〜4（存在・未使用・未取消／24時間以内／メール完全一致・`auth.email()`一致／ハッシュ照合）を1つも省略せず全て通過した後に、`auth.email()`と一致する有効な（`is_deleted=false`）members行があるかで分岐する。
  - **無ければ**：従来どおり新規INSERT（挙動を変えない）。
  - **あれば**：INSERTせず、その行の`group_ids`に招待用部署を追加する（兼務）。`display_name`/`short_name`/`initials`/`color_bg`/`color_text`の引数は無視する（既存の表示名・色を上書きしない）。`is_admin`/`is_super_admin`/`group_id`（ホーム部署）は変更しない——**UPDATE文のSET句を`group_ids`のみにすることで物理的に変更不可能にしている**（個別に「変更しない」分岐を書く必要が無い。書かれていない列は触れない）。
  - **`group_ids`追加は新しい抜け道を作らない**：`create_project_invite()`が発行者本人・PJオーナーに兼務を付与するときと全く同じ`app.allow_invite_group_grant`セッション変数の仕組み（migrations/20260810_add_project_invites.sql ブロック3）にそのまま乗せる。
  - 既に招待用部署を持っている場合は何もせず冪等に成功させる（同じPJへの2回目の招待受諾でも重複しない）。
  - ドル引用タグは`$fn_accept_project_invite$`のまま（関数名・シグネチャを変えないため）。
- **✅ スキーマ検査（`schemaChecks.ts`）の既知の限界はv3.80で解消済み（旧記録）**：`kind:"function"`は`pg_proc`に同名関数が存在するかしか見ない（`check_schema_health` RPC・`20260806_add_schema_health_check.sql`参照）。ここでは`accept_project_invite()`の名前・引数を変えず**本文だけ**を差し替えるため、当時はこのマイグレーションが未適用でも既存の検査項目（`fn_accept_project_invite`）が「存在する」と判定され続け、適用漏れを検知できなかった。**v3.80で`kind:"function_body_contains"`（関数定義全文にneedleを含むかで判定）を新設し、この経路も検知できるようになった**（詳細はSection 22・38）。
- **ログイン済みの受諾入口を2つ追加**：
  1. **招待リンク（`?invite=<code>`）をログイン済みでも拾う**：`App.tsx`の`AuthenticatedApp`に、`currentUser`が確定した後にURLの招待コードを拾い直すuseEffectを追加した（既存の②自動受諾＝`pendingProjectInvite`はcurrentUserが未確定の間だけ動く経路で、既存メンバーには届かない）。`confirmDialog()`（`window.confirm`ではない。`src/lib/dialog.ts`）で「招待を受け入れて、このプロジェクトに参加しますか？」を確認し、承諾なら`acceptProjectInvite()`を呼んで`window.location.reload()`する。結果（承諾・キャンセル・失敗）に関わらず`history.replaceState`でURLからinviteパラメータを外し、再訪問・再読み込みで同じ確認が繰り返されないようにする。判定・ペイロード組み立て・URL加工は`src/lib/projectInvite/loggedInInviteFlow.ts`の純粋関数（`shouldPromptLoggedInInviteAccept`/`buildAcceptPayloadForExistingMember`/`stripInviteParamFromUrl`）に切り出しテストした。
  2. **手入力の入口（`src/components/project/AcceptInviteModal.tsx`）**：サイドバー（デスクトップ：設定＝歯車ボタンの直下に「🎫 招待コードを入力」。モバイル：ヘッダーが密集しているため「🧪 ラボ」ボトムシートの項目として追加）から開く。表示名・略称の入力欄は出さない（サーバー側の既存メンバー分岐が上書きしないため無意味）。**AdminViewの「プロジェクト招待」タブには置かなかった**：AdminView全体が部署管理者限定のガード（`canAccessAdmin`）を持ち、招待コードを持つ人は管理者かどうかに関わらず受け入れられる必要があるため、この入口はAdminViewの外に置いた。
- **マイグレーション未適用時の後方互換**：`accept_project_invite()`のシグネチャ（引数・戻り値）は変更していないため、マイグレ未適用のままフロントだけ先にデプロイされても、新規の人は従来どおり成功し、既存メンバーは従来どおり`members_email_unique`の23505エラー（`formatErrorForUser`経由の表示）になるだけで、既存機能が壊れることは無い。

---

## 26. AI呼び出しの非2xxエラーの原因が捨てられていたバグの修正（v3.43・2026-08-10）

**症状**：OKRモード「Kintoneから取込」でPDFを解析しようとすると「AI解析に失敗しました Edge Function returned a non-2xx status code」しか出ず、Anthropic側の実際の理由（レート制限・過負荷・ゲートウェイのサイズ超過等）が一切見えなかった。

**原因（Section 15末尾に要点を明記済み）**：`supabase.functions.invoke()` は非2xx時に `data` を必ず `null` にし、Edge Functionが返した本文（`{error, message, detail, status}`）は戻り値の `response`（`Response`オブジェクト）にしか入らない。`invokeAI.ts`/`apiClient.ts`はどちらも`data`だけを見ていたため、`ANTHROPIC_ERROR`/`RATE_LIMIT_EXCEEDED`/ゲスト回数制限等の丁寧な分岐が実際には一度も実行されず、常に汎用フォールバック文言に落ちていた。

- **共通ロジックを`src/lib/ai/edgeFunctionError.ts`に集約**：`readEdgeErrorPayload()`（`response`から本文を読む。JSON化できなければ生テキストのまま保持。読み取り自体の失敗も例外を投げない）・`extractEdgeError()`（body/status/rawTextからユーザー向けメッセージを組み立てる純粋関数）・`buildInvokeErrorMessage()`（`invokeAI.ts`用の結合ヘルパー。`data`が既にある後方互換ケースはそれを使い、無いときだけ`response`を読む）。`apiClient.ts`（`callAIConsultation`）は`AIError`のコード分岐を保つため`readEdgeErrorPayload()`を直接使う形に揃えた（Section 16の例外経路だがこのバグは共通していたため同じ直し方にした）。
- **HTTPステータスコードをメッセージに含める**（例「Anthropic APIエラー (529): overloaded_error」「(502): upstream connect error」）。原因の切り分けに直結する。
- **本文がJSONでない・空でも汎用文言だけで終わらせない**：ステータスコードと生テキストの先頭300文字を必ず添える（Section 15の趣旨）。
- **413（添付が大きすぎる）は専用の案内文**：「添付ファイルが大きすぎます (413)。ページ数を絞るか、テキストを貼り付けてお試しください。」
- **送信前のサイズチェックは入れなかった**：Supabase Edge Functionsのリクエストボディサイズ上限は2026-08-10時点で公式ドキュメントに明記されておらず（`supabase.com/docs/guides/functions/limits`はメモリ・実行時間・関数バンドルサイズ等のみを記載）、GitHub上のSupabase側回答も「10MB」は関数バンドル自体の上限であり受信ペイロードの上限ではないことを確認した。根拠のある数値が調べきれなかったため、推測の厳しい閾値で機能を狭めることはせず、エラー時のメッセージ改善（413対応）のみに留めた。将来413が実際に観測されたら、その時点のステータスコード・レスポンス本文を根拠に閾値を検討する。
- **`personalOkrImportExtractor.ts`の`max_tokens=16000`は確認のみ**：Edge Function側の`MAX_TOKENS_CAP`（16384）の範囲内であり原因ではないと判断し、変更していない。
- **テスト**：`src/lib/ai/__tests__/edgeFunctionError.test.ts`（新規・23件）に加え、`invokeAI.test.ts`/`apiClient.test.ts`に実際のsupabase-js非2xx挙動（`data=null`＋`response`から読む経路）のテストを追加。既存テスト（`data`を直接モックする後方互換ケース）は変更せず全通過。

---

## 27. PDF添付でEdge Functionが落ちる問題の修正・PDFのクライアント側テキスト抽出（v3.45・2026-08-10）

**症状（Section 26の続き）**：v3.43でエラー本文が読めるようになった結果、OKRモード「Kintoneから取込」で670KBのPDFを解析すると実際には `Edge Function returned a non-2xx status code (546): {"code":"WORKER_RESOURCE_LIMIT","message":"Function failed due to not having enough compute resources"}` が原因だったと判明した。Section 26（v3.43）時点では「`personalOkrImportExtractor.ts`の`max_tokens=16000`はCap（16384）の範囲内であり原因ではない」と判断していたが、**実際には16000という値そのものと、PDFをbase64で送っていたことの合算が原因**だった（Section 19 ⑦参照）。

**対応1：`max_tokens`を8192に引き下げ**（`src/lib/ai/personalOkrImportExtractor.ts`の初回・自己修正リトライ両方）。実績のある`okrImportExtractor.ts`と同じ値に揃えた（Section 6-1c）。加えて`invokeAI.ts`の`AIRawResponse`に`stop_reason`を追加し（Edge Functionは成功時のレスポンス本文をそのまま素通ししているため元々`data`には含まれていたが、型が持っていなかった）、`stop_reason==="max_tokens"`（出力の途中切れ）のときはJSONパースを試みる前に「抽出結果が長すぎて途中で切れました。四半期OKRと月次振返りを分けて取り込んでください。」という明示的なエラーにした（`consultationRunner.ts`の先例と同じ方針。リトライしても同じ長さの壁にぶつかるだけなのでリトライしない）。

**対応2：PDFのクライアント側テキスト抽出**（`docxText.ts`と同じ形に統一）。

- **`pdfjs-dist`を新規導入**（`package.json`にキャレット無しで`"6.2.108"`固定）。`src/lib/pdfTextFormat.ts`（pdfjs-dist非依存の純粋関数：`isPdfFile`/`normalizePdfText`/`pageItemsToText`/`isBlankExtractedText`/`PDF_EMPTY_TEXT_MESSAGE`）と`src/lib/pdfText.ts`（pdfjs-distを使う`extractPdfText`。前者を再export）に分離した。**理由**：`pdfjs-dist`はブラウザ専用ビルドで、vitestの`environment:"node"`でトップレベルimportするだけで`DOMMatrix is not defined`になる（`chunkSizeGate.ts`と同種の制約）。純粋関数だけを分離することでpdfjs-dist本体を読み込まずにテストできる。
- **`FileAttachButton.tsx`を変更**：PDFは`.docx`/`.html`と同じく専用抽出→テキスト添付（`isText:true`）に統一した。判定ロジック（`resolveMediaType`/`isSupportedMediaType`）は`src/lib/fileAttachMediaType.ts`に切り出し、`DOC_MEDIA_TYPES`（`application/pdf`のみだった）は削除した。**PDFの判定・抽出（`lib/pdfTextFormat.ts`／`lib/pdfText.ts`）は`FileAttachButton.tsx`側からのみ動的import**する設計にし、PDFを一度も添付しない人がこのチャンクをダウンロードしないようにした（Section 19）。
- **セキュリティ対処（山本さんの承認条件）**：
  1. **isEvalSupported:false**：型・実装ともに明示的に渡している（`GetDocumentParamsWithEvalFlag`型で拡張）。**検証結果として付記**：固定した6.2.108では、このオプション自体が`DocumentInitParameters`の型定義から既に削除されており、`pdf.mjs`/`pdf.worker.mjs`をgrepしても`eval(`/`new Function(`が1件も出現しない（＝CVE-2024-4367の原因だった危険なeval経路自体がライブラリから撤去済み。フラグより強い「経路の撤去」で解決している）。将来アップグレードでこの経路が復活した場合に備え、型を拡張してfalseを渡す防御的なコードは残した。
  2. **worker・cmap・標準フォントを全てローカルにバンドル**：workerは`pdfjs-dist/build/pdf.worker.mjs?url`（Viteの明示URLインポート）で同一origin・ハッシュ付き静的アセットとして解決（ビルド出力で`assets/pdf.worker-*.mjs`という相対パスに実際に解決されることを確認済み）。cmap・標準フォント（計約2.3MB）は`vite.config.ts`の`ensurePdfjsAssets()`が`node_modules/pdfjs-dist`から`public/pdfjs/`へコピーし（`.gitignore`対象・pdfjs-distのバージョンとマーカーファイルで突き合わせて重複コピーを避ける）、`cMapUrl`/`standardFontDataUrl`は`/pdfjs/cmaps/`・`/pdfjs/standard_fonts/`（同一origin）を渡す。**外部URLへのリクエストが無いことの確認方法**：ビルド後の`dist/assets/*.js`・`*.mjs`全体を`unpkg`/`jsdelivr`/`cdn.`/`mozilla.github`/`cdnjs`でgrepし0件、`pdfText`チャンクの実際のコードを直接読んで`cMapUrl`/`standardFontDataUrl`/workerSrcが`/pdfjs/...`・`assets/pdf.worker-*.mjs`という相対パス文字列そのものであることを目視確認した（2026-08-10）。
  3. **バージョン固定**：`package.json`の`"pdfjs-dist": "6.2.108"`（キャレット無し）。
- **`@napi-rs/canvas`を入れない**：`pdfjs-dist`の`optionalDependencies`（Node.jsでPDFを画像化する用途のOS別バイナリ12種）。`npm install --omit=optional`で一度入れたところ、その副作用でRollupの必須ネイティブバイナリ（`@rollup/rollup-win32-x64-msvc`。これもnpmの仕組み上optionalDependencyとして配布されている）まで一緒に除外されてしまい`vite build`自体が壊れた（`--omit=optional`はpdfjs-dist以外の全パッケージのoptionalDependenciesにも及ぶグローバルなフラグのため）。そこで`package.json`に`"overrides": { "@napi-rs/canvas": "npm:@napi-rs/canvas-do-not-install@0.0.0" }`を追加し、存在しない偽パッケージへ解決させることで**`@napi-rs/canvas`だけ**を狙って除外した（optionalDependencyの解決失敗はnpm installを失敗させない仕様を利用）。これにより通常の`npm install`（`--omit=optional`無し）でRollup等の正当なネイティブバイナリは正しく入り、`@napi-rs/canvas`だけが入らない。**確認方法**：`find node_modules -iname "*canvas*"`で0件、`npm audit`の脆弱性一覧に`pdfjs-dist`が含まれないこと、を都度確認する。
- **テキスト抽出はレイアウト情報を失う**：`personalOkrImportExtractor.ts`のシステムプロンプト冒頭に「入力はPDFそのものではなくレイアウト情報を失ったテキストである」旨の注記を追加し、位置関係よりも見出し語・ラベル文言（「[自己評価：]」等の角括弧表記）を根拠に判断するよう明示した（既存の角括弧表記優先の設計を大きく変える必要は無かった）。
- **抽出結果が空（スキャン画像のみのPDF等）の場合**：`extractPdfText`は`PDF_EMPTY_TEXT_MESSAGE`（「このPDFからは文字を読み取れませんでした。テキストを貼り付けてお試しください。」）を例外として投げる。**v3.79より前**は`FileAttachButton.tsx`の`.catch(alert(...))`経路にそのまま乗り、利用者にアラートを出して添付なしで終わっていた。**v3.79でこの挙動を変更**：抽出失敗（空文字・例外いずれも）を検知したら黙って従来のbase64直送にフォールバックするようにした。詳細はSection 37参照。
- **DLゲート（Section 19 ③）は今回のPDFチャンクには自動適用されない**：`withChunkDownloadGate()`は`MainLayout.tsx`が登録するReact.lazyビュー専用の仕組みで、`FileAttachButton.tsx`内の素の`import("../../lib/pdfText")`（イベントハンドラ内の動的import。v3.79以降は`src/lib/pdfAttachment.ts`経由）はこの仕組みの対象外。今回は実測gzip 127.38KB（閾値200KB未満）のため実害は無いが、将来pdfjs-distが育って閾値を超えた場合は、この動的import経路に個別のゲート対応を追加検討すること。

✅ **既知の未解消リスクはv3.79（2026-08-19）で解消済み（旧記録）**：`OkrImportModal.tsx`（グループOKR取込）と`MeetingImportPanel.tsx`（会議文字起こし取込）は、`FileAttachButton.tsx`を使わずPDFをbase64のdocumentブロックとして直接送る独自実装を持っていた。v3.79でこの2画面もクライアント側テキスト抽出に揃えた。詳細はSection 37参照。

---

## 28. 個人OKR取込のAI呼び出しを2回に分割（実行時間起因の546再発対策・v3.46・2026-08-10）

**症状（Section 27の続き）**：v3.45でPDFのクライアント側テキスト抽出とmax_tokens=8192への引き下げを行った後も、山本さんが実データで取込を試したところ「テキストだけで抽出は行われた」（テキスト抽出自体は成功）が、**しばらく時間が経った後に同じ546 WORKER_RESOURCE_LIMIT**になった。ペイロードのサイズではなく、個人四半期KR（最大8本×6本文欄）と月次計画・振り返り（最大8本×3か月×計画/振り返り両方）を**1回の呼び出しで抽出していたことによる生成時間の積み重ね**が原因（Section 19 ⑧）。

**対応：抽出を2回の呼び出しに分割した**（`src/lib/ai/personalOkrImportExtractor.ts`）。

- **呼び出し1（`extractPersonalOkrQuarterlyData`）**：資料の種類の判定（`detected_doc_type`）＋KR単位の基本情報（KR種別・ラベル・ウェイト・6本文欄）。**常に実行する**（月次振返り記録でも6本文欄は「KR_四半期OKRから転記」列に同じ内容が転記されているため、この呼び出しだけで拾える）。
- **呼び出し2（`extractPersonalOkrMonthlyData`）**：月次の計画・振り返り。呼び出し1の`detected_doc_type`が`"monthly_review"`のときだけ実行する（四半期OKRのみの資料には月次情報が無いため呼ぶ意味が無く、呼び出しを1回減らせる）。呼び出し1自体が失敗したときは種別が分からないため保険的に実行する。
- **マージは純粋関数に分離**：`mergePersonalOkrImportResults(quarterly, monthly)`が、`source_label`→`label`→同一インデックスの順でKRと月次データを対応づける（両呼び出しは同じKintone画面を同じ順序で読むため、ラベルが一致しなくても位置で対応づけられる可能性が高い）。対応が見つからないmonthly側のグループはデータを失わないよう末尾に追加する。
- **片方が失敗しても、成功した方をそのまま確認画面に出す**（全部やり直しにしない）。`extractPersonalOkrImportData()`のオーケストレーターが呼び出しごとにtry/catchし、失敗した方は`warnings: string[]`に理由を積んで返す（両方失敗したときだけ例外を投げる）。`PersonalOkrImportModal.tsx`のレビュー画面に⚠️の警告ボックスとして表示する。
- **max_tokensは8192のまま**（分割で1回あたりの生成量が減るため足りる見込み。Section 6-1c）。
- **進捗表示**：`onProgress`コールバックで`{current, total, label}`（"1/2 個人KRを抽出中"→"2/2 月次計画を抽出中"→完了）を呼び出し元へ伝える。従来の時間ベースの演出（`AIProgressLoader`）から、実際の呼び出し完了状況を表すもの（`SaveProgressLoader`を流用）に差し替えた（無言で長時間待たせないため）。
- **モデル切替の余地を残した（既定は変えない）**：`invokeAI()`に`model`引数（省略可）を追加し、Edge Function側の`ALLOWED_MODELS`（`claude-sonnet-4-6`/`claude-haiku-4-5`）から指定できるようにした。`personalOkrImportExtractor.ts`の`PERSONAL_OKR_IMPORT_MODEL`定数（1箇所）が既定値（`claude-sonnet-4-6`）を持つ。呼び出し分割でも546が続く場合は、この定数を`"claude-haiku-4-5"`に変えると生成が速くなる（コメントに明記済み）。
- **抽出文字数を画面に出す（診断・事前警告）**：`src/lib/personalOkr/importCharWarning.ts`の`isPersonalOkrImportTextTooLong()`（純粋関数）が、入力欄・添付から抽出した文字数（`MAX_TEXT_CHARS=40000`で切り詰めた後の実際に送信する文字数）が20000字を超えるかを判定する。20000字は「40000字の上限内でも546が再発した」という事実から安全側に倒した値（既存上限の半分。根拠は同ファイル冒頭コメント）。解析実行前（入力欄）・解析成功後（レビュー画面）の両方に表示し続ける（今後の切り分けに使うため、コンソールログではなく画面に出す）。閾値超えは「量が多いため、四半期OKRと月次振返りを別々に取り込むことをお勧めします」という行動が分かる警告文を添える。
- **テスト**：`personalOkrImportExtractor.test.ts`を分割後の構成に合わせて再構成（呼び出し1・2をそれぞれ独立にテスト＋`mergePersonalOkrImportResults`の純粋関数テスト＋オーケストレーターの呼び出し省略・進捗・部分失敗・全滅を検証）。新規`importCharWarning.test.ts`（閾値の境界値）。
- **やらないこと**：Edge Function自体のストリーミング化（対象外）。`OkrImportModal.tsx`／`MeetingImportPanel.tsx`の独自PDF送信経路（Section 19 ⑦の既知リスクのまま・別途）。

---

## 29. 利用者向けバージョン履歴（v3.63・2026-08-12、v3.65で全期間へ拡張＋月ごとの折りたたみを追加）

**目的は2つ**（山本さんの依頼）：①利用者が「何が変わったか」を自分で確認できること ②OKRの実績として「この期間に何を更新したか」を期間指定でコピーできること。②があるため、単なる一覧では足りない設計にした。

- **データは `src/lib/releaseNotes.ts`（`RELEASE_NOTES: ReleaseNoteEntry[]`。新しい順）に持つ。** 開発者向けの `docs/dev/CHANGELOG.md` とは別物として維持する（読み手が違う＝開発者 vs 利用者のため統合しない）。CHANGELOG.mdの技術的な記述をそのまま転記せず、利用者が読んで「何ができるようになったか」が分かる粒度に書き直す。内部実装のみの変更（リファクタ・テスト追加・型修正等、利用者の操作や見た目が変わらないもの）は載せない。
- **粒度はCHANGELOG.mdの1バージョン＝1エントリという対応にしていない。** 同じ日・同じ話題で複数回のバージョンアップがあった場合は1エントリにまとめ、`version`にはその範囲の最後のバージョンを記す。`date`（YYYY-MM-DD）が期間フィルタの判定に使う唯一のフィールドで、`version`は表示ラベルにすぎない。
- **範囲（v3.65で変更）**：当初は「2026年7月以降のみ」（下期OKRの期間に合わせる。山本さんの指示）だったが、v3.65で全期間（2026年3月の最初のリリースから）に拡張した。負荷面の判断：CHANGELOG.mdの見出し176件のうち、実際に「利用者の操作・見た目が変わった」に該当するのは19件（既存。2026-07-06以降）＋5件（今回追加。2026年3月〜7月2日）の合計24件のみで、gzip実測（後述）は閾値を大きく下回るため拡張して問題無いと判断した。**2026-07-06より前の期間は件数が極端に少ない**（1〜2件/日どころか1件/1〜2か月）。理由：この期間はDB設計・zustand状態管理移行・エラー表示ルール等の内部アーキテクチャ整備が中心で、利用者の操作・見た目が変わる変更自体が少なかったため（機能追加の大半は2026年7月以降に集中している）。
- **v1.0/v2.0（Phase設計ドキュメントの反映のみ）、v2.2/v2.3/v2.7（ホスティング確定・状態管理移行・楽観ロック強化等の内部アーキテクチャのみ）は対象外**：CHANGELOG.md上は見出しがあるが、利用者の操作・見た目の変化を伴わないため載せていない。
- **2026-07-06より前は日付にちょうどの日次粒度が無いバージョンがある**（CHANGELOG.mdの見出しに「2026年3月」等、日単位の日付が無い）。この場合は`git log -S"<該当版のCHANGELOG見出し文言>"`で該当テキストを最初に追加したコミットの日付を実際の日付として採用した（`src/lib/releaseNotes.ts`の該当エントリ手前のコメント参照）。v2.20（部署ごとのデータ分離）は実装が2026-06-26〜07-02の複数日にまたがっており、CHANGELOG.md自身が「実装は先行し文書化が遅れた」と明記しているため、機能が完成した07-02を採用した。
- **文体は です・ます調で統一する**（UI文言の文体方針。本節上部「UI/UX仕様」参照）。着手時点では「だ・である調で淡々と」の指示だったが、実装中にv3.62で「だ・である調は配布資料限定・UIはです・ます調を維持」という方針が確定したため、この確定に合わせて書いた。問いかけ・詩的表現は使わない（この禁止事項はUI文言にも等しく適用される）。
- **書き忘れの機械防止**：`src/lib/__tests__/releaseNotes.test.ts`が「`RELEASE_NOTES[0].version`が`` `v${APP_VERSION}` ``と一致するか」を検査する（`version.test.ts`と同じ「ソースを読んで検査する」方式）。バージョンだけ上げてリリースノートを書き忘れると`npx vitest run`が落ちる。バージョンを上げるときの4点セットはSection 11参照。
- **ダウンロード量の最小化**：`VersionHistoryModal.tsx`は`lazyWithRetry`で遅延読込する（CLAUDE.md Section 19）。`releaseNotes.ts`はこのモーダルからのみ静的importするため、バージョン履歴を開かない利用者はこのデータ・モーダルのコードともにダウンロードしない。gzip実測は閾値（200KB）を大きく下回るため`withChunkDownloadGate`は付けていない。
- **画面：押せる箇所はVersionBadgeを使う6箇所全て**（サイドバー最下部・ログイン画面4状態・モバイルラボシート）。`VersionBadge`（`src/components/common/VersionBadge.tsx`）に`onClick`を渡すと`<span>`から`<button>`に変わり、ホバーで下線・`aria-label`が付く。onClick省略時は従来の`<span>`表示のまま（後方互換）。**6箇所全てをクリック可能にした**（判断理由：全て同一の共有コンポーネントであり、ログイン前でも自分で更新内容を確認できる方が一貫性があり実装コストも増えないため。個別に一部だけ対応する理由が無かった）。
- **モーダルの契約**：Section 21（`modalStyles.ts`）を使用。本文（`MODAL_BODY_STYLE`）だけがスクロールし、期間指定・コピー行とフッターは常に見える。ゲスト（`isGuestMember`）にもガード無しで見せる（社内情報ではなくアプリの更新内容のため）。
- **期間で絞り込んでコピー（②の目的）**：モーダル内の開始日・終了日（`<input type="date">`）で絞り込んだ内容が、そのまま表示とコピーの両方に反映される（表示とコピー対象を分離すると「見えているものと違う内容がコピーされる」混乱を招くため、単一の`filtered`を両方に使う設計にした）。既定は両方空＝全件表示。
- **純粋関数への切り出し**：`src/lib/releaseNotes/filterByPeriod.ts`の`filterReleaseNotesByPeriod()`（期間の両端を含む・不正な日付文字列の境界は無視してもう一方だけで判定・エントリ自身のdateが不正なら除外）と`buildReleaseNotesText()`（日付・バージョン・タイトル・箇条書きだけの装飾なしプレーンテキスト。該当0件は空文字列）。テストは`src/lib/releaseNotes/__tests__/filterByPeriod.test.ts`。
- **月ごとの折りたたみ（v3.65で追加）**：件数が全期間拡張で増えたため、直近の更新が埋もれないよう月見出しで区切り、開閉できるようにした。ロジックは`src/lib/releaseNotes/groupByMonth.ts`に切り出し（テストは`__tests__/groupByMonth.test.ts`）：`groupReleaseNotesByMonth()`が新しい順のエントリを隣接する同月ごとにグループ化し、`defaultOpenMonthKeys(monthKeys, referenceDate, hasPeriodFilter)`が「開いている月キーの集合」を返す純粋関数として既定状態を判定する（`hasPeriodFilter`がtrueなら該当する月を全て開く＝絞り込んだのに折りたたまれて見えない状態を避ける。falseなら当月・前月だけを開く）。`VersionHistoryModal.tsx`側は`openMonths`（`Set<string>`）をReact stateとして持ち、`startDate`/`endDate`が変わるたびに`defaultOpenMonthKeys()`で再計算し直す（手動で開閉した状態は次に期間指定を変えるまで保持する）。見出しは`<button aria-expanded>`で、クリックで個別に開閉できる。


- **コピーの3段フォールバック**：`navigator.clipboard.writeText()` → 失敗時は非表示`<textarea>`＋`execCommand("copy")` → それも失敗したら画面上に選択済みの`<textarea>`を表示して手動コピーを促す（`ErrorBar.tsx`の`copyText()`と同じ考え方だが、`ErrorBar.tsx`は非export・別ドメインのためこのモーダル内に同型のヘルパーを個別に持つ。共通化は今回のスコープ外）。成功・失敗は`showToast()`で通知する。
- **DBスキーマ変更なし**（`schemaChecks.ts`への追記も不要）。

---

## 30. サイドバーの境界をドラッグで幅変更（v3.66・2026-08-12）

山本さんの依頼「サイドメニューとメインエリアの境界をドラッグで移動できるようにしてください」への対応。

- **範囲は160px〜420px**（`src/lib/layout/sidebarWidth.ts` の `SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH`。根拠はファイル内コメント参照：最小はナビ項目のラベル文字が折り返さず収まる下限、最大はメインエリアが極端に狭くならない上限）。既定幅は`SIDEBAR_DEFAULT_WIDTH`（196px。旧`SIDEBAR_WIDTH_EXPANDED`定数の値を継承）。
- **localStorageに記憶**：`KEYS.SIDEBAR_WIDTH`（`src/lib/localData/localStore.ts`）。折りたたみ時の48pxとは別に「展開時の幅」だけを記憶するため、折りたたみ→展開で必ず記憶した幅に戻る（折りたたみ中は`isSidebarCollapsed`で48px固定表示になるだけで、`sidebarWidth`のstate自体は変わらない）。
- **ダブルクリックで既定幅（196px）に復帰**。
- **折りたたみ中（48px）はドラッグ不可**：ハンドル自体を`!collapsed`のときだけ描画する（`MainLayout.tsx`の`Sidebar`コンポーネント内）。
- **キーボード操作**：ハンドルに`role="separator"` `aria-orientation="vertical"` `aria-label` `aria-valuemin/max/now`を付与し、`tabIndex={0}`でフォーカス可能にする。左右矢印キーで`SIDEBAR_WIDTH_KEY_STEP`（12px）ずつ変更する。jsx-a11yの既定ルールは`role="separator"`を「非インタラクティブロール」として扱うため`no-noninteractive-element-interactions`/`no-noninteractive-tabindex`の警告が出るが、ARIAの仕様上separator（window-splitter相当）はfocusable＋キー操作可能にしてよいため、理由コメント付きで`eslint-disable-next-line`している。
- **純粋関数への切り出し**：`src/lib/layout/sidebarWidth.ts`の`clampSidebarWidth(width)`（最小・最大への丸め。NaN/Infinityは既定幅にフォールバック）と`parseStoredSidebarWidth(raw)`（localStorageの生文字列を検証・復元。null・空文字列・数値変換不能な文字列は既定幅、範囲外の数値は範囲内にクランプ）。テストは`__tests__/sidebarWidth.test.ts`。
- **ドラッグの実装はConsultationPanel.tsx / PersonalOkrAiPanel.tsxの「左端ドラッグでリサイズ」と同じ流儀**（`position:absolute`の細い帯・`window`の`mousemove`/`mouseup`・refで最新値を保持し`mouseup`時にlocalStorageへ確定保存・ドラッグ中は`document.body.style.cursor`/`userSelect`を変更してテキスト選択を防ぐ）だが、**共通化はしていない**（判断理由）：
  1. 既存2箇所はキーボード操作に対応していない（マウス専用・`no-static-element-interactions`をdisableして済ませている）。サイドバーは要件上キーボード対応が必須で、実装が構造的に異なる。
  2. ドラッグの方向が逆（AIパネルは左端を掴んで左に伸ばすと幅が増える＝画面右側に固定された パネル。サイドバーは右端を掴んで右に伸ばすと幅が増える＝画面左側に固定されたパネル）。
  3. 既存2箇所は安定稼働中でテスト済みのため、今回のスコープ外の理由で触ってリグレッションを増やすリスクを取らない判断をした。
  重複しているのは「mousemove/mouseup配線・クランプ・localStorage確定保存」という短い手続きのみで、共通化してもコード量の削減効果は小さい。将来3箇所目の要件が増えたときに改めてhook化を検討する。
- **既存の全画面ラボビュー（Section 20）・ガント（Section 3-6 B2）との整合**：サイドバー幅は`var(--app-sidebar-w)`のようなCSS変数配布ではなく通常のflexboxレイアウト（Sidebarとメインエリアが`display:flex`の兄弟要素）で決まるため、サイドバー幅が変わるとメインエリアは自動的に追従する（Section 20のcontainmentテストが検査する「CSS変数配布方式に戻っていないこと」は今回も保たれている）。ガントのタスクバーは`ganttBodyRef`を`ResizeObserver`で監視し要素サイズが変わるたびに`remeasureDeps()`（依存関係の矢印・バッジの再計算）を呼ぶ設計になっており、サイドバーの幅変更（＝ガントのコンテナ幅の変化）でも自動的に再測定される。ドラッグ中の連続的な幅変更でも同じ経路で追従する（コード読解により確認。ブラウザでの実機確認は山本さんに依頼）。

---

## 31. グランドルール：ビューヘッダー（左タイトル＋右ツールバー）は `flexWrap` と `flexShrink` で守る（v3.73・2026-08-17）

**2026-08-17に発生した実際の不具合（山本さんが実機で発見）**：ブラウザ幅を狭めると、ガントビュー上部のヘッダーで「全プロジェクト」の文字が1文字ずつ縦に折り返され、ヘッダーだけで縦200px以上を占めてしまった。ツールバーのボタンラベル（「ベースライン」「クリティカルパス」等）も2行に割れていた。

**原因**：ヘッダーの外側`div`に`flexWrap`が無く、子要素（タイトル・ツールバー群）を無理に1行へ押し込もうとしていた。かつタイトルの`div`が`flex:1`だったため、幅が不足すると0近くまで縮み、テキストが1文字ごとに改行される（`white-space`未指定のflex子要素が極端に縮んだときの既知のCSS挙動）。

**対策（`DashboardView.tsx`が既に解決済みだった確立パターンをそのまま適用）**：
1. ヘッダーの外側`div`に`flexWrap:"wrap"`を付ける（幅が足りなければツールバーが2行目に折り返す。縦に潰れる代わりに横の行が増えるだけにする）。
2. **タイトルの`div`は`flex:1`を使わない。`flexShrink:0`にして常に自然な幅を確保する**（縦積みを構造的に不可能にする）。PJ名等の長い文字列は`overflow:hidden / textOverflow:"ellipsis" / whiteSpace:"nowrap" / maxWidth:"240px"`で省略表示にする。「全プロジェクト」「OKRタスク」のような固定文言は`whiteSpace:"nowrap"`だけでよい。
3. ツールバーの各ボタン（`headerBtnStyle`等の共有スタイル）・グループ化した`div`にも`whiteSpace:"nowrap"`と`flexShrink:0`を付け、ラベルが2行に割れないようにする。

**🔴 次に「タイトルを`flex:1`にすれば右寄せツールバーとの間が均等に空く」と直したくなっても戻さないこと**：見た目上は広いウィンドウで問題なく動くため気づきにくいが、ウィンドウ幅を狭める・Teams埋め込み等で幅が制約される環境で必ず再発する。「左タイトル＋右ツールバー」のヘッダー構造を新設・変更するときは、必ずこの3点（外側`flexWrap`・タイトル`flexShrink:0`・ボタン`whiteSpace:"nowrap"`+`flexShrink:0`）を確認すること。

**対象範囲の調査結果**：`GanttView.tsx`（2112行目〜）・`KanbanView.tsx`（246行目〜）はこの不具合があり本項の方針で修正した。`GanttMobileView.tsx`（161行目〜）はタイトルに元から`whiteSpace:"nowrap"`が付いており該当しない（横は省略表示になるだけで縦には潰れない）。`WorkloadView.tsx`（70行目〜）は元から`flexWrap:"wrap"`＋タイトル`flexShrink:0`が入っており該当しない。`ListView.tsx`（586行目〜）は「左タイトル＋右ツールバー」という構造自体を持たない（PJ名を表示する専用のタイトル要素が無い）ため対象外。

---

## 32. サイドバー下部「その他」（ガイド／設定／招待コードを入力）の折りたたみ（v3.74・2026-08-17）

山本さんの依頼：「📖 ガイド」「⚙ 設定」「🎫 招待コードを入力」の3ボタンが縦に並んでサイドバーの面積を占領しているため、折りたたみ式にして必要なときだけ展開したい（見せたいのは「メニュー」と「プロジェクト」）。

- **既存の確立済みパターンをそのまま踏襲**：`Sidebar`コンポーネント（`MainLayout.tsx`）の`pjOpen`/`togglePjOpen`（`KEYS.SIDEBAR_PJ_OPEN`）と同じ形で`miscOpen`/`toggleMiscOpen`（`KEYS.SIDEBAR_MISC_OPEN`）を新設した。**向きが逆**：`SIDEBAR_PJ_OPEN`は既定ON（`!== "0"`）だが、`SIDEBAR_MISC_OPEN`は既定OFF（起動時は折りたたみ。`=== "1"`のときだけ開く）。
- **見出し行**：折りたたみ時は`▸ その他`の1行のみ（クリックで`▾ その他`に変わり展開）。スタイルは「プロジェクト」セクション見出し（`togglePjOpen`のボタン）と同じトークン（font-size 10px・font-weight 600・letter-spacing 0.05em・color `var(--color-text-tertiary)`・text-transform uppercase・矢印`▶`の回転アニメ）を流用した（新しい見た目は作っていない）。
- **項目数が2件以上のときだけ見出し＋折りたたみにする**：「設定」「招待コードを入力」は`!isGuest`条件付きのため、ゲストは「ガイド」1つだけになる。1件以下のときに見出しで包むと、見出し行が増える分だけかえって縦の占有面積が増えて逆効果になるため、判定を`src/lib/layout/sidebarMiscSection.ts`の`shouldGroupSidebarMiscButtons(visibleItemCount)`（純粋関数・`visibleItemCount >= 2`）に切り出した（テストは`__tests__/sidebarMiscSection.test.ts`）。JSX側は`showMiscGroup = !c && shouldGroupSidebarMiscButtons(miscItemCount)`の1箇所で判定し、条件式を散らさない。
- **サイドバー自体が折りたたまれている（`c === true`・幅48px）ときは見出しを出さない**：`showMiscGroup`が`!c`を含むため自動的にfalseになり、従来どおり3つのアイコンボタンをそのまま並べる（アイコン1個ぶんの高さしか無くそもそも面積を圧迫していないため。ここで見出しを足すと逆に1行増える）。
- **既存の3ボタンの`onClick`／`title`／`data-tour-id`は無改修**。位置が見出しの内側に入れ子になるだけ。
- **初回ツアーの`guide-btn`参照が壊れる問題への対応**：`first-time.ts`の「guide」ステップ（`target: "guide-btn"`・`skipIfMissing: true`）は、「その他」が折りたたまれているとDOM上に存在せず黙って飛ばされてしまう。対応は**(a) ツアー開始時に自動的に「その他」を開く**を採用した。具体的には、同ツアーの最初のステップ（`id: "welcome"`。ターゲット無し＝毎回必ず表示される）に`action: "open-sidebar-misc"`を追加し、`Sidebar`コンポーネント側で`"tour:action"`イベント（既存の`demo-ai-consult`/`open-dashboard-pj-analysis`と同じ配線方式。`TourProvider.tsx`が`window.dispatchEvent`する）をリッスンして`setMiscOpen(true)`する。**localStorageは書き換えない**（一時的な展開に留め、ユーザーが選んだ既定の開閉状態を変えない）。
  - **タイミングの注意**：`TourProvider.tsx`はステップ変更時に「ターゲット測位（`skipIfMissing`判定を含む）」と「action発火」を同じ`activeStep`変更に対する別々の`useEffect`で行う。もし`action`を「guide」ステップ自身に付けても、ターゲット測位の効果（宣言順で先）がその場でターゲット不在と判定し即座に次のステップへ進めてしまい、action発火（宣言順で後）が「その他」を開いた頃には既に手遅れ（該当ステップの表示自体がスキップ済み）になる。そのため**「guide」より前のステップ（このツアーでは冒頭の`welcome`）でアクションを発火させ、猶予（`guide`到達までの間の複数ステップ分）を確保する**設計にした。
  - `okr-intro.ts`（OKRモードのツアー）は`guide-btn`を参照していないため対象外（確認済み）。
- **DBスキーマ変更なし**（`schemaChecks.ts`への追記も不要）。

---

## 33. プロジェクト招待まわりの権限境界を締める＋招待受諾者からPJ参加者全員が見えるように（v3.75・2026-08-18）

`supabase/migrations/20260818_harden_invite_related_rls.sql` 参照（**2026-08-18にdev/prod両方へ山本さんが手動適用済み**）。

### 何が起きたか（事故の芽・実害には至っていない）

v3.47（2026-08-11・`20260810c_extend_members_visibility_for_invites.sql`）で`members`のRLSポリシーに3つ目のOR条項（`OR group_ids && visible_invite_group_ids()`）を追加した。当時の意図は「可視性だけを広げる」ことだったが、このポリシーは`FOR ALL`でありながら`WITH CHECK`を省略していた。**PostgreSQLは`FOR ALL`で`WITH CHECK`が無い場合、USING式をINSERT/UPDATEの認可としても使う。** つまり追加した条項は可視性だけでなく書き込み権限も同時に広げていた——招待用部署を介して見えているだけの行（発行者・PJオーナー）に対して、招待受諾者が書き込みできてしまう余地があった。

あわせて、`guard_member_privilege_columns`（権限昇格ガードトリガー）が守っていた列は`is_super_admin`/`is_admin`/`group_id`/`group_ids`の4つだけで、`email`（ログイン中の利用者とmembers行を結びつける同一性判定キー）と`is_deleted`（有効な管理者の人数＝ブートストラップ猶予の判定材料）が無防備だった。

**🔴 引継ぎ時に発見・修正した二次バグ**：前任（クラッシュ前）が書いたこのマイグレーションの下書きは、コメントで「`will_be_super_admin`（NEW.is_super_adminが真でありさえすれば真になる、対象の属性で判定していた誤り）を`self_bootstrap_super_admin`（フェーズ1の自己ブートストラップ分岐を実際に通った時だけ真になる変数）に置き換えて正す」と明記していたが、**実際の関数本体は旧ロジックのまま未修正**だった（コメントと実装の食い違い）。つまり「対象行が元々super-adminで今回は無変更」というケースでも、同じ部署の非管理者がそのsuper-adminの行のis_admin/group_id/group_ids/email/is_deletedを書き換えられる穴が実装上まだ残っていた。本セッションでコメントどおりに実装を修正した。**教訓：レビュー（generator/evaluatorの分離）が無いと、コメントで「直した」と書いてあるだけで実際には直っていないコードがそのまま出て行きうる。**

### 塞いだこと（5点）

1. **members のRLSをSELECT用（`members_select`）と書き込み用（`members_write_insert`/`update`/`delete`）に分割**。可視性（SELECT）は既存3条項を1文字も変えず維持しつつ後述の4条項目を追加、書き込みは3条項目（招待用部署ごしに見えているだけの行）にのみ「部署管理者または全社スーパー管理者であること」を課した。`WITH CHECK`を省略せず明示的に書く（省略が今回の原因そのもの）。
2. **`guard_member_privilege_columns`に`email`／`is_deleted`の保護を追加**。`email`は実行者がsuper-admin／部署管理者／対象が自分自身の行、のいずれかでなければ静かに差し戻す。`is_deleted`のfalse→true（論理削除）は実行者がsuper-admin／部署管理者でなければ差し戻す。
3. **部署ブートストラップ猶予から招待用部署を除外**。招待用部署（`is_invite_group=true`）にはadminを作る経路が設計上存在せず、`dept_admin_count`が永久に0のままになるため、この猶予が恒久的に開いた窓になっていた（招待受諾者が自分の行を`is_admin=true`にできた）。
4. **`will_be_super_admin`を`self_bootstrap_super_admin`に置き換え**（上記「引継ぎ時に発見・修正した二次バグ」参照）。
5. **`projects.group_ids`のガードトリガー（`verify_project_group_ids`）を新設**。自部署のPJに他PJの招待用部署を後から足すことができ、`visible_invite_group_ids()`の戻り値を任意に膨らませられる穴を塞いだ（非super-adminは、そのPJ自身の招待用部署／変更前から入っていたもの／実行者が既にアクセス権を持っているもの、以外の招待用部署を静かに取り除く）。
6. **`project_invites`のSELECTポリシーを「発行者の所属部署」基準から「対象PJが属する通常部署」基準に変更**（新設`project_normal_group_ids()`）。旧基準では招待受諾者が発行者の発行した全招待行（他人のメールアドレス・他PJ宛を含む）を読めてしまっていた。
7. **task_dependencies のRLSをPJ範囲（group_ids配列）に追従させる**（統括の追加指示。下記「task_dependenciesの取り残し」参照）。

### 追加要望：招待受諾者からPJ参加者全員が見えるように（4条項目）

山本さんの追加要望（本番の羅針盤フォーラムPJで実害発生：招待された方からPJの他の参加者が1人も見えず、担当者欄が「未担当」になる）。従来、招待受諾者から見える社内メンバーは3条項目（`group_ids && visible_invite_group_ids()`）により発行者本人とPJオーナーの2名だけに限られていた（Section 25 Phase 4末尾に記録済みの制約）。

- **方針**：兼務（`group_ids`）を増やす方式は採らない（書き込みスコープが広がる・「表示部署」切替の副作用が出る・既存メンバーの`group_ids`を大量に書き換えることになるため）。代わりに**`members`のSELECTポリシーにだけ**4条項目を追加した：`OR id = ANY(public.visible_project_member_ids())`。**書き込み側には一切追加していない**（可視性の緩和が書き込み認可も兼ねる、という今回の事故と同型の誤りを繰り返さないため）。
- **新設ヘルパー`visible_project_member_ids()`**（引数無し・SECURITY DEFINER・STABLE。`current_member_group_ids()`等の既存3ヘルパーと同じ流儀）：「自分がアクセスできるPJ」に参加しているメンバーidの配列を返す。「参加しているメンバー」の定義は`src/lib/project/projectMembers.ts`の`computeProjectMembers()`の実際の呼び出し元（`ProjectSettingsModal.tsx`）と`ProjectKarte.tsx`の`pjAllMembers`（"AI分析に渡す「このPJに関わる全員」＝オーナー＋メンバー＋タスク担当者の和集合"というコメントがそのまま定義）で共通する集合に揃えた：owner_member_id（互換目的の単数）／owner_member_ids（複数オーナー）／`projects.member_ids`（PJの関与者列。**この列自体は`supabase/schema.sql`への反映が漏れていたドリフトだったため今回追記した**）／そのPJに紐づくタスクの`assignee_member_id`・`assignee_member_ids`（project_id直接紐づき＋task_projects経由の追加PJ紐づけの両方）。`is_deleted=false`のPJ・タスクのみ対象。
- **性能**：引数を取らない関数にしたため、PostgreSQLはクエリ全体で1回だけ評価するuncorrelated subplanとして実行できる（members行数分ではなく1回だけprojects×tasksを辿る）。仮に「メンバーidを引数に取りEXISTSで判定する」形にすると、members行ごとに相関実行され不利になる。関数内部はUNIONで集合を作り（EXISTSではない）、JOINは必要な2経路（project_id直接／task_projects経由）だけにとどめた。`can_access_group_ids()`は呼ばず`(p.group_ids && current_member_group_ids() OR current_member_is_super_admin())`をインライン展開している（`schema.sql`では`can_access_group_ids()`自体の定義がmembersのRLS群より後方にあるため前方参照エラーになる。`visible_invite_group_ids()`の先例に倣った）。
  - 🔴 **【2026-08-19・v3.80で訂正】上記の「クエリ全体で1回だけ評価するuncorrelated subplanとして実行できる」という記述は誤りだった。** 実測（本番・招待受諾者アカウント）で`EXPLAIN (ANALYZE, BUFFERS)`を取ったところ、`members`（21行）へのSELECTが`shared hit=6504`・`Execution Time 76.085ms`という異常値になっており、引数無しのSTABLE/SECURITY DEFINER関数であってもRLSのWHERE句に直接書くとPostgreSQLは行ごとに評価することが判明した。**関数呼び出しを`(SELECT ...)`で包まない限りInitPlan化されない。** 是正版はv3.80・`20260819c_optimize_members_rls_initplan.sql`。詳細・グランドルール化はSection 39参照。
- **意図的に受け入れる副作用**：部署をまたぐPJでは、他部署のメンバー同士も相互に見えるようになる（同じPJの参加者に限る）。「部署間の素の可視性は広げない」という既存の設計原則からの意図的な緩和（山本さん承認済み）。PJを共有しない他部署のメンバーは引き続き見えない。
- **Section 25 Phase 4「可視性の非対称」は本changeで解消**（該当箇所を書き換え済み）。発行者・PJオーナーへの兼務付与自体（(a)の切替UI抑制のため）は残るが、メンバー可視性としての非対称は解消された。
- **フロント側の追加変更は不要と確認済み**：`ProjectSettingsModal`の「関わるメンバー」タブ・サイドバーPJ行「⋮」メニューの「⚙ このPJの設定」は、どちらも権限ガード（`isGuest`以外）を持たず、招待受諾者（実アカウント）は元々到達できる。`members`が見えるようになったことで`computeProjectMembers()`・担当者アイコンは自動的に正しく動く。

### task_dependenciesの取り残し（統括の追加指示・同一マイグレーションに追記）

`task_dependencies`（B1：タスク依存関係）だけが20260722b の配列化（`group_id`単数比較→`group_ids`配列オーバーラップ）に追従しておらず、旧来の`group_id = current_member_group_id()`のまま残っていた。実害は2つ：①招待受諾者にはPJのタスク依存関係が1本も見えず、ガントの矢印（B2）・依存ゲート（B1）・BlockedTasksWidgetが機能しない、②複数部署を兼務しているメンバーも兼務先PJでは依存関係が見えない既存バグ（招待とは無関係）。あわせて`FOR ALL`で`WITH CHECK`を省略していた（今回の事故と同型）。

**対応**：`group_id`列の値ではなく、依存関係が結ぶ2つのタスク（predecessor/successor）それぞれへのアクセス可否で判定する形に切り替えた。`tasks.group_ids`は`sync_task_group_ids`/`cascade_project_group_ids_to_tasks`によりPJのgroup_ids（招待用部署を含む）が既に伝播済みのため、これに乗るだけで招待受諾者にも兼務メンバーにも正しく効く。既存の`task_projects_group`/`task_task_forces_group`と同じ`can_access_group_ids(task_group_ids(...))`の流儀に揃え、新しいヘルパー関数は作らなかった（`task_group_ids()`は主キー1件参照のSTABLE関数で既存2ポリシーと同じコスト）。**両端とも（AND）アクセスできることを要求する**（ORにすると見えない方のタスクの存在が依存線から漏れるため）。`group_id`列自体は残す（NOT NULL・アプリが書いている）が、RLSの判定材料としては使わない。

### 検知できないこと（schemaChecksの既知の限界）

**✅ `guard_member_privilege_columns`の本文差し替えはv3.80で検知可能になった**（`src/lib/schema/schemaChecks.ts`の新kind`function_body_contains`。Section 22・38参照）。当時（v3.75時点）は本文だけを差し替える関数のため`kind:"function"`（`pg_proc`に同名関数が存在するかしか見ない）では適用漏れを検知できなかった（旧記録）。**`task_dependencies`のRLSポリシー変更は今もschemaChecksでは検知できない**（「ポリシーの中身」を検査する種類（kind）が無いため。v3.80のスコープ外）。新設した3関数（`verify_project_group_ids`／`project_normal_group_ids`／`visible_project_member_ids`）は`kind:"function"`で追加済み。

### 変えていないこと

- `create_project_invite()`／`accept_project_invite()`の本文（メール検証・24時間有効期限・既存メンバー分岐等）は変更していない。
- v3.60の要件「部署管理者が招待受諾者を編集できる」は維持（書き込みポリシーの3条項目に残した）。
- `sync_task_group_ids`／`cascade_project_group_ids_to_tasks`／`task_forces`の可視性（v3.76以降で別途対応予定）は変更していない。

---

## 34. 招待された人の体験3件の修正（v3.76・2026-08-18）

2026-08-18に山本さんが実機で未登録の方を「羅針盤フォーラム」PJへ招待して踏んだ3件。RLS・招待の仕組み自体は正しく機能していることを確認済みで、以下は純粋にフロント側の問題だった。

### 件1：参加の確認ダイアログが削除ボタンの見た目になっていた

`src/lib/dialog.ts`の`confirmDialog(message: string)`がメッセージしか受け取らず、`ConfirmModal.tsx`が常に削除用の見た目（赤・ゴミ箱🗑・「削除する」）で固定されていたため、招待を受諾する確認（「参加しますか？」）にまで削除の見た目が出ていた。

- `confirmDialog(message, opts?)`に`opts: { tone?: "danger" | "neutral"; confirmLabel?: string }`を追加した（`src/lib/dialog.ts`）。`ConfirmModal.tsx`は`resolveDialogVisual(type, tone)`でアイコン・配色を決める（`alertDialog`の見た目＝warningは無変更）。
- 🔴 **`tone`の既定値は`"danger"`のまま据え置いた。** 呼び出し箇所は19（うち大半は削除・取り消し・解除の破壊的操作）あり、既定を変えると拾い漏れた呼び出しが「削除ボタンが無害に見える」という悪い方向の回帰になるため。**非破壊の確認を新しく追加するときは、呼び出し側が必ず`{ tone: "neutral" }`を明示すること。**
- `tone: "neutral"`にした箇所（読んで破壊的でないと判断した4箇所のみ。他15箇所は削除・取り消し・解除のため据え置き）：`App.tsx`の招待受諾確認（本件の本体。ラベル「参加する」＝`auth.invite.member.submit`を再利用）／`ProjectSettingsModal.tsx`のPJ状態変更（完了・アーカイブ・差し戻し＝データを消さない）／`AdminView.tsx`のTFクォーター解除・TFクォーター移動（TF自体は削除されない）。招待の取り消し（`AdminView.tsx`／`ProjectSettingsModal.tsx`の2箇所）はアクセス権を無効化する操作のため据え置いた。タブ切替時の「未保存の変更が失われます」警告（`AdminView.tsx:234`）・ゲストのサンプルリセット（`MainLayout.tsx`）も、現在の編集内容を失わせるため据え置いた。

### 件2：受諾後もURLに`?invite=`が残り、リロードのたびに参加確認が再表示される

`stripInviteParamFromUrl()`（`src/lib/projectInvite/loggedInInviteFlow.ts`。Section 25 Phase 5）は、既存メンバーがログイン済みでURLの招待コードを拾い直す経路（`App.tsx`の③）でのみ使われており、**未ログインからの新規登録経路（`LoginScreen`→`App.tsx`の②`pendingProjectInvite`自動受諾）では一度も呼ばれていなかった。** 受諾成功後に`window.location.reload()`してもURLに`?invite=<code>`が残ったままのため、reload後に③が同じコードを拾い直して確認ダイアログを再表示し、`accept_project_invite()`を再実行して「既に使用されています」エラーになっていた。

- ②の3分岐（メール不一致・成功・失敗）全てで、既存の`stripInviteParamFromUrl()`を再利用して`window.history.replaceState()`でURLから`?invite=`を外すようにした（`App.tsx`）。新しい処理は書いていない。
- 成功時はreloadの**前**に外す（reload後はURLを読み直すため、reload前に書き換える必要がある）。

### 件3：招待されたPJがサイドバーに出ない

サイドバーのPJ一覧「自分／全件」トグルの既定が「自分」で、招待受諾者はまだ担当タスクを持たないため0件になり、「自分が担当するタスクを持つPJはまだありません」と出てPJ自体は見えているのに一覧に現れなかった。

- 🔴 **「招待受諾者かどうか」で分岐するコードは書いていない。** Section 25 Phase 4の`filterInviteGroupsForSidebar()`（「フィルタ結果が0件なら除外前のリストを返す」という一般則）と同じ流儀で、**一般則1つ**で解いた：`src/lib/layout/sidebarMineOnlyDefault.ts`の`resolveInitialSidebarMineOnly(storedPreference, mineCount, allCount)`が「未設定（初回表示）・自分0件・全件1件以上なら『全件』を初期値にする」を判定する。**これなら招待受諾者だけでなく「まだ自分のタスクが1件も無い新入社員」も同じ理屈で救われる。**
- `MainLayout.tsx`の`mineOnly`の`useState`初期化関数から呼ぶだけ（初期化関数は初回マウント時にしか実行されないため、以後ユーザーが明示的に切り替えた選択を上書きすることはない。localStorageに選択済みの値（`KEYS.SIDEBAR_MY_PROJECTS_ONLY`が`"0"`/`"1"`）があれば常にそちらを優先する）。
- 空状態のメッセージ（`layout.sidebar.noMineProjects1`/`2`）に「「全件」に切り替える」ボタン（`layout.sidebar.switchToAllProjects`）を追加し、既存の`onToggleMineOnly`をそのまま呼ぶ（新しい切替経路は作っていない）。
- 回帰テストは`src/lib/layout/__tests__/sidebarMineOnlyDefault.test.ts`（自分0件／全件0件・自分0件／全件2件・自分3件／全件5件・明示的に切り替えた後の2ケース）。

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

## 36. 招待受諾者の取りこぼし3箇所の修正＋再発防止の機械チェック3種（v3.78・2026-08-18）

Section 25 Phase 4末尾「部署でスコープする画面を新設するたびに再発しうる構造」で予告した
とおり、AdminView内の3箇所で実際にこの構造を踏んでいた。CLAUDE.md記載の行番号は診断（変更前）
時点のもので、現物とはズレがある（本Section末尾の「行番号のズレ」参照）。

### パートA：招待受諾者の取りこぼし3箇所

**設計判断**：MembersSectionが採った「部署絞り込みとは別枠の常時表示カード」方式（Section 8・
25 Phase 4）はドロップダウン・チェックボックス一覧・集計レポートには馴染まないため、この3箇所
では採らない。代わりに**一覧に混ぜたうえで、招待受諾者だと分かる識別ラベルを付ける**方式にした。
判定は既存の`src/lib/admin/guestMembers.ts`の`isGuestOnlyMember()`をそのまま再利用し、
呼び出し側の正規化（`group_ids`が空なら`group_id`にフォールバック）・混ぜ込み・ラベル付けを
まとめた3つの薄いヘルパー（`withGuestOnlyMembers()`／`isGuestMemberOf()`／`withGuestLabel()`）
を同ファイルに追加した（`isGuestOnlyMember()`自体はリネームしていない）。

**🔴🔴 招待受諾者を一覧に混ぜるときは、必ず選択中の部署のPJに紐づく人だけに絞ること
（v3.78・レビュー後の訂正）。** 当初は「クライアントのmembers stateに乗っている時点でRLS
（`visible_invite_group_ids()`/`visible_project_member_ids()`。Section 25/33）が可視範囲を
決定済みだから部署でのさらなる絞り込みは不要」という判断で3箇所とも無条件に全招待受諾者を
混ぜていたが、**v3.75で`members_select`にvisible_project_member_ids()（自分がアクセスできる
PJの参加者全員）を足したことでmembersの可視性が部署をまたいで広がったため、この前提はもう
成り立たない**。招待用PJが複数部署にできると、絞り込み無しでは部署別レポート（特にAI使用量）
に他部署の招待受諾者のコストが混ざる。そのため`src/lib/admin/guestMembers.ts`に
`inviteGroupIdsInScope(projects, selectedGroupId, allInviteGroupIds)`を追加し、
`withGuestOnlyMembers()`/`isGuestMemberOf()`に渡す`inviteGroupIds`は必ずこの関数で
「選択中の部署のPJに紐づく招待用部署idだけ」に絞り込んだ集合にする（招待用部署のidの導出は
`grp-invite-+PJのid`の文字列組み立てを新しく書き起こさず、既にストアにある
`projects.group_ids`＝PJへの招待発行時に招待用部署idが直接追加される実データの積集合で求める。
`ProjectSettingsModal.tsx`の`inviteGroupId`計算と同じ「フロントで命名規則を複製しない」方針）。

1. **PJオーナー／メンバー選択**（`AdminView.tsx`の`PJSection`。診断時点1585行目・現物では
   `ProjectFormFields`のオーナー/メンバーpicker）：オーナー・メンバー両方のcandidate一覧の
   ベースとなる`members`useMemoに`withGuestOnlyMembers()`を適用。混ぜる対象は
   `inviteGroupIdsInScope()`で選択中の部署のPJに紐づく招待受諾者だけに絞る。オーナーチップ・
   メンバーチップ・ドロップダウンのラベルに`withGuestLabel()`で「（招待）」を付けた。
2. **メンバータグ付与**（`AdminView.tsx`の`TagsSection`。診断時点3104行目・現物では
   `TagFormFields`のチェックボックス一覧）：`scopedMembers`に`withGuestOnlyMembers()`を適用。
   同じく`inviteGroupIdsInScope()`で選択中の部署のPJに紐づく招待受諾者だけに絞る。
   チェックボックスのラベルに「（招待）」を付けた。
3. **AI使用量レポート**（`AdminView.tsx`の`AIUsageSection`。診断時点3662行目）：
   **集計から漏れていたこと自体が主目的**。`scopedMemberIds`（部署別ログの絞り込み集合）に
   `withGuestOnlyMembers()`で招待受諾者を混ぜた結果、その部署に紐づくログが
   `scopedLogs`/`monthlyData`/`memberBreakdown`の集計に初めて入るようになった（今まで
   これらの数値から丸ごと消えていた）。混ぜる対象は`inviteGroupIdsInScope()`で選択中の部署の
   PJに紐づく招待受諾者だけに絞る（他部署の招待受諾者のコストが混ざらないようにするため）。
   メンバー別内訳の氏名にも「（招待）」を付けた。

### パートB：再発防止の機械チェック3種

いずれもCLAUDE.md Section 22の流儀（TS側の宣言的な配列＋テストで機械検証する）に合わせた。
実行時に人が気づく仕組みではなく、**CIで落ちるテスト**。3種とも実装前に「わざと1箇所壊して
赤くなる」ことを確認済み（各テストファイルの冒頭コメントに手順を記録した）。

#### ①ゲスト分岐の網羅性（`src/stores/__tests__/guestBranchCoverage.test.ts`）

**守っているもの**：appStoreの書き込み系アクション（`AppState`interfaceに宣言された
関数のうち、`load`/`reload`/`loadDemoData`/`setCurrentGroupId`/`setCurrentUserIsSuperAdmin`/
`applyRemoteChange`を除いた全て。現在33個）が、必ず次の3つのいずれかに分類できることを
ソース走査で検査する：`isGuestMode()`の直接ガードを持つ／`src/lib/admin/adminOnlyActions.ts`の
`DELEGATING_ACTIONS`（委譲先自身がガードを持つことも検査）／同ファイルの`ADMIN_ONLY_ACTIONS`
許可リストに載っている（「なぜガードが無くても安全か」の理由をファイル冒頭コメントに明記）。
v3.77で見つかった`saveMember`の分岐漏れ（Section 35 件5）と同型の漏れを止めるのが目的。

**新しいアクションを足す人が何をすればよいか**：`appStore.ts`に新しい書き込みアクションを
追加したら、以下のいずれかを必ず選ぶ。何もしないとこのテストが落ちる。
- ゲストにも開放する機能 → 実装内に`isGuestMode()`分岐を入れる（既存17アクションと同型）。
- 既存のガード済みアクションに委譲するだけ → `adminOnlyActions.ts`の`DELEGATING_ACTIONS`に
  `{ 新アクション名: 委譲先アクション名 }`を追記する。
- AdminView（またはAdminViewの中からしかマウントされない子コンポーネント）専用で、ゲストは
  UIの分岐で到達不能 → `adminOnlyActions.ts`の`ADMIN_ONLY_ACTIONS`に追記する（②のテストが
  「本当に到達不能か」を別途検査する）。

#### ②admin専用アクションの越境（`src/components/__tests__/adminActionBoundary.test.ts`）

**守っているもの**：①の許可リスト`ADMIN_ONLY_ACTIONS`（15個。`saveGroup`・`deleteGroup`・
`saveLoadingTip`・`deleteLoadingTip`・`deleteMember`・`saveObjective`・`saveKeyResult`・
`deleteKeyResult`・`saveTaskForce`・`deleteTaskForce`・`saveToDo`・`deleteToDo`・
`saveQuarterlyObjective`・`saveMemberTag`・`deleteMemberTag`）は、`MainLayout.tsx`の
唯一のUI分岐（`(isAdminOpen && !isGuest) ? adminOverlay : ...`）でAdminView自体に
ゲストが到達できないことだけで安全になっている単一障害点。このテストは独立した2つの壊れ方を
検知する：(1)これら15アクションの呼び出し元（`useAppStore(s => s.<name>)`）が、宣言済みの
3ファイル（`AdminView.tsx`／`LoadingTipsSection.tsx`／`OkrImportModal.tsx`）以外に増えていないか
（越境検知。UI分岐が健全でも新しい画面がこれらを呼び始めれば実害が出る）、(2)`MainLayout.tsx`の
該当箇所から`!isGuest`が失われていないか（単一防御点の健全性）。
**このリポジトリにReactレンダリングテスト基盤が無いため、「ゲストが実際にAdminViewを開けない
こと」自体は実機確認に委ねる**（ソースコードの構造が壊れたら気づける、という限定的な機械
チェック）。

**新しくAdminView専用アクション・画面を足す人が何をすればよいか**：①でADMIN_ONLY_ACTIONSに
追記したら、その呼び出し元を`AdminView.tsx`／`LoadingTipsSection.tsx`／`OkrImportModal.tsx`の
いずれかに限定する（新しいAdminView専用の子コンポーネントを増やす場合は、
`adminOnlyActions.ts`の`ADMIN_ONLY_ACTION_SURFACE_FILES`にファイルを追記する）。

#### ③memberInGroupの使用箇所（`src/components/__tests__/memberInGroupUsage.test.ts`）

**守っているもの**：パートAと同じ「部署で絞り込むと招待受諾者が漏れる」構造を、次に新しい
画面を作ったときに機械で検出するためのもの。`AdminView.tsx`内のローカル関数
`memberInGroup()`の呼び出し箇所（現在5箇所）を宣言的配列`EXPECTED_CALL_SITES`（呼び出し行の
テキスト＋招待受諾者をどう扱うかの理由）として持ち、実際の呼び出し箇所とのソース走査による
1対1の一致を検査する。

**新しく部署で絞り込む画面を足す人が何をすればよいか**：`memberInGroup(`を新しく呼ぶコードを
書いたら、このテストが落ちる（宣言済みリストに無い呼び出しのため）。落ちたら、招待受諾者を
その画面でどう扱うかを決めてから（`inviteGroupIdsInScope()`で選択中の部署のPJに紐づく人
だけに絞り込んだうえで`withGuestOnlyMembers()`で混ぜる／意図的に除外する、のいずれか。
**部署でさらに絞り込まずに全招待受諾者を混ぜるのは選ばないこと**＝パートAのAI使用量レポートで
実際に発生した「他部署のコストが混ざる」不具合の再発になる）、`EXPECTED_CALL_SITES`に
呼び出し行のテキストと理由を追記する。**理由の記入を省略しないこと**（無言の除外を作らない
ためのテストであり、行を追加するだけでは目的を果たさない）。

### 行番号のズレについて

診断（2026-08-17時点）の行番号は本Sectionの実装前の状態を指す。パートAの実装で`PJSection`・
`TagsSection`・`AIUsageSection`それぞれに数行〜十数行を追加したため、現物の行番号は診断時点より
後方にずれている（本Sectionの各項目に記載した「診断時点」の行番号がその変更前の値）。

---

## 37. PDF取込をクライアント側テキスト抽出に統一（v3.79・2026-08-19）

Section 19 ⑦・27で「既知の未解消リスク」として記録していた、PDFをbase64のdocumentブロックとして直接Edge Functionへ送る経路を、実際に調査して確定させ、他の画面と同じ「クライアント側でテキスト抽出→テキストを送る」方式に統一した。

### 調査結果：実際にbase64直送のまま残っていた経路は2画面（診断どおり）

- `src/components/admin/OkrImportModal.tsx`（グループOKR取込。「📄 PDFから取込」）
- `src/components/meeting/MeetingImportPanel.tsx`（会議文字起こし取込）

どちらも`handleFile()`内でPDF判定時に`FileReader.readAsDataURL()`→`{ mediaType: "application/pdf", isText: false }`を直接組み立てており、`FileAttachButton.tsx`の共通経路を使っていなかった（診断の「2画面」と一致。他に該当する画面は無いことをコードベース全体で`application/pdf`を検索して確認済み）。

### 既に移行済みだった経路：`FileAttachButton.tsx`（v3.45時点）

`src/components/common/FileAttachButton.tsx`は`isPdfFile(file)`判定後、`lib/pdfText.ts`の`extractPdfText()`を動的importして呼び、抽出したテキストを`{ mediaType: "text/plain", isText: true }`として渡す設計に既になっていた（v3.45）。この経路は`src/components/lab/KrJointSessionFlow.tsx`・`KrQuarterPlanPanel.tsx`・`KrReportPanel.tsx`・`KrWhyPanel.tsx`・`src/components/okr/personal/PersonalOkrImportModal.tsx`（Kintone個人OKR取込・Section 24 Step F）から共有されている。

**横展開できるか＝できる。ただし1点だけ既存の`extractPdfText()`呼び出しをそのまま踏襲すると設計判断2（フォールバック必須）を満たせなかった**：v3.45時点の`FileAttachButton.tsx`は、`extractPdfText()`が抽出結果空（`PDF_EMPTY_TEXT_MESSAGE`）や解析失敗で例外を投げた場合、`.catch(alert(...))`で利用者にアラートを出すだけで**添付なしのまま終わっていた**（フォールバックしていなかった）。今回の依頼の設計判断2（抽出結果が空ならbase64直送へ自動フォールバック）を満たすには、この失敗時の挙動自体を変える必要があった。そのため「そのまま横展開」ではなく、フォールバック判定を挟む共通ラッパーを新設し、**`FileAttachButton.tsx`自身もこのラッパー経由に更新した**（既存の移行済み画面の挙動も、今回のフォールバック方針に合わせて底上げされる）。

### 実装

- **`src/lib/pdfTextFormat.ts`に純粋関数`resolvePdfFallbackSource(extractedText: string | null, fileSizeBytes: number): "text" | "base64" | "too-large"`を追加**（pdfjs-dist非依存・既存の`isBlankExtractedText`をそのまま再利用）。抽出成功（非blank）ならサイズを問わず`"text"`。抽出失敗（`null`＝例外／空文字／空白・改行のみ）の場合のみサイズを見て、`PDF_BASE64_FALLBACK_MAX_BYTES`（200KB＝204800バイト）以下なら`"base64"`、超えたら`"too-large"`を返す。テストは`src/lib/__tests__/pdfTextFormat.test.ts`に7ケース（通常のテキスト×大小2件／空文字・小／空白改行のみ・小／null・小／閾値ちょうど＝base64／閾値超過×2件＝too-large）。
  - 🔴 **base64フォールバックそのものにもサイズの歯止めが必要（統括レビューで追加）**：抽出失敗をきっかけにbase64直送へフォールバックする設計は、テキスト層の無い大きなPDFに対して「546を分かりにくい失敗として再発させるだけ」になりかねない（base64直送自体が546の原因だった実績＝Section 19 ⑦）。**閾値は「実際に落ちた670KBという値」そのものではなく、その値から十分な安全マージンを取った200KB**（670KBの実に3割弱）にした。閾値を超える場合は`PDF_TOO_LARGE_MESSAGE`（「このPDFは文字を読み取れず、かつサイズが大きいため読み込めませんでした。文字を選択できる状態で保存し直すか、内容をコピーしてテキスト欄に貼り付けてお試しください。」）を例外として投げ、base64は一切送らない。
- **新規`src/lib/pdfAttachment.ts`（`buildPdfAttachment(file: File): Promise<FileAttachment>`）**：PDFをAIに添付するための唯一の入口。内部で`./pdfText`（pdfjs-dist本体を抱える）を動的importして`extractPdfText()`を呼び、失敗したら`console.warn`で1行だけログを残す（利用者への通知はしない＝設計判断3）。`resolvePdfFallbackSource(extractedText, file.size)`の判定に従い、`"text"`ならテキスト添付、`"base64"`なら`FileReader.readAsDataURL()`でbase64を読み直してbase64添付（`isText:false`）、`"too-large"`なら`PDF_TOO_LARGE_MESSAGE`を例外として投げる。base64の読み込み自体が失敗した場合（本当に読めないファイル）も例外を投げる。いずれの例外も呼び出し側の`.catch()`でユーザーに表示する——**この判定・エラーの出し方は`buildPdfAttachment`という1つの入口に集約されているため、7画面（`FileAttachButton.tsx`経由の5画面＋`OkrImportModal.tsx`／`MeetingImportPanel.tsx`）全てで同じ挙動になる**（画面ごとに文言・挙動がばらつかない）。
  - このファイル自身は`pdfText`をトップレベルでimportしていない（関数本体からの動的import）ため、呼び出し側が`buildPdfAttachment`を静的importしてもpdfjs-distのダウンロードは発生しない（Section 19の「PDFを一度も添付しない人はダウンロードしない」を維持。ビルド実測で`pdfAttachment`チャンクはgzip 0.69KBの独立チャンクになり、重量級の`pdfText`チャンク（gzip 127.38KB）とは分離されたままであることを確認済み）。
- **`FileAttachButton.tsx`を更新**：PDF判定時の処理を`import("../../lib/pdfText").then(extractPdfText)`から`import("../../lib/pdfAttachment").then(buildPdfAttachment)`に差し替えた。これにより、テキスト層の無いPDF（スキャン画像等）を添付したとき、**従来は失敗アラートで終わっていたのが、v3.79からは自動的にbase64直送へフォールバックして解析を継続できる**ようになった（この画面群のユーザー体験も今回の対応で底上げされた）。
- **`OkrImportModal.tsx`／`MeetingImportPanel.tsx`を更新**：`handleFile()`内のPDF分岐を、`FileReader.readAsDataURL()`直書きから`import("../../lib/pdfAttachment").then(({ buildPdfAttachment }) => buildPdfAttachment(file))`に差し替えた。`pdfAttachment`状態（型は変更なし・`FileAttachment`）にテキスト添付またはbase64添付のどちらかが入るようになる。UI上の添付ラベル「このPDFをそのままAIに渡します」は、実際にはテキストで送られる場合とbase64で送られる場合の両方があり得るため（設計判断3：フォールバックの発動は利用者に分かる必要はない）、「このPDFを読み込みました」という経路を問わない表現に変更した。
- **AIに渡る情報の意味は経路によって変わらない（設計判断4）**：`extractOkrImportData()`（`okrImportExtractor.ts`）・`extractMeetingData()`（`meetingExtractor.ts`）はどちらも既存の`buildMessageContent(text, attachment)`（`invokeAI.ts`）を経由しており、`attachment.isText`の真偽だけでテキスト追記／documentブロックのどちらで送るかを自動判定する。呼び出し元のプロンプト組み立てコードは一切変更していない（`attachment: pdfAttachment`をそのまま渡すだけ）。
- **max_tokensは変更していない**：`okrImportExtractor.ts`は既に8192（Section 6-1c準拠）、`meetingExtractor.ts`は4096で、どちらも添付ファイルを伴うAI機能の目安（8192）の範囲内だったため変更不要と確認した。

### 意味が変わるため実装を見送った経路：無し

調査の結果、「PDFの図表そのものをAIに見せる必要がある」ため今回のテキスト抽出化に適さない経路は見つからなかった。`OkrImportModal.tsx`・`MeetingImportPanel.tsx`はどちらもKintoneの画面をPDF化したテキスト主体の資料を読ませる用途で、既存のシステムプロンプト（角括弧表記・見出し語ベースの抽出）が前提とする入力形式と一致しており、`personalOkrImportExtractor.ts`が既に同じ前提でテキスト抽出運用されている（Section 27）こととも整合する。

### フォールバックを残す理由（再掲）

山本さんに確認済みの前提は「取り込むPDFはブラウザの印刷機能で作られるためテキスト層が残る」だが、将来キャプチャ由来のPDF（テキスト層なし）が混ざる可能性があるため、抽出結果が使えない場合は黙って従来のbase64直送に落ちる安全網を残した（Kintone取込の「決定的パーサ→AIフォールバック」＝Section 24 Step Kと同じ考え方）。

### フォールバックにサイズの歯止めを設けた理由（統括レビューで追加）

フォールバックを入れたことで、`FileAttachButton.tsx`経由の5画面がこれまで出していた明確なエラー表示（alert）が黙ってbase64直送に置き換わった。歯止めが無いままだと、テキスト層の無い大きなPDFに対して「分かりやすいエラー」を「原因の分かりにくい546」に置き換えただけになってしまう。そのため`resolvePdfFallbackSource()`にファイルサイズ判定を組み込み、閾値超過時はbase64直送をせず`PDF_TOO_LARGE_MESSAGE`で明示的に失敗させるようにした（詳細は上記「実装」参照）。

### やらないこと

- `OkrImportModal.tsx`・`MeetingImportPanel.tsx`の他の機能（Word/テキスト読み込み・登録フロー等）は変更していない。
- Edge Function側（`supabase/functions/ai-consult/index.ts`）は変更していない（クライアント側の送信データを軽くするだけで解決する設計のため。Section 19 ⑦参照）。
- `max_tokens`の見直しは行っていない（上記のとおり既に基準内）。

---

## 38. スキーマ検査：関数の「本文差し替え型」＋列の「型のずれ」の検知（v3.80・2026-08-19）

Section 22・25 Phase 5・33で繰り返し既知の限界として記録していた穴（`kind:"function"`が`pg_proc`に同名関数が存在するかしか見ないため、関数の名前・引数を変えず本文だけを差し替えるマイグレーションの適用漏れを検知できない）を解消した。あわせて、2026-08-18に実際に踏んだ「列は存在するが宣言と実DBの型がずれていた」事故（`projects.owner_member_ids`）の再発防止として`kind:"column_type"`も追加した。

### 棚卸し結果：診断の「1件」から2件へ（本文差し替え型）

2026-08-17の診断は本文差し替え型を`accept_project_invite()`（`20260812_accept_invite_for_existing_member.sql`）の1件と確定していたが、今回`CREATE (OR REPLACE) FUNCTION`の再定義箇所を全マイグレーションから機械的に洗い出したところ、`guard_member_privilege_columns()`（v3.75・`20260818_harden_invite_related_rls.sql`）も同型（名前・引数不変・本文のみ差し替え）と判明し、**合計2件**が対象と確定した。他に複数回再定義されている関数（`guard_group_deletion`／`current_member_group_id`）もあったが、いずれも同じマイグレーション内でテーブル列追加等の既存kindで検知可能な変更を伴っており、対象から除外した（本文差し替えだけが唯一の変更点になっているのは上記2件のみ）。

### 追加事故：`projects.owner_member_ids`の型ドリフト

山本さんが実DBの型を確認した結果、`projects.owner_member_ids`の実DBが`uuid[]`（宣言は`20260331_add_missing_columns.sql`・`schema.sql`ともに一貫して`text[]`）のままドリフトしていたことが確定した。`projects.member_ids`／`tasks.assignee_member_ids`は宣言と実DBが一致していた（食い違いは1列のみ）。この型ずれが、2026-08-18のv3.75適用が「UNION types text and uuid cannot be matched」で2回失敗した原因だった。`supabase/migrations/20260819b_fix_owner_member_ids_type.sql`（新規・山本さんが手動適用）で`ALTER COLUMN owner_member_ids TYPE text[]`により是正した（NOT NULL・DEFAULT '{}'は明示的に再宣言。`20260818_harden_invite_related_rls.sql`の`unnest(...)::text`キャストはそのまま残す＝将来また型がずれても壊れない安全網として機能する）。`schema.sql`の該当列にドリフトと是正日のコメントを追記した。

### 実装

- **SQL側**：新規マイグレーション`supabase/migrations/20260819_add_schema_health_function_body_and_column_type_check.sql`（既存の`20260806_add_schema_health_check.sql`は書き換えず、`check_schema_health()`を`CREATE OR REPLACE`で拡張）。新kind`"function_body_contains"`は`pg_get_functiondef(p.oid)`で関数定義全文（本文含む）を取得し`position(needle IN ...)`で部分一致を判定する。新kind`"column_type"`は`information_schema.columns.udt_name`が期待値（配列は`"_text"`/`"_uuid"`等の内部表記）と一致するかを判定する。動的SQL（EXECUTE）は使わない。呼び出し権限（部署管理者・全社スーパー管理者のみ、それ以外は空配列）・`SET search_path=''`・既存kindの判定ロジックは1文字も変えていない。**適用回数を増やさないため2つのkindを1ファイルにまとめた**（山本さんの手動適用の手間を優先）。
- **TS側**：`src/lib/schema/schemaChecks.ts`に`SchemaCheckDescriptor`の新バリアント2つ（`kind:"function_body_contains"; name; needle` / `kind:"column_type"; table; column; udt`）と検査項目5件（本文差し替え型2件＋列の型3件＝`projects.owner_member_ids`／`projects.member_ids`／`tasks.assignee_member_ids`。**visible_project_member_ids()がUNIONする3列全てを登録**——1列だけ守っても次に別の列が同じ理由でずれたら同じ事故が起きるため）を追加。`src/lib/schema/checkSchemaHealth.ts`の`toCheckPayload`に対応するcaseを追加。`SchemaHealthBanner.tsx`はlabel/migrationを汎用的に表示するだけの実装のため無改修で両kindに対応済み。
- **`function_body_contains`のneedle選定方針**：変数名・コメント文言（消えやすい）ではなく、そのマイグレーションの核心的な振る舞いを表す実行文そのものを選んだ。
  - `accept_project_invite`：`v_invite.invite_group_id = ANY(COALESCE(v_existing_group_ids, '{}'::text[]))`（既存メンバーへの冪等な兼務付与判定。この式が無いとSection 25 Phase 5の冪等性要件が壊れる）。
  - `guard_member_privilege_columns`：`NEW.email := old_email;`（v3.75フェーズ4のemail保護の差し戻し文そのもの。これが無いと同一性判定キーの保護という主目的が成立しない）。
- **検証**：`src/lib/schema/__tests__/functionBodyContainsNeedles.test.ts`・`columnTypeChecks.test.ts`（いずれも新規）が、各needle/udtが「差し替え・是正前のマイグレーションファイルには存在せず、差し替え・是正後にのみ存在する」ことを実際のマイグレーションSQLテキストに対して固定する。作成時にそれぞれ一度、値を意図的に間違ったものへ差し替えてテストがredになることを確認し、正しい値に戻してgreenになることを確認した（Section 22の「わざと壊して赤くなることを確認する」記録）。

### やらないこと

- `supabase/schema.sql`は`check_schema_health`自体が元々未反映（既存ドリフト。Section 1の設計と無関係に長期間放置されている）のため、今回のスコープでは同期しない（`projects.owner_member_ids`列自体のコメント追記は別途実施済み。上記参照）。
- `task_dependencies`のRLSポリシー変更（Section 33参照）は今回のkind追加でも検知できない（「関数」ではなく「ポリシー」の中身を見る検査手段が無いため。将来別のkindが必要）。
- マイグレーションの適用は行っていない。山本さんがdev→prodの順でSupabase SQL Editorに手動適用する（3ファイルの適用順はSection 39参照）。

---

## 39. グランドルール：RLSポリシー内でSECURITY DEFINER関数を呼ぶときは`(SELECT ...)`で包む（必須・v3.80・2026-08-19）

### 実測で判明した誤り

v3.75（`20260818_harden_invite_related_rls.sql`）の「性能：`id = ANY(...)`を選んだ理由」というコメントには「membersの各行と相関を持たないため、PostgreSQLはクエリ全体で1回だけ評価するuncorrelated subplanとして実行できる」と書いたが、**これは誤りだった**。2026-08-19、山本さんが本番で招待受諾者アカウント・RLSを効かせた状態で`EXPLAIN (ANALYZE, BUFFERS)`を実測したところ：

```
Seq Scan on members  (cost=0.00..34.88 rows=21 width=279) (actual time=8.093..76.053 rows=16 loops=1)
  Filter: ((group_ids && current_member_group_ids()) OR current_member_is_super_admin()
           OR (group_ids && visible_invite_group_ids()) OR (id = ANY (visible_project_member_ids())))
  Rows Removed by Filter: 5
  Buffers: shared hit=6504
Planning Time: 48.270 ms
Execution Time: 76.085 ms
```

`members`は21行＝実体は1ページで足りるはずが、`shared hit=6504`という異常値が出た。引数無しのSTABLE/SECURITY DEFINER関数であっても、RLSポリシーのWHERE句に直接書くとPostgreSQLは**行ごとに評価する**（uncorrelated subplanにはならない）ことが実測で確定した。`20260818_harden_invite_related_rls.sql`の該当コメントは、誤りだったことと実測値・是正した版（v3.80）を追記する形で訂正した（消していない）。

### ルール

**RLSポリシーのUSING/WITH CHECK句でSECURITY DEFINER関数（引数の有無を問わない）を呼ぶときは、必ず`(SELECT 関数呼び出し())`の形で包むこと。** PostgreSQLはこの形をInitPlanとして認識し、クエリ全体で1回だけ評価してキャッシュする。Supabaseが公式にRLSの性能改善として推奨している定石（`auth.uid()`を`(SELECT auth.uid())`と書く）と同じ手法。

```sql
-- ❌ 行ごとに再評価される
USING (group_ids && current_member_group_ids() OR current_member_is_super_admin())

-- ✅ InitPlanとして1回だけ評価される（式の意味は同じ）
USING (group_ids && (SELECT current_member_group_ids()) OR (SELECT current_member_is_super_admin()))
```

### v3.80で対応した範囲（`members`のみ）

`supabase/migrations/20260819c_optimize_members_rls_initplan.sql`で`members_select`/`members_write_insert`/`members_write_update`/`members_write_delete`の4ポリシー全ての関数呼び出しを`(SELECT ...)`で包んだ（**式の意味・条項の順序・キャストは一切変えていない**）。`schema.sql`のmembersポリシー4本も同期済み。

- **v3.75で塞いだ穴は再度開けていない**：`FOR ALL`に戻していない・`WITH CHECK`を省略していない・SELECT用と書き込み用のポリシー分割を維持している。
- **書き込み系に`visible_project_member_ids()`は足していない**（元々存在しない。書き込みスコープを広げる変更はしていない）。

### 同型の問題を抱える他のポリシー（v3.80では対応しない・調査結果の記録）

`projects_group`／`tasks_group`／`task_dependencies_group`は、いずれも`current_member_group_ids()`/`current_member_is_super_admin()`をSECURITY DEFINER関数として`(SELECT ...)`で包まずに直接呼んでおり、**同型の性能問題を抱えている可能性が高い**。ただしv3.80で実測により問題を確認できたのは`members`のみのため、今回はこの3ポリシーには手を入れていない（一度に触る範囲を広げない）。実際に性能問題が顕在化した場合は、同じ`(SELECT ...)`で包む対応を個別に検討すること。

### このルールは新しいRLSポリシーを書くとき必ず確認する

- [ ] USING/WITH CHECK句でSECURITY DEFINER関数を呼んでいるか？ → `(SELECT ...)`で包んだか？
- [ ] 式の意味・条項の順序・キャストを変えていないか？（包むだけで、ロジックは1文字も変えない）
- [ ] `schema.sql`の該当ポリシーも同期したか？

---

## 40. `visible_project_member_ids()` の中身を軽くする（v3.81・2026-08-19）

`supabase/migrations/20260819d_optimize_visible_project_member_ids.sql` 参照。

### 実測で切り分けられたこと（次に性能を疑うときの手順として記録）

v3.80でmembersのRLS内の関数呼び出しを`(SELECT ...)`で包んでInitPlan化した後、本番・招待受諾者アカウントで取った`EXPLAIN (ANALYZE, BUFFERS)`は次のようになっていた：

```
InitPlan 1 (current_member_group_ids)      actual time=2.583..2.584   Buffers: shared hit=86
InitPlan 2 (current_member_is_super_admin) actual time=0.227..0.228   Buffers: shared hit=2
InitPlan 3 (visible_invite_group_ids)      actual time=5.935..5.936   Buffers: shared hit=299
InitPlan 4 (visible_project_member_ids)    actual time=53.922..53.922 Buffers: shared hit=730
Execution Time: 63.500 ms
```

**ここが今回の切り分けの要点**：InitPlan化により4つの関数はいずれも「クエリ全体で1回しか呼ばれていない」状態になっていた。にもかかわらずInitPlan 4だけ53.9ms・shared hit=730と突出していた。**呼び出し回数を1回に減らしても遅いなら、次に疑うべきは「関数の中身」である**——今回はこの理屈で`visible_project_member_ids()`本体の重さ（8ブランチ、実際に数えると7ブランチのUNION、各ブランチが独立にprojects/tasksを走査し関数を呼び直している）を犯人だと確定できた。**「1回しか呼ばれていないのに重い」という実測値の読み方**は、今後同様の性能調査でも使える手順として残す。

### 何をしたか

`current_member_group_ids()`/`current_member_is_super_admin()`をCTE（`ctx`）で1回だけ評価し、「自分がアクセスできる、削除されていないPJ」をCTE（`accessible_projects`）で1回だけ作った。オーナー系3ブランチ（`owner_member_id`／`owner_member_ids`／`member_ids`）はそのCTEから取り、tasksの走査は「project_id直接」「task_projects経由」の2系統に絞って、各系統内の単数・複数担当者は配列結合してから1回unnestする形にまとめた（旧4ブランチ→新2ブランチ）。

- 🔴 **`ctx`・`accessible_projects`の両方に`AS MATERIALIZED`が必須（統括レビューで訂正）**：実装時は`accessible_projects`（5箇所から参照）にだけ明示し、`ctx`（`accessible_projects`から1回だけ参照）には付けていなかった。しかしPostgreSQL 12以降は「参照が1回だけ」かつ「volatile関数を含まない」非再帰CTEを既定でインライン展開する。`ctx`は参照1回・中の関数もSTABLE（volatileでない）のため、この既定インライン展開の条件を完全に満たしてしまい、`MATERIALIZED`が無いとWHERE句が元の形（`p.group_ids && current_member_group_ids() OR current_member_is_super_admin()`）に戻って行ごとに関数が再評価される——v3.80で実測・確定した「関数呼び出しは`(SELECT ...)`で包まない限りInitPlan化されない」問題（Section 39）が、関数の内側でそっくり再発する構造だった。統括のレビューで指摘を受け、`ctx`にも明示的に`AS MATERIALIZED`を付けて修正した。
- **走査回数**：projectsの物理スキャン 7回→1回、tasksの物理スキャン 4回→2回、`current_member_group_ids()`/`current_member_is_super_admin()`の呼び出し 14回（7ブランチ×2関数）→各1回。
- **返る集合は1要素も変えていない**。旧7ブランチ→新実装の対応表・型キャストを結合前に行う理由（20260819bと同型の事故を防ぐため）はmigrationファイルのコメントに全文残した。
- **関数名・シグネチャ・RLSポリシー（`members_select`）は無変更**。
- `schema.sql`の同関数を同期した。
- `src/lib/schema/schemaChecks.ts`に`kind:"function_body_contains"`の検査項目を1件追加（`visible_project_member_ids_optimized_body`。needleは`accessible_projects AS MATERIALIZED`。**当初は`JOIN accessible_projects ap ON ap.id = t.project_id`を選んでいたが、統括レビューで「エイリアス名変更だけで検知が壊れる」脆さを指摘され選び直した**。単なる命名ではなく、この最適化の性能特性そのものを担うCTEディレクティブのため、これが消える＝再検証が必要な変更、という対応が取れる。旧実装（20260818時点）にはCTE自体が存在しないためこの文字列は登場しない）。
- **`projects.group_ids`のGINインデックスは存在しない**（`idx_projects_owner_member_id`／`idx_projects_status`のみ）。`accessible_projects`のWHERE句の`&&`判定に理論上効きうるが、「一度に触る範囲を広げない」方針により今回は追加していない。

### 検証の分離（結果不変性の担保）

このリポジトリのテスト環境（Vitest/Node）では実際のPostgresを起動できず、SQL関数の集合演算そのものを単体テストで検証する手段が無い（`consume_guest_ai_quota`と同型の制約。Section 22参照）。そのため、無理に形だけのテストは書かず、代わりに**migrationファイル内に旧ブランチ→新実装の対応表をコメントで明示**し、**山本さんが適用前後に同一クエリ（`visible_project_member_ids()`をソート済み配列で比較）を実行して完全一致を確認する監査手順**をmigration末尾に用意した。

### やらないこと

- `projects.group_ids`へのGINインデックス追加（見立てのみ報告。Section本文参照）。
- `task_dependencies`のRLSポリシー・`projects_group`／`tasks_group`／`task_dependencies_group`のInitPlan化（Section 39で「対応しない」と記録済みの範囲。スコープ外のまま）。
- マイグレーションの適用は行っていない。山本さんが手動適用する。

---

## 41. サイドバーの「表示部署」をリロード後も維持する（v3.82・2026-08-19）

山本さんの依頼：「リロードしたときには、リロード前の表示部署が表示されるようにしてほしい」。従来は`App.tsx`の`autoMatch()`が無条件に`setCurrentGroupId(member.group_id ?? null)`＝ホーム部署を設定し、`MainLayout.tsx`の切替UI（`handleSelectGroupNav`）は`setCurrentGroupId(id)`を呼ぶだけでどこにも保存していなかったため、リロードすると必ずホーム部署に戻っていた。

### 保存先・キー

localStorage。`src/lib/localData/localStore.ts`の`LS_KEY.sidebarCurrentGroup(memberId)`（`consultationHistory`等と同じ「エンティティIDごとの動的キー」の流儀）。**メンバーIDごとに保存する**——同じブラウザを別アカウントで使ったときに前の人の選択を引き継がないため。

### 🔴 復元前に必ず妥当性を検証する（ホーム部署へのフォールバックが必要な理由）

保存されている部署に**今もアクセスできる場合だけ**復元し、そうでなければホーム部署（`member.group_id`）にフォールバックする。**理由**：兼務が外れた後・部署が削除された後にその部署をそのまま復元しようとすると、`currentGroupId`の対応先が存在しなくなり、選択肢に無い部署がセットされたまま何も見えない画面になる（メンバー一覧・PJ一覧等が`currentGroupId`基準で絞り込まれるため。Section 1.6参照）。ホーム部署は必ずアクセス可能なため、安全側のフォールバック先として機能する。

判定を担う純粋関数`resolveRestoredCurrentGroupId(storedGroupId, homeGroupId, accessibleGroupIds)`（`src/lib/layout/sidebarCurrentGroupRestore.ts`）は「保存値が`accessibleGroupIds`に含まれていればそれを復元し、含まれていなければホーム部署を返す」の1行で完結する。

### 🔴 「アクセスできる」の判定基準は切替UIと完全に一致させる（個別分岐を書かない）

全社スーパー管理者は`group_ids`に含まれない部署も表示できる（Section 1.6）ため、一般メンバーとは判定基準が異なる。招待受諾者は招待用部署（`is_invite_group=true`）しか持たない特殊ケース（Section 25 Phase 4）。この2つを個別に分岐するのではなく、**サイドバーの切替UIが実際に選択肢として出しているリストの組み立てロジックそのものを1関数に共通化**した：`computeAccessibleGroupsForSidebar(groups, member, isSuperAdmin)`（`src/lib/projectInvite/sidebarGroupVisibility.ts`。`filterInviteGroupsForSidebar()`と同じファイル）。`MainLayout.tsx`の`accessibleGroups`useMemoと、`App.tsx`の復元ロジックの両方がこの1関数を呼ぶ。判定基準がずれると、切替UIには出ない部署をリロード後に復元してしまい、UIから戻す手段が無い状態になる（招待用部署の除外・その除外が空になる場合のフォールバック＝Section 25 Phase 4の一般則をそのまま継承）。

### `App.tsx`の2つの経路（①Auth email一致・②localStorageの前回ユーザー）

`autoMatch()`には2つの経路があるが、**どちらにも同じ復元ロジックを適用した**（`resolveGroupIdForLogin(member)`という同一の内部関数を両方の分岐から呼ぶ）。リロード時にどちらの経路でマッチするかは環境依存（`members.email`が設定されているかどうか）で決まり、利用者から見れば同じ「リロード」という操作のため、経路によって表示部署の維持有無が変わると混乱を招く。

### 全社スーパー管理者・招待受諾者の扱い

- 全社スーパー管理者：`computeAccessibleGroupsForSidebar`が`isSuperAdmin=true`のときは`member.group_ids`を見ず、削除されていない全部署（招待用部署を除く）を返す。保存値がこの中に含まれていれば復元される。
- 招待受諾者：ホーム部署自体が招待用部署であり、`accessibleGroupIds`も招待用部署1件のみ（`filterInviteGroupsForSidebar`の「除外すると空になるなら諦める」一般則）。保存値とホーム部署が一致するため、復元・フォールバックのどちらに転んでも同じ値になり実害が無い。

### ゲストは対象外

ゲスト（サンプル閲覧）モードは`App.tsx`の別経路（`loadDemoData`）で`currentGroupId`を`DEMO_GROUP_ID`に設定するだけで、`AuthenticatedApp`/`autoMatch()`を一切経由しない（Section 23）。保存側（`MainLayout.tsx`の`handleSelectGroupNav`）も`isGuest`で明示的にガードし、ゲストの選択を保存しない・保存された値をゲストへ復元しない。

### テスト・機械チェックへの影響

- `src/lib/layout/__tests__/sidebarCurrentGroupRestore.test.ts`（新規）：保存値なし／保存値が有効／保存値が無効（アクセス不可・削除済み）／ホーム部署がnullのケースを検証。
- `src/lib/projectInvite/__tests__/sidebarGroupVisibility.test.ts`に`computeAccessibleGroupsForSidebar`のテストを追加（非super-admin・招待受諾者・super-adminの3パターン）。
- `loadStoredSidebarGroupId`/`saveSidebarGroupId`はlocalStorage依存のため（vitest.config.tsが`environment:"node"`。`chunkSizeGate.ts`と同じ制約）、純粋関数部分のみをテスト対象にしている。

### DBスキーマ変更なし

localStorageのみの変更のため、マイグレーション・`schemaChecks.ts`への追記は不要。

---

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

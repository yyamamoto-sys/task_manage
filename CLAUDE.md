# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v3.36
#
最終更新：2026-08-07（v3.36）

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
- Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要
- Claude APIへのデータ送信について社内ポリシーとの整合性確認が必要
- Teams埋め込みアプリとしての申請手続き確認が必要

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
  | "okr-import";          // Kintone OKR(PDF/テキスト)からObjective/KR/TF構造を抽出
```

新しい AI 機能を追加するときは、この型に新タグを追加し、当該 prompt builder に
「何のデータを渡しているか」をコメントで明示すること（漏洩防止というより可読性・記録のため）。
タグなしの呼び出しはコンパイルエラー。

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
// risk・no_tasks・deadline_risk → appendTaskComment（2ステップSELECT+UPDATE）
//   supabase.rpc()は使わない。アプリ側で追記ロジックを実装する。
//
// scope_reduce・pause → 論理削除（is_deleted=true）
//
// milestone → 現在未対応。errorを返す。
//   マイルストーンテーブルの設計完了後にneeds_confirmationに変更する。
```

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
| 管理画面 | ✅ 実装済み | カテゴリ分け左ナビ（v2.63）＋件数サマリー行・モダンCard体裁（v2.64）：作業設定（PJ/TF/Objective・KR）／人（メンバー/メンバータグ）／組織（グループ・部署）／レポート（AI使用量）。部署管理者・全社スーパー管理者が編集可。アクセス可能な部署が2つ以上のユーザーには部署絞り込みセレクタ（設定画面ローカル）を表示、メンバー/PJ/タグ/AI使用量を選択部署で絞り込む（v2.86）。メンバー・PJ・TFの「＋追加」はマイルストーン追加と同じポップアップモーダル形式（v2.86） |
| OKR PDF取込（`OkrImportModal`） | ✅ 実装済み（v2.92） | 設定画面「Objective・KR」タブの「📄 PDFから取込」ボタンから起動。KintoneのOKR画面PDF/テキストをAIが解析しObjective/KR/TFを構造抽出→人が確認・編集（担当リーダーの自動突合含む）→登録。二重登録防止のため登録先（新しい期のObjectiveとして作成／既存Objectiveに追記）を選択可 |
| ダッシュボード | ✅ 実装済み | OKR進捗・今週タスク・アラート・フィルター付き |
| カンバンビュー | ✅ 実装済み | ドラッグ&ドロップ対応。タスク追加はFABに一本化（右上ボタンは廃止） |
| ガントビュー | ✅ 実装済み | PJ別・人別の2ビューモード。PJバー・マイルストーン・今日線・トグル開閉 |
| リストビュー | ✅ 実装済み | 列カスタマイズ・サイドパネル・エクスポート |
| タスク追加FAB | ✅ 実装済み | 全画面共通・右下固定。TF・ToDo・PJ・担当者・開始日・期日・メモを設定可。最上位作成時は子タスクを一括追加可 |
| PJ作成モーダル | ✅ 実装済み | 単一ステップフォーム。作成方法トグル（まっさらな新規作成／他PJから引き継ぐ）で、過去含む他PJのタスクをチェックボックス選択して新PJに引き継ぐことも可能（v2.83） |
| タスク編集モーダル | ✅ 実装済み | ToDo紐づけフィールド含む |
| AIに変更を相談パネル | ✅ 実装済み | マルチターン・5モード・確認ダイアログ |
| ConfirmationDialogModal | ✅ 実装済み | date_change/assignee確認用 |
| ツアー機能 | ✅ 実装済み | ⚠ 位置指定をpx固定→要素基準に修正が必要（技術的負債） |
| グラフビュー（ラボ機能） | ✅ 実装済み | Canvas+カスタム物理シミュレーション。サイドバーのラボセクションから起動 |
| OKRモード クォーター計画タブ（ラボ機能） | ✅ 実装済み | 翌クォーターのTF計画をAI対話で立案。localStorage保存（Phase 1）。OkrDashboardView「📅 計画」タブ |
| KRセッション freeform モード | ✅ 実装済み（v2.4） | 戦略会議・四半期計画など OKR/TF が議題中心の自由形式会議用。AI が「議論サマリ・決定事項・言及KR・フォローアップ」を抽出して対象 KR にぶら下げ保存。`kr_sessions.session_type='freeform'` + `summary`/`decisions`/`kr_mentions` 列 |
| ローディングのヒント設定（`LoadingTipsSection`） | ✅ 実装済み（v3.13） | 設定画面の新カテゴリ「アプリ設定」→「ローディングのヒント」。全社スーパー管理者のみ。ローディング画面（データ読み込み中）に出す操作テクニックの一覧・並べ替え・編集・削除・追加。`loading_tips` テーブル（全社共通・group_idなし） |
| マイページ（ラボ機能） | ✅ Phase 1（MVP・v3.15）＋Phase 2（configSchema駆動フォーム・v3.16）＋Phase 3（ウィジェット作成仕様書・v3.17）実装済み | サイドバー「🧪 ラボ」から「🧩 マイページ」で開く全画面オーバーレイ。自分専用のウィジェット画面（📌今週のタスク／🔥期限超過・滞留／👥自分の負荷／📊締切の見通し／📈完了ペース／📝メモ／⭐ピン留めプロジェクト／🕒最近更新されたタスク／⏳先行待ちのタスク／➕クイックタスク追加の10種）を追加・削除・並べ替え・サイズ変更できる。設定を持つウィジェットは編集モードの⚙からconfigSchema駆動の設定フォームを開ける。クイックタスク追加はホスト経由でappStore choke pointを通す書き込みアクションの実例。レイアウトは`member_widget_layouts`テーブル（本人のみRLS）に永続化。設計の経緯は`docs/dev/mypage-widgets-design.md`、自作ウィジェットの作り方は`docs/dev/widget-authoring.md`（Section 14.6参照） |

### UI/UX仕様（2026年4月確定）

- **フォント**: M PLUS Rounded 1c（Google Fonts）+ 日本語フォールバックスタック
- **カラー**: すべて `var(--color-*)` CSS変数で管理。ハードコード禁止
- **角丸**: `--radius-sm: 6px` / `--radius-md: 10px` / `--radius-lg: 16px`
- **テキストエリア**: `field-sizing: content` で自動伸縮（Chrome 123+ / Firefox 128+ / Safari 17.4+）
- **フォントサイズ切り替え**: 管理画面に小/中/大（zoom: 0.85/1/1.15）を実装
- **TFアクションボタン**: ToDo・Q移動・編集・解除を2×2グリッドに配置
- **四半期自動判定**: 現在日付から自動的に現在のQを選択（1〜3月=1Q、4〜6月=2Q等）

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
- **リリース時、DBスキーマに変更を伴うマイグレーションを追加した場合は `src/lib/schema/schemaChecks.ts` に検査項目を1行足すこと**（2026-08-06・v3.26で追加。Section 22参照）。マイグレSQLを書いて終わりにせず、この配列への追記までがワンセット。
- 最終更新：2026-08-07（v3.32）

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
│       └── quarterPlanStore.ts   # クォーター計画保存（Phase 1: localStorage、Supabase移行準備済み）
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

---

## 20. グランドルール：全画面ラボ系ビューは position:fixed を使わずメインエリア内に収める（必須・v3.23、v3.33で方式を全面変更、v3.34で単一state化、v3.35でchoke point化）

### 用語（今後この2語で呼び分ける）

- **サイドバー**：左のメニュー領域（`MainLayout.tsx` の `Sidebar` コンポーネント。展開時196px／折りたたみ時48px／モバイルでは非表示）。幅は `SIDEBAR_WIDTH_EXPANDED`/`SIDEBAR_WIDTH_COLLAPSED` 定数で一元管理する（Sidebar自身の width にのみ使う）。
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

**対策**：真偽値を並べる方式をやめ、`LabViewId`（`"graph" | "calendar" | "structure" | "mypage" | "kr-report" | "kr-why" | "kr-session"`）1つを保持する単一state `activeLabView: LabViewId | null` に一本化した。ラボ機能を開く操作は必ず `setActiveLabView("<id>")` の1行で、前に開いていたものは自動的に閉じる——**2つ同時に開くこと自体が型レベルで不可能**になるのがこの設計の要。`closeLabViews()` は `setActiveLabView(null)` の1行になった。

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

## 21. グランドルール：中央寄せモーダルは必ず画面内に収まる高さ上限を持つ（必須・v3.24）

**2026-08-06に発生した実際の不具合**：`ProjectCreateModal`（「過去のPJから新規PJを作る」）で、引き継ぎ元PJのタスク一覧が伸びるとモーダルが画面の上下を突き抜け、保存ボタンに到達できずPJを作成できなくなった。原因は「箱（モーダル本体）に `maxHeight` が無く、コンテンツの高さまで無制限に伸びていた」こと。オーバーレイにも `overflow` の指定が無かったため、はみ出した部分に到達する手段が無かった。

### 契約（`src/components/common/modalStyles.ts` に集約）

- **オーバーレイ**（背景の暗幕）：`modalOverlayStyle(zIndex)` を使う。`position:fixed; inset:0` で画面いっぱいに広げ、`display:flex; alignItems:center; justifyContent:center` で中央寄せし、`overflow:"auto"` を保険として持つ（箱が想定外に大きくなっても背景側をスクロールして到達できるようにするため）。
- **箱**（モーダル本体）：`modalBoxStyle(width)` を使う。**`maxHeight:"100%"`** で、オーバーレイの padding を除いた内側＝ビューポート内に必ず収まるようにする。`display:flex; flexDirection:column; overflow:"hidden"` で、内側の本文だけにスクロールを担わせる。
- **本文**（ヘッダー・フッターに挟まれるスクロール領域）：`MODAL_BODY_STYLE`（`flex:1; minHeight:0; overflowY:"auto"`）を使う。**`minHeight:0` は必須。** フレックス子要素の既定 `min-height:auto` のせいで、箱の高さが制約されても本文が縮まずスクロールが発生しない、という典型的な罠がある。
- **フッター**（保存・キャンセル等の操作ボタン行）：`MODAL_FOOTER_STYLE`（`flexShrink:0`）を使う。コンテンツがどれだけ長くても、操作ボタンが押し縮められず常に見える状態を保つ。
- 背景の濃さ・角丸・padding・幅などの個別事情は、これらの spread の**後**に上書きしてよい（例：`{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }`）。

### このルールは新しいモーダル・ポップアップを追加するとき必ず確認する

- [ ] `modalStyles.ts` の共有スタイルを使っているか？（新規実装で毎回コピペし直すと必ずどこかで漏れる）
- [ ] 箱に `maxHeight` が付いているか？（無いとコンテンツの高さまで無制限に伸びて画面外に突き抜ける）
- [ ] 本文に `minHeight:0` が付いているか？（無いとフレックスの既定 `min-height:auto` でスクロールしなくなる）
- [ ] 保存・キャンセル等の操作ボタンはフッターに置き `flexShrink:0` にしているか？

### 対象外

- **横からのドロワー・サイドパネル**（AI相談・`TaskSidePanel`・`MemberDetailPanel`・OKRラボの右ドロワー3つ等）。画面の高さいっぱいに出るのが正しい設計で、この契約の対象ではない。
- Section 20 の全画面ラボビュー（体制図・カレンダー・マイページ・関係性グラフ）も対象外（別の契約＝position:fixedを使わずメインエリア内にflexで収める、に従う）。
- **モーダルはサイドバーを避けない**（Section 20 とは別の話。モーダルは画面中央のままでよい）。

### 機械チェック

`src/components/common/__tests__/modalStyles.test.ts` が、`position:"fixed"` かつ `inset:0` で中央寄せ（`alignItems:"center"` + `justifyContent:"center"`）しているオーバーレイを持つ全 `.tsx` ファイルを検出し、`modalStyles.ts` を import しているか自前で `maxHeight` を持っているかを機械的に検査する（widgetContract.test.ts と同じソース走査方式）。ドロワー・サイドパネル等は明示的な除外リスト（`EXCLUDED_FILES`）に理由付きで列挙してある（v3.33：全画面ラボビュー4ファイルは `position:fixed` を一切使わなくなり検出パターンにそもそも一致しなくなったため除外リストから外した。将来の逆行を見逃さないための対応）。

---

## 22. グランドルール：マイグレーション追加時は検査項目も1行足す（必須・v3.26）

### 2026-08-06に実際に起きた事故

`20260721_add_task_status_hold_cancelled.sql`（v2.74・2026-07-21適用予定だったマイグレ）が本番に未適用のまま**約2週間気づかれず**、タスクのステータスに「保留」「中止」を選ぶと保存に失敗する不具合が、タスク編集モーダル・カンバン・リスト・ガント・AI提案の反映の**全経路**で発生し続けた。コード側は正しく `on_hold` を送っていたが、DB側の `tasks.status` CHECK 制約が3値のままだったために起きた。マイグレの適用が手作業でコードだけ先に本番へ出るため、適用漏れが「機能が静かに壊れたまま」残る構造になっている。

### 仕組み（起動時に管理者だけが検知する）

```
起動時（管理者のみ・1回）→ RPC（check_schema_health）でスキーマ検査 → 欠けていたら管理者にだけ控えめな警告バナー
```

- **検査項目は `src/lib/schema/schemaChecks.ts` に宣言的な配列として持つ**（SQL側にハードコードしない）。理由：SQL側に埋め込むと項目を追加するたびに新しいマイグレーションが必要になり、この仕組み自体が必ず形骸化する。TS側の配列に1行足すだけで済むようにしてある。
- 各項目は `{ kind, table/column/needle/name, label, migration }` の形（`kind` は `"table"` / `"column"` / `"check_contains"` / `"function"`）。`migration` は該当マイグレファイル名で、実在することを `src/lib/schema/__tests__/schemaChecks.test.ts` が機械的に検査する（存在しないファイル名を書くとテストが落ちる）。
- 実際の問い合わせは汎用RPC `check_schema_health(p_checks jsonb)`（`supabase/migrations/20260806_add_schema_health_check.sql`）。**動的SQL（EXECUTE）は使わず**、`pg_catalog`/`information_schema` へのパラメータ化された参照だけで判定する。呼び出せるのは部署管理者・全社スーパー管理者のみ（それ以外は例外ではなく静かに空配列を返す）。
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

---

## 24. 個人OKR層（OKRモード再設計 Phase 1 Step A・v3.36で新設）

**正本は [docs/dev/okr-redesign-plan.md](docs/dev/okr-redesign-plan.md)。** このセクションは要点だけを薄く残す（Section 11のルール）。詳細（列定義・段階計画・未決事項）は必ず計画書を読むこと。

- **一行で言うと**：Kintoneが正本。このアプリはKintoneに存在しない「週の層」を埋める実行層。個人四半期KR・月次計画の**編集・評価確定**はKintone側のまま変えない。
- **今回（Step A）追加した5テーブル**：`personal_krs`（個人四半期KR）／`personal_kr_months`（個人月次計画）／`personal_kr_weeks`（★週の目標状態。アプリだけが持つ層）／`personal_kr_week_tasks`（週とタスクの紐づけ）／`personal_kr_memos`（KRごとのメモ）。`migrations/20260807b_add_personal_okr.sql` 参照（**山本さんの手動適用が必要。未適用**）。
- **RLSは本人のみ**（`member_widget_layouts` と同じ流儀）。`personal_krs`/`personal_kr_memos` 以外の3テーブルは列にmember_idを持たせず、`personal_kr_owner_member_id()`/`personal_kr_week_owner_member_id()`（SECURITY DEFINER・親を辿るヘルパー関数）で判定する。判断理由はマイグレーションファイル冒頭コメント参照（20260723の「親を辿るポリシー」先例に近い＝単一所有者・低ホップ数・少量データのため）。
- **週の区切りは既存のカレンダー週ロジックを共有する**（二度書かない）。`src/components/gantt/ganttUtils.ts`（v3.09）から純粋な「月→週セグメント」部分を `src/lib/date/monthWeeks.ts`（`calendarWeekNumber`/`computeMonthWeekSegments`）へ抽出し、ganttUtils.ts はそこから import する。ガントの座標計算・挙動は一切変えていない。
- **状態管理**：`src/lib/supabase/personalOkrStore.ts`（低レベルCRUD・flat関数群）を新設したが、`appStore.ts`（zustand・全アプリデータの単一真実）には一切組み込んでいない。OKRモードを開かない人にこのテーブル群へのクエリを発生させないため（Section 19）。個人OKRビュー（Step B以降）は専用の読み込み経路から呼ぶこと。
- **画面は未実装**（Step B以降）。Kintone取込・AI解析・`personal_kr_outlooks`・`okr_knowledge_docs` は対象外（Phase 2・3・5）。

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

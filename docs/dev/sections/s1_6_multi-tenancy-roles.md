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
- `current_member_is_admin()` — どこかの部署の管理者か（部署を区別しない。招待条項・スキーマ検査・ガードのゲスト分岐だけで使う）
- `current_member_admin_group_id()` — 管理者として扱う部署＝ホーム部署（管理者でなければ NULL）。**members・groups の書き込み判定はこちら**（v3.137・Section 70）
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

- 全社スーパー管理者は他人の行を含めて変更可。部署管理者は**対象行のホーム部署が自分のホーム部署のとき**だけ `is_admin`・`email`・論理削除を変更可（v3.137・Section 70）。`group_id`（部署の異動）は全社スーパー管理者のみ
- **ブートストラップ猶予**：company-wide に `is_super_admin=true` が1人もいない間は、自分自身の行に限り自己昇格を許可（他人の代理昇格は不可）。同様に、対象部署に `is_admin=true` が1人もいない間は、その部署内で `is_admin` の自己昇格を許可（`group_id` が NULL の行・招待用部署は対象外）
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

`members`/`projects`/`tasks`に`group_ids text[]`（アクセス可能な部署の全リスト）を新設。既存の`group_id`（ホーム部署）は不変・並存する。RLSは`group_id = current_member_group_id()`（単一値比較）から`group_ids && current_member_group_ids()`（配列オーバーラップ）に置き換え済み（super-admin全部署アクセスの条項は維持）。`tasks.group_ids`はアプリから直接編集させずDBトリガー（`sync_task_group_ids`）が唯一の真実（プロジェクト紐づきはPJのgroup_idsを継承・独立タスクはホーム部署のみ）。`group_ids`の直接付与・剥奪はsuper-admin限定（`guard_member_privilege_columns`拡張）。設計時にスコープ外とした項目：`is_admin`（部署管理権限）の複数部署対応（ホーム部署のみのまま）／スタンドアロンタスクへの部署複数選択 UI／期限通知の複数部署対応（旧 Teams 通知は元から全社無フィルタの設計。v3.136 で撤去済み）。OKR コア階層の部署分離は後続のv3.03（`20260724_scope_okr_core_tables.sql`）で行った。
ロールアウトの順序（ステージング環境が無いため段階を分けた）：①マイグレーション適用→②バックフィル検証クエリで0件確認→③フロント未デプロイのまま既存挙動を確認→④フロント push→⑤単一部署のメンバーで非破壊確認→⑥super-admin で実際に2部署アクセスを確認→⑦対象者へ付与。**DB トリガーのロジックは JS で二重実装してテストしない**（実物とずれるため）。SQL Editor の手動確認クエリで実物を直接検証する。
設計時の落とし穴：クライアント側のセレクタ（`selectScopedTasks` 等）が `group_id` の単一値比較のままだと、RLS で2部署目を許可しても UI から消える。RLS とクライアントのフィルタは必ずセットで直す。
**フロントエンド対応の現状（v3.139で改訂）**：`Member.group_ids`/`Project.group_ids`/`Task.group_ids`（`lib/localData/types.ts`。`Task.group_ids`はv3.139で型に追加＝DBトリガー`sync_task_group_ids`が唯一の真実で、`select("*")`により以前から読み込まれていた）。AdminView.tsxの部署絞り込み（本セクション末尾の設定画面部署絞り込み参照）は従来どおり。`currentUserIsSuperAdmin` state（`appStore.ts`）は`App.tsx`の`autoMatch()`でログイン時に`members.is_super_admin`から設定する。**`selectScopedTasks`/`selectScopedProjects`/`selectScopedTaskDependencies`/`selectScopedMembers`は、super-admin・一般・兼務者の全員について、サイドバーの「表示部署」（`currentGroupId`）で絞る**（v3.139・Section 71）。PJ・タスクは「`group_ids`に表示部署を含む、または`group_id`一致、または`group_id==null`」、メンバーは「削除済みでなく`group_id`一致または`group_ids`に含む」、依存は「両端が絞り込み後のタスクに含まれるもの」（`task_dependencies.group_id`単数では判定しない）。判定は`src/lib/scope/displayGroupScope.ts`。`currentGroupId`が null（ログイン直後の未確定）の間は元配列をそのまま返す。**本人が属する招待用部署を group_ids に持つPJ・タスクは、表示部署に関わらず通す（v3.140。`isRowInUserInviteGroups`・`appStore.currentUserGroupIds`）。**メモ化は入力（元配列・`currentGroupId`）の参照で行い、無関係な`set()`では同じ配列を返す（React #185 の教訓。Section 1.5）。サイドバー（`MainLayout.tsx`）の「表示部署」切替UI（アクセス可能な部署が2件以上のときだけ表示）で`currentGroupId`を切り替えると、PJ・タスクの一覧と担当者の候補がその部署のものに切り替わる（新規作成時の所属部署もこの値）。**「1メンバー/1PJに複数部署を明示的に付与するUI」はまだ無い**（新規作成は常に単一のホーム部署=group_idのみで作成され、DBトリガーがgroup_idsへ自動反映する形）。〔旧：v2.91〜v3.138は「非super-adminは一切絞らない」割り切りだった（兼務2部署目がUIから消えるのを避けるため）。v3.75でmembersの可視範囲がPJ参加者全員へ広がり、他部署の人が候補に出るようになったため撤回した。〕

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

## v3.186 の追記：SetupWizard（初回セットアップ）

登録対象は「表示名と略称の両方が入った行」（`components/auth/setupWizardRun.ts` の `pickSetupMembers`。画面の警告・「あなた」の印・次へ進む条件・完了処理で同じ基準）。完了処理は `runSetup`：ブートストラップ（members が0件のときだけ通る）の成功済み部署IDと登録済みメンバーを覚え、途中で失敗した再試行では済んだ分をやり直さない。`bootstrap_first_group_and_member` を2回呼ぶ経路を作らない。テスト＝`setupWizardRun.test.ts`。

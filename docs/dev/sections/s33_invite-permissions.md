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

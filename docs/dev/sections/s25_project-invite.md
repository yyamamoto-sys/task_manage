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

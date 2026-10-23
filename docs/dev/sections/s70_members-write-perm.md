## 70. members の書き込み権限：本人とホーム部署の管理者だけ（v3.137・2026-10-07）

**正本は `supabase/migrations/20261007c_tighten_member_writes.sql` 冒頭のコメント。** 検証は `docs/dev/verify_20261007c_member_writes.sql`。

### 何が問題だったか

members の UPDATE／INSERT／DELETE が `group_ids && current_member_group_ids()` OR super_admin OR（招待用部署 AND 管理者）だったため、
①同じ部署の一般メンバーが他人の表示名・略称・色・teams_account・notify_pref を書き換え・追加・物理削除できた（特権列はトリガーが守るが、それ以外は守られない）。
②`current_member_is_admin()` は部署を見ないため、兼務管理者が兼務先でも管理者として振る舞えた。

### 決定（山本さん・2026-10-07）

1. 他人の行の更新・追加・削除は、**その人のホーム部署（`members.group_id`）の管理者**と super_admin だけ。一般メンバーは自分の行（`email = auth.email()`）だけ更新できる。
2. 管理者の権限はホーム部署だけに効く。兼務先では一般メンバー扱い。**招待用部署の管理の扱いは変えない。**

### 判定（DB が強制。画面は写しにすぎない）

| 操作 | 許可される人 |
|---|---|
| 自分の行の UPDATE | 本人（`email = auth.email() AND is_deleted = false`。WITH CHECK も email で見る＝一般メンバーは自分の email を変えられない） |
| 他人の行の UPDATE／INSERT／DELETE | super_admin／対象行の `group_id` = `current_member_admin_group_id()`／対象行の `group_id` が「見えている招待用部署」でどこかの管理者 |
| `is_admin`・`email`・論理削除の変更（トリガー） | 上と同じ範囲（`v_can_manage`）。`is_admin` は管理者不在の通常部署なら本人の自己昇格も可（`group_id` が NULL の行は不可） |
| `group_id`（部署の異動）の変更（トリガー） | super_admin のみ |
| groups の改名 | super_admin／ホーム部署の管理者（意味は従来どおり） |

- **部署の異動**：「旧部署と新部署の両方の管理者」を要求する。管理者のホーム部署は1つなので実質 super_admin だけ。片側の管理者だけで移せると、押し付け・引き抜きが一方的にできるため。
- **招待条項**は「対象行のホーム部署が `visible_invite_group_ids()` に含まれる」に絞った（`@> ARRAY[group_id]`）。旧条項は `group_ids` の重なりで判定しており、招待を受けて兼務している別部署の通常メンバーまで、無関係な部署の管理者が触れた。ゲスト（ホーム部署が招待用部署）の扱いは同じ。`visible_invite_group_ids()` 自体（兼務先のPJ経由で見える招待用部署も含む）は変えていない。
- **初回セットアップ・招待の RPC**（`bootstrap_first_group_and_member`・`create_project_invite`・`accept_project_invite`）は SECURITY DEFINER（所有者 postgres は RLS を迂回）なので影響しない。ガードの自己ブートストラップ分岐も変えていない。
- **App.tsx の email 自動補完**は、本人を email で特定できない行が対象のため、旧来から RLS で0件更新になっていた（本番の該当行は0件）。

### 画面（`src/lib/admin/memberPermission.ts`）

AdminView のメンバー一覧は、表示中の部署を管理できるとき（`canAdministerGroup`）だけ「＋追加」を出し、✏ は自分の行か管理できる行（`canEditMemberRow`）、削除は管理できる他人の行（`canDeleteMember`）だけに出す。ホーム部署の選択は super_admin だけ（`canChangeHomeGroup`）。部署タブの改名・削除の判定も `canAdministerGroup` に揃えた。

🔴 **members を書き込む新しい画面・RPC を足すときは、この表に合うかを確かめること。** 画面で判定を足すときは `memberPermission.ts` の関数を使い、`currentUser.is_admin` を部署に関係なく見ない。

---

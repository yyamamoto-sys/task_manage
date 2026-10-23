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

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

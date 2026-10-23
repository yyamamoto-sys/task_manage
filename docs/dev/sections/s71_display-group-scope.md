## 71. メンバー・PJ・タスクの表示と担当者の候補を「表示部署」単位に絞る（v3.139・2026-10-08）

### 何が問題だったか

サイドメニューからPJを作成すると、オーナー候補に他部署の人が出た。`ProjectCreateModal` がストアの全メンバーを素で使っていた。
v3.75 で members の RLS に `visible_project_member_ids()`（アクセスできるPJの参加者全員）を足したため、部署をまたぐPJがあると他部署の人がストアに載る。
同じ使い方の画面が多数あった。

### 決定（山本さん・2026-10-08）

1. **PJ・タスク・依存・メンバーの一覧は、super-admin・一般・兼務者の全員について表示部署（`currentGroupId`）で絞る。** 判定は Section 1.6。
   v2.91 の「非super-adminは RLS が絞っているので一切絞らない」割り切りは撤回した。**兼務者は表示部署を切り替えると、その部署のPJ・タスク・メンバーに切り替わる**（両方の部署を一度に見る画面はない）。
   部署をまたぐPJは属する各部署で表示される。招待受諾者は表示部署が招待用部署なので、招待されたPJが見える。
2. **担当者の候補 ＝ 表示部署のメンバー ＋〔既存PJのタスクなら〕そのPJの参加者 ＋ 今の担当者。** 削除済みは出さない。
   PJ参加者の定義は `visible_project_member_ids()`／`ProjectSettingsModal` の「関わるメンバー」と同じ：オーナー（`owner_member_id(s)`）／`projects.member_ids`／
   そのPJのタスク（`project_id` 直接＋`task_projects` 経由）の担当者／PJの `group_ids` のうち招待用部署（`is_invite_group=true`）に属する人。
   今の担当者を残すのは、他部署の人が既に担当しているときに選択状態が壊れないようにするため。
3. **PJの新規作成（オーナー・他PJから引き継ぐメンバー）と、既存PJのオーナー追加は、表示部署のメンバーだけ。**

### 候補と名前の解決を分ける（🔴 ここを取り違えると「未担当」に見える）

- **候補一覧**（ピッカー・チェックボックス・ドロップダウン・絞り込みの選択肢・メンション候補・PJの外から足す候補）は、`selectScopedMembers`
  か `src/lib/members/assigneeCandidates.ts`（`buildAssigneeCandidates`／`projectParticipantIds`／`participantIdsOfProjects`／`sharedProjectId`）・
  `src/hooks/useAssigneeCandidates.ts` から作る。担当者ピッカーは必ず後者（`InlineEditAssignee` は `projectId` を受け取り、開いたときだけ計算する）。
- **名前の解決**（id→表示名・アバター・担当者チップ・変更履歴・AIに渡す「このPJの関係者」の名前）は、ストアの全メンバーを使う。
  表示部署のメンバーで引くと、既に担当している他部署の人が空欄・「メンバー」になる。
- 人別にまとめる表示（ガントの人別ビュー・リストの担当者別）は、表示中のタスクの担当者だけが行になるため全メンバーのまま
  （表示部署のメンバーに絞ると、他部署の担当者のタスクが一覧から消える）。ワークロードの行は従来どおり表示部署のメンバー。
- AIに渡す「部署メンバー一覧」は表示部署のまま（2026-07-03の越境送信の教訓）。AIの担当者名の照合（`applyProposal`）も候補と同じ範囲で行う
  （全件で引くと、他部署の同じ略称の人が担当に入りうる）。
- 通知の監視（`useMentionNotifications`）は一覧ではないので、表示部署に関係なく全タスクを見る。

### 機械チェック

`src/components/__tests__/rawMembersUsage.test.ts` が、ストアの全メンバーを素で読む箇所（全メンバーを返すセレクタでの購読と `getState()` からの読み取り）を
構文木でファイルごとに数え、許可リスト（理由付き）と完全一致することを検査する。**新しく増やすと落ちる**：候補一覧なら上の関数に直し、名前解決なら理由を書いて許可リストに足す。
構文木で数えるのでコメントは数に入らない（Section 59 の無力化は起きない。わざと1行足すと赤・同じ行をコメントにすると緑を確認済み）。
限界：ローカル変数に入れたストアの state から読む形（`const s = useAppStore.getState(); s.members`）は数えない。

### 対象外

AdminView 配下（Section 36・`memberInGroupUsage.test.ts`）、設定のプロフィール・通知、`UserSelectScreen`、`App.tsx` の `autoMatch`、OKR系（`deptScope.ts`）。
DB・RLS は変更していない（マイグレーションなし）。

---

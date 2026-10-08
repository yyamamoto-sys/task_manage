// src/components/__tests__/rawMembersUsage.test.ts
//
// v3.139（CLAUDE.md Section 71）：担当者などの候補一覧は「表示部署のメンバー」（selectScopedMembers）か
// 担当者候補（lib/members/assigneeCandidates.ts・hooks/useAssigneeCandidates.ts）から作る。
// 全メンバー（RLS で見えている全員＝部署をまたぐPJの参加者を含む）を素で購読してよいのは、
// id→表示名・アバターの名前解決など候補一覧に使わない箇所だけ。
//
// このテストは、ストアの全メンバーを素で読む箇所（`useAppStore(セレクタ)` で members を丸ごと返すもの、
// `getState()` から members を読むもの）をファイルごとに数え、許可リストと完全一致することを確かめる。
// 新しく増えたら落ちる：その箇所が候補一覧なら selectScopedMembers／useAssigneeCandidates に直し、
// 名前解決なら許可リストに理由付きで足すこと。
// 構文木で数えるので、コメントや文字列に同じ書き方があっても数に入らない（Section 59 の無力化は起きない）。
//
// 【わざと壊して赤くなることを確認した記録（v3.139）】
// ①QuickAddTaskModal.tsx に全メンバーの素の購読を1行足す → 「未登録・件数超過」で red → 戻して green。
// ②同じ行をコメントとして書く → green のまま（数に入らない）。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const SCAN_DIRS = ["components", "hooks", "lib", "App.tsx"];

function listSources(p: string): string[] {
  if (!statSync(p).isDirectory()) return /\.tsx?$/.test(p) ? [p] : [];
  return readdirSync(p).flatMap(name => {
    const c = join(p, name);
    if (statSync(c).isDirectory()) return name === "__tests__" ? [] : listSources(c);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [c] : [];
  });
}

export function countRawMembersReads(src: string, fileName = "x.tsx"): number {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node) => {
    // (s) => s.members
    if (ts.isArrowFunction(node) && node.parameters.length === 1 && ts.isIdentifier(node.parameters[0].name)) {
      const p = node.parameters[0].name.text;
      const body = ts.isParenthesizedExpression(node.body) ? node.body.expression : node.body;
      if (ts.isPropertyAccessExpression(body) && body.name.text === "members"
        && ts.isIdentifier(body.expression) && body.expression.text === p) n++;
    }
    // useAppStore.getState().members
    if (ts.isPropertyAccessExpression(node) && node.name.text === "members" && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "getState") n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** ファイル（src からの相対パス）→ 件数と理由。候補一覧に使っていないことを理由に書く。 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "App.tsx": { count: 1, reason: "ログイン時の autoMatch（本人の特定）。候補一覧ではない" },
  "components/admin/AdminView.tsx": { count: 8, reason: "管理画面は memberInGroup（Section 36・memberInGroupUsage.test）で部署を絞る。対象外" },
  "components/admin/BackupSection.tsx": { count: 1, reason: "実行者名の解決のみ" },
  "components/admin/ClientErrorSection.tsx": { count: 1, reason: "報告者名の解決のみ" },
  "components/admin/OkrImportModal.tsx": { count: 1, reason: "OKR取込（OKR系は deptScope.ts の管理）" },
  "components/admin/ReminderSection.tsx": { count: 1, reason: "名前の解決のみ" },
  "components/auth/UserSelectScreen.tsx": { count: 1, reason: "ログインユーザーの選択画面（部署が決まる前）" },
  "components/common/InlineEditAssignee.tsx": { count: 1, reason: "今の担当者のアイコン表示（名前解決）。候補は useAssigneeCandidates" },
  "components/consultation/ConfirmationDialogModal.tsx": { count: 1, reason: "buildAssigneeCandidates の allMembers 入力（候補は表示部署＋PJ参加者で組み立て済み）" },
  "components/dashboard/DashboardView.tsx": { count: 1, reason: "オーナー・担当者・更新者の名前解決。AIに渡す部署メンバー一覧は selectScopedMembers" },
  "components/dashboard/ProjectKarte.tsx": { count: 1, reason: "オーナー・担当者の名前解決。オーナーの追加候補は selectScopedMembers" },
  "components/gantt/GanttView.tsx": { count: 1, reason: "行の名前解決と人別ビューの行（表示中のタスクの担当者だけが行になる。絞るとタスクが消える）" },
  "components/graph/GraphView.tsx": { count: 1, reason: "名前の解決のみ" },
  "components/kanban/KanbanView.tsx": { count: 1, reason: "一括変更のトースト等の名前解決。一括変更の候補は useAssigneeCandidates" },
  "components/lab/KrJointSessionFlow.tsx": { count: 1, reason: "名前の解決のみ（OKR系）" },
  "components/lab/ProjectStructureView.tsx": { count: 1, reason: "名前解決と既にPJにいる人。PJの外から足す候補は selectScopedMembers" },
  "components/layout/MainLayout.tsx": { count: 1, reason: "PJ編集権限の判定（canEditProjectBasicInfo）" },
  "components/list/ListView.tsx": { count: 1, reason: "行・CSV・担当者別のまとめの名前解決。絞り込みの選択肢と一括変更の候補は表示部署" },
  "components/meeting/MeetingImportPanel.tsx": { count: 1, reason: "既存タスクの担当者名の解決。候補・AIに渡す一覧は selectScopedMembers" },
  "components/okr/GroupOkrDashboardArchived.tsx": { count: 1, reason: "OKR系（アーカイブ済み画面）" },
  "components/project/ProjectCreateModal.tsx": { count: 1, reason: "オーナーのチップ・タスク行の担当者の名前解決。候補は selectScopedMembers" },
  "components/project/ProjectSettingsModal.tsx": { count: 1, reason: "オーナーのチップ・「関わるメンバー」（このPJの参加者一覧）・権限判定。オーナーの追加候補は selectScopedMembers" },
  "components/settings/NotificationSettingsSection.tsx": { count: 1, reason: "本人の設定（対象外）" },
  "components/settings/SettingsView.tsx": { count: 3, reason: "本人のプロフィール・設定（対象外）" },
  "components/task/TaskEditModal.tsx": { count: 1, reason: "担当者チップ・変更履歴の名前解決。候補は useAssigneeCandidates" },
  "components/task/TaskSidePanel.tsx": { count: 1, reason: "担当者チップ・変更履歴の名前解決。候補は useAssigneeCandidates" },
  "hooks/useAIConsultation.ts": { count: 1, reason: "相談する本人の特定（表示部署に属さない super_admin もいる）。AIに渡す一覧は selectScopedMembers" },
  "hooks/useAssigneeCandidates.ts": { count: 1, reason: "buildAssigneeCandidates の allMembers 入力" },
  "hooks/useMentionNotifications.ts": { count: 1, reason: "本人・メンションした人の名前解決" },
  "lib/ai/applyProposal.ts": { count: 1, reason: "担当者名の表示用の解決（getMemberShortName）。AIの担当者名の照合は表示部署＋PJ参加者" },
};

describe("全メンバーを素で読む箇所は許可リストと一致する（候補一覧は表示部署で絞る・Section 71）", () => {
  it("検出器：素の購読・getState からの読み取りを数え、表示部署の selector やコメントは数えない", () => {
    expect(countRawMembersReads("const a = useAppStore(s => s.members);")).toBe(1);
    expect(countRawMembersReads("const a = useAppStore((state) => (state.members));")).toBe(1);
    expect(countRawMembersReads("const a = useAppStore.getState().members.find(x => x);")).toBe(1);
    expect(countRawMembersReads("const a = useAppStore(selectScopedMembers);")).toBe(0);
    expect(countRawMembersReads("// const a = useAppStore(s => s.members);\nconst b = 1;")).toBe(0);
    expect(countRawMembersReads("const a = props.members;")).toBe(0);
  });

  it("ファイルごとの件数が許可リストと一致する", () => {
    const actual: Record<string, number> = {};
    for (const d of SCAN_DIRS) {
      for (const file of listSources(join(SRC, d))) {
        const n = countRawMembersReads(readFileSync(file, "utf8"), file);
        if (n > 0) actual[relative(SRC, file).replace(/\\/g, "/")] = n;
      }
    }
    const offenders: string[] = [];
    for (const [file, n] of Object.entries(actual)) {
      const allowed = ALLOWED[file];
      if (!allowed) offenders.push(`未登録: ${file}（${n}件）— 候補一覧なら selectScopedMembers／useAssigneeCandidates を使う`);
      else if (allowed.count !== n) offenders.push(`件数不一致: ${file}（許可 ${allowed.count}件・実際 ${n}件）`);
    }
    for (const file of Object.keys(ALLOWED)) {
      if (!(file in actual)) offenders.push(`許可リストに残っているが該当なし: ${file}（リストから消す）`);
    }
    expect(offenders).toEqual([]);
  });
});

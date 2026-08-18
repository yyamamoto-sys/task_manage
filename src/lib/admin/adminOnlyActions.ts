// src/lib/admin/adminOnlyActions.ts
//
// 【設計意図】v3.78 パートB②「admin専用アクションの越境」対応（CLAUDE.md参照）。
//
// appStore（src/stores/appStore.ts）の書き込み系アクションのうち、以下の15個は
// AdminView.tsx（および、AdminViewの中からしかマウントされない子コンポーネント＝
// LoadingTipsSection.tsx／OkrImportModal.tsx）からしか呼ばれていない。
// ゲストがこれらを一度も呼べないのは、appStore側にisGuestMode()の直接ガードが
// あるからではなく、MainLayout.tsx の唯一のUI分岐
// （`(isAdminOpen && !isGuest) ? adminOverlay : ...`）でAdminView自体に
// 到達できないことだけによる（＝単一障害点）。
//
// 🔴 この一覧自体が「守り」の実体ではない。守っているのはMainLayout.tsxのUI分岐だけ。
// この一覧は「今どのアクションがその単一防御に依存しているか」を機械的に固定するための
// ものであり、以下2点を src/components/__tests__/adminActionBoundary.test.ts が検査する：
//   ①一覧の各アクションの呼び出し元（`useAppStore(s => s.<name>)` 等）が
//     ADMIN_ONLY_ACTION_SURFACE_FILES の3ファイル以外に増えていないこと（越境検知）
//   ②MainLayout.tsxのUI分岐から `!isGuest` 相当の条件が失われていないこと
//
// 新しくAdminView専用の書き込みアクションを追加するときは、appStore側にisGuestMode()の
// ガードを足すか、このリストに追加する（どちらかを必ず選ぶこと。無言の除外を作らない）。
// src/stores/__tests__/guestBranchCoverage.test.ts が、appStoreの全書き込み系アクションを
// 「isGuestMode()ガードあり」「delegateあり」「このリストに載っている」のいずれかに
// 分類できることを検査するため、何もしないと機械的に気づける。
export const ADMIN_ONLY_ACTIONS = [
  "saveGroup",
  "deleteGroup",
  "saveLoadingTip",
  "deleteLoadingTip",
  "deleteMember",
  "saveObjective",
  "saveKeyResult",
  "deleteKeyResult",
  "saveTaskForce",
  "deleteTaskForce",
  "saveToDo",
  "deleteToDo",
  "saveQuarterlyObjective",
  "saveMemberTag",
  "deleteMemberTag",
] as const;

export type AdminOnlyActionName = (typeof ADMIN_ONLY_ACTIONS)[number];

// これらのアクションが呼び出されてよい唯一の場所（AdminView自身と、AdminViewの中からしか
// マウントされない子コンポーネント）。src/ からの相対パス。
export const ADMIN_ONLY_ACTION_SURFACE_FILES = [
  "components/admin/AdminView.tsx",
  "components/admin/LoadingTipsSection.tsx",
  "components/admin/OkrImportModal.tsx",
] as const;

// appStoreの書き込み系アクションのうち、自分自身はisGuestMode()を直接呼ばないが、
// 内部で別のガード済みアクション（appStore.getState()経由）に処理を委譲しているため
// 実質的にゲスト安全なもの。CLAUDE.md Section 3-6 B3の一括シフト機能（bulkShiftTasks→
// runBulkShift→saveTask）が該当する。
export const DELEGATING_ACTIONS: Record<string, string> = {
  bulkShiftTasks: "saveTask",
};

// src/lib/layout/sidebarCurrentGroupRestore.ts
//
// 【設計意図】
// サイドバーの「表示部署」（appStore.currentGroupId）を、リロード後も維持する機能（v3.82）。
// 山本さんの依頼：「リロードしたときには、リロード前の表示部署が表示されるようにしてほしい」。
//
// 【保存先・キー】localStorage。src/lib/localData/localStore.ts の LS_KEY.sidebarCurrentGroup
// （メンバーIDごとに保存。同じブラウザを別アカウントで使ったときに前の人の選択が
// 引き継がれないようにするため）。
//
// 🔴 復元前に必ず妥当性を検証する（resolveRestoredCurrentGroupId）。保存されている部署に
// 今もアクセスできる場合だけ復元し、そうでなければホーム部署（member.group_id）にフォール
// バックする。兼務が外れた後・部署が削除された後にその部署を表示しようとすると、
// currentGroupIdの対応先が無くなり何も見えない画面になるため。
//
// 🔴 「アクセスできる」の判定基準は、サイドバーの切替UIが実際に出している選択肢と
// 完全に一致させる（src/lib/projectInvite/sidebarGroupVisibility.ts の
// computeAccessibleGroupsForSidebar()。MainLayout.tsx の accessibleGroups と同じ関数）。
// 切替UIに出ない部署を復元すると、UIから戻す手段が無い状態になる（全社スーパー管理者・
// 招待受諾者のどちらも、この関数を通したリストを基準にすれば個別分岐が不要になる）。
//
// 【ゲスト対象外】ゲスト（サンプル閲覧）モードはApp.tsxの別経路（loadDemoData）で
// currentGroupIdをDEMO_GROUP_IDに設定するだけで、このモジュールを一切通らない
// （AuthenticatedApp/autoMatchを経由しない。CLAUDE.md Section 23）。保存側
// （MainLayout.tsxの切替ハンドラ）も呼び出し前にisGuestで明示的にガードする。

import { LS_KEY } from "../localData/localStore";

/**
 * 保存されている「表示部署」を復元してよいか判定する（純粋関数）。
 *
 * @param storedGroupId localStorageから読んだ保存値（無ければnull）
 * @param homeGroupId ホーム部署（member.group_id ?? null）。フォールバック先
 * @param accessibleGroupIds サイドバーの切替UIが実際に出している選択肢のid一覧
 *   （computeAccessibleGroupsForSidebar()の結果をmapしたもの）
 * @returns 復元するgroupId、または（保存値が無効/無い場合の）ホーム部署
 */
export function resolveRestoredCurrentGroupId(
  storedGroupId: string | null,
  homeGroupId: string | null,
  accessibleGroupIds: string[],
): string | null {
  if (storedGroupId && accessibleGroupIds.includes(storedGroupId)) return storedGroupId;
  return homeGroupId;
}

/** メンバーごとの保存値を読む。localStorage利用不可・未保存はnull（機能継続）。 */
export function loadStoredSidebarGroupId(memberId: string): string | null {
  try { return localStorage.getItem(LS_KEY.sidebarCurrentGroup(memberId)); }
  catch { return null; }
}

/** メンバーごとに「表示部署」の選択を保存する。localStorage利用不可時は無視（機能継続）。 */
export function saveSidebarGroupId(memberId: string, groupId: string | null): void {
  try {
    if (groupId) localStorage.setItem(LS_KEY.sidebarCurrentGroup(memberId), groupId);
    else localStorage.removeItem(LS_KEY.sidebarCurrentGroup(memberId));
  } catch { /* 利用不可・容量不足は無視（機能継続） */ }
}

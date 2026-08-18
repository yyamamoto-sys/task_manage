// src/lib/layout/sidebarMineOnlyDefault.ts
//
// 【設計意図】
// サイドバーのPJ一覧「自分／全件」トグルの初期値を決める純粋関数（v3.76）。
//
// 【背景】2026-08-18に山本さんが実機で招待受諾者として「羅針盤フォーラム」PJに参加した
// 直後、サイドバーが「自分が担当するタスクを持つPJはまだありません」と表示し、招待された
// PJが一覧に出なかった（PJ自体は上部のフィルターチップに出ており見えている）。原因は
// トグルの既定が「自分」で、招待受諾者はまだ担当タスクを持たないため0件になること。
//
// 🔴 「招待受諾者かどうか」で分岐するコードは書かない（CLAUDE.md Section 25 Phase 4の
// filterInviteGroupsForSidebar と同じ流儀）。一般則1つで解く：
// 「初回表示時に、『自分』で0件かつ『全件』で1件以上なら『全件』を初期値にする」。
// これなら招待受諾者だけでなく「まだ自分のタスクが1件も無い新入社員」も同じ理屈で救われる。
//
// ユーザーが一度でも明示的にトグルを切り替えたら（localStorageにフラグが残っているなら）、
// この一般則より常にその選択を優先する（「初回表示時」限定の効果であり、以後は再判定しない）。

/**
 * サイドバーPJ一覧「自分／全件」トグルの初期値（mineOnly）を決める。
 *
 * @param storedPreference localStorage（KEYS.SIDEBAR_MY_PROJECTS_ONLY）の生値。
 *   "1"＝自分のみを明示選択済み、"0"＝全件を明示選択済み、null＝未選択（初回表示）。
 * @param mineCount 「自分」で絞ったときのPJ件数
 * @param allCount 「全件」のPJ件数
 * @returns true＝「自分のみ」を初期値にする、false＝「全件」を初期値にする
 */
export function resolveInitialSidebarMineOnly(
  storedPreference: string | null,
  mineCount: number,
  allCount: number,
): boolean {
  if (storedPreference === "1") return true;
  if (storedPreference === "0") return false;
  // 未設定＝このブラウザでまだ選んだことがない。既定はON（自分のみ）だが、自分に
  // 担当タスクが1件も無く、全件になら何かあるときだけ「全件」を初期値にする。
  if (mineCount === 0 && allCount > 0) return false;
  return true;
}

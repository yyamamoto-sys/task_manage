// src/components/auth/setupWizardRun.ts
//
// 【設計意図・v3.186】SetupWizard の「登録するメンバーの選び方」と「完了処理の再試行」を、
// 画面から切り出した純粋なロジック（テスト用）。
//
// ① 登録対象は「表示名と略称の両方が入っている行」だけ。画面の警告（「空欄のままだと保存されません」）・
//    「あなた」の印・次へ進む条件はすべてこの基準で、完了処理もこれに合わせる。
//    以前は完了処理だけ表示名だけで拾っており、略称が空の行が先頭だと、印の付いた人ではなく
//    その行が最初の管理者（super-admin）になっていた。
// ② ブートストラップ（部署と最初の管理者の作成）は「membersが0件のときだけ」通る。途中で失敗して
//    もう一度押すと、2回目は必ず拒否されて先へ進めなくなる。成功済みの部署IDと登録済みの
//    メンバーを覚えておき、再試行では済んだ分をやり直さない。

export function pickSetupMembers<T extends { display_name: string; short_name: string }>(
  drafts: readonly T[],
): T[] {
  return drafts.filter(m => m.display_name.trim() && m.short_name.trim());
}

export interface SetupProgress {
  groupId: string | null;
  savedMemberIds: Set<string>;
}

export function newSetupProgress(): SetupProgress {
  return { groupId: null, savedMemberIds: new Set() };
}

export interface SetupDeps<M extends { id: string }> {
  /** 部署と最初のメンバーを作り、部署IDを返す。失敗したら例外 */
  bootstrap: () => Promise<string>;
  setGroup: (groupId: string) => void;
  saveMember: (member: M) => Promise<void>;
  reload: () => Promise<void>;
}

export async function runSetup<M extends { id: string }>(
  deps: SetupDeps<M>,
  progress: SetupProgress,
  rest: readonly M[],
): Promise<void> {
  if (!progress.groupId) progress.groupId = await deps.bootstrap();
  deps.setGroup(progress.groupId);
  for (const member of rest) {
    if (progress.savedMemberIds.has(member.id)) continue;
    await deps.saveMember(member);
    progress.savedMemberIds.add(member.id);
  }
  await deps.reload();
}

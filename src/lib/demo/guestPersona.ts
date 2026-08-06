// src/lib/demo/guestPersona.ts
//
// 【設計意図】
// buildDemoDataset()（dataset.ts）自体は「全エンティティが demo- 接頭辞」という強い制約を
// 保つ（__tests__/dataset.test.ts が機械的に検証する）。一方でマイページの既定ウィジェット
// （今週のタスク／自分のワークロード）は currentUser.id（= ゲストは GUEST_MEMBER_ID）で
// フィルタするため、ゲスト自身をどのタスクにも割り当てないと必ず空表示になる。
//
// この関数はランタイム専用の後処理として、GUEST_MEMBER 自身を members に追加し、
// dataset.ts が用意した「ゲスト担当タスク」（GUEST_ASSIGNED_TASK_IDS）の担当者を
// ゲストへ付け替える。dataset.ts の出力（buildDemoDataset の戻り値）は書き換えず、
// 新しいオブジェクトを組み立てて返す。
//
// 【意図的な例外】GUEST_MEMBER.id（"__guest__"）は "demo-" 接頭辞ではないが、これは
// アプリの既存定数（src/lib/guestMode.ts）そのものであり、実データではない。
// dataset.test.ts の id プレフィックス検証はこの関数を経由する前の buildDemoDataset() の
// 戻り値だけを対象にしているため、両者は矛盾しない。
//
// 【dataset.ts を静的importしない理由】このファイルは GUEST_ASSIGNED_TASK_IDS だけが
// 欲しいが、dataset.ts 全体を静的importするとデータ本体への静的な依存が生まれてしまう
// （dataset.ts 自体は import() 経由でしか読み込ませたくない。Section 19）。そのため
// 定数は dataset.ts ではなく constants.ts（データを持たない軽量ファイル）に置く。

import { GUEST_MEMBER, GUEST_MEMBER_ID } from "../guestMode";
import { DEMO_GROUP_ID, GUEST_ASSIGNED_TASK_IDS } from "./constants";
import type { DemoDataset } from "./types";

export function applyGuestPersona(dataset: DemoDataset): DemoDataset {
  const guestAsMember = { ...GUEST_MEMBER, group_id: DEMO_GROUP_ID };
  const assignedIds = new Set(GUEST_ASSIGNED_TASK_IDS);
  return {
    ...dataset,
    members: [...dataset.members, guestAsMember],
    tasks: dataset.tasks.map(t =>
      assignedIds.has(t.id)
        ? { ...t, assignee_member_id: GUEST_MEMBER_ID, assignee_member_ids: [GUEST_MEMBER_ID] }
        : t
    ),
  };
}

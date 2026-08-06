// src/lib/guestMode.ts
//
// 【設計意図・2026-08-06改訂】
// 「ゲスト（サンプル閲覧）」モードの単一の真実。ログイン画面の「サンプルを見る」を選ぶと
// 有効化される。有効化中は Supabase への実アクセス（読み取り・書き込み・rpc・
// functions.invoke・storage の全経路）を supabase/client.ts の choke point
// （assertGuestBlocked）で一括ブロックする。ゲストの画面は appStore に
// src/lib/demo/ のサンプルデータを直接注入して表示するため、そもそも実データを
// 読みに行く必要が無い。
//
// 【なぜ読み取りも止めるか】ゲストは独立した権限主体ではなく、既存の認証セッション
// （またはRLS）に被せた見た目だけのペルソナ。読み取りを許すと自部署の実業務データが
// 全部ゲストに見えてしまう（2026-08-06の調査でこの穴が判明し、書き込みのみブロックする
// 旧実装から「原則全部止める」設計に反転した）。CLAUDE.md Section 23 参照。

import type { Member } from "./localData/types";

export const GUEST_MEMBER_ID = "__guest__";

/** ログイン画面の「ゲスト」選択で使う合成メンバー。DB には存在しない。 */
export const GUEST_MEMBER: Member = {
  id: GUEST_MEMBER_ID,
  display_name: "ゲスト（閲覧のみ）",
  short_name: "ゲスト",
  initials: "G",
  teams_account: "",
  color_bg: "#9ca3af",
  color_text: "#ffffff",
  is_deleted: false,
};

export function isGuestMember(member: { id: string } | null | undefined): boolean {
  return !!member && member.id === GUEST_MEMBER_ID;
}

// ===== ゲストモードフラグ（client.ts の書き込みブロックが参照する単一の真実） =====

let guestMode = false;

export function setGuestMode(v: boolean): void {
  guestMode = v;
}

export function isGuestMode(): boolean {
  return guestMode;
}

/** ゲストの書き込みブロック時に投げられるエラーの message に使う文言。 */
export const GUEST_READONLY_MESSAGE = "ゲストモードでは編集できません（閲覧のみ）";

// src/lib/guestMode.ts
//
// 【設計意図】
// 「ゲスト（閲覧のみ）」モードの単一の真実。ログイン画面で「ゲスト」を選ぶと有効化され、
// 全ての書き込み（insert/update/delete）を Supabase クライアント層（supabase/client.ts）で
// 一括ブロックする。通常編集も AI 提案の反映も、すべてここを通るので確実に止まる。
//
// ⚠ これは「経営役員などの見学」を想定した**クライアント側の閲覧専用ガード**であり、
// 厳格なセキュリティ境界ではない（アプリは共有 anon キーで DB に接続しているため、
// 技術的に詳しい人による回避余地はゼロではない）。厳格な書込禁止が要る場合は
// Supabase 側の RLS ＋ 専用認証ロールが必要。

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

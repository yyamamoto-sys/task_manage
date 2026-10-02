// src/lib/notifications/bell.ts
//
// 右上のベル（v3.133）の表示ロジック：未読バッジの形と、一覧のタブ（すべて／管理者向け／送信済み）。
//
// 🔴 バッジはベルのボタンの「外」（兄弟要素）に置く。globals.css の `button:not(:disabled)` が
// position:relative と overflow:hidden を全ボタンに付けており、ボタンは border-radius:50% の円なので、
// ボタンの内側にバッジを置くと円の外にはみ出した部分（＝数字）が円形に切り取られる（v3.129〜v3.132 の見切れの原因）。

import type { CSSProperties } from "react";

export const BELL_BADGE_HEIGHT_PX = 18;
export const BELL_BADGE_MIN_WIDTH_PX = 18;
export const BELL_BADGE_PADDING_X_PX = 5;
export const BELL_BADGE_BORDER_PX = 2;
export const BELL_BADGE_FONT_PX = 10;
/** ベルの外接矩形の右上角からのずれ（負＝外側へ出す） */
export const BELL_BADGE_OFFSET_TOP_PX = -5;
export const BELL_BADGE_OFFSET_RIGHT_PX = -6;
/** 10px 太字の数字・記号1文字の幅の見積もり（M PLUS Rounded 1c の実測より大きめ） */
const BADGE_CHAR_WIDTH_PX = 7;

/** バッジの文字が欠けずに収まる幅の見積もり（テストで「固定幅で切っていない」ことの検算に使う） */
export function estimateBellBadgeWidthPx(text: string): number {
  return Math.max(
    BELL_BADGE_MIN_WIDTH_PX,
    text.length * BADGE_CHAR_WIDTH_PX + BELL_BADGE_PADDING_X_PX * 2 + BELL_BADGE_BORDER_PX * 2,
  );
}

/** バッジの style。幅は固定せず中身に合わせて広がる（minWidth のみ）。折り返さない */
export function bellBadgeStyle(): CSSProperties {
  return {
    position: "absolute",
    top: `${BELL_BADGE_OFFSET_TOP_PX}px`,
    right: `${BELL_BADGE_OFFSET_RIGHT_PX}px`,
    minWidth: `${BELL_BADGE_MIN_WIDTH_PX}px`,
    height: `${BELL_BADGE_HEIGHT_PX}px`,
    padding: `0 ${BELL_BADGE_PADDING_X_PX}px`,
    borderRadius: "99px",
    background: "#e5484d",
    color: "#fff",
    border: `${BELL_BADGE_BORDER_PX}px solid var(--color-bg-primary)`,
    fontSize: `${BELL_BADGE_FONT_PX}px`,
    fontWeight: 700,
    lineHeight: `${BELL_BADGE_HEIGHT_PX - BELL_BADGE_BORDER_PX * 2}px`,
    textAlign: "center",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: 1,
  };
}

export type BellTab = "all" | "admin" | "sent";

/** お知らせを送れる人（送信画面 AdminMessageSection と同じ条件。範囲の強制は DB の send_admin_message） */
export function canSendAdminMessages(user: { isSuperAdmin: boolean; isAdmin: boolean }): boolean {
  return user.isSuperAdmin || user.isAdmin;
}

/** ベルの一覧に出すタブ。1つしか無いときはタブ列そのものを出さない */
export function bellTabsFor(user: { isSuperAdmin: boolean; isAdmin: boolean }): BellTab[] {
  const tabs: BellTab[] = ["all"];
  if (user.isSuperAdmin) tabs.push("admin");
  if (canSendAdminMessages(user)) tabs.push("sent");
  return tabs;
}

/** 送信済みタブは「自分が送ったもの」だけ（list_sent_admin_messages は super_admin には全件を返すため絞る） */
export function ownSentMessages<T extends { sender_id: string }>(rows: readonly T[], memberId: string): T[] {
  return rows.filter(r => r.sender_id === memberId);
}

// src/components/tour/tours/announcements.ts
//
// お知らせツアー（新機能の紹介）の登録表。新機能のたびに「ツアー定義を1本書いて、ここに1行足す」だけで届けられる。
// 作り方の手順は docs/dev/tour-guidelines.md §13。
//
// 🔴 audience が公開範囲の唯一の定義。"super_admin" の間は、管理者以外には
//   ①自動開始しない ②ガイドの一覧に出さない ③お知らせの「ツアーで見る」ボタン・ディープリンクでも再生しない
//   （buildTours が登録そのものから外すので start() が通らない）。全員へ広げるときは "all" に1行変えるだけ。
// ゲスト（サンプル閲覧）には、audience に関わらず出さない（ご意見・ベルなど対象の機能がゲストには無いため）。

import { FEEDBACK_INTRO_TOUR_ID } from "./feedback-intro";

export type AnnouncementAudience = "super_admin" | "all";

export interface AnnouncementTour {
  /** tours/*.ts に定義したツアーの id（ALL_TOURS に登録済みであること＝テストが検査） */
  tourId: string;
  /** 公開した版（"3.159"。表示・棚卸し用。判定には使わない） */
  sinceVersion: string;
  audience: AnnouncementAudience;
  /** true＝公開後、各自が次にアプリを開いたとき自動で1回始まる */
  autoStart: boolean;
}

export const ANNOUNCEMENT_TOURS: readonly AnnouncementTour[] = [
  // v3.159：まず管理者（super_admin）だけで確認する。全員へ広げるときは audience を "all" にする（これ1行）
  { tourId: FEEDBACK_INTRO_TOUR_ID, sinceVersion: "3.159", audience: "super_admin", autoStart: true },
];

export interface AnnouncementViewer {
  isGuest: boolean;
  isSuperAdmin: boolean;
}

export function canSeeAnnouncement(entry: AnnouncementTour, viewer: AnnouncementViewer): boolean {
  if (viewer.isGuest) return false;
  if (entry.audience === "all") return true;
  return viewer.isSuperAdmin;
}

export function visibleAnnouncementEntries(
  viewer: AnnouncementViewer,
  entries: readonly AnnouncementTour[] = ANNOUNCEMENT_TOURS,
): AnnouncementTour[] {
  return entries.filter(e => canSeeAnnouncement(e, viewer));
}

export function isAnnouncementTourId(tourId: string, entries: readonly AnnouncementTour[] = ANNOUNCEMENT_TOURS): boolean {
  return entries.some(e => e.tourId === tourId);
}

export interface AutoStartContext {
  viewer: AnnouncementViewer;
  /** ログイン中のメンバーID（未確定なら null） */
  memberId: string | null;
  /** 初回ツアー（first-time）が既読で、招待ダイアログも出ていない */
  firstTimeDone: boolean;
  isCompleted: (tourId: string) => boolean;
  tourRunning: boolean;
  /** モーダル・未保存の編集・ガイドや設定などの全画面表示がある */
  blocked: boolean;
}

/**
 * 今この瞬間に自動開始してよいお知らせツアーの id（無ければ null）。登録順の先頭の1本だけ。
 * 「あとで」（スキップ）も既読として記録されるため、未読のものだけが対象＝自動では何度も出ない。
 */
export function pickAutoStartAnnouncement(
  ctx: AutoStartContext,
  entries: readonly AnnouncementTour[] = ANNOUNCEMENT_TOURS,
): string | null {
  if (!ctx.memberId) return null;
  if (ctx.viewer.isGuest) return null;
  if (!ctx.firstTimeDone) return null;
  if (ctx.tourRunning || ctx.blocked) return null;
  for (const e of visibleAnnouncementEntries(ctx.viewer, entries)) {
    if (!e.autoStart) continue;
    if (!ctx.isCompleted(e.tourId)) return e.tourId;
  }
  return null;
}

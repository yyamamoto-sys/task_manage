// src/components/tour/tourCompletion.ts
//
// 【設計意図・v3.138】
// ツアー既読の localStorage をメンバーID別に持つ（同じPCを別の人が使っても初回ツアーが出るように）。
// 旧キー（メンバー共通）は、更新後に最初に開いたメンバーへ1回だけ引き継いで削除する
// ＝自分専用PCの既存利用者には再表示しない／共用PCの2人目以降には初回ツアーが出る。
// ゲストは固定の別キーを使い、旧キーの引き継ぎ先にはしない（実利用者の既読を奪わないため）。
// localStorage はテスト環境に無いので、読み書きは引数で受け取る。

import { GUEST_MEMBER_ID } from "../../lib/guestMode";

export const TOUR_COMPLETED_LEGACY_KEY = "tour_completed_v1";
export const TOUR_COMPLETED_GUEST_KEY = `${TOUR_COMPLETED_LEGACY_KEY}:guest`;

export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type TourCompletedMap = Record<string, true>;

/** メンバーIDが未確定なら null（＝読み書きしない） */
export function tourCompletedKey(memberId: string | null | undefined): string | null {
  if (!memberId) return null;
  if (memberId === GUEST_MEMBER_ID) return TOUR_COMPLETED_GUEST_KEY;
  return `${TOUR_COMPLETED_LEGACY_KEY}:${memberId}`;
}

function parseMap(raw: string | null): TourCompletedMap {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as TourCompletedMap) : {};
  } catch {
    return {};
  }
}

/** 新キーが無く旧キーがあれば、旧キーの内容を新キーへ写して旧キーを消す */
export function migrateLegacyTourCompleted(storage: TourStorage, memberId: string | null | undefined): void {
  const key = tourCompletedKey(memberId);
  if (!key || key === TOUR_COMPLETED_GUEST_KEY) return;
  if (storage.getItem(key) !== null) return;
  const legacy = storage.getItem(TOUR_COMPLETED_LEGACY_KEY);
  if (legacy === null) return;
  storage.setItem(key, legacy);
  storage.removeItem(TOUR_COMPLETED_LEGACY_KEY);
}

/** メンバーIDが未確定なら null（呼び出し側は「完了済み扱い＝自動開始しない」にする） */
export function loadTourCompleted(storage: TourStorage, memberId: string | null | undefined): TourCompletedMap | null {
  const key = tourCompletedKey(memberId);
  if (!key) return null;
  migrateLegacyTourCompleted(storage, memberId);
  return parseMap(storage.getItem(key));
}

export function markTourCompleted(storage: TourStorage, memberId: string | null | undefined, tourId: string): void {
  const key = tourCompletedKey(memberId);
  if (!key) return;
  const map = loadTourCompleted(storage, memberId) ?? {};
  map[tourId] = true;
  storage.setItem(key, JSON.stringify(map));
}

export function isTourCompleted(storage: TourStorage, memberId: string | null | undefined, tourId: string): boolean {
  const map = loadTourCompleted(storage, memberId);
  return map === null ? true : !!map[tourId];
}

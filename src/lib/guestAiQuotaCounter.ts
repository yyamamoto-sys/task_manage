// src/lib/guestAiQuotaCounter.ts
//
// 【設計意図・v3.31】
// ゲスト（サンプル閲覧）のAI利用回数を「使う前に」画面へ明示するための、localStorageベースの
// 表示専用カウンタ。GuestAiQuotaNotice（src/components/common/GuestAiQuotaNotice.tsx）から
// 読まれ、invokeAI.ts / apiClient.ts のAI呼び出し成功時に recordGuestAiUse() で加算される。
//
// 【重要な前提・3点】
// (a) ここで返す値は表示のためだけの参考値。回数制限の強制は
//     Edge Function（supabase/functions/ai-consult/index.ts）→
//     consume_guest_ai_quota()（SQL・supabase/migrations/20260807_add_guest_ai_quota.sql）
//     だけが真実（CLAUDE.md Section 23）。このファイルの値がずれても実際の制限は正しく動く。
// (b) 上限値（GUEST_AI_DAILY_LIMIT=3）は supabase/functions/ai-consult/index.ts の
//     GUEST_AI_PER_BROWSER_DAILY_LIMIT（環境変数 GUEST_AI_PER_BROWSER_DAILY_LIMIT で上書き可）
//     と二重管理になっている。環境変数で上限を変えた場合、この表示だけがズレる
//     （強制は正しく動き続ける）。上限を変えるときは両方直すこと。
// (c) ゲストの匿名Authセッション（src/lib/supabase/guestAiAuth.ts）も同じlocalStorageに
//     保存される。そのためlocalStorageを消すと匿名ユーザーが新規発行され、サーバー側の
//     ブラウザ別枠も同時にリセットされる＝表示とサーバーが揃ってリセットされるため
//     ズレない、という前提でこの設計（localStorageに素朴にカウントを置くだけ）を選んでいる。
//
// 【テスト容易性のための分離】
// vitest.config.ts が environment:"node" のため localStorage が存在しない
// （src/lib/chunkSizeGate.ts と同じ制約）。localStorage を直接触る関数はテストせず、
// 日付跨ぎ・加算・下限クランプの判定ロジックを純粋関数（resolveGuestAiUsedCount /
// resolveGuestAiRemaining）に分離してテストする。

import { KEYS } from "./localData/localStore";

export const GUEST_AI_DAILY_LIMIT = 3;

export interface GuestAiUsageRecord {
  /** ローカル日付 "YYYY-MM-DD"（日付が変わったら0として扱うための基準） */
  date: string;
  count: number;
}

function todayLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 記録済みレコードから「本日の利用回数」を導く純粋関数。
 * レコードが無い・壊れている・日付が今日と異なる（日付跨ぎ）場合は 0 を返す。
 * 明示的なクリア処理は持たない設計（日付が変われば自然に0扱いになる）。
 */
export function resolveGuestAiUsedCount(record: GuestAiUsageRecord | null, todayStr: string): number {
  if (!record || record.date !== todayStr) return 0;
  return Math.max(0, record.count);
}

/** 残り回数を導く純粋関数（0未満にはならない）。 */
export function resolveGuestAiRemaining(usedCount: number, limit: number = GUEST_AI_DAILY_LIMIT): number {
  return Math.max(0, limit - usedCount);
}

function readRecord(): GuestAiUsageRecord | null {
  try {
    const raw = localStorage.getItem(KEYS.GUEST_AI_USAGE_TODAY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestAiUsageRecord> | null;
    if (typeof parsed?.date !== "string" || typeof parsed?.count !== "number") return null;
    return { date: parsed.date, count: parsed.count };
  } catch {
    return null;
  }
}

/** 本日（ローカル日付）のAI利用回数。表示専用の参考値（ファイル冒頭コメント参照）。 */
export function getGuestAiUsedToday(): number {
  try {
    return resolveGuestAiUsedCount(readRecord(), todayLocalDateStr());
  } catch {
    return 0;
  }
}

/** 本日の残り利用回数（表示専用の参考値。0未満にはならない）。 */
export function getGuestAiRemainingToday(): number {
  return resolveGuestAiRemaining(getGuestAiUsedToday(), GUEST_AI_DAILY_LIMIT);
}

/**
 * AI呼び出しが成功したときだけ呼ぶこと（invokeAI.ts / apiClient.ts）。
 * 429（GUEST_DAILY_LIMIT_EXCEEDED等）や他のエラー時は絶対に呼ばない。
 * 書き込み失敗（localStorage利用不可・容量不足等）は黙って無視する
 * （表示専用の参考値のため。chunkSizeGate.ts と同じ流儀）。
 */
export function recordGuestAiUse(): void {
  try {
    const today = todayLocalDateStr();
    const used = resolveGuestAiUsedCount(readRecord(), today);
    const record: GuestAiUsageRecord = { date: today, count: used + 1 };
    localStorage.setItem(KEYS.GUEST_AI_USAGE_TODAY, JSON.stringify(record));
  } catch {
    // 利用不可・容量不足は無視（機能継続。次回また参考値として0から数え直すだけ）
  }
}

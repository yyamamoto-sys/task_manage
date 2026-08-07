// src/lib/ai/__tests__/guestQuota.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）のAI利用回数制限のしきい値判定（decideGuestAiQuota）の境界値テスト。
// 実体は supabase/functions/ai-consult/guestQuota.ts（Edge Function側・Deno依存の無い
// 純粋関数）にあり、このファイルから相対importしてそのままテストする
// （CLAUDE.md Section 23・migrations/20260807_add_guest_ai_quota.sql参照）。

import { describe, it, expect } from "vitest";
import { decideGuestAiQuota } from "../../../../supabase/functions/ai-consult/guestQuota";

const PER_BROWSER_LIMIT = 3;
const GLOBAL_LIMIT = 10;

describe("decideGuestAiQuota：ブラウザ別上限（1日3回）の境界値", () => {
  it("3回目（=上限と同数）は通る", () => {
    const result = decideGuestAiQuota(3, 3, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result).toEqual({ allowed: true, reason: "ok" });
  });

  it("4回目（=上限を1件超える）は落ちる", () => {
    const result = decideGuestAiQuota(4, 4, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result).toEqual({ allowed: false, reason: "per_browser" });
  });
});

describe("decideGuestAiQuota：全体上限（1日10回）の境界値", () => {
  it("全体10回目（=上限と同数）は通る（このブラウザ自身は1回目でもよい）", () => {
    const result = decideGuestAiQuota(1, 10, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result).toEqual({ allowed: true, reason: "ok" });
  });

  it("全体11回目（=上限を1件超える）は落ちる", () => {
    const result = decideGuestAiQuota(1, 11, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result).toEqual({ allowed: false, reason: "global" });
  });
});

describe("decideGuestAiQuota：両方超過時の優先順位", () => {
  it("ブラウザ別・全体の両方が超過している場合は「global」を優先して報告する", () => {
    // 個人枠だけが埋まっていると誤解させないため、共有枠（コストの天井）切れを優先する。
    const result = decideGuestAiQuota(4, 11, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result).toEqual({ allowed: false, reason: "global" });
  });
});

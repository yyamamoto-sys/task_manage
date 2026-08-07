// src/lib/ai/__tests__/guestQuota.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）のAI利用回数制限の状態遷移ロジック（条件付き加算・拒否時の
// 補償・境界値）の固定テスト。実体は supabase/functions/ai-consult/guestQuota.ts
// （Edge Function側・Deno依存の無い参照実装）にあり、このファイルから相対importして
// そのままテストする（CLAUDE.md Section 23・migrations/20260807_add_guest_ai_quota.sql参照）。
//
// 【なぜ参照実装か】実際の判定＋条件付き加算はconsume_guest_ai_quota()（SQL関数）の中で
// 完結している（TOCTOUレース防止のため）。このリポジトリのテスト環境（Vitest/Node）では
// 実際のPostgresを起動してSQL関数を直接検証する手段が無いため、SQL関数と手順を1対1で
// 対応させたTypeScript参照実装をここで用意し、境界値・拒否時の非消費・補償の3点を固定する
// （v3.30：無条件加算→事後判定だったv3.29版の可用性バグ修正に伴い decideGuestAiQuota から
// simulateConsumeGuestAiQuota へ全面的に置き換えた）。

import { describe, it, expect } from "vitest";
import { simulateConsumeGuestAiQuota, type GuestQuotaState } from "../../../../supabase/functions/ai-consult/guestQuota";

const PER_BROWSER_LIMIT = 3;
const GLOBAL_LIMIT = 10;

const zeroState = (): GuestQuotaState => ({ browserCount: 0, globalCount: 0 });

describe("simulateConsumeGuestAiQuota：ブラウザ別上限（1日3回）の境界値", () => {
  it("1回目〜3回目は通り、両方のカウンタが1ずつ進む", () => {
    let state = zeroState();
    for (let i = 1; i <= 3; i++) {
      const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("ok");
      expect(result.nextState).toEqual({ browserCount: i, globalCount: i });
      state = result.nextState;
    }
  });

  it("4回目は拒否される（reason=per_browser）", () => {
    const state: GuestQuotaState = { browserCount: 3, globalCount: 3 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("per_browser");
  });
});

describe("simulateConsumeGuestAiQuota：拒否されたリクエストはどちらのカウンタも消費しない（今回の欠陥そのもの）", () => {
  it("per_browser拒否時、全体カウンタは加算前の値のまま変化しない（補償が効いている）", () => {
    const state: GuestQuotaState = { browserCount: 3, globalCount: 3 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.nextState).toEqual(state); // 呼び出し前と完全に同じ
  });

  it("global拒否時、ブラウザ別カウンタは加算前の値のまま変化しない（そもそも触れていない）", () => {
    const state: GuestQuotaState = { browserCount: 0, globalCount: 10 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global");
    expect(result.nextState).toEqual(state);
  });

  it("【欠陥の再現テスト】1ブラウザが4回目以降を何回試しても、全体カウンタは3のまま増えない", () => {
    // v3.29の欠陥：無条件インクリメントだと、この操作を繰り返すたびに全体カウンタが
    // 4,5,6...と増え続け、1ブラウザが全体枠（10）を1人で食い潰せた。
    let state: GuestQuotaState = { browserCount: 3, globalCount: 3 };
    for (let i = 0; i < 20; i++) {
      const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("per_browser");
      expect(result.nextState.globalCount).toBe(3); // 増えない
      expect(result.nextState.browserCount).toBe(3); // 増えない
      state = result.nextState;
    }
  });
});

describe("simulateConsumeGuestAiQuota：全体上限（1日10回）の境界値", () => {
  it("全体10回目（=上限と同数）は通る（このブラウザ自身は1回目でもよい）", () => {
    const state: GuestQuotaState = { browserCount: 0, globalCount: 9 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(true);
    expect(result.nextState).toEqual({ browserCount: 1, globalCount: 10 });
  });

  it("全体11回目（=上限を1件超える）は落ちる", () => {
    const state: GuestQuotaState = { browserCount: 0, globalCount: 10 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global");
  });
});

describe("simulateConsumeGuestAiQuota：拒否理由の優先順位（全体枠切れを優先して伝える）", () => {
  it("ブラウザ別・全体の両方が上限に達している場合はglobalを優先して報告する", () => {
    const state: GuestQuotaState = { browserCount: 3, globalCount: 10 };
    const result = simulateConsumeGuestAiQuota(state, PER_BROWSER_LIMIT, GLOBAL_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global");
  });
});

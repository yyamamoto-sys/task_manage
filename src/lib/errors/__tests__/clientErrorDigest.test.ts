// src/lib/errors/__tests__/clientErrorDigest.test.ts
//
// エラーのまとめ通知（push-reminders の30分ごとの実行・v3.129）の純粋関数。実体は supabase/functions/_shared/。

import { describe, it, expect } from "vitest";
import {
  ERROR_DIGEST_INITIAL_LOOKBACK_MS, ERROR_DIGEST_URL,
  buildErrorDigestPayload, countErrorsSince, resolveDigestWindow, selectErrorDigestRecipients,
} from "../../../../supabase/functions/_shared/clientErrorDigest";
import type { KindPrefsLike } from "../../../../supabase/functions/_shared/notificationKinds";

const SINCE = "2026-10-01T00:00:00.000Z";
const UNTIL = "2026-10-01T00:30:00.000Z";

describe("前回以降のエラー件数（countErrorsSince）", () => {
  it("last_notified_at が窓（前回より後・今回以前）の行だけを数え、初めて記録されたものを新規として数える", () => {
    const rows = [
      { first_seen: "2026-09-30T10:00:00Z", last_notified_at: "2026-10-01T00:10:00Z" }, // 解決済みから再発
      { first_seen: "2026-10-01T00:05:00Z", last_notified_at: "2026-10-01T00:05:00Z" }, // 新規
      { first_seen: "2026-09-30T10:00:00Z", last_notified_at: "2026-10-01T00:00:00Z" }, // 前回ちょうど＝含めない
      { first_seen: "2026-10-01T00:40:00Z", last_notified_at: "2026-10-01T00:40:00Z" }, // 今回より後＝含めない
      { first_seen: "2026-09-30T09:00:00Z", last_notified_at: null }, // まだ一度も通知されていない（レア）＝含めない
    ];
    expect(countErrorsSince(rows, SINCE, UNTIL)).toEqual({ total: 2, fresh: 1 });
    expect(countErrorsSince([], SINCE, UNTIL)).toEqual({ total: 0, fresh: 0 });
  });

  it("🔴 既知の未解決エラーがただ繰り返しただけ（last_seen は窓に入るが last_notified_at は窓より前）では数えない（独立レビュー指摘・軽）", () => {
    const rows = [
      // 以前から知られている未解決エラーが、今回の窓の中でまた発生した（last_notified_at は昔のまま）
      { first_seen: "2026-09-25T00:00:00Z", last_notified_at: "2026-09-25T00:00:00Z" },
    ];
    expect(countErrorsSince(rows, SINCE, UNTIL)).toEqual({ total: 0, fresh: 0 });
  });
});

describe("受け取る人（selectErrorDigestRecipients）", () => {
  const on: KindPrefsLike = { inapp_enabled: true, push_enabled: true, kind_channels: {} };
  it("super_admin で、Windows通知がオン・エラー種類の Windows がオンの人だけ", () => {
    const members = [
      { id: "sa1", is_super_admin: true },
      { id: "sa2", is_super_admin: true },
      { id: "sa3", is_super_admin: true },
      { id: "sa4", is_super_admin: true, is_deleted: true },
      { id: "m1", is_super_admin: false },
    ];
    const prefs = new Map<string, KindPrefsLike>([
      ["sa1", on],
      ["sa2", { ...on, push_enabled: false }],
      ["sa3", { ...on, kind_channels: { client_error: { push: false } } }],
      ["sa4", on],
      ["m1", on],
    ]);
    expect(selectErrorDigestRecipients(members, prefs)).toEqual(["sa1"]);
  });

  it("設定の行が無い super_admin は Windows がオフ（既定）なので送らない", () => {
    expect(selectErrorDigestRecipients([{ id: "sa1", is_super_admin: true }], new Map())).toEqual([]);
  });
});

describe("文面と窓", () => {
  it("件数と新規件数を載せ、クリック先はエラータブ", () => {
    const p = buildErrorDigestPayload({ total: 3, fresh: 1 });
    expect(p.body).toContain("エラー3件");
    expect(p.body).toContain("新しいエラー1件");
    expect(p.url).toBe(ERROR_DIGEST_URL);
    expect(p.title).toContain("🛡");
    expect(buildErrorDigestPayload({ total: 2, fresh: 0 }).body).not.toContain("新しい");
  });

  it("初回（カーソル無し）は cron の間隔だけ遡る。2回目以降は前回の終わりから", () => {
    const now = new Date(UNTIL);
    expect(resolveDigestWindow(null, now)).toEqual({ since: new Date(now.getTime() - ERROR_DIGEST_INITIAL_LOOKBACK_MS).toISOString(), until: UNTIL });
    expect(resolveDigestWindow(SINCE, now)).toEqual({ since: SINCE, until: UNTIL });
  });
});

// push-reminders（Edge Function）の x-cron-secret 比較。実体は supabase/functions/_shared/ の
// 純粋関数で、ここから相対 import して検証する（reminderLogic.test.ts と同じ置き方）。

import { describe, it, expect } from "vitest";
import { timingSafeEqualString } from "../../../../supabase/functions/_shared/timingSafeEqual";

describe("timingSafeEqualString", () => {
  it("同じ文字列はtrue", () => {
    expect(timingSafeEqualString("super-secret-value", "super-secret-value")).toBe(true);
  });

  it("違う文字列（同じ長さ）はfalse", () => {
    expect(timingSafeEqualString("super-secret-valuA", "super-secret-valuB")).toBe(false);
  });

  it("長さが違う文字列はfalse（長い方が短い方を前方一致していても）", () => {
    expect(timingSafeEqualString("secret", "secret-extra")).toBe(false);
    expect(timingSafeEqualString("secret-extra", "secret")).toBe(false);
  });

  it("空文字同士はtrue・片方だけ空はfalse", () => {
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("", "x")).toBe(false);
    expect(timingSafeEqualString("x", "")).toBe(false);
  });

  it("日本語等マルチバイト文字でも正しく比較する", () => {
    expect(timingSafeEqualString("ひみつ", "ひみつ")).toBe(true);
    expect(timingSafeEqualString("ひみつ", "ヒミツ")).toBe(false);
  });
});

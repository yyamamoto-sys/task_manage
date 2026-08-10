// src/lib/okr/__tests__/okrModeGate.test.ts
//
// shouldShowOkrModeIntro は純粋関数として検証する。
// hasApprovedOkrModeIntro/markOkrModeIntroApproved は localStorage 依存
// （vitest.config.ts が environment: "node" のため localStorage 自体が未定義。
// src/lib/chunkSizeGate.ts と同じ制約）。ここでは「未定義環境でも例外を投げず
// 安全側（false / no-op）に倒れること」だけを検証する。

import { describe, it, expect } from "vitest";
import {
  shouldShowOkrModeIntro,
  hasApprovedOkrModeIntro,
  markOkrModeIntroApproved,
} from "../okrModeGate";

describe("shouldShowOkrModeIntro", () => {
  it("未承認・非ゲストなら表示する", () => {
    expect(shouldShowOkrModeIntro(false, false)).toBe(true);
  });

  it("承認済み・非ゲストなら表示しない", () => {
    expect(shouldShowOkrModeIntro(true, false)).toBe(false);
  });

  it("ゲストは未承認でも表示しない（Supabaseに接続しない設計のため承認を求めない）", () => {
    expect(shouldShowOkrModeIntro(false, true)).toBe(false);
  });

  it("ゲストは承認済みでも当然表示しない", () => {
    expect(shouldShowOkrModeIntro(true, true)).toBe(false);
  });
});

describe("hasApprovedOkrModeIntro / markOkrModeIntroApproved（localStorage例外時に落ちない）", () => {
  it("localStorage未定義環境でも例外を投げず false を返す", () => {
    expect(() => hasApprovedOkrModeIntro()).not.toThrow();
    expect(hasApprovedOkrModeIntro()).toBe(false);
  });

  it("localStorage未定義環境でも例外を投げずに何もしない", () => {
    expect(() => markOkrModeIntroApproved()).not.toThrow();
  });
});

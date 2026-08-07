import { describe, it, expect, afterEach } from "vitest";
import { GuestAiQuotaNotice } from "../GuestAiQuotaNotice";
import { setGuestMode } from "../../../lib/guestMode";

// GuestAiQuotaNoticeはuseT()等のReact Hookを使わない「素の関数」方式で実装している
// （invokeAI.tsのtOutsideと同じ流儀）。そのため、vitest.config.tsのenvironment:"node"
// （Reactレンダラー無し）でもコンポーネント関数を直接呼び出してテストできる
// （GuestAiQuotaNotice.tsx冒頭コメント参照）。

describe("GuestAiQuotaNotice", () => {
  afterEach(() => setGuestMode(false));

  it("ゲストでないときはnullを返す（banner）", () => {
    setGuestMode(false);
    expect(GuestAiQuotaNotice({ variant: "banner" })).toBeNull();
  });

  it("ゲストでないときはnullを返す（inline）", () => {
    setGuestMode(false);
    expect(GuestAiQuotaNotice({ variant: "inline" })).toBeNull();
  });

  it("ゲストのときはbanner/inlineどちらもJSX要素を返す", () => {
    setGuestMode(true);
    expect(GuestAiQuotaNotice({ variant: "banner" })).not.toBeNull();
    expect(GuestAiQuotaNotice({ variant: "inline" })).not.toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { translate } from "../i18n";

describe("translate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("現在言語に値があればそれを返す", () => {
    expect(translate("en", "auth.tab.login")).toBe("Login");
    expect(translate("ja", "auth.tab.login")).toBe("ログイン");
  });

  it("{name} 形式のプレースホルダを差し込む", () => {
    expect(translate("ja", "auth.signup.done.sentTo", { email: "a@example.com" }))
      .toBe("a@example.com 宛にメールを送りました。");
    expect(translate("en", "auth.signup.done.sentTo", { email: "a@example.com" }))
      .toBe("We've sent an email to a@example.com.");
  });

  it("vars に無いプレースホルダはそのまま残す", () => {
    expect(translate("ja", "auth.signup.done.sentTo")).toBe("{email} 宛にメールを送りました。");
  });

  it("未知キーは key 自体を返し console.warn する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(translate("ja", "does.not.exist")).toBe("does.not.exist");
    expect(translate("en", "does.not.exist")).toBe("does.not.exist");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does.not.exist"));
  });
});

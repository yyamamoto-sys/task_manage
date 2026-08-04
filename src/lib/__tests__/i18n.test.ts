import { describe, it, expect, vi, afterEach } from "vitest";
import { translate } from "../i18n";
import { commonJa, commonEn } from "../../i18n/common";
import { authJa, authEn } from "../../i18n/auth";
import { layoutJa, layoutEn } from "../../i18n/layout";

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

/**
 * 【設計意図】
 * ja/en の辞書に片側にしかないキーがあると、実行時にフォールバック＋console.warnで
 * 気づけるだけで「追加漏れ」自体は機械的に検出できない。モジュール単位で辞書を追加する
 * たびにキー集合が完全一致することをここで強制する（差分キー名をエラーメッセージに出す）。
 */
describe("辞書のキー集合（ja/en 完全一致）", () => {
  function diffKeys(a: Record<string, string>, b: Record<string, string>): string[] {
    return Object.keys(a).filter(k => !(k in b));
  }

  const modules: { name: string; ja: Record<string, string>; en: Record<string, string> }[] = [
    { name: "common", ja: commonJa, en: commonEn },
    { name: "auth", ja: authJa, en: authEn },
    { name: "layout", ja: layoutJa, en: layoutEn },
  ];

  for (const { name, ja, en } of modules) {
    it(`${name}: ja/en のキー集合が完全に一致する`, () => {
      const jaOnly = diffKeys(ja, en);
      const enOnly = diffKeys(en, ja);
      expect({ jaOnly, enOnly }).toEqual({ jaOnly: [], enOnly: [] });
    });
  }
});

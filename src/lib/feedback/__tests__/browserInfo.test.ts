// src/lib/feedback/__tests__/browserInfo.test.ts
//
// v3.157：UserAgent の要約（ブラウザ名・メジャー版・OS の列挙値だけ）。判定の順序（Edge・Opera は Chrome を、Chrome は Safari を名乗る）。

import { describe, expect, it } from "vitest";
import { parseUserAgent } from "../browserInfo";

describe("parseUserAgent", () => {
  const cases: [string, string, ReturnType<typeof parseUserAgent>][] = [
    ["Chrome / Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", { browser: "Chrome", major: 130, os: "Windows" }],
    ["Edge（Chrome を名乗る）", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/129.0.2792.89", { browser: "Edge", major: 129, os: "Windows" }],
    ["Opera（Chrome を名乗る）", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0", { browser: "Opera", major: 115, os: "Windows" }],
    ["Firefox / Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", { browser: "Firefox", major: 131, os: "Linux" }],
    ["Safari / macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15", { browser: "Safari", major: 17, os: "macOS" }],
    ["Safari / iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", { browser: "Safari", major: 17, os: "iOS" }],
    ["Chrome / Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", { browser: "Chrome", major: 130, os: "Android" }],
    ["Chrome / iOS（CriOS）", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1", { browser: "Chrome", major: 130, os: "iOS" }],
  ];
  it.each(cases)("%s", (_name, ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });

  it("空・不明・null は Other／メジャー版なし", () => {
    expect(parseUserAgent("")).toEqual({ browser: "Other", major: null, os: "Other" });
    expect(parseUserAgent(null)).toEqual({ browser: "Other", major: null, os: "Other" });
    expect(parseUserAgent("curl/8.0")).toEqual({ browser: "Other", major: null, os: "Other" });
  });

  it("結果に UserAgent の全文や細かい版を含めない（列挙値と数値だけ）", () => {
    const r = parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.6723.92 Safari/537.36");
    expect(Object.keys(r).sort()).toEqual(["browser", "major", "os"]);
    expect(typeof r.major).toBe("number");
  });
});

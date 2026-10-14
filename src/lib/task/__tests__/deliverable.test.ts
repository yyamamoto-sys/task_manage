import { describe, it, expect } from "vitest";
import {
  extractDeliverableUrls, stripDeliverableUrls, deliverableTooltipText, deliverableForAi,
  buildDeliverableLink, isSafeHttpUrl, DELIVERABLE_AI_MAX_CHARS,
} from "../deliverable";

describe("extractDeliverableUrls", () => {
  it("http/https の URL を出てきた順に（重複なし）", () => {
    expect(extractDeliverableUrls("資料 https://a.example.com/x と http://b.example.com/y と https://a.example.com/x"))
      .toEqual(["https://a.example.com/x", "http://b.example.com/y"]);
  });
  it("javascript: data: file: は検出しない", () => {
    expect(extractDeliverableUrls("javascript:alert(1) data:text/html,x file:///c:/a")).toEqual([]);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });
  it("末尾の句読点・閉じ括弧は URL に含めない／URL 内の括弧は残す", () => {
    expect(extractDeliverableUrls("（https://x.example.com/a）。")).toEqual(["https://x.example.com/a"]);
    expect(extractDeliverableUrls("見てください https://x.example.com/a、")).toEqual(["https://x.example.com/a"]);
    expect(extractDeliverableUrls("https://ja.wikipedia.org/wiki/A_(B)")).toEqual(["https://ja.wikipedia.org/wiki/A_(B)"]);
  });
  it("www. 始まりは https:// を補って開く", () => {
    expect(extractDeliverableUrls("参照 www.example.com/a です")).toEqual(["https://www.example.com/a"]);
    expect(extractDeliverableUrls("awww.example.com")).toEqual([]);
  });
  it("日本語を含むパスも1つの URL として拾い、encodeURI して開く（%エンコード済みは二重にしない）", () => {
    expect(extractDeliverableUrls("https://x.example.com/共有/資料.pdf を見る"))
      .toEqual(["https://x.example.com/%E5%85%B1%E6%9C%89/%E8%B3%87%E6%96%99.pdf"]);
    expect(extractDeliverableUrls("https://x.example.com/%E8%B3%87")).toEqual(["https://x.example.com/%E8%B3%87"]);
  });
  it("空白・全角空白・全角括弧・引用符・読点で止まる", () => {
    expect(extractDeliverableUrls("https://x.example.com/a\u3000次")).toEqual(["https://x.example.com/a"]);
    expect(extractDeliverableUrls("（https://x.example.com/a）")).toEqual(["https://x.example.com/a"]);
    expect(extractDeliverableUrls("「https://x.example.com/a」と、https://y.example.com/b、")).toEqual(["https://x.example.com/a", "https://y.example.com/b"]);
    expect(extractDeliverableUrls('"https://x.example.com/a"')).toEqual(["https://x.example.com/a"]);
  });
  it("javascript: を www 風に偽装しても開ける形にならない", () => {
    expect(extractDeliverableUrls("javascript://www.example.com/%0aalert(1)")).toEqual(["https://www.example.com/%0aalert(1)"]);
    expect(extractDeliverableUrls("javascript:alert(1)")).toEqual([]);
  });
  it("空・未設定は空配列", () => {
    expect(extractDeliverableUrls("")).toEqual([]);
    expect(extractDeliverableUrls(undefined)).toEqual([]);
  });
});

describe("説明（URL を除いた本文）", () => {
  it("URL を除き空白を詰める", () => {
    expect(stripDeliverableUrls("第2回の資料 https://x.example.com/a です")).toBe("第2回の資料 です");
    expect(stripDeliverableUrls("https://x.example.com/a")).toBe("");
  });
  it("ツールチップは長いと省略する", () => {
    expect(deliverableTooltipText("あ".repeat(200)).endsWith("…")).toBe(true);
  });
});

describe("deliverableForAi（AIへは説明だけ）", () => {
  it("URL・メールアドレス・ネットワークパスが残らない", () => {
    const out = deliverableForAi(String.raw`報告書 https://example.com/secret?token=abc を tanaka@example.com へ \\fs02\bumon\x.xlsx`);
    expect(out).not.toContain("example.com/secret");
    expect(out).not.toContain("tanaka@example.com");
    expect(out).not.toContain("fs02");
    expect(out).toContain("報告書");
  });
  it("www.・日本語パスの URL も除去する", () => {
    const out = deliverableForAi("資料 www.example.com/a と https://x.example.com/共有/資料.pdf です");
    expect(out).not.toContain("example.com");
    expect(out).toContain("資料");
  });
  it("長さを切る", () => {
    expect(deliverableForAi("あ".repeat(1000)).length).toBeLessThanOrEqual(DELIVERABLE_AI_MAX_CHARS + 1);
  });
  it("空は空文字", () => expect(deliverableForAi(undefined)).toBe(""));
});

describe("buildDeliverableLink（📎）", () => {
  it("URL が無ければ null", () => expect(buildDeliverableLink("説明だけ")).toBeNull());
  it("最初の1件を開き、複数なら案内をツールチップに出す", () => {
    const l = buildDeliverableLink("資料 https://a.example.com/1 https://b.example.com/2");
    expect(l?.url).toBe("https://a.example.com/1");
    expect(l?.total).toBe(2);
    expect(l?.tooltip).toContain("資料");
    expect(l?.tooltip).toContain("ほか1件");
  });
});

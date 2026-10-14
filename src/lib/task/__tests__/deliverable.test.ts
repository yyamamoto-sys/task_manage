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
  it("直後に続く日本語を巻き込まない", () => {
    expect(extractDeliverableUrls("https://x.example.com/a資料")).toEqual(["https://x.example.com/a"]);
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

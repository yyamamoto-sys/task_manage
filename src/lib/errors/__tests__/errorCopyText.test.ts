import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildErrorCopyText, fenceFor, firstLine, formatJst, matchNewErrors, type ErrorCopyInput } from "../errorCopyText";

function sample(over: Partial<ErrorCopyInput> = {}): ErrorCopyInput {
  return {
    id: 1, source: "boundary", message: "Cannot read properties of undefined (reading 'name')\n  at X",
    code: null, context: "ErrorBoundary", stack: "TypeError: x\n    at Foo (app.js:1:2)",
    route: "/projects", screen: "list", app_version: "3.150", user_agent: "Mozilla/5.0 Test",
    first_seen: "2026-10-14T00:00:00Z", last_seen: "2026-10-14T01:30:00Z", count: 4, reporter_count: 2, resolved_at: null,
    ...over,
  };
}
const NOW = new Date("2026-10-14T06:05:00Z");

describe("buildErrorCopyText", () => {
  it("件数・版・JST 日時・依頼文を冒頭に入れ、入力順に番号を振る", () => {
    const text = buildErrorCopyText([sample({ id: 1, message: "first" }), sample({ id: 2, message: "second" })], { now: NOW, appVersion: "3.151" });
    expect(text).toContain("画面エラー 2件（コピー日時 2026-10-14 15:05 JST・アプリの版 v3.151）");
    expect(text).toContain("原因を調べて、対策を提案してください。");
    expect(text.indexOf("## 1. first")).toBeGreaterThan(-1);
    expect(text.indexOf("## 1. first")).toBeLessThan(text.indexOf("## 2. second"));
    expect(text).toContain("- 回数：4／発生した人数：2");
    expect(text).toContain("最初の発生：2026-10-14 09:00 JST／最後の発生：2026-10-14 10:30 JST");
    expect(text).toContain("- 状態：未解決");
    expect(buildErrorCopyText([sample({ resolved_at: "2026-10-14T02:00:00Z" })], { now: NOW, appVersion: "3.151" })).toContain("- 状態：解決済み");
  });

  it("見出しはメッセージの1行目、全文とスタックは別のブロックに入る", () => {
    const text = buildErrorCopyText([sample()], { now: NOW, appVersion: "3.151" });
    expect(text).toContain("## 1. Cannot read properties of undefined (reading 'name')\n");
    expect(text).toContain("### メッセージ全文\n```text\nCannot read properties of undefined (reading 'name')\n  at X\n```");
    expect(text).toContain("### スタック\n```text\nTypeError: x");
  });

  it("メール・トークンを伏せ、人を特定する項目（member_id・表示名）は文面に出ない", () => {
    const withPerson = {
      ...sample({ message: "failed for taro@example.co.jp Bearer abcdef123456.xyz", stack: "token=1", user_agent: "UA taro@example.co.jp" }),
      member_id: "m-secret-001", display_name: "山田太郎", resolved_by: "m-secret-002",
    } as ErrorCopyInput;
    const text = buildErrorCopyText([withPerson], { now: NOW, appVersion: "3.151" });
    expect(text).not.toContain("taro@example.co.jp");
    expect(text).toContain("[email]");
    expect(text).not.toContain("abcdef123456");
    expect(text).not.toContain("m-secret-001");
    expect(text).not.toContain("m-secret-002");
    expect(text).not.toContain("山田太郎");
  });

  it("中身に ``` があっても柵を長くしてコードブロックが崩れない", () => {
    const text = buildErrorCopyText([sample({ message: "a ```b``` c", stack: "x ````y" })], { now: NOW, appVersion: "3.151" });
    expect(text).toContain("````text\na ```b``` c\n````");
    expect(text).toContain("`````text\nx ````y\n`````");
  });

  it("スタックが無いときは(スタックなし)、null の項目は - にする", () => {
    const text = buildErrorCopyText([sample({ stack: null, code: null, screen: null })], { now: NOW, appVersion: "3.151" });
    expect(text).toContain("(スタックなし)");
    expect(text).toContain("コード（code）：-");
    expect(text).toContain("画面（screen）：-");
  });
});

describe("補助関数", () => {
  it("fenceFor は最長のバッククォート列+1（最低3）", () => {
    expect(fenceFor("abc")).toBe("```");
    expect(fenceFor("``")).toBe("```");
    expect(fenceFor("```")).toBe("````");
  });
  it("firstLine は先頭の空行を飛ばし120字で切る", () => {
    expect(firstLine("\n\n  hello \nworld")).toBe("hello");
    expect(firstLine("あ".repeat(130))).toBe("あ".repeat(120) + "…");
    expect(firstLine("")).toBe("(メッセージなし)");
  });
  it("formatJst は UTC+9", () => {
    expect(formatJst("2026-10-14T16:30:00Z")).toBe("2026-10-15 01:30");
  });
});

describe("matchNewErrors（新規＝未読の通知と同じ時刻に last_notified_at が更新されたエラー）", () => {
  const logs = [
    { id: 1, last_notified_at: "2026-10-14T01:00:00.123456+00:00" },
    { id: 2, last_notified_at: "2026-10-13T01:00:00+00:00" },
    { id: 3, last_notified_at: null },
  ];
  it("時刻が一致するものだけを返し、書式の違い（マイクロ秒・Z）は吸収する", () => {
    expect(matchNewErrors(["2026-10-14T01:00:00.123Z"], logs).map(l => l.id)).toEqual([1]);
    expect(matchNewErrors([], logs)).toEqual([]);
    expect(matchNewErrors(["garbage"], logs)).toEqual([]);
  });
});

describe("super_admin 以外には描画しない（ソース走査・コメント除去後。Section 59）", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bell = strip(readFileSync("src/components/notifications/InAppNotificationBell.tsx", "utf8"));
  it("ErrorCopyPanel は isSuperAdmin && の直後でだけ描画され、他の場所では使われない", () => {
    expect(bell).toMatch(/\{isSuperAdmin && <ErrorCopyPanel /);
    expect(bell.match(/<ErrorCopyPanel/g)?.length).toBe(1);
  });
  it("パネルの取得 effect は翻訳関数を依存に持たず、member_id を文面に渡さない", () => {
    const panel = strip(readFileSync("src/components/notifications/ErrorCopyPanel.tsx", "utf8"));
    expect(panel).toMatch(/\}, \[memberId, tab\]\);/);
    const store = strip(readFileSync("src/lib/supabase/clientErrorStore.ts", "utf8"));
    const fn = store.slice(store.indexOf("fetchClientErrorsNotifiedSince"));
    expect(fn).not.toMatch(/select\([^)]*member_id/);
  });
});

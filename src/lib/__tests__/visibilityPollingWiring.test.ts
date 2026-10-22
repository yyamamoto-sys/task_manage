// DB に問い合わせる定期処理は、非表示の間は取りに行かない（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
// 🔴 Section 59：コメントを除去してから走査する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("AdminView の AI使用量（30秒ごとの reload）", () => {
  const src = code("src/components/admin/AdminView.tsx");
  it("非表示の間は取らず、前面に戻ったら1回取る", () => {
    expect(src).toMatch(/setInterval\(\(\) => \{ if \(!isDocumentHidden\(\)\) void reload\(true\); \}, 30_000\)/);
    expect(src).toMatch(/addEventListener\("visibilitychange", onVisible\)/);
    expect(src).toMatch(/removeEventListener\("visibilitychange", onVisible\)/);
  });
});

describe("src 配下の setInterval で DB を読むものは非表示を見る", () => {
  // DB に問い合わせる定期処理の許可リスト（ここに無い setInterval は、DB を読まないもの）。足すときは非表示の扱いを書く
  it("ベルの定期取得は shouldPollBell（非表示では false）を通す", () => {
    const src = code("src/components/notifications/InAppNotificationBell.tsx");
    expect(src).toMatch(/shouldPollBell\(\{ hidden: isDocumentHidden\(\)/);
  });
  it("ベルの未読数の取得は非表示では何もしない", () => {
    const src = code("src/components/notifications/InAppNotificationBell.tsx");
    expect(src).toMatch(/const refreshCount = useCallback\(async \(\) => \{\s*if \(isDocumentHidden\(\)\) return;/);
  });
});

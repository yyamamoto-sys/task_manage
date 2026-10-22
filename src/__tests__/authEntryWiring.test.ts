// 認証の入口（App.tsx・AccessDeniedScreen）の配線をソース走査で固定する（コメントは除去して走査＝Section 59）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
const read = (rel: string) => strip(fs.readFileSync(path.resolve(here, "..", rel), "utf-8"));

describe("App.tsx の認証の入口", () => {
  const app = read("App.tsx");
  it("SIGNED_OUT で前ユーザーの状態を切る（shouldReloadOnSignedOut → clearCurrentUser → reload）", () => {
    const i = app.indexOf("shouldReloadOnSignedOut({");
    expect(i).toBeGreaterThan(0);
    const body = app.slice(i, i + 400);
    expect(body).toMatch(/clearCurrentUser\(\)/);
    expect(body).toMatch(/window\.location\.reload\(\)/);
  });
  it("初回取得の失敗はアクセス拒否画面より先に判定する", () => {
    const failed = app.indexOf("<StartupLoadFailedScreen");
    const denied = app.indexOf("<AccessDeniedScreen");
    expect(failed).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(failed);
  });
  it("システム空判定は取得エラー中は走らせない", () => {
    expect(app).toMatch(/if \(loading \|\| isWizardDone \|\| error\) return;/);
  });
});

describe("AccessDeniedScreen のログアウト", () => {
  it("自分では signOut を呼ばない（App.tsx の handleLogout が失敗の通知つきで行う）", () => {
    expect(read("components/auth/AccessDeniedScreen.tsx")).not.toMatch(/\bsignOut\(/);
  });
});

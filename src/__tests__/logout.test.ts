// src/__tests__/logout.test.ts
//
// 【設計意図】
// 2026-08-06に発生した不具合（「ログアウトを押してもログアウトできない」）の再発防止テスト。
// 原因は App.tsx の handleLogout が Supabase の signOut() を呼ばずローカルの選択状態だけを
// 消していたこと。currentUser が null になった瞬間、AuthenticatedApp の autoMatch()
// （認証セッションはまだ生きている）が Auth email 一致で同じユーザーに即座に自動ログイン
// し直してしまい、押しても何も起きないように見えていた。
//
// App.tsx はレンダリング用のフック・Provider に依存しており、React Testing Library 等での
// 実マウントはこのリポジトリに前例が無い（.tsx コンポーネントテストは現状ゼロ）。そのため
// modalStyles.test.ts / widgetContract.test.ts と同じ「ソースを読んで検査する」方式を採る。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../");
const APP_TSX_PATH = path.resolve(SRC_DIR, "App.tsx");

/** App.tsx 内の `const handleLogout = ... };` ブロックだけを取り出す */
function extractHandleLogoutBody(source: string): string {
  const start = source.indexOf("const handleLogout");
  expect(start, "App.tsx に handleLogout の定義が見つかりません").toBeGreaterThanOrEqual(0);
  // 次のトップレベル宣言（handleWizardComplete）の手前までを対象とする
  const end = source.indexOf("const handleWizardComplete", start);
  expect(end, "handleLogout の終端（次のconst宣言）が見つかりません").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("App.tsx の handleLogout：signOut() を必ず呼ぶ（ログアウトが効かない不具合の再発防止）", () => {
  const source = fs.readFileSync(APP_TSX_PATH, "utf-8");
  const body = extractHandleLogoutBody(source);

  it("Supabase の signOut() を import している", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bsignOut\b[^}]*\}\s*from\s*["']\.\/lib\/supabase\/auth["']/);
  });

  it("handleLogout の中で signOut() を呼んでいる", () => {
    expect(body).toMatch(/\bsignOut\(\)/);
  });

  it("signOut() の呼び出しが、ローカル状態のクリア（clearCurrentUser）より前にある", () => {
    // クリア処理が先に走ると、currentUser=null をトリガーに autoMatch() が
    // まだ生きている認証セッションを使って再ログインしてしまう隙が生まれるため、
    // 順序（signOut→クリア）そのものを固定する。
    const signOutIndex = body.search(/\bsignOut\(\)/);
    const clearIndex = body.search(/\bclearCurrentUser\(\)/);
    expect(signOutIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(signOutIndex).toBeLessThan(clearIndex);
  });

  it("signOut() が失敗した場合に無言で終わらず、エラーを表示する経路がある", () => {
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/showToast/);
  });

  it("ログアウト後に前ユーザーのデータを残さないため、ストアの残留を断つ処理（reload）がある", () => {
    expect(body).toMatch(/window\.location\.reload\(\)/);
  });
});

describe("onLogout の直接呼び出し箇所：signOut 経路を必ず通る（二重呼び出しの取り違え防止）", () => {
  /**
   * `onLogout()`（プロパティの参照渡し `onClick={onLogout}` ではなく、実際の関数呼び出し）
   * をしているファイルを src 全体から洗い出す。App.tsx の handleLogout 自体は signOut() を
   * 内包するようになったため、他のファイルが自前で signOut() せずに onLogout() だけ呼んでも
   * ログアウト自体は成立する。ここでは「新しい直接呼び出し箇所が増えたら気づけること」を
   * 目的に、既知の1箇所（AccessDeniedScreen.tsx）だけであることを固定する。
   */
  function collectDirectCallSites(dir: string, results: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectDirectCallSites(full, results);
      } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
        const content = fs.readFileSync(full, "utf-8");
        if (/\bonLogout\(\)/.test(content)) {
          results.push(path.relative(SRC_DIR, full).replace(/\\/g, "/"));
        }
      }
    }
    return results;
  }

  it("onLogout() の直接呼び出しは AccessDeniedScreen.tsx のみである", () => {
    const sites = collectDirectCallSites(SRC_DIR, []);
    expect(sites).toEqual(["components/auth/AccessDeniedScreen.tsx"]);
  });

  it("AccessDeniedScreen.tsx は onLogout() を呼ぶ前に自前で signOut() している（二重signOutが起きる経路）", () => {
    const content = fs.readFileSync(
      path.resolve(SRC_DIR, "components/auth/AccessDeniedScreen.tsx"),
      "utf-8",
    );
    const signOutIndex = content.search(/\bsignOut\(\)/);
    const onLogoutIndex = content.search(/\bonLogout\(\)/);
    expect(signOutIndex).toBeGreaterThanOrEqual(0);
    expect(onLogoutIndex).toBeGreaterThan(signOutIndex);
  });
});

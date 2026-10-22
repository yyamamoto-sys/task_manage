// M71：アクセス拒否画面の案内が「メールの不一致」に気づける文になっていること。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessDeniedScreen } from "../AccessDeniedScreen";
import { authJa } from "../../../i18n/auth.ja";

describe("AccessDeniedScreen の案内（M71）", () => {
  const html = renderToStaticMarkup(createElement(AccessDeniedScreen, { onLogout: () => {} }));
  it("個人のメールアドレスでログインしていないかの確認を促す", () => {
    expect(html).toContain("メンバー登録は会社のメールアドレスで行われています。個人のメールアドレス（Gmail 等）でログインしていないか確認してください。");
  });
  it("ログアウトボタンは登録済みのアドレスで入り直す案内", () => {
    expect(html).toContain("ログアウトして登録済みのアドレスで入り直す");
  });
  it("解決しない場合の管理者への連絡を案内する", () => {
    expect(html).toContain("解決しない場合は管理者に連絡し");
  });
  it("案内文に問いかけ・感嘆符を使わない（ja）", () => {
    const keys = ["body1", "body2", "body3", "logoutButton"] as const;
    for (const k of keys) expect(authJa[`auth.accessDenied.${k}`]).not.toMatch(/[?？!！]/);
  });
  it("ログイン中のメールアドレスを表示する枠が残っている", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, "../AccessDeniedScreen.tsx"), "utf-8");
    expect(src).toMatch(/getAuthEmail\(\)\.then\(setEmail\)/);
    expect(src).toMatch(/\{email && \(\s*<div[\s\S]*?\{email\}/);
  });
});

// M72：前回ユーザーの自動ログインは Auth メールと前回ユーザーのメールが一致するときだけ。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSavedUserAutoLogin } from "../savedUserMatch";
import type { Member } from "../../localData/types";

const m = (id: string, email?: string): Member => ({ id, email } as unknown as Member);
const members = [m("a", "Taro@Example.com"), m("b", "hanako@example.com"), m("c"), m("d", "  ")];

describe("resolveSavedUserAutoLogin", () => {
  it("一致すれば従来どおりそのメンバー（大文字小文字・前後の空白は無視）", () => {
    expect(resolveSavedUserAutoLogin("a", members, "  taro@example.COM ")?.id).toBe("a");
  });
  it("Auth メールが前回ユーザーのメールと違えば自動ログインしない", () => {
    expect(resolveSavedUserAutoLogin("a", members, "someone@gmail.com")).toBeNull();
    expect(resolveSavedUserAutoLogin("b", members, "taro@example.com")).toBeNull();
  });
  it("前回ユーザーの email が空（未設定・空白だけ）なら対象外", () => {
    expect(resolveSavedUserAutoLogin("c", members, "taro@example.com")).toBeNull();
    expect(resolveSavedUserAutoLogin("d", members, "taro@example.com")).toBeNull();
  });
  it("Auth メールが取れない・前回ユーザーが居ない・members に居ないときは null", () => {
    expect(resolveSavedUserAutoLogin("a", members, null)).toBeNull();
    expect(resolveSavedUserAutoLogin("a", members, "  ")).toBeNull();
    expect(resolveSavedUserAutoLogin(undefined, members, "taro@example.com")).toBeNull();
    expect(resolveSavedUserAutoLogin("zzz", members, "taro@example.com")).toBeNull();
  });
});

describe("App.tsx の autoMatch の配線（コメント除去のソース走査＝Section 59）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  const app = strip(fs.readFileSync(path.resolve(here, "../../../App.tsx"), "utf-8"));
  const i = app.indexOf("async function autoMatch()");
  const body = app.slice(i, app.indexOf("void autoMatch();", i));
  it("前回ユーザーは判定関数を通し、不一致なら localStorage の前回ユーザーを消す", () => {
    expect(i).toBeGreaterThan(0);
    expect(body).toMatch(/resolveSavedUserAutoLogin\(saved\?\.id, activeMembers, authEmail\)/);
    expect(body).toMatch(/if \(saved && !member\) clearCurrentUser\(\)/);
  });
  it("members を id だけで引いて自動ログインする旧経路が残っていない", () => {
    expect(body).not.toMatch(/activeMembers\.find\(m => m\.id === saved/);
  });
});

import { describe, it, expect } from "vitest";
import {
  isAllowedInviteEmailDomain,
  computeInviteExpiresAt,
  isInviteExpired,
  generateInviteCode,
  isValidInviteCodeFormat,
  INVITE_CODE_LENGTH,
  DEFAULT_ALLOWED_INVITE_EMAIL_DOMAINS,
} from "../inviteRules";

describe("isAllowedInviteEmailDomain", () => {
  it("許可ドメインのメールを許可する", () => {
    expect(isAllowedInviteEmailDomain("user@amita-net.co.jp")).toBe(true);
  });

  it("許可外のドメインを拒否する", () => {
    expect(isAllowedInviteEmailDomain("user@evil.com")).toBe(false);
  });

  it("許可ドメインを末尾に含むだけの偽装ドメインを拒否する（部分一致にしない）", () => {
    expect(isAllowedInviteEmailDomain("user@amita-net.co.jp.evil.com")).toBe(false);
  });

  it("許可ドメインを先頭に含むだけの偽装ドメインを拒否する", () => {
    expect(isAllowedInviteEmailDomain("user@amita-net.co.jp-evil.com")).toBe(false);
  });

  it("サブドメインは自動では許可しない（既定では明示リストに無いため拒否）", () => {
    expect(isAllowedInviteEmailDomain("user@sub.amita-net.co.jp")).toBe(false);
  });

  it("サブドメインを明示的に許可リストへ追加した場合は許可する", () => {
    expect(
      isAllowedInviteEmailDomain("user@sub.amita-net.co.jp", ["amita-net.co.jp", "sub.amita-net.co.jp"]),
    ).toBe(true);
  });

  it("大文字小文字を無視する", () => {
    expect(isAllowedInviteEmailDomain("USER@AMITA-NET.CO.JP")).toBe(true);
  });

  it("前後の空白を無視する", () => {
    expect(isAllowedInviteEmailDomain("  user@amita-net.co.jp  ")).toBe(true);
  });

  it("複数の@を含む入力は最後の@より後ろだけをドメインとして扱う（偽装に使われる先頭@を無視）", () => {
    // "a@amita-net.co.jp@evil.com" を最初の@で区切ると誤って "amita-net.co.jp" を
    // 抜き出してしまう。実際のドメインは最後の@より後ろの "evil.com" であり、拒否されるべき。
    expect(isAllowedInviteEmailDomain("a@amita-net.co.jp@evil.com")).toBe(false);
  });

  it("@が無い文字列を拒否する", () => {
    expect(isAllowedInviteEmailDomain("not-an-email")).toBe(false);
  });

  it("空文字列を拒否する", () => {
    expect(isAllowedInviteEmailDomain("")).toBe(false);
  });

  it("@の直後が空（ドメイン欠落）を拒否する", () => {
    expect(isAllowedInviteEmailDomain("user@")).toBe(false);
  });

  it("複数ドメインを指定できる（案内どおり配列で複数指定可能）", () => {
    const allowed = ["amita-net.co.jp", "amita-holdings.co.jp"];
    expect(isAllowedInviteEmailDomain("user@amita-holdings.co.jp", allowed)).toBe(true);
    expect(isAllowedInviteEmailDomain("user@amita-net.co.jp", allowed)).toBe(true);
    expect(isAllowedInviteEmailDomain("user@other.co.jp", allowed)).toBe(false);
  });

  it("既定の許可ドメインはamita-net.co.jpのみ", () => {
    expect(DEFAULT_ALLOWED_INVITE_EMAIL_DOMAINS).toEqual(["amita-net.co.jp"]);
  });
});

describe("computeInviteExpiresAt / isInviteExpired", () => {
  it("発行から24時間後を返す", () => {
    const issuedAt = new Date("2026-08-10T09:00:00Z");
    const expiresAt = computeInviteExpiresAt(issuedAt);
    expect(expiresAt.toISOString()).toBe("2026-08-11T09:00:00.000Z");
  });

  it("期限より前はfalse", () => {
    const expiresAt = new Date("2026-08-11T09:00:00Z");
    const now = new Date("2026-08-11T08:59:59Z");
    expect(isInviteExpired(expiresAt, now)).toBe(false);
  });

  it("期限ちょうどはtrue（境界含む。SQL側のexpires_at <= now()と同じ扱い）", () => {
    const expiresAt = new Date("2026-08-11T09:00:00Z");
    expect(isInviteExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("期限より後はtrue", () => {
    const expiresAt = new Date("2026-08-11T09:00:00Z");
    const now = new Date("2026-08-11T09:00:01Z");
    expect(isInviteExpired(expiresAt, now)).toBe(true);
  });
});

describe("generateInviteCode / isValidInviteCodeFormat", () => {
  it("長さが64桁である", () => {
    expect(generateInviteCode().length).toBe(INVITE_CODE_LENGTH);
  });

  it("文字種が16進数（0-9a-f）のみである", () => {
    const code = generateInviteCode();
    expect(/^[0-9a-f]+$/.test(code)).toBe(true);
  });

  it("ハイフンを含まない", () => {
    expect(generateInviteCode()).not.toContain("-");
  });

  it("呼び出しごとに異なるコードを生成する", () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(a).not.toBe(b);
  });

  it("生成したコードはisValidInviteCodeFormatを満たす", () => {
    expect(isValidInviteCodeFormat(generateInviteCode())).toBe(true);
  });

  it("長さが違えば無効", () => {
    expect(isValidInviteCodeFormat("abcd")).toBe(false);
  });

  it("16進数以外の文字を含めば無効", () => {
    expect(isValidInviteCodeFormat("g".repeat(INVITE_CODE_LENGTH))).toBe(false);
  });
});

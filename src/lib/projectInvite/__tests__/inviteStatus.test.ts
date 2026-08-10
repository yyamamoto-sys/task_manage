import { describe, it, expect } from "vitest";
import { resolveInviteStatus, PROJECT_INVITE_STATUS_LABEL } from "../inviteStatus";

const NOW = new Date("2026-08-10T12:00:00Z");
const FUTURE = "2026-08-11T12:00:00Z";
const PAST = "2026-08-09T12:00:00Z";

describe("resolveInviteStatus", () => {
  it("未使用・未取消・期限内 → unused", () => {
    expect(resolveInviteStatus({ accepted_at: null, revoked_at: null, expires_at: FUTURE }, NOW)).toBe("unused");
  });

  it("accepted_at がある → used（revoked_atが同時にあっても used が優先）", () => {
    expect(resolveInviteStatus(
      { accepted_at: "2026-08-10T10:00:00Z", revoked_at: "2026-08-10T11:00:00Z", expires_at: FUTURE },
      NOW,
    )).toBe("used");
  });

  it("accepted_at がある → used（期限切れでも used が優先）", () => {
    expect(resolveInviteStatus({ accepted_at: "2026-08-09T00:00:00Z", revoked_at: null, expires_at: PAST }, NOW))
      .toBe("used");
  });

  it("revoked_at がある（未使用）→ revoked", () => {
    expect(resolveInviteStatus({ accepted_at: null, revoked_at: "2026-08-10T11:00:00Z", expires_at: FUTURE }, NOW))
      .toBe("revoked");
  });

  it("期限切れ（now > expires_at）→ expired", () => {
    expect(resolveInviteStatus({ accepted_at: null, revoked_at: null, expires_at: PAST }, NOW)).toBe("expired");
  });

  it("境界値：now と expires_at が完全一致 → expired（期限切れ側に含む）", () => {
    expect(resolveInviteStatus({ accepted_at: null, revoked_at: null, expires_at: NOW.toISOString() }, NOW))
      .toBe("expired");
  });

  it("境界値：expires_at の1ms前 → まだ unused", () => {
    const justBefore = new Date(NOW.getTime() + 1).toISOString();
    expect(resolveInviteStatus({ accepted_at: null, revoked_at: null, expires_at: justBefore }, NOW))
      .toBe("unused");
  });

  it("undefined のaccepted_at/revoked_atも欠落として扱う", () => {
    expect(resolveInviteStatus({ expires_at: FUTURE }, NOW)).toBe("unused");
  });

  it("PROJECT_INVITE_STATUS_LABEL が4状態すべてを持つ", () => {
    expect(Object.keys(PROJECT_INVITE_STATUS_LABEL).sort()).toEqual(
      ["expired", "revoked", "unused", "used"],
    );
  });
});

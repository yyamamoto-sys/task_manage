import { describe, it, expect } from "vitest";
import { isPushReceivedMessage } from "../swMessage";

describe("isPushReceivedMessage", () => {
  it("type:push-received なら true", () => {
    expect(isPushReceivedMessage({ type: "push-received" })).toBe(true);
  });

  it("別のtype（notification-click等）はfalse", () => {
    expect(isPushReceivedMessage({ type: "notification-click", url: "/" })).toBe(false);
  });

  it("null/undefined/プリミティブはfalse", () => {
    expect(isPushReceivedMessage(null)).toBe(false);
    expect(isPushReceivedMessage(undefined)).toBe(false);
    expect(isPushReceivedMessage("push-received")).toBe(false);
  });
});

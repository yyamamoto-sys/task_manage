import { describe, it, expect } from "vitest";
import { resolveNotificationClickUrl } from "../notificationClickUrl";

const ORIGIN = "https://task-manage.example.com";

describe("resolveNotificationClickUrl", () => {
  it("同一オリジンの相対URLはそのまま開く", () => {
    expect(resolveNotificationClickUrl("/?open=my-tasks", ORIGIN)).toBe("/?open=my-tasks");
  });

  it("同一オリジンの絶対URLはパス部分を開く", () => {
    expect(resolveNotificationClickUrl(`${ORIGIN}/?open=my-tasks`, ORIGIN)).toBe("/?open=my-tasks");
  });

  it("他オリジンのURLは \"/\" を開く（外部へ遷移しない）", () => {
    expect(resolveNotificationClickUrl("https://evil.example.com/phish", ORIGIN)).toBe("/");
  });

  it("プロトコル相対URLで他オリジンに化けるケースも \"/\"", () => {
    expect(resolveNotificationClickUrl("//evil.example.com/phish", ORIGIN)).toBe("/");
  });

  it("壊れたURL文字列も \"/\"", () => {
    expect(resolveNotificationClickUrl("http://", ORIGIN)).toBe("/");
  });

  it("空文字は \"/\"", () => {
    expect(resolveNotificationClickUrl("", ORIGIN)).toBe("/");
  });
});

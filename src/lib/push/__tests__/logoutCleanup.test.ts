import { describe, it, expect, vi } from "vitest";
import { cleanupPushSubscriptionOnLogout } from "../logoutCleanup";

describe("cleanupPushSubscriptionOnLogout", () => {
  it("購読があればunsubscribe→DB削除の順に呼ぶ", async () => {
    const unsubscribe = vi.fn().mockResolvedValue("https://example.com/ep1");
    const deleteRow = vi.fn().mockResolvedValue(undefined);

    await cleanupPushSubscriptionOnLogout(unsubscribe, deleteRow);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deleteRow).toHaveBeenCalledWith("https://example.com/ep1");
  });

  it("このブラウザが未購読（null）ならDB削除は呼ばない", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(null);
    const deleteRow = vi.fn().mockResolvedValue(undefined);

    await cleanupPushSubscriptionOnLogout(unsubscribe, deleteRow);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("unsubscribeが失敗してもログアウトを止めない（例外を投げない）", async () => {
    const unsubscribe = vi.fn().mockRejectedValue(new Error("boom"));
    const deleteRow = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(cleanupPushSubscriptionOnLogout(unsubscribe, deleteRow)).resolves.toBeUndefined();

    expect(deleteRow).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("DB削除が失敗してもログアウトを止めない（例外を投げない）", async () => {
    const unsubscribe = vi.fn().mockResolvedValue("https://example.com/ep1");
    const deleteRow = vi.fn().mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(cleanupPushSubscriptionOnLogout(unsubscribe, deleteRow)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

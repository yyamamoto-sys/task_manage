// 診断（chunk-load 等）を直接送る createDirectLogger と、動的 import の失敗を無視リストから外したこと（v3.146）。
import { describe, it, expect, vi } from "vitest";
import { createDirectLogger, isIgnoredError } from "../clientErrorLog";

const env = () => ({ route: "/", screen: "list", appVersion: "3.146", userAgent: "ua" });
const flush = () => new Promise(r => setTimeout(r, 0));

describe("動的 import の失敗は無視リストに入っていない", () => {
  it("lazyWithRetry の外（FileAttachButton 等）で起きたものは通常の経路で記録される", () => {
    expect(isIgnoredError("Failed to fetch dynamically imported module: https://x/a.js")).toBe(false);
    expect(isIgnoredError("Importing a module script failed")).toBe(false);
    expect(isIgnoredError("AbortError: x")).toBe(true);
  });
});

describe("createDirectLogger", () => {
  it("送る／同じ fingerprint は1分に1回", async () => {
    let now = 0;
    const send = vi.fn(async (_p: unknown) => {});
    const log = createDirectLogger({ send, canSend: async () => true, env, now: () => now });
    const input = { source: "report" as const, code: "chunk-load", message: "m", context: "chunk-load:A v3.146" };
    log(input); log(input);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ p_source: "report", p_code: "chunk-load" });
    now = 61_000;
    log(input);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("canSend が false なら送らない／送信失敗は握って console.warn のみ", async () => {
    const input = { source: "report" as const, code: "chunk-load", message: "m", context: "c" };
    const send = vi.fn(async () => {});
    createDirectLogger({ send, canSend: async () => false, env })(input);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createDirectLogger({ send: async () => { throw new Error("x"); }, canSend: async () => true, env })(input);
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

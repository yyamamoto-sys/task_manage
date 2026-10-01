// src/lib/errors/__tests__/clientErrorLog.test.ts
//
// 画面のエラー記録（v3.129）：伏せ字・切り詰め・fingerprint の作り方・送信の間引き・無限ループ防止。

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_MESSAGE_CHARS, MAX_SENDS_PER_HOUR, SAME_FINGERPRINT_INTERVAL_MS,
  buildClientErrorPayload, computeFingerprint, createSendThrottle, inputFromAppError, inputFromUnknown,
  installClientErrorLogging, isIgnoredError, normalizeForFingerprint, redactSensitive,
  type ClientErrorEnv, type ClientErrorPayload,
} from "../clientErrorLog";

const ENV: ClientErrorEnv = { route: "/", screen: "list", appVersion: "3.129", userAgent: "UA" };

describe("伏せ字（redactSensitive）", () => {
  it("メールアドレスを伏せる", () => {
    expect(redactSensitive("taro.yamada@example.co.jp で失敗")).toBe("[email] で失敗");
    expect(redactSensitive("a@b.io と c+d@x.jp")).toBe("[email] と [email]");
  });

  it("JWT・Bearer トークン・長い英数字の塊を伏せる", () => {
    expect(redactSensitive("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF_-1")).toBe("token [token]");
    expect(redactSensitive("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [token]");
    expect(redactSensitive(`key=${"A".repeat(45)}`)).toBe("key=[redacted]");
  });

  it("普通の日本語・短い英単語は変えない", () => {
    expect(redactSensitive("保存に失敗しました [42703] column does not exist")).toBe("保存に失敗しました [42703] column does not exist");
  });
});

describe("送る内容（buildClientErrorPayload）", () => {
  it("message は500字・stack は2000字で切り、伏せ字を通す", () => {
    const p = buildClientErrorPayload({ source: "report", message: "あ".repeat(800) + " a@b.jp", stack: "at f (x.js:1) ".repeat(300) }, ENV);
    expect(Array.from(p.p_message).length).toBe(MAX_MESSAGE_CHARS);
    expect((p.p_stack ?? "").length).toBe(2000);
    expect(buildClientErrorPayload({ source: "report", message: "user a@b.jp failed" }, ENV).p_message).toBe("user [email] failed");
  });

  it("元のエラーオブジェクト（raw）は送らない。stack だけを取り出す", () => {
    const raw = new Error("boom");
    const input = inputFromAppError({ message: "保存に失敗", context: "タスク保存", timestamp: "t", raw: { ...raw, secret: "入力内容" } });
    const p = buildClientErrorPayload(input, ENV);
    expect(JSON.stringify(p)).not.toContain("入力内容");
    expect(Object.keys(p).sort()).toEqual([
      "p_app_version", "p_code", "p_context", "p_fingerprint", "p_message", "p_route", "p_screen", "p_source", "p_stack", "p_user_agent",
    ]);
  });

  it("ErrorBoundary 由来は source=boundary になる", () => {
    expect(inputFromAppError({ message: "x", context: "ErrorBoundary: at A / at B", timestamp: "t" }).source).toBe("boundary");
    expect(inputFromUnknown("promise", new TypeError("bad")).message).toBe("TypeError: bad");
    expect(inputFromUnknown("window", { message: "m", code: "C" })).toEqual({ source: "window", message: "m", code: "C" });
  });
});

describe("fingerprint（同じエラーを1件にまとめる）", () => {
  it("16桁の16進", () => {
    expect(computeFingerprint({ source: "report", message: "x" })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("数字・UUID・引用符の中身・クエリが違うだけなら同じ", () => {
    const a = computeFingerprint({ source: "report", message: 'row 12 "タスクA" id=1b4e28ba-2fa1-11d2-883f-0016d3cca427', context: "保存" });
    const b = computeFingerprint({ source: "report", message: 'row 98 "タスクB" id=6fa459ea-ee8a-3ca4-894e-db77e160355e', context: "保存" });
    expect(a).toBe(b);
    expect(normalizeForFingerprint("GET /x?a=1&b=2")).toBe(normalizeForFingerprint("GET /x?a=9"));
  });

  it("メッセージ・コード・操作・種類が違えば別", () => {
    const base = { source: "report" as const, message: "保存に失敗", context: "タスク保存" };
    const fp = computeFingerprint(base);
    expect(computeFingerprint({ ...base, message: "削除に失敗" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, code: "42703" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, context: "PJ保存" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, source: "window" })).not.toBe(fp);
  });

  it("ErrorBoundary はコンポーネントの位置（context）でまとめを分けない", () => {
    expect(computeFingerprint({ source: "boundary", message: "x", context: "ErrorBoundary: at A" }))
      .toBe(computeFingerprint({ source: "boundary", message: "x", context: "ErrorBoundary: at B" }));
  });

  it("メールアドレスだけ違うエラーは伏せ字のあとで同じ fingerprint になる", () => {
    const a = buildClientErrorPayload({ source: "report", message: "a@b.jp は登録済み" }, ENV);
    const b = buildClientErrorPayload({ source: "report", message: "c@d.jp は登録済み" }, ENV);
    expect(a.p_fingerprint).toBe(b.p_fingerprint);
  });
});

describe("送信の間引き（createSendThrottle）", () => {
  it("同じ fingerprint は1分に1回だけ", () => {
    const t = createSendThrottle();
    expect(t.allow("f1", 0)).toBe(true);
    expect(t.allow("f1", SAME_FINGERPRINT_INTERVAL_MS - 1)).toBe(false);
    expect(t.allow("f2", 1000)).toBe(true);
    expect(t.allow("f1", SAME_FINGERPRINT_INTERVAL_MS)).toBe(true);
  });

  it("1時間の総数に上限がある（1時間たてば戻る）", () => {
    const t = createSendThrottle();
    for (let i = 0; i < MAX_SENDS_PER_HOUR; i++) expect(t.allow(`f${i}`, i)).toBe(true);
    expect(t.allow("over", MAX_SENDS_PER_HOUR)).toBe(false);
    expect(t.allow("over", 60 * 60 * 1000 + 1)).toBe(true);
  });

  it("既知の無害なエラーは記録しない", () => {
    expect(isIgnoredError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isIgnoredError("Script error.")).toBe(true);
    expect(isIgnoredError("保存に失敗")).toBe(false);
  });
});

describe("取り付け（installClientErrorLogging）と無限ループ防止", () => {
  let target: EventTarget;
  beforeEach(() => { target = new EventTarget(); });
  const flush = () => new Promise(r => setTimeout(r, 0));
  const appError = (message: string) => new CustomEvent("app:error", { detail: { message, timestamp: "t" } });

  it("reportError（app:error）を1回送る", async () => {
    const send = vi.fn<(p: ClientErrorPayload) => Promise<void>>().mockResolvedValue();
    installClientErrorLogging({ send, canSend: async () => true, env: () => ENV, target: target as unknown as Window });
    target.dispatchEvent(appError("保存に失敗"));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].p_message).toBe("保存に失敗");
  });

  it("ログインしていなければ送らない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    installClientErrorLogging({ send, canSend: async () => false, env: () => ENV, target: target as unknown as Window });
    target.dispatchEvent(appError("x"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("🔴 記録の RPC が失敗しても、それを記録しようとしない（console.warn だけ・例外を外へ出さない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("rpc failed"));
    const seen: Event[] = [];
    target.addEventListener("app:error", e => seen.push(e));
    target.addEventListener("unhandledrejection", e => seen.push(e));
    installClientErrorLogging({ send, canSend: async () => true, env: () => ENV, target: target as unknown as Window });
    target.dispatchEvent(appError("first"));
    await flush();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1); // 最初の1件だけ。失敗が新しい app:error / unhandledrejection を生んでいない
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("🔴 記録の処理の中から同期的にエラーが戻ってきても、再び記録しない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    let reentered = 0;
    installClientErrorLogging({
      send,
      canSend: async () => true,
      env: () => {
        reentered += 1;
        // 記録の準備中に別のエラー通知が同期的に発火した（例：env の取得で reportError が呼ばれた）
        if (reentered < 5) target.dispatchEvent(appError(`nested ${reentered}`));
        return ENV;
      },
      target: target as unknown as Window,
    });
    target.dispatchEvent(appError("outer"));
    await flush();
    expect(reentered).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("同じエラーが連発しても1分に1回しか送らない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    let now = 0;
    installClientErrorLogging({ send, canSend: async () => true, env: () => ENV, now: () => now, target: target as unknown as Window });
    for (let i = 0; i < 20; i++) target.dispatchEvent(appError("同じエラー"));
    now = SAME_FINGERPRINT_INTERVAL_MS;
    target.dispatchEvent(appError("同じエラー"));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("解除すると拾わなくなる", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const off = installClientErrorLogging({ send, canSend: async () => true, env: () => ENV, target: target as unknown as Window });
    off();
    target.dispatchEvent(appError("x"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});

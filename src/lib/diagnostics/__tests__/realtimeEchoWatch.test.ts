// 自分の保存の realtime エコーの見張り（v3.148・CLAUDE.md Section 76）。
import { describe, it, expect, vi } from "vitest";
import { createRealtimeEchoWatch, ECHO_TIMEOUT_MS, type EchoWatchDeps } from "../realtimeEchoWatch";
import { buildClientErrorPayload } from "../../errors/clientErrorLog";
import { readFileSync } from "node:fs";

function setup(over: Partial<EchoWatchDeps> = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log = vi.fn();
  const deps: EchoWatchDeps = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: h => { timers.delete(h as number); },
    channelState: () => "SUBSCRIBED",
    isGuest: () => false,
    log,
    ...over,
  };
  const w = createRealtimeEchoWatch(deps);
  return {
    w, log,
    advance(ms: number) { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } },
    pending: () => timers.size,
  };
}

describe("realtime-silent", () => {
  it("10秒以内にエコーが届けば何も記録しない", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(3000);
    s.w.noteEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(20_000);
    expect(s.log).not.toHaveBeenCalled();
    expect(s.pending()).toBe(0);
  });
  it("届かなければ10秒後に1回だけ記録する（表名・チャンネル状態・経過秒を context に）", () => {
    const s = setup({ channelState: () => "CLOSED" });
    s.w.expectEcho("projects", "p1", "2026-10-14T00:00:05Z");
    s.advance(ECHO_TIMEOUT_MS - 1);
    expect(s.log).not.toHaveBeenCalled();
    s.advance(1);
    expect(s.log).toHaveBeenCalledTimes(1);
    const arg = s.log.mock.calls[0][0];
    expect(arg).toMatchObject({ source: "report", code: "realtime-silent" });
    expect(arg.context).toContain("表:projects");
    expect(arg.context).toContain("チャンネル:CLOSED");
    expect(arg.context).toContain("経過10秒");
  });
  it("セッション中1回だけ：記録したあとは何度保存しても記録しない／他の待ちも解除する", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1");
    s.w.expectEcho("tasks", "t2");
    s.advance(ECHO_TIMEOUT_MS);
    expect(s.log).toHaveBeenCalledTimes(1);
    s.w.expectEcho("tasks", "t3");
    s.advance(60_000);
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.pending()).toBe(0);
  });
  it("エコーが保存の応答より先に届いていた場合は待たない", () => {
    const s = setup();
    s.w.noteEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    expect(s.pending()).toBe(0);
    s.advance(60_000);
    expect(s.log).not.toHaveBeenCalled();
  });
  it("古い updated_at のエコー（別の変更）は自分の保存のエコーとして数えない", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:10Z");
    s.w.noteEcho("tasks", "t1", "2026-10-14T00:00:01Z");
    s.advance(ECHO_TIMEOUT_MS);
    expect(s.log).toHaveBeenCalledTimes(1);
  });
  it("ゲストでは動かさない／dispose で待ちを解除する", () => {
    const g = setup({ isGuest: () => true });
    g.w.expectEcho("tasks", "t1");
    expect(g.pending()).toBe(0);
    const s = setup();
    s.w.expectEcho("tasks", "t1");
    s.w.dispose();
    s.advance(60_000);
    expect(s.log).not.toHaveBeenCalled();
  });
  it("fingerprint は code ごとに束ねる（表名・チャンネル状態・経過秒が違っても同じ）／source は CHECK 制約の範囲", () => {
    const env = { route: "/", screen: "list", appVersion: "3.148", userAgent: "ua" };
    const mk = (context: string) => buildClientErrorPayload({ source: "report", code: "realtime-silent", message: "自分の保存の realtime エコーが10秒以内に届きませんでした", context }, env);
    expect(mk("表:tasks / チャンネル:SUBSCRIBED / 経過10秒").p_fingerprint).toBe(mk("表:projects / チャンネル:CLOSED / 経過12秒").p_fingerprint);
    expect(["report", "boundary", "window", "promise"]).toContain(mk("x").p_source);
  });
});

describe("配線", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("保存の成功（upsertTask・upsertProject）で noteOwnWrite、realtime の到着（handleRemoteChange）で noteRemoteEcho を呼ぶ", () => {
    const store = strip(readFileSync("src/lib/supabase/store.ts", "utf8"));
    expect(store).toMatch(/noteOwnWrite\("tasks", task\.id, updatedAt\)/);
    expect(store).toMatch(/noteOwnWrite\("projects", project\.id, updatedAt\)/);
    const app = strip(readFileSync("src/stores/appStore.ts", "utf8"));
    expect(app).toMatch(/noteRemoteEcho\(event\.table, echoRow\.id/);
  });
  it("App.tsx が見張りを初期化し、アンマウントで解除する／チャンネル状態は realtime.ts が更新する", () => {
    const app = strip(readFileSync("src/App.tsx", "utf8"));
    expect(app).toMatch(/initRealtimeEchoWatch\(\{/);
    expect(app).toMatch(/disposeRealtimeEchoWatch\(\)/);
    const rt = strip(readFileSync("src/lib/supabase/realtime.ts", "utf8"));
    expect(rt).toMatch(/setRealtimeChannelState\(status\)/);
  });
});

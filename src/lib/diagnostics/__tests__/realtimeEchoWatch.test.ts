// 自分の保存の realtime エコーの見張り（v3.148・CLAUDE.md Section 76）。
import { describe, it, expect, vi } from "vitest";
import { createRealtimeEchoWatch, ECHO_TIMEOUT_MS, ECHO_GIVEUP_MS, type EchoWatchDeps } from "../realtimeEchoWatch";
import { buildClientErrorPayload } from "../../errors/clientErrorLog";
import { readFileSync } from "node:fs";

function setup(over: Partial<EchoWatchDeps> = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log = vi.fn();
  const onSlow = vi.fn();
  const onStuck = vi.fn();
  const vis = { v: "visible" };
  const deps: EchoWatchDeps = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: h => { timers.delete(h as number); },
    channelState: () => "SUBSCRIBED",
    visibility: () => vis.v,
    isGuest: () => false,
    onSlow,
    onStuck,
    log,
    ...over,
  };
  const w = createRealtimeEchoWatch(deps);
  return {
    w, log, onSlow, onStuck, vis,
    // 1秒刻みで進める（タイマーの中で新しいタイマーが張られても、その時刻に正しく発火させるため）
    advance(ms: number) {
      for (let i = 0; i < ms; i += 1000) {
        now += Math.min(1000, ms - i);
        for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
      }
    },
    pending: () => timers.size,
  };
}

describe("realtime-silent", () => {
  it("10秒以内にエコーが届けば何も記録せず、自己回復も要求しない", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(3000);
    s.w.noteEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(120_000);
    expect(s.log).not.toHaveBeenCalled();
    expect(s.onSlow).not.toHaveBeenCalled();
    expect(s.onStuck).not.toHaveBeenCalled();
    expect(s.pending()).toBe(0);
  });
  it("10秒届かなくても即は記録しない：遅延として待ち、差分取得の要求を1回出す", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(ECHO_TIMEOUT_MS);
    expect(s.log).not.toHaveBeenCalled();
    expect(s.onSlow).toHaveBeenCalledTimes(1);
    expect(s.onStuck).not.toHaveBeenCalled();
    expect(s.pending()).toBe(1);
  });
  it("遅れて届いたら、届くまでの秒数・可視状態・チャンネル状態つきで1回だけ記録する", () => {
    const s = setup({ channelState: () => "SUBSCRIBED" });
    s.w.expectEcho("projects", "p1", "2026-10-14T00:00:05Z");
    s.advance(ECHO_TIMEOUT_MS);
    s.vis.v = "hidden";
    s.advance(14_000);
    s.w.noteEcho("projects", "p1", "2026-10-14T00:00:05Z");
    expect(s.log).toHaveBeenCalledTimes(1);
    const arg = s.log.mock.calls[0][0];
    expect(arg).toMatchObject({ source: "report", code: "realtime-silent" });
    expect(arg.context).toContain("表:projects");
    expect(arg.context).toContain("チャンネル:SUBSCRIBED");
    expect(arg.context).toContain("遅れて届いた（経過24秒）");
    expect(arg.context).toContain("10秒時点:visible");
    expect(arg.context).toContain("記録時点:hidden");
    expect(arg.context).toContain("待ち1件");
    expect(s.onStuck).not.toHaveBeenCalled();
    expect(s.pending()).toBe(0);
  });
  it("差分取得で補完された場合は realtime ではなく補完と記録する（realtime の到着として数えない）", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.advance(ECHO_TIMEOUT_MS);
    s.w.noteEcho("tasks", "t1", "2026-10-14T00:00:05Z", "catchup");
    expect(s.log.mock.calls[0][0].context).toContain("realtimeでは届かず差分取得で補完");
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z"); // 差分取得の行は「先着のエコー」に残らない
    expect(s.pending()).toBe(1);
  });
  it("60秒届かなければ「60秒以内に届かず」を記録し、張り直しの要求を1回出す", () => {
    const s = setup({ channelState: () => "CLOSED" });
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    s.w.expectEcho("tasks", "t2", "2026-10-14T00:00:05Z");
    s.advance(ECHO_GIVEUP_MS - 1000);
    expect(s.log).not.toHaveBeenCalled();
    s.advance(1000);
    expect(s.log).toHaveBeenCalledTimes(1);
    const ctx = s.log.mock.calls[0][0].context;
    expect(ctx).toContain("チャンネル:CLOSED");
    expect(ctx).toContain("60秒以内に届かず（経過60秒）");
    expect(ctx).toContain("待ち2件");
    expect(s.onSlow).toHaveBeenCalledTimes(1); // 2件待っていても差分取得の要求は1回
    expect(s.onStuck).toHaveBeenCalledTimes(1);
    expect(s.pending()).toBe(0);
  });
  it("記録はセッション中1回だけ。ただし2回目以降も自己回復の要求は出す（待ちがなくなると次の波）", () => {
    const s = setup();
    s.w.expectEcho("tasks", "t1");
    s.advance(ECHO_GIVEUP_MS);
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.onSlow).toHaveBeenCalledTimes(1);
    expect(s.onStuck).toHaveBeenCalledTimes(1);
    s.w.expectEcho("tasks", "t3");
    s.advance(ECHO_GIVEUP_MS);
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.onSlow).toHaveBeenCalledTimes(2);
    expect(s.onStuck).toHaveBeenCalledTimes(2);
    expect(s.pending()).toBe(0);
  });
  it("保存した時点で hidden なら見張らない（記録の枠も自己回復も使わない）", () => {
    const s = setup();
    s.vis.v = "hidden";
    s.w.expectEcho("tasks", "t1");
    expect(s.pending()).toBe(0);
    s.advance(ECHO_GIVEUP_MS);
    expect(s.log).not.toHaveBeenCalled();
    expect(s.onSlow).not.toHaveBeenCalled();
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
    expect(s.onSlow).toHaveBeenCalledTimes(1);
    expect(s.pending()).toBe(1);
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
    expect(s.onSlow).not.toHaveBeenCalled();
  });
  it("fingerprint は code ごとに束ねる（表名・チャンネル状態・経過秒が違っても同じ）／source は CHECK 制約の範囲", () => {
    const env = { route: "/", screen: "list", appVersion: "3.148", userAgent: "ua" };
    const mk = (context: string) => buildClientErrorPayload({ source: "report", code: "realtime-silent", message: "自分の保存の realtime エコーが10秒以内に届きませんでした", context }, env);
    expect(mk("表:tasks / チャンネル:SUBSCRIBED / 遅れて届いた（経過24秒） / 10秒時点:visible 記録時点:visible / 待ち1件").p_fingerprint)
      .toBe(mk("表:projects / チャンネル:CLOSED / 60秒以内に届かず（経過60秒） / 10秒時点:hidden 記録時点:hidden / 待ち3件").p_fingerprint);
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
    expect(app).toMatch(/noteRemoteEcho\(\s*event\.table,\s*echoRow\.id/);
  });
  it("App.tsx が見張りを初期化し、アンマウントで解除する／チャンネル状態は realtime.ts が更新する", () => {
    const app = strip(readFileSync("src/App.tsx", "utf8"));
    expect(app).toMatch(/initRealtimeEchoWatch\(\{/);
    expect(app).toMatch(/disposeRealtimeEchoWatch\(\)/);
    expect(app).toMatch(/visibility: \(\) => document\.visibilityState/);
    expect(app).toMatch(/onSlow: requestEchoSlowRecovery/);
    expect(app).toMatch(/onStuck: requestEchoStuckRecovery/);
    // 10秒＝差分取得（全件 load ではない）、60秒＝購読の張り直し（世代を進めて effect を作り直す）
    expect(app).toMatch(/slow: echoCatchUp/);
    expect(app).toMatch(/echoCatchUp = createResyncRunner\(\(\) => \{ void catchUpRemoteChanges\(Date\.now\(\)\)/);
    expect(app).toMatch(/setRealtimeEpoch\(n => n \+ 1\)/);
    expect(app).toMatch(/\[realtimeReady, applyRemoteChange, load, realtimeEpoch\]/);
    const store = strip(readFileSync("src/stores/appStore.ts", "utf8"));
    expect(store).toMatch(/opts\.noResync \? "catchup" : "realtime"/);
    const rt = strip(readFileSync("src/lib/supabase/realtime.ts", "utf8"));
    expect(rt).toMatch(/setRealtimeChannelState\(status\)/);
  });
});

describe("購読を止めている間（v3.171・長い非表示の Realtime 停止）", () => {
  it.each(["paused", "resuming"])("チャンネル状態が %s のときは見張らない（記録も自己回復の要求もしない）", state => {
    const s = setup({ channelState: () => state });
    s.w.expectEcho("tasks", "t1", "2026-10-14T00:00:05Z");
    expect(s.pending()).toBe(0);
    s.advance(ECHO_GIVEUP_MS * 2);
    expect(s.log).not.toHaveBeenCalled();
    expect(s.onSlow).not.toHaveBeenCalled();
    expect(s.onStuck).not.toHaveBeenCalled();
  });
});

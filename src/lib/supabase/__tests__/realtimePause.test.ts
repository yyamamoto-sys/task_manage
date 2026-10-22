// 長く非表示のタブの Realtime を止める判断（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHiddenPauseController, HIDDEN_PAUSE_MS } from "../realtimePause";

function harness() {
  let now = 0;
  let hidden = false;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const events: boolean[] = [];
  const controller = createHiddenPauseController({
    thresholdMs: HIDDEN_PAUSE_MS,
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimeout: h => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1); },
    isHidden: () => hidden,
    onChange: p => events.push(p),
  });
  return {
    events,
    controller,
    setHidden(v: boolean) { hidden = v; controller.check(); },
    advance(ms: number) {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn(); }
      }
    },
    pendingTimers: () => timers.length,
  };
}

describe("hidden が10分続いたら停止し、visible に戻ったら再開する", () => {
  it("10分ちょうど非表示のままなら停止の合図を1回だけ出す", () => {
    const h = harness();
    h.setHidden(true);
    h.advance(HIDDEN_PAUSE_MS - 1);
    expect(h.events).toEqual([]);
    h.advance(1);
    expect(h.events).toEqual([true]);
    h.advance(HIDDEN_PAUSE_MS * 3);
    expect(h.events).toEqual([true]);
  });

  it("10分未満で前面に戻ったら何も起きない（今の挙動のまま）", () => {
    const h = harness();
    h.setHidden(true);
    h.advance(HIDDEN_PAUSE_MS - 1000);
    h.setHidden(false);
    h.advance(HIDDEN_PAUSE_MS * 2);
    expect(h.events).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
  });

  it("停止後に前面へ戻ったら再開の合図を1回出し、visible が重なっても重ねない", () => {
    const h = harness();
    h.setHidden(true);
    h.advance(HIDDEN_PAUSE_MS);
    h.setHidden(false);
    h.setHidden(false);
    expect(h.events).toEqual([true, false]);
  });

  it("再開後にもう一度10分非表示にすれば、また停止する", () => {
    const h = harness();
    h.setHidden(true); h.advance(HIDDEN_PAUSE_MS); h.setHidden(false);
    h.setHidden(true); h.advance(HIDDEN_PAUSE_MS);
    expect(h.events).toEqual([true, false, true]);
  });

  it("hidden の通知が重なってもタイマーは1本だけ", () => {
    const h = harness();
    h.setHidden(true);
    h.controller.check();
    h.controller.check();
    expect(h.pendingTimers()).toBe(1);
  });

  it("停止中に dispose したら再開の合図を出して片付ける", () => {
    const h = harness();
    h.setHidden(true); h.advance(HIDDEN_PAUSE_MS);
    h.controller.dispose();
    expect(h.events).toEqual([true, false]);
  });
});

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

// 🔴 Section 59：コメントを除去してから走査する
describe("配線（ソース走査）", () => {
  const app = code("src/App.tsx");
  const bell = code("src/components/notifications/InAppNotificationBell.tsx");

  it("App.tsx は停止の合図を起動し、停止で購読を外し、再開で張り直して全件再取得する", () => {
    expect(app).toMatch(/useEffect\(\(\) => installHiddenPause\(\), \[\]\)/);
    expect(app).toMatch(/onRealtimePauseChange\(paused => \{/);
    expect(app).toMatch(/if \(paused\) \{\s*off\?\.\(\);\s*off = null;\s*setRealtimeChannelState\("paused"\);/);
    expect(app).toMatch(/setRealtimeChannelState\("resuming"\);\s*gate\.onVisible\(\);\s*start\(true\);\s*resync\(\);/);
  });

  it("停止中の復帰は onVisibility 側で全件再取得を重ねない", () => {
    expect(app).toMatch(/if \(isRealtimePaused\(\)\) return;\s*if \(gate\.onVisible\(\)\) resync\(\);/);
  });

  it("停止中に effect が作り直されても購読を張らない", () => {
    expect(app).toMatch(/if \(isRealtimePaused\(\)\) setRealtimeChannelState\("paused"\);\s*else start\(false\);/);
  });

  it("ベルも停止の合図で購読を外し、再開で張り直す", () => {
    expect(bell).toMatch(/if \(!isRealtimePaused\(\)\) start\(\);/);
    expect(bell).toMatch(/onRealtimePauseChange\(paused => \{\s*if \(paused\) \{ off\?\.\(\); off = null; \} else start\(\);/);
  });
});

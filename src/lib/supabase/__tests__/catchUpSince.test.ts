import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createUnsubscribeClock } from "../resync";

describe("createUnsubscribeClock（M68・M69）", () => {
  it("一度も解除していなければ null（初回は従来どおり初回 load の開始を起点にする）", () => {
    expect(createUnsubscribeClock(() => 1000).since()).toBeNull();
  });
  it("解除した時刻を返し、解除のたびに更新する", () => {
    let t = 1000;
    const c = createUnsubscribeClock(() => t);
    c.markUnsubscribed();
    expect(c.since()).toBe(1000);
    t = 5000;
    c.markUnsubscribed();
    expect(c.since()).toBe(5000);
  });
});

describe("App.tsx の購読の配線", () => {
  const src = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf-8")
    .split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  it("停止からの再開でも onFirstSubscribed で差分取得する（M69）", () => {
    expect(src).not.toMatch(/resumed\s*\?\s*undefined/);
    expect(src).toMatch(/onFirstSubscribed:\s*\(\)\s*=>\s*\{[^}]*catchUpRemoteChanges\(since/);
  });
  it("張り直しの差分取得は直前に解除した時刻を起点にする（M68）", () => {
    expect(src).toContain("clock.since()");
    expect(src).toContain("clock.markUnsubscribed()");
  });
});

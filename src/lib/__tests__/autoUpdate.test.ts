import { describe, expect, it } from "vitest";
import {
  AUTO_RELOAD_COOLDOWN_MS, AUTO_UPDATE_IDLE_MS, readAutoReloadRecord, setAutoUpdateAiBlock,
  isAutoUpdateAiBusy, shouldAutoReload, writeAutoReloadRecord, type AutoReloadInput,
} from "../autoUpdate";

const NOW = 1_000_000_000_000;
const base: AutoReloadInput = {
  serverVersion: "3.153", currentVersion: "3.152", idleMs: AUTO_UPDATE_IDLE_MS,
  hasUnsaved: false, inputFocused: false, modalOpen: false, aiBusy: false, isGuest: false,
  lastAutoReload: null, now: NOW,
};

describe("shouldAutoReload", () => {
  it("全条件を満たせば true", () => expect(shouldAutoReload(base)).toBe(true));
  it("ちょうど10分は true・9分59秒は false", () => {
    expect(shouldAutoReload({ ...base, idleMs: 10 * 60 * 1000 })).toBe(true);
    expect(shouldAutoReload({ ...base, idleMs: 10 * 60 * 1000 - 1000 })).toBe(false);
  });
  it("サーバーの版が同じ・古い・不明なら false", () => {
    expect(shouldAutoReload({ ...base, serverVersion: "3.152" })).toBe(false);
    expect(shouldAutoReload({ ...base, serverVersion: "3.151" })).toBe(false);
    expect(shouldAutoReload({ ...base, serverVersion: null })).toBe(false);
  });
  it("版は数値で比べる（3.9 より 3.10 が新しい）", () => {
    expect(shouldAutoReload({ ...base, currentVersion: "3.9", serverVersion: "3.10" })).toBe(true);
  });
  it.each(["hasUnsaved", "inputFocused", "modalOpen", "aiBusy", "isGuest"] as const)("%s が true なら false", key => {
    expect(shouldAutoReload({ ...base, [key]: true })).toBe(false);
  });
  it("ループ防止：同じ版を30分未満に再読み込み済みなら false・ちょうど30分で true", () => {
    expect(shouldAutoReload({ ...base, lastAutoReload: { version: "3.153", at: NOW - AUTO_RELOAD_COOLDOWN_MS + 1 } })).toBe(false);
    expect(shouldAutoReload({ ...base, lastAutoReload: { version: "3.153", at: NOW - AUTO_RELOAD_COOLDOWN_MS } })).toBe(true);
  });
  it("ループ防止は別の版には効かない", () => {
    expect(shouldAutoReload({ ...base, lastAutoReload: { version: "3.152", at: NOW - 1000 } })).toBe(true);
  });
});

describe("記録とAIブロック", () => {
  it("sessionStorage 相当に書いて読める・壊れた値は null・書けなければ false", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(readAutoReloadRecord(st)).toBeNull();
    expect(writeAutoReloadRecord({ version: "3.153", at: 5 }, st)).toBe(true);
    expect(readAutoReloadRecord(st)).toEqual({ version: "3.153", at: 5 });
    mem.set("auto_reload_v1", "{broken");
    expect(readAutoReloadRecord(st)).toBeNull();
    expect(writeAutoReloadRecord({ version: "3.153", at: 5 }, { setItem: () => { throw new Error("quota"); } })).toBe(false);
  });
  it("AIブロックは登録・解除できる", () => {
    expect(isAutoUpdateAiBusy()).toBe(false);
    setAutoUpdateAiBlock("a", true);
    expect(isAutoUpdateAiBusy()).toBe(true);
    setAutoUpdateAiBlock("a", false);
    expect(isAutoUpdateAiBusy()).toBe(false);
  });
});

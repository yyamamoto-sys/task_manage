// lazyWithRetry（v3.146・v3.163・CLAUDE.md Section 76）：失敗時の扱い／記録は画面ごとに1回／全体バナー用イベントを出さない／先読み。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  loadChunkOrFallback, reportChunkLoadFailure, _resetChunkReportForTest, CHUNK_RETRY_DELAY_MS, defaultChunkDeps,
  prefetchAllChunks, registerPrefetchChunk, registeredChunkNames, _resetPrefetchRegistryForTest,
  type ChunkLoadDeps, type PrefetchDeps,
} from "../lazyWithRetry";
import { setDiagnosticLogger } from "../errors/diagnosticLog";
import { ChunkLoadFailed } from "../../components/common/ChunkLoadFailed";
import { reloadWithGuard } from "../reloadWithGuard";

const FALLBACK = (() => null) as never;
function deps() {
  return { wait: vi.fn(async () => {}), report: vi.fn(), tryReload: vi.fn(() => false) } satisfies ChunkLoadDeps;
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

beforeEach(() => { _resetChunkReportForTest(); setDiagnosticLogger(null); });

describe("loadChunkOrFallback", () => {
  it("成功時はそのまま返し、記録も再読み込みの判定もしない", async () => {
    const d = deps();
    const mod = { default: (() => null) as never };
    await expect(loadChunkOrFallback(async () => mod, "X", FALLBACK, d)).resolves.toBe(mod);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.tryReload).not.toHaveBeenCalled();
  });
  it("1回目の失敗は待って1回だけ再取得し、直れば何も出さない", async () => {
    const d = deps();
    const mod = { default: (() => null) as never };
    const factory = vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValueOnce(mod);
    await expect(loadChunkOrFallback(factory, "X", FALLBACK, d)).resolves.toBe(mod);
    expect(d.wait).toHaveBeenCalledWith(CHUNK_RETRY_DELAY_MS);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.tryReload).not.toHaveBeenCalled();
  });
  it("2回続けて失敗しても例外にせず、再読み込みできないときは案内の部品を返し、記録を1回", async () => {
    const d = deps();
    const factory = vi.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module: https://x/assets/A-abc.js"));
    const r = await loadChunkOrFallback(factory, "A", FALLBACK, d);
    expect(r.default).toBe(FALLBACK);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.tryReload).toHaveBeenCalledTimes(1);
  });
  it("再読み込みを始めたときは案内を返さず読み込み中のままにする（案内を一瞬出さない）", async () => {
    const d = deps();
    d.tryReload.mockReturnValue(true);
    const factory = vi.fn().mockRejectedValue(new Error("x"));
    const settled = vi.fn();
    void loadChunkOrFallback(factory, "A", FALLBACK, d).then(settled);
    await new Promise(r => setTimeout(r, 20));
    expect(d.tryReload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });
  it("lazyWithRetry.ts は reload を直接呼ばない・sessionStorage を持たない（判定は chunkRecovery.ts）", () => {
    const src = stripComments(readFileSync("src/lib/lazyWithRetry.ts", "utf8"));
    expect(src).not.toMatch(/\.reload\(/);
    expect(src).not.toMatch(/sessionStorage/);
  });
});

describe("reportChunkLoadFailure：同じ画面名はセッション中1回", () => {
  it("code=chunk-load・context に画面名と版を付けて1回だけ送る（URL は message に入れない）", () => {
    const log = vi.fn();
    setDiagnosticLogger(log);
    const err = new Error("Failed to fetch dynamically imported module: https://x/assets/A-abc.js");
    reportChunkLoadFailure("A", err);
    reportChunkLoadFailure("A", err);
    reportChunkLoadFailure("B", err);
    expect(log).toHaveBeenCalledTimes(2);
    const first = log.mock.calls[0][0];
    expect(first).toMatchObject({ source: "report", code: "chunk-load" });
    expect(first.context).toMatch(/^chunk-load:A v\d/);
    expect(first.message).not.toContain("https://");
  });
});

describe("ChunkLoadFailed と reloadWithGuard", () => {
  it("案内を表示する（素の関数として呼べる）", () => {
    expect(ChunkLoadFailed()).not.toBeNull();
  });
  it("未保存の編集の確認を通ったときだけ reload する", async () => {
    const reload = vi.fn();
    await expect(reloadWithGuard({ confirm: async () => false, reload })).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    await expect(reloadWithGuard({ confirm: async () => true, reload })).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// ===== 本物の配線：記録がつながっていること・全体バナー用のイベントが出ないこと =====
describe("lazyWithRetry の配線（本物の deps）", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  function stubEnv(opts: { hasDialog?: boolean }) {
    const dispatched: string[] = [];
    const reload = vi.fn();
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (e: Event) => { dispatched.push(e.type); return true; },
      location: { reload },
    };
    (globalThis as { document?: unknown }).document = {
      activeElement: null,
      querySelector: () => (opts.hasDialog ? {} : null),
    };
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    return { dispatched, reload };
  }

  it("失敗が確定しても診断ログ（chunk-load）は1回送られ、全体バナー用のイベントは出ない（安全なら黙って再読み込み）", async () => {
    const log = vi.fn();
    setDiagnosticLogger(log);
    const { dispatched, reload } = stubEnv({});
    const factory = vi.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module: https://x/assets/Z-abc12345.js"));
    void loadChunkOrFallback(factory, "WiringScreen", FALLBACK, { ...defaultChunkDeps, wait: async () => {} });
    await new Promise(r => setTimeout(r, 20));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ source: "report", code: "chunk-load" });
    expect(dispatched).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("モーダルが開いているときは再読み込みせず案内の部品を返す。このときも全体バナー用のイベントは出ない", async () => {
    const { dispatched, reload } = stubEnv({ hasDialog: true });
    const factory = vi.fn().mockRejectedValue(new Error("x"));
    const r = await loadChunkOrFallback(factory, "S", FALLBACK, { ...defaultChunkDeps, wait: async () => {} });
    expect(r.default).toBe(FALLBACK);
    expect(dispatched).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });
  it("lazyWithRetry は本物の deps を使い、全体バナー用のイベントを持たない", () => {
    const lazySrc = stripComments(readFileSync("src/lib/lazyWithRetry.ts", "utf8"));
    expect(lazySrc).toMatch(/loadChunkOrFallback\(factory, name, ChunkLoadFailed as unknown as T, defaultChunkDeps\)/);
    expect(lazySrc).toMatch(/report: reportChunkLoadFailure/);
    expect(lazySrc).not.toMatch(/dispatchEvent|CHUNK_LOAD_FAILED_EVENT/);
    expect(stripComments(readFileSync("src/lib/reloadNotice.ts", "utf8"))).not.toMatch(/CHUNK_LOAD_FAILED_EVENT/);
  });
  it("全体バナーは MIN_CLIENT_VERSION 判定のときだけ出し、チャンク失敗の購読・状態を持たない。出ている間は本体を押し下げる", () => {
    const banner = stripComments(readFileSync("src/components/common/ReloadNoticeBanner.tsx", "utf8"));
    expect(banner).toMatch(/setVersionOutdated\(shouldShowReloadNotice/);
    expect(banner).toMatch(/if \(!versionOutdated\) return null/);
    expect(banner).not.toMatch(/chunkFailed|CHUNK_LOAD_FAILED_EVENT|setChunkFailed/);
    expect(banner).toMatch(/setProperty\(RELOAD_BAR_HEIGHT_VAR/);
    const css = readFileSync("src/styles/globals.css", "utf8");
    expect(css).toMatch(/padding-top: calc\(8px \+ var\(--reload-bar-h, 0px\)\)/);
    expect(css).toMatch(/body \{ padding: 0; padding-top: var\(--reload-bar-h, 0px\); \}/);
  });
  it("ログイン後のメイン描画（通常・ゲスト）の両方に先読み部品を置く", () => {
    const app = stripComments(readFileSync("src/App.tsx", "utf8"));
    expect(app.match(/<ChunkPrefetcher \/>/g)?.length).toBe(2);
  });
});

// ===== 先読み（prefetchAllChunks） =====
describe("prefetchAllChunks", () => {
  const pdeps = (): PrefetchDeps & { debug: ReturnType<typeof vi.fn> } => ({ pause: async () => {}, debug: vi.fn() });
  beforeEach(() => { _resetPrefetchRegistryForTest(); });

  it("登録済みの factory を全部・登録順に1本ずつ呼ぶ（並行して走らせない）", async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    for (const n of ["a", "b", "c"]) {
      registerPrefetchChunk(n, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        order.push(n);
        running--;
      });
    }
    expect(registeredChunkNames()).toEqual(["a", "b", "c"]);
    const ok = await prefetchAllChunks(pdeps());
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(ok).toBe(3);
  });
  it("1本が失敗しても止まらず残りを読み込み、失敗は debug に流すだけ（例外にしない）", async () => {
    const called: string[] = [];
    registerPrefetchChunk("a", async () => { called.push("a"); });
    registerPrefetchChunk("b", async () => { called.push("b"); throw new Error("404"); });
    registerPrefetchChunk("c", async () => { called.push("c"); });
    const d = pdeps();
    await expect(prefetchAllChunks(d)).resolves.toBe(2);
    expect(called).toEqual(["a", "b", "c"]);
    expect(d.debug).toHaveBeenCalledTimes(1);
    expect(d.debug.mock.calls[0][0]).toBe("b");
  });
  it("同じ名前の二重登録は1本にまとめる", () => {
    registerPrefetchChunk("a", async () => {});
    registerPrefetchChunk("a", async () => {});
    expect(registeredChunkNames()).toEqual(["a"]);
  });
  it("lazyWithRetry で作ったコンポーネントの factory も登録される", async () => {
    const { lazyWithRetry } = await import("../lazyWithRetry");
    lazyWithRetry(async () => ({ default: (() => null) as never }), "RegScreen");
    expect(registeredChunkNames()).toContain("RegScreen");
  });
  it("先読みは client_error_logs（診断ログ）に記録しない", async () => {
    const log = vi.fn();
    setDiagnosticLogger(log);
    registerPrefetchChunk("bad", async () => { throw new Error("x"); });
    await prefetchAllChunks(pdeps());
    expect(log).not.toHaveBeenCalled();
  });
});

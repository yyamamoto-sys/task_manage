// lazyWithRetry（v3.146・CLAUDE.md Section 76）：失敗しても reload しない／案内を出す／記録は画面ごとに1回。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadChunkOrFallback, reportChunkLoadFailure, _resetChunkReportForTest, CHUNK_RETRY_DELAY_MS, type ChunkLoadDeps } from "../lazyWithRetry";
import { setDiagnosticLogger } from "../errors/diagnosticLog";
import { ChunkLoadFailed } from "../../components/common/ChunkLoadFailed";
import { reloadWithGuard } from "../reloadWithGuard";

const FALLBACK = (() => null) as never;
function deps() {
  return { wait: vi.fn(async () => {}), report: vi.fn(), notify: vi.fn() } satisfies ChunkLoadDeps;
}

beforeEach(() => { _resetChunkReportForTest(); setDiagnosticLogger(null); });

describe("loadChunkOrFallback", () => {
  it("成功時はそのまま返し、記録も通知もしない", async () => {
    const d = deps();
    const mod = { default: (() => null) as never };
    await expect(loadChunkOrFallback(async () => mod, "X", FALLBACK, d)).resolves.toBe(mod);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });
  it("1回目の失敗は待って1回だけ再取得し、直れば何も出さない", async () => {
    const d = deps();
    const mod = { default: (() => null) as never };
    const factory = vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValueOnce(mod);
    await expect(loadChunkOrFallback(factory, "X", FALLBACK, d)).resolves.toBe(mod);
    expect(d.wait).toHaveBeenCalledWith(CHUNK_RETRY_DELAY_MS);
    expect(d.report).not.toHaveBeenCalled();
  });
  it("2回続けて失敗しても例外にせず（ErrorBoundary・unhandledrejection に流さない）案内の部品を返し、記録と全体バナー通知を1回ずつ", async () => {
    const d = deps();
    const factory = vi.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module: https://x/assets/A-abc.js"));
    const r = await loadChunkOrFallback(factory, "A", FALLBACK, d);
    expect(r.default).toBe(FALLBACK);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });
  it("lazyWithRetry.ts は reload を呼ばない（コメントを除いた本文で確認）", () => {
    const src = readFileSync("src/lib/lazyWithRetry.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

// ===== v3.148：本物の配線（記録とバナー通知が実際につながっていること） =====
import { afterEach } from "vitest";
import { defaultChunkDeps } from "../lazyWithRetry";
import { CHUNK_LOAD_FAILED_EVENT } from "../reloadNotice";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("lazyWithRetry の配線（本物の deps）", () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  it("失敗が確定すると、診断ログ（chunk-load）が1回送られ、window にバナー用のイベントが流れる", async () => {
    const log = vi.fn();
    setDiagnosticLogger(log);
    const dispatched: string[] = [];
    (globalThis as { window?: unknown }).window = { dispatchEvent: (e: Event) => { dispatched.push(e.type); return true; } };
    const factory = vi.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module: https://x/assets/Z-abc12345.js"));
    const r = await loadChunkOrFallback(factory, "WiringScreen", FALLBACK, { ...defaultChunkDeps, wait: async () => {} });
    expect(r.default).toBe(FALLBACK);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ source: "report", code: "chunk-load" });
    expect(dispatched).toEqual([CHUNK_LOAD_FAILED_EVENT]);
  });
  it("lazyWithRetry は本物の deps（defaultChunkDeps）を使い、ReloadNoticeBanner は同じイベントを受ける", () => {
    const lazySrc = stripComments(readFileSync("src/lib/lazyWithRetry.ts", "utf8"));
    expect(lazySrc).toMatch(/loadChunkOrFallback\(factory, name, ChunkLoadFailed as unknown as T, defaultChunkDeps\)/);
    expect(lazySrc).toMatch(/report: reportChunkLoadFailure/);
    const banner = stripComments(readFileSync("src/components/common/ReloadNoticeBanner.tsx", "utf8"));
    expect(banner).toMatch(/addEventListener\(CHUNK_LOAD_FAILED_EVENT, onChunkFailed\)/);
    expect(banner).toMatch(/removeEventListener\(CHUNK_LOAD_FAILED_EVENT, onChunkFailed\)/);
  });
  it("バナーは版による通知とチャンク失敗の通知を別々の state で持つ（版チェックがチャンク失敗の案内を消さない）", () => {
    const banner = stripComments(readFileSync("src/components/common/ReloadNoticeBanner.tsx", "utf8"));
    expect(banner).toMatch(/setVersionOutdated\(shouldShowReloadNotice/);
    expect(banner).toMatch(/setChunkFailed\(true\)/);
    expect(banner).toMatch(/if \(!versionOutdated && !chunkFailed\) return null/);
  });
});

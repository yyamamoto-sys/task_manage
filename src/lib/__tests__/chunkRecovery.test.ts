// chunkRecovery（v3.163・CLAUDE.md Section 76）：チャンク取得に失敗したとき、安全なら黙って再読み込み・そうでなければ案内に落とす判定。
import { describe, it, expect, vi } from "vitest";
import { attemptChunkRecoveryReload, CHUNK_RELOAD_LOOP_MS, type ChunkRecoveryDeps } from "../chunkRecovery";

function makeDeps(over: Partial<ChunkRecoveryDeps> = {}) {
  const deps: ChunkRecoveryDeps = {
    hasUnsaved: () => false,
    inputFocused: () => false,
    modalOpen: () => false,
    aiBusy: () => false,
    isGuest: () => false,
    readLastAt: () => null,
    writeAt: vi.fn(() => true),
    reload: vi.fn(),
    now: () => 1_000_000,
    ...over,
  };
  return deps;
}

describe("attemptChunkRecoveryReload", () => {
  it("条件がすべて OK なら記録を書いて reload し、true を返す", () => {
    const d = makeDeps();
    expect(attemptChunkRecoveryReload(d)).toBe(true);
    expect(d.writeAt).toHaveBeenCalledWith(1_000_000);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["未保存の編集がある", { hasUnsaved: () => true }],
    ["入力中", { inputFocused: () => true }],
    ["モーダルが開いている", { modalOpen: () => true }],
    ["AI会話中", { aiBusy: () => true }],
    ["ゲスト", { isGuest: () => true }],
  ] as [string, Partial<ChunkRecoveryDeps>][])("%s ときは reload せず false（案内に落とす）", (_n, over) => {
    const d = makeDeps(over);
    expect(attemptChunkRecoveryReload(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.writeAt).not.toHaveBeenCalled();
  });
  it("直近1分以内に自動再読み込みした記録があれば reload せず false（ループ防止）", () => {
    const d = makeDeps({ readLastAt: () => 1_000_000 - (CHUNK_RELOAD_LOOP_MS - 1) });
    expect(attemptChunkRecoveryReload(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });
  it("記録が1分以上前なら再び reload してよい（ちょうど1分は可）", () => {
    const d = makeDeps({ readLastAt: () => 1_000_000 - CHUNK_RELOAD_LOOP_MS });
    expect(attemptChunkRecoveryReload(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
  it("記録を書けない環境では reload しない（ループ防止が効かないため）", () => {
    const d = makeDeps({ writeAt: vi.fn(() => false) });
    expect(attemptChunkRecoveryReload(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });
});

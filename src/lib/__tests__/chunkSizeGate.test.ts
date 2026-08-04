import { describe, it, expect } from "vitest";
import { resolveChunkGateStatus, CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES } from "../chunkSizeGate";

// isChunkDownloadApproved/markChunkDownloadApproved/getKnownChunkGzipBytes は
// localStorage/fetch 依存（vitest.config.ts が environment: "node" のため未検証。
// src/lib/tips/__tests__/loadingTips.test.ts と同じ方針）。ここでは判定の純粋関数のみ検証する。

describe("resolveChunkGateStatus", () => {
  it("既に承認済みなら常に approved を返す（サイズに関わらず）", () => {
    expect(resolveChunkGateStatus(CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES + 1, true)).toBe("approved");
  });

  it("サイズ不明（マニフェスト未取得）は確認なしで approved にする", () => {
    expect(resolveChunkGateStatus(null, false)).toBe("approved");
  });

  it("閾値以下なら approved", () => {
    expect(resolveChunkGateStatus(CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES, false)).toBe("approved");
    expect(resolveChunkGateStatus(1024, false)).toBe("approved");
  });

  it("閾値超過かつ未承認なら needsConfirm", () => {
    expect(resolveChunkGateStatus(CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES + 1, false)).toBe("needsConfirm");
  });
});

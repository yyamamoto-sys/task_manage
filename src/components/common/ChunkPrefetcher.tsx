// src/components/common/ChunkPrefetcher.tsx
//
// 描画はしない。ログイン後（ゲスト含む）のメイン描画側に1つ置き、マウントされたら全チャンクの先読みを
// 予約する（v3.163・CLAUDE.md Section 76）。実処理は lib/prefetchChunks.ts（タブ内で1回だけ走る）。

import { useEffect } from "react";
import { startChunkPrefetch } from "../../lib/prefetchChunks";

export function ChunkPrefetcher() {
  useEffect(() => { startChunkPrefetch(); }, []);
  return null;
}

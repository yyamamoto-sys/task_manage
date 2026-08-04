// src/lib/chunkSizeGate.ts
//
// 【設計意図】
// React.lazy で分割した重量級チャンクのうち、閾値(gzip後)を超えるものを初めて要求する
// 時だけ「◯KBのデータをダウンロードします」の確認ダイアログを挟む
// （Human in the loop パターン③「承認して記憶」＝一度承認したら次回から聞かない。
// ClaudeCodeForWork/CLAUDE.md の設計思想）。
//
// サイズの出どころ：vite.config.ts の chunk-size-manifest プラグインが実際のビルド出力
// （rollupのgenerateBundleフックで確定した各チャンクのコード）からraw/gzipサイズを実測し、
// dist/chunk-sizes.json として書き出す。ここではその実測JSONをfetchで読むだけで、
// サイズをハードコードしない（ビルドすれば自動で正しい数字になる）。
//
// マニフェストのfetchはこのモジュールが読み込まれた時点（=アプリ起動直後、MainLayoutが
// 静的importしているため）に前倒しで開始する。ゲート判定自体は同期関数
// （resolveChunkGateStatus）にしてあり、Reactコンポーネント側はuseEffect等の非同期待ちを
// 挟まない。万一マニフェストがまだ取得できていない状態で最初のゲート対象コンポーネントが
// 呼ばれても、サイズ不明として「確認なしで許可」に倒す
// （＝ゲート導入前の挙動と同じにする。「毎回fetchを待ってからチャンク本体を読みにいく」
// という直列化を避け、初回表示の体感速度を犠牲にしないため）。
// 承認フラグ自体は localStorage にチャンク名ごとの真偽値のみを持つ（データ本体は保存しない）。

import { LS_KEY } from "./localData/localStore";

/** 閾値（gzip後バイト数）。ここを変えるだけで全チャンク共通の基準が変わる。暫定値200KB */
export const CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES = 200 * 1024;

export type ChunkGateStatus = "approved" | "needsConfirm";

type ChunkSizeManifest = Record<string, { raw: number; gzip: number }>;

let manifest: ChunkSizeManifest | null = null;

function loadManifestEagerly(): void {
  fetch("/chunk-sizes.json")
    .then(res => (res.ok ? (res.json() as Promise<ChunkSizeManifest>) : Promise.resolve({})))
    .then(json => { manifest = json; })
    .catch(() => { manifest = {}; });
}
loadManifestEagerly();

/** 既知のマニフェストからサイズを引く。マニフェスト未取得／未知チャンクは null */
export function getKnownChunkGzipBytes(chunkName: string): number | null {
  return manifest?.[chunkName]?.gzip ?? null;
}

/**
 * ゲート判定の純粋関数（テスト容易性のため副作用と分離）。
 * gzipBytes が null（マニフェスト未取得 or 未知チャンク）の場合は確認なしで許可する。
 */
export function resolveChunkGateStatus(
  gzipBytes: number | null,
  alreadyApproved: boolean,
): ChunkGateStatus {
  if (alreadyApproved) return "approved";
  if (gzipBytes === null) return "approved";
  if (gzipBytes <= CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES) return "approved";
  return "needsConfirm";
}

export function isChunkDownloadApproved(chunkName: string): boolean {
  try { return localStorage.getItem(LS_KEY.chunkDownloadApproved(chunkName)) === "1"; }
  catch { return false; }
}

export function markChunkDownloadApproved(chunkName: string): void {
  try { localStorage.setItem(LS_KEY.chunkDownloadApproved(chunkName), "1"); }
  catch { /* 利用不可・容量不足は無視（機能継続。次回また確認ダイアログが出るだけ） */ }
}

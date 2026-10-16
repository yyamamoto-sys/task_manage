// src/lib/chunkRecovery.ts
//
// 【設計意図・v3.163（CLAUDE.md Section 76 の改訂）】
// lazyWithRetry がチャンクを読み込めなかったとき（デプロイ後の古いタブ）、安全な状況なら黙って再読み込みする。
// 画面遷移と同じ扱い＝未保存の編集・入力中・モーダル・AI会話中・ゲストのどれかなら再読み込みしない
// （呼び出し側がその画面の位置に ChunkLoadFailed を出す）。
// ループ防止：直近 CHUNK_RELOAD_LOOP_MS 以内に自動で再読み込みした記録があれば再読み込みしない。
// 記録を書けない環境（sessionStorage 不可）では再読み込みしない（ループ防止が効かないため）。

import { hasUnsavedEditors } from "./editing/unsavedEditorRegistry";
import { isGuestMode } from "./guestMode";
import { isAutoUpdateAiBusy, isInputFocused, isModalOpen } from "./autoUpdate";

export const CHUNK_RELOAD_LOOP_MS = 60 * 1000;
export const CHUNK_RELOAD_STORAGE_KEY = "chunk_reload_v1";

export interface ChunkRecoveryDeps {
  hasUnsaved: () => boolean;
  inputFocused: () => boolean;
  modalOpen: () => boolean;
  aiBusy: () => boolean;
  isGuest: () => boolean;
  readLastAt: () => number | null;
  /** 書けたら true */
  writeAt: (at: number) => boolean;
  reload: () => void;
  now: () => number;
}

/** 再読み込みを始めたら true（呼び出し側はその画面を読み込み中のままにする）。しなかったら false */
export function attemptChunkRecoveryReload(d: ChunkRecoveryDeps): boolean {
  if (d.hasUnsaved() || d.inputFocused() || d.modalOpen() || d.aiBusy() || d.isGuest()) return false;
  const now = d.now();
  const last = d.readLastAt();
  if (last !== null && now - last < CHUNK_RELOAD_LOOP_MS) return false;
  if (!d.writeAt(now)) return false;
  d.reload();
  return true;
}

function readLastAt(): number | null {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function writeAt(at: number): boolean {
  try { sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(at)); return true; } catch { return false; }
}

export const defaultChunkRecoveryDeps: ChunkRecoveryDeps = {
  hasUnsaved: hasUnsavedEditors,
  inputFocused: () => isInputFocused(),
  modalOpen: () => isModalOpen(),
  aiBusy: isAutoUpdateAiBusy,
  isGuest: isGuestMode,
  readLastAt,
  writeAt,
  reload: () => window.location.reload(),
  now: () => Date.now(),
};

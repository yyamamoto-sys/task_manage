// src/lib/account/recoveryMarker.ts
//
// 再設定待ちの印（localStorage）。再設定リンクで入ったあと、パスワードを決める前に再読み込み・
// 新しいタブを開いても、通常のアプリへ入れないようにする（CLAUDE.md Section 79）。
// localStorage が使えない環境では書けない（false を返す）＝その場の画面（メモリ上の状態）だけが
// 守られ、再読み込みすると印が無いので通常起動になる。
import { buildRecoveryMarker } from "./recoveryFlow";

export const RECOVERY_MARKER_KEY = "recovery_pending_v1";

export function readRecoveryMarkerRaw(): string | null {
  try { return localStorage.getItem(RECOVERY_MARKER_KEY); } catch { return null; }
}

export function writeRecoveryMarker(userId: string): boolean {
  try {
    localStorage.setItem(RECOVERY_MARKER_KEY, buildRecoveryMarker(userId, Date.now()));
    return true;
  } catch {
    console.warn("再設定待ちの印を保存できませんでした（localStorage が使えません）");
    return false;
  }
}

export function clearRecoveryMarker(): void {
  try { localStorage.removeItem(RECOVERY_MARKER_KEY); } catch { /* 使えない環境では何もしない */ }
}

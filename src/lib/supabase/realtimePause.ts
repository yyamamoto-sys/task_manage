// src/lib/supabase/realtimePause.ts
//
// 長く非表示のタブの Realtime を切る（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
// 本番は Free・Nano で、Realtime の変更取得（realtime.list_changes）と購読の張り直しが最大の負荷だった。
// 誰も見ていないタブが購読を持ち続ける意味は無いので、document が hidden のまま10分続いたら
// 「一時停止」の合図を出し、購読している側（app-sync・app-sync-optional・通知）がそれぞれ購読を解除する。
// visible に戻ったら解除の合図を出し、各自が張り直す。取りこぼしは resync.ts の全件再取得（復帰時）で埋める。
// 10分未満の非表示では何も起きない（今までの挙動のまま）。

export const HIDDEN_PAUSE_MS = 10 * 60 * 1000;

let paused = false;
const listeners = new Set<(paused: boolean) => void>();

export function isRealtimePaused(): boolean {
  return paused;
}

/** 一時停止／再開の合図を受ける。返り値で解除 */
export function onRealtimePauseChange(listener: (paused: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  for (const l of [...listeners]) l(next);
}

export interface HiddenPauseDeps {
  thresholdMs: number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isHidden: () => boolean;
  onChange: (paused: boolean) => void;
}

/** hidden が thresholdMs 続いたら onChange(true)、visible に戻ったら（停止していれば）onChange(false) */
export function createHiddenPauseController(deps: HiddenPauseDeps) {
  let timer: unknown = null;
  let isPaused = false;
  const clear = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };
  return {
    /** visibilitychange のたびに呼ぶ（起動時にも1回呼ぶ） */
    check(): void {
      if (deps.isHidden()) {
        if (timer !== null || isPaused) return;
        timer = deps.setTimeout(() => {
          timer = null;
          // 保険：タイマーが走った時点でまだ hidden のときだけ止める
          if (!deps.isHidden() || isPaused) return;
          isPaused = true;
          deps.onChange(true);
        }, deps.thresholdMs);
        return;
      }
      clear();
      if (isPaused) {
        isPaused = false;
        deps.onChange(false);
      }
    },
    dispose(): void {
      clear();
      if (isPaused) {
        isPaused = false;
        deps.onChange(false);
      }
    },
  };
}

/** AuthenticatedApp から1回だけ起動する。返り値で停止（停止中だったら再開の合図も出す） */
export function installHiddenPause(thresholdMs: number = HIDDEN_PAUSE_MS): () => void {
  if (typeof document === "undefined") return () => {};
  const controller = createHiddenPauseController({
    thresholdMs,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    isHidden: () => document.visibilityState === "hidden",
    onChange: setPaused,
  });
  const onVisibility = () => controller.check();
  document.addEventListener("visibilitychange", onVisibility);
  controller.check();
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    controller.dispose();
  };
}

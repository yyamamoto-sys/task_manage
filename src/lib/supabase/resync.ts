// src/lib/supabase/resync.ts
//
// realtime 購読の「取りこぼしを埋める再取得（load）」を、必要なときだけ走らせるための純粋な部品。
// 通常の変更は applyRemoteChange が差分で反映するので load() は呼ばない（v3.146・CLAUDE.md Section 76）。
// load() が必要なのは「イベントを受け取れていなかった間がある」ときだけ：
//   ① チャンネルが切断（CHANNEL_ERROR/TIMED_OUT/CLOSED）から SUBSCRIBED に復帰したとき
//   ② タブが長時間（既定10分）非表示だったあと前面に戻ったとき

export const HIDDEN_RESYNC_MS = 10 * 60 * 1000;
export const RESYNC_MIN_INTERVAL_MS = 30 * 1000;

const LOST_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

/** 購読の状態遷移を見て「切断→復帰」のときだけ true を返す（最初の SUBSCRIBED では false） */
export function createReconnectTracker() {
  let lost = false;
  return {
    onStatus(status: string): boolean {
      if (LOST_STATUSES.has(status)) { lost = true; return false; }
      if (status === "SUBSCRIBED") {
        const resync = lost;
        lost = false;
        return resync;
      }
      return false;
    },
  };
}

/** 非表示から戻ったとき、非表示が thresholdMs 以上続いていたら true */
export function createHiddenReturnGate(thresholdMs: number = HIDDEN_RESYNC_MS, now: () => number = () => Date.now()) {
  let hiddenAt: number | null = null;
  return {
    onHidden(): void { if (hiddenAt === null) hiddenAt = now(); },
    onVisible(): boolean {
      const since = hiddenAt;
      hiddenAt = null;
      return since !== null && now() - since >= thresholdMs;
    },
  };
}

/** 再接続が連続して揺れたときに load() を連打しない（最短間隔つき） */
export function createResyncRunner(run: () => void, minIntervalMs: number = RESYNC_MIN_INTERVAL_MS, now: () => number = () => Date.now()) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return;
    last = t;
    run();
  };
}

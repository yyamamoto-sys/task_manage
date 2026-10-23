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

export interface ResyncTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export type ResyncRunner = (() => void) & { cancel: () => void };

/**
 * 再接続が連続して揺れたときに load() を連打しない（最短間隔つき）。
 * 🔴 間隔内に呼ばれた分は捨てない：間隔が明けた時点で1回だけ後追い実行する（捨てると、間隔内に起きた
 * 変更の取りこぼしが次のきっかけまで埋まらない）。後追いは1つだけ予約し、cancel（アンマウント時）で解除する。
 */
export function createResyncRunner(
  run: () => void,
  minIntervalMs: number = RESYNC_MIN_INTERVAL_MS,
  now: () => number = () => Date.now(),
  timers: ResyncTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): ResyncRunner {
  let last = -Infinity;
  let pending: unknown = null;
  const fire = () => {
    pending = null;
    last = now();
    run();
  };
  const runner = (() => {
    if (pending !== null) return;
    const wait = last + minIntervalMs - now();
    if (wait <= 0) {
      fire();
      return;
    }
    pending = timers.setTimeout(fire, wait);
  }) as ResyncRunner;
  runner.cancel = () => {
    if (pending !== null) timers.clearTimeout(pending);
    pending = null;
  };
  return runner;
}

/**
 * 購読を最後に解除した時刻の記録（Section 76／M68・M69）。張り直し・停止からの再開のとき、
 * 取りこぼしの差分取得の起点を「解除した時刻」にする（セッション最初の load 開始まで遡らない）。
 * 一度も解除していなければ null＝従来どおり初回 load の開始時刻（catchUpRemoteChanges の既定）を使う。
 * 余裕（時計のずれ分）は catchUpRemoteChanges 側で引く。
 */
export function createUnsubscribeClock(now: () => number = () => Date.now()) {
  let at: number | null = null;
  return {
    markUnsubscribed(): void { at = now(); },
    /** catchUpRemoteChanges の起点（ms）。null なら呼び出し側は引数を渡さない */
    since(): number | null { return at; },
  };
}

// src/lib/diagnostics/realtimeEchoWatch.ts
//
// 自分の保存（tasks・projects の insert/update）の realtime エコーが届くかを見張り、セッション中1回だけ
// client_error_logs へ code="realtime-silent" を記録する（v3.148・CLAUDE.md Section 76。v3.158 で遅延の切り分けと自己回復を追加）。
// 「他の人の変更がリロードするまで反映されない」の原因が、イベントがそもそも届いていないことなのかを
// 利用者の実環境（会社のネットワーク・Teams 内など）から知るための見張り。
//   - 自分の保存は DB にコミットされれば、同じ行の変更が自分の購読にも返ってくるはず（RLS が自分に見える行なので）。
//   - 10秒（ECHO_TIMEOUT_MS）届かなければ「遅延」として待ち続け、自己回復（差分取得）を1回要求する。
//   - 届いた時点（realtime／差分取得のどちらで届いたか付き）、または60秒（ECHO_GIVEUP_MS）で、1回だけ記録する。
//     60秒時点で届いていなければ、チャンネルの張り直しを1回要求する（要求は「待ちがなくなるまで」の波ごとに1回ずつ。
//     記録だけがセッション中1回で、記録後も見張りと自己回復は続ける）。
//   - 保存した時点でタブが hidden の場合は見張らない（裏タブはタイマー・ハートビートが止まり、遅延と区別できない。
//     セッション1回の枠も消費しない）。
//   - realtime のエコーが保存の応答より先に届くことがある。直近のエコーを短時間覚えておき、保存の登録時に照合する。

export const ECHO_TIMEOUT_MS = 10_000;
export const ECHO_GIVEUP_MS = 60_000;
const SEEN_KEEP_MS = 30_000;

export type EchoVia = "realtime" | "catchup";

export interface EchoWatchDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  channelState: () => string;
  /** document.visibilityState 相当（"visible" / "hidden"） */
  visibility: () => string;
  isGuest: () => boolean;
  /** 10秒届かなかったとき：差分取得を1回走らせる（既存の最短間隔つきランナーに乗せる） */
  onSlow: () => void;
  /** 60秒でも届かなかったとき：チャンネルの張り直しを1回要求する */
  onStuck: () => void;
  log: (input: { source: "report"; code: string; message: string; context: string }) => void;
}

interface Pending {
  handle: unknown;
  phase: "wait" | "slow";
  startedAt: number;
  table: string;
  expected: number | null;
  visAtSlow: string;
}

function parseTs(v: string | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function createRealtimeEchoWatch(
  deps: EchoWatchDeps,
  timeoutMs: number = ECHO_TIMEOUT_MS,
  giveUpMs: number = ECHO_GIVEUP_MS,
) {
  let reported = false;
  // 自己回復の要求は「遅延の波」ごとに1回（待ちが全部なくなったら次の波でまた1回）
  let slowRequested = false;
  let stuckRequested = false;
  const pending = new Map<string, Pending>();
  const seen = new Map<string, { at: number; updated: number | null }>();

  const keyOf = (table: string, id: string) => `${table}:${id}`;
  const prune = () => {
    const t = deps.now();
    for (const [k, v] of seen) if (t - v.at > SEEN_KEEP_MS) seen.delete(k);
  };
  const satisfied = (s: { at: number; updated: number | null } | undefined, expected: number | null): boolean => {
    if (!s) return false;
    if (expected === null || s.updated === null) return true;
    return s.updated >= expected;
  };
  const resetEpisodeIfIdle = () => {
    if (pending.size === 0) { slowRequested = false; stuckRequested = false; }
  };
  const finish = (key: string, p: Pending, outcome: string, waiting: number) => {
    pending.delete(key);
    resetEpisodeIfIdle();
    if (reported) return; // 記録はセッション中1回。回復の要求は波ごとに続ける
    reported = true;
    const secs = Math.round((deps.now() - p.startedAt) / 1000);
    deps.log({
      source: "report",
      code: "realtime-silent",
      message: "自分の保存の realtime エコーが10秒以内に届きませんでした",
      context:
        `表:${p.table} / チャンネル:${deps.channelState()} / ${outcome}（経過${secs}秒） / ` +
        `10秒時点:${p.visAtSlow} 記録時点:${deps.visibility()} / 待ち${waiting}件`,
    });
  };

  const goSlow = (key: string) => {
    const p = pending.get(key);
    if (!p) return;
    p.phase = "slow";
    p.visAtSlow = deps.visibility();
    if (!slowRequested) { slowRequested = true; deps.onSlow(); }
    p.handle = deps.setTimeout(() => giveUp(key), Math.max(0, giveUpMs - timeoutMs));
  };
  const giveUp = (key: string) => {
    const p = pending.get(key);
    if (!p) return;
    const waiting = pending.size;
    if (!stuckRequested) { stuckRequested = true; deps.onStuck(); }
    finish(key, p, "60秒以内に届かず", waiting);
  };

  return {
    /** 自分の保存が成功した直後に呼ぶ（updatedAt は DB が返した値） */
    expectEcho(table: string, id: string, updatedAt?: string): void {
      if (deps.isGuest()) return;
      if (deps.visibility() === "hidden") return;
      // 長く非表示で購読を止めている間と、再開直後の接続待ちは、エコーが届かなくて当然（v3.171）
      const channelState = deps.channelState();
      if (channelState === "paused" || channelState === "resuming") return;
      const key = keyOf(table, id);
      const expected = parseTs(updatedAt);
      if (satisfied(seen.get(key), expected)) return; // エコーの方が先に届いていた
      if (pending.has(key)) return;
      const handle = deps.setTimeout(() => goSlow(key), timeoutMs);
      pending.set(key, { handle, phase: "wait", startedAt: deps.now(), table, expected, visAtSlow: "-" });
    },
    /** realtime（または差分取得）で tasks・projects の変更が届いたときに呼ぶ */
    noteEcho(table: string, id: string, updatedAt?: string, via: EchoVia = "realtime"): void {
      const key = keyOf(table, id);
      const updated = parseTs(updatedAt);
      // 差分取得で入った行は「realtime が届いた証拠」ではないので、先着の記憶には残さない
      if (via === "realtime") {
        seen.set(key, { at: deps.now(), updated });
        prune();
      }
      const p = pending.get(key);
      if (!p || !satisfied({ at: deps.now(), updated }, p.expected)) return;
      deps.clearTimeout(p.handle);
      if (p.phase === "slow") {
        const waiting = pending.size;
        finish(key, p, via === "realtime" ? "遅れて届いた" : "realtimeでは届かず差分取得で補完", waiting);
        return;
      }
      pending.delete(key);
      resetEpisodeIfIdle();
    },
    /** テスト・解除用 */
    dispose(): void {
      for (const p of pending.values()) deps.clearTimeout(p.handle);
      pending.clear();
      seen.clear();
    },
  };
}

type Watch = ReturnType<typeof createRealtimeEchoWatch>;
let singleton: Watch | null = null;

/** アプリ全体で1つ。依存は初回に実物を差し込む（ログ・チャンネル状態・ゲスト判定は動的 import を避けて引数で受ける） */
export function initRealtimeEchoWatch(deps: EchoWatchDeps): void {
  singleton?.dispose();
  singleton = createRealtimeEchoWatch(deps);
}

export function noteOwnWrite(table: string, id: string, updatedAt?: string): void {
  singleton?.expectEcho(table, id, updatedAt);
}

export function noteRemoteEcho(table: string, id: string, updatedAt?: string, via: EchoVia = "realtime"): void {
  singleton?.noteEcho(table, id, updatedAt, via);
}

export function disposeRealtimeEchoWatch(): void {
  singleton?.dispose();
  singleton = null;
}

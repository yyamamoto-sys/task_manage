// src/lib/diagnostics/realtimeEchoWatch.ts
//
// 自分の保存（tasks・projects の insert/update）の realtime エコーが10秒以内に届かなければ、セッション中1回だけ
// client_error_logs へ code="realtime-silent" を記録する（v3.148・CLAUDE.md Section 76）。
// 「他の人の変更がリロードするまで反映されない」の原因が、イベントがそもそも届いていないことなのかを
// 利用者の実環境（会社のネットワーク・Teams 内など）から知るための見張り。
//   - 自分の保存は DB にコミットされれば、同じ行の変更が自分の購読にも返ってくるはず（RLS が自分に見える行なので）。
//   - 届いたら何もしない。届かなければ、チャンネルの状態・経過秒・表名を context に付けて1回だけ送る。
//   - realtime のエコーが保存の応答より先に届くことがある。直近のエコーを短時間覚えておき、保存の登録時に照合する。

export const ECHO_TIMEOUT_MS = 10_000;
const SEEN_KEEP_MS = 30_000;

export interface EchoWatchDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  channelState: () => string;
  isGuest: () => boolean;
  log: (input: { source: "report"; code: string; message: string; context: string }) => void;
}

function parseTs(v: string | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function createRealtimeEchoWatch(deps: EchoWatchDeps, timeoutMs: number = ECHO_TIMEOUT_MS) {
  let reported = false;
  const pending = new Map<string, { handle: unknown; startedAt: number; table: string; expected: number | null }>();
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

  return {
    /** 自分の保存が成功した直後に呼ぶ（updatedAt は DB が返した値） */
    expectEcho(table: string, id: string, updatedAt?: string): void {
      if (reported || deps.isGuest()) return;
      const key = keyOf(table, id);
      const expected = parseTs(updatedAt);
      if (satisfied(seen.get(key), expected)) return; // エコーの方が先に届いていた
      if (pending.has(key)) return;
      const startedAt = deps.now();
      const handle = deps.setTimeout(() => {
        pending.delete(key);
        if (reported) return;
        reported = true;
        for (const p of pending.values()) deps.clearTimeout(p.handle);
        pending.clear();
        const secs = Math.round((deps.now() - startedAt) / 1000);
        deps.log({
          source: "report",
          code: "realtime-silent",
          message: "自分の保存の realtime エコーが10秒以内に届きませんでした",
          context: `表:${table} / チャンネル:${deps.channelState()} / 経過${secs}秒`,
        });
      }, timeoutMs);
      pending.set(key, { handle, startedAt, table, expected });
    },
    /** realtime で tasks・projects の変更が届いたときに呼ぶ */
    noteEcho(table: string, id: string, updatedAt?: string): void {
      if (reported) return;
      const key = keyOf(table, id);
      const updated = parseTs(updatedAt);
      seen.set(key, { at: deps.now(), updated });
      prune();
      const p = pending.get(key);
      if (p && satisfied({ at: deps.now(), updated }, p.expected)) {
        deps.clearTimeout(p.handle);
        pending.delete(key);
      }
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

export function noteRemoteEcho(table: string, id: string, updatedAt?: string): void {
  singleton?.noteEcho(table, id, updatedAt);
}

export function disposeRealtimeEchoWatch(): void {
  singleton?.dispose();
  singleton = null;
}

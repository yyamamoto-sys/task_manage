// src/lib/notifications/bellPolling.ts
//
// 右上のベルの未読数を定期的に取り直す判断（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
// 以前は3分ごとに無条件で in_app_notifications を取っていた（本番の pg_stat_statements で約22万回）。
//   - タブが非表示の間は取りに行かない（前面に戻ったときに1回だけ取る）。
//   - 通知の Realtime が SUBSCRIBED の間は、イベントで即時に届くので間隔を15分に延ばす（保険）。
//     「publication 未適用でも黙って SUBSCRIBED になりうる」ため、完全には止めない。
//   - Realtime が切れているときだけ従来どおり3分の保険を効かせる。

export const BELL_POLL_TICK_MS = 60 * 1000;
export const BELL_FALLBACK_MS = 3 * 60 * 1000;
export const BELL_LIVE_SAFETY_MS = 15 * 60 * 1000;

export function shouldPollBell(input: { hidden: boolean; live: boolean; now: number; lastFetchAt: number }): boolean {
  if (input.hidden) return false;
  const interval = input.live ? BELL_LIVE_SAFETY_MS : BELL_FALLBACK_MS;
  return input.now - input.lastFetchAt >= interval;
}

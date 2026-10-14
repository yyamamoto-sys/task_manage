// src/lib/supabase/realtimeState.ts
//
// app-sync チャンネルの現在の状態（SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED / none）。
// 「自分の保存の realtime エコーが届かない」診断（realtimeEchoWatch）が context に載せるためだけに持つ（v3.148・Section 76）。
// 購読の判断には使わない（判断は resync.ts の createReconnectTracker）。

let state = "none";

export function setRealtimeChannelState(s: string): void {
  state = s;
}

export function getRealtimeChannelState(): string {
  return state;
}

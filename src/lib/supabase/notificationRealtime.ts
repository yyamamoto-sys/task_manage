// src/lib/supabase/notificationRealtime.ts
//
// 右上のベル（v3.133）：自分の in_app_notifications の INSERT/UPDATE を Realtime で購読し、未読数を即時に取り直す。
// 対象は migrations/20261002b_in_app_notifications_realtime.sql の publication。他人の行は RLS（本人の行だけ）で届かない。
// 購読できない環境（publication 未適用・接続失敗）ではエラーにせず console.warn だけ出し、ベル側の従来のポーリング（3分。publication 未適用でも黙って SUBSCRIBED になりうるため、購読中も延ばさない）で動く。
// 後片付けは realtime.ts と同じく removeChannel。切断後の再接続は supabase-js が自動で行い、再び SUBSCRIBED になったら
// onChange を1回呼んで取りこぼしを埋める。

import { REALTIME_LISTEN_TYPES, REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { supabase } from "./client";

// 同名のチャンネルは使い回されうる（StrictMode の再マウントで、解除中のチャンネルに .on を足すと例外になる）ため購読ごとに名前を変える
let seq = 0;

export function subscribeInAppNotifications(
  memberId: string,
  onChange: () => void,
): () => void {
  const channel = supabase.channel(`in-app-notifications:${memberId}:${++seq}`);
  const filter = `member_id=eq.${memberId}`;
  for (const event of ["INSERT", "UPDATE"] as const) {
    channel.on(
      REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
      { event, schema: "public", table: "in_app_notifications", filter },
      () => onChange(),
    );
  }

  let wasLive = false;
  channel.subscribe((status, err) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      if (wasLive) onChange();
      wasLive = true;
      return;
    }
    if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
      console.warn("[notificationRealtime] ベルの即時更新を購読できません（ポーリングで更新します）:", status, err);
    }
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}

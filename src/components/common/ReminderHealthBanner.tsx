// src/components/common/ReminderHealthBanner.tsx
//
// 期限リマインドが「黙って止まる」のを防ぐ管理画面バナー（v3.128・設計書 §6.3）。
// BackupHealthBanner と同じ流儀：非ブロッキング取得・閉じても次回読み込みでまた出す・
// 取得失敗は黙って消さず「確認できません」を出す。reminder_runs は super_admin しか読めないため
// super_admin にだけ出す。判定は src/lib/reminder/reminderHealth.ts（純粋関数）。

import { useEffect, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { fetchRecentReminderRuns } from "../../lib/supabase/notificationStore";
import { resolveReminderHealth, type ReminderHealthResult } from "../../lib/reminder/reminderHealth";
import { formatErrorForUser } from "../../lib/errorMessage";

type BannerState =
  | { kind: "hidden" }
  | { kind: "unavailable"; detail: string }
  | { kind: "shown"; result: ReminderHealthResult };

export function ReminderHealthBanner({ currentUser }: { currentUser: Member }) {
  const isSuperAdmin = currentUser.is_super_admin === true;
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const runs = await fetchRecentReminderRuns({ cronOnly: true });
        if (cancelled) return;
        const result = resolveReminderHealth(runs, new Date());
        setState(result.level === "none" ? { kind: "hidden" } : { kind: "shown", result });
      } catch (e) {
        if (cancelled) return;
        const detail = formatErrorForUser("reminder_runs の取得に失敗", e);
        console.error("[ReminderHealthBanner]", detail);
        setState({ kind: "unavailable", detail });
      }
    })();
    return () => { cancelled = true; };
  }, [isSuperAdmin, currentUser.id]);

  if (!isSuperAdmin || dismissed || state.kind === "hidden") return null;

  const red = state.kind === "shown" && state.result.level === "red";
  const tone = red ? "danger" : "warning";
  const title = state.kind === "unavailable"
    ? "期限リマインドの状態を確認できません"
    : red
      ? "🔴 期限リマインドが止まっている可能性があります"
      : "🟡 期限リマインドの送信失敗が多くなっています";
  const body = state.kind === "unavailable"
    ? `通知の実行記録を取得できませんでした。${state.detail}`
    : red
      ? `${state.result.missedSlot} の自動実行が${state.result.reason === "missing" ? "記録されていません（cron が止まっている可能性）" : "失敗しています"}。`
      : state.result.reason === "partial"
        ? "直近の自動実行が「一部失敗」でした。"
        : "直近の自動実行で、Windows通知の半数以上が失敗しました。";

  return (
    <div
      role="status"
      style={{
        position: "fixed", top: "16px", right: "16px", zIndex: 149,
        width: "min(380px, calc(100vw - 32px))",
        borderRadius: "var(--radius-md)", boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
        padding: "12px 14px", fontSize: "12px", lineHeight: 1.5,
        background: `var(--color-bg-${tone})`, border: `1px solid var(--color-border-${tone})`, color: `var(--color-text-${tone})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>{title}</div>
          <div style={{ opacity: 0.9, wordBreak: "break-word", overflowWrap: "anywhere" }}>{body}</div>
          <div style={{ marginTop: "6px", opacity: 0.75, fontSize: "10.5px" }}>
            詳細は 設定 → 部署の管理 → アプリ設定 → 通知 で確認できます。
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          title="閉じる"
          aria-label="閉じる"
          style={{ flexShrink: 0, background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: "14px", padding: 0, lineHeight: 1 }}
        >×</button>
      </div>
    </div>
  );
}

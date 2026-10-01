// src/components/admin/ReminderSection.tsx
//
// 設定 →「アプリ設定」→「通知」タブ（super_admin のみ・v3.128）。期限リマインド（push-reminders）の
// 直近30回の実行記録・購読数・dryRun を見る場所（設計書 §6.3。BackupSection と同じ構成）。
// 平日は30分ごとに起動するため、30件でおよそ1営業日分になる。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { Card, SummaryRow, SummaryTile } from "../common/Card";
import { primaryBtnStyle } from "./adminStyles";
import { formatJstDateTime } from "../../lib/backup/backupFormat";
import { resolveReminderHealth } from "../../lib/reminder/reminderHealth";
import {
  fetchPushSubscriptionStats, fetchRecentReminderRuns, runReminderDryRun,
  type ReminderDryRunResult, type ReminderRun,
} from "../../lib/supabase/notificationStore";

const STATUS_LABEL: Record<ReminderRun["status"], string> = {
  running: "実行中", success: "成功", partial: "一部失敗", failed: "失敗",
};
const STATUS_TONE: Record<ReminderRun["status"], string> = {
  running: "info", success: "success", partial: "warning", failed: "danger",
};
const TRIGGER_LABEL: Record<ReminderRun["trigger"], string> = {
  cron: "自動", manual: "手動", test: "テスト",
};

export function ReminderSection({ currentUser }: { currentUser: Member }) {
  const members = useAppStore(s => s.members);
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.display_name])), [members]);
  const isSuperAdmin = currentUser.is_super_admin === true;

  const [runs, setRuns] = useState<ReminderRun[]>([]);
  const [stats, setStats] = useState<{ subscriptions: number; members: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRun, setDryRun] = useState<ReminderDryRunResult | null>(null);

  const reload = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetchRecentReminderRuns(), fetchPushSubscriptionStats()]);
      setRuns(r);
      setStats(s);
      setFetchError(null);
    } catch (e) {
      setFetchError(formatErrorForUser("通知の実行記録の取得に失敗しました", e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isSuperAdmin) void reload(); }, [isSuperAdmin, reload]);

  const handleDryRun = async () => {
    if (dryRunning) return;
    setDryRunning(true);
    try {
      setDryRun(await runReminderDryRun());
    } catch (e) {
      showToast(formatErrorForUser("dryRun に失敗しました", e), "error");
    } finally {
      setDryRunning(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 2 }}>
        🔒 通知の実行記録は全社スーパー管理者のみ確認できます。
      </div>
    );
  }

  const health = resolveReminderHealth(runs, new Date());
  const lastCron = runs.find(r => r.trigger === "cron");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>通知（期限リマインド）</h2>
        <button
          style={{ ...primaryBtnStyle, opacity: dryRunning ? 0.6 : 1, cursor: dryRunning ? "wait" : "pointer" }}
          disabled={dryRunning}
          onClick={() => void handleDryRun()}
          title="送信も記録もせず、今日送る内容を全員分確認します"
        >
          {dryRunning ? "確認中…" : "▶ 今すぐ実行（dryRun）"}
        </button>
      </div>

      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
        平日 7:00〜19:30 に30分ごとに起動し、その時刻を選んでいる人へ「期限超過・今日期限」を知らせます（祝日は送らず「祝日のためスキップ」を記録します）。
        「成功」はプッシュサービスが受け取ったところまでで、画面に表示されたかまでは分かりません。詳細は docs/dev/web-push-reminder-design.md。
      </div>

      {fetchError && (
        <div role="alert" style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
          {fetchError}
        </div>
      )}

      <SummaryRow>
        <SummaryTile
          label="状態"
          value={health.level === "red" ? `🔴 ${health.missedSlot ?? ""} の実行が${health.reason === "missing" ? "ありません" : "失敗"}` : health.level === "yellow" ? "🟡 失敗が多い" : "正常"}
          tone={health.level === "red" ? "danger" : health.level === "yellow" ? "warning" : "success"}
        />
        <SummaryTile label="最後の自動実行" value={lastCron ? formatJstDateTime(lastCron.started_at) : "なし"} tone="info" />
        <SummaryTile label="Windows通知の登録" value={stats ? `${stats.subscriptions}件（${stats.members}人）` : "—"} tone="accent" />
      </SummaryRow>

      {dryRun && (
        <Card title="dryRun の結果（送信していません）" badge={`${dryRun.people.length}人`}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px", lineHeight: 1.7 }}>
            {dryRun.date}（今のスロット {dryRun.currentSlot}）。
            {dryRun.daySkip ? ` 今日は送りません：${dryRun.daySkip}。` : ""}
            {!dryRun.vapidConfigured && " 🔴 VAPID の鍵が未設定です（Windows通知は送れません）。"}
          </div>
          {dryRun.people.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>今日知らせる対象の人はいません。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {dryRun.people.map(p => (
                <div key={p.memberId} style={{ fontSize: "11.5px", padding: "6px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", color: "var(--color-text-primary)" }}>
                    <span style={{ fontWeight: 600 }}>{memberNameById.get(p.memberId) ?? p.memberId}</span>
                    <span>{p.reminderTime}</span>
                    <span>{p.inapp ? "アプリ内✓" : "アプリ内—"}</span>
                    <span>{p.push ? `Windows✓（登録${p.subscriptionCount}件）` : "Windows—"}</span>
                  </div>
                  <div style={{ color: "var(--color-text-secondary)", marginTop: "2px" }}>{p.body}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {loading ? (
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>
      ) : (
        <Card title="直近の実行記録" badge={`最新${runs.length}件`}>
          {runs.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>実行記録がまだありません。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {runs.map(run => {
                const tone = STATUS_TONE[run.status];
                return (
                  <div key={run.id} style={{
                    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "6px 10px",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", fontSize: "11.5px",
                  }}>
                    <span style={{
                      fontSize: "10.5px", padding: "1px 8px", borderRadius: "99px", fontWeight: 500,
                      color: `var(--color-text-${tone})`, background: `var(--color-bg-${tone})`, border: `1px solid var(--color-border-${tone})`,
                    }}>{STATUS_LABEL[run.status]}</span>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{formatJstDateTime(run.started_at)}</span>
                    <span style={{ color: "var(--color-text-tertiary)" }}>
                      {TRIGGER_LABEL[run.trigger]}{run.triggered_by ? `（${memberNameById.get(run.triggered_by) ?? run.triggered_by}）` : ""}
                      {run.slot_time ? ` ${run.slot_time.slice(0, 5)}` : ""}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>対象 {run.target_members ?? "—"}人</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>アプリ内 {run.inapp_written ?? "—"}</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      Windows {run.push_succeeded ?? "—"}/{run.push_attempted ?? "—"}
                      {(run.subscriptions_removed ?? 0) > 0 ? `（失効削除 ${run.subscriptions_removed}）` : ""}
                    </span>
                    {run.error_summary && (
                      <span style={{ flexBasis: "100%", color: run.status === "success" ? "var(--color-text-tertiary)" : "var(--color-text-danger)", fontSize: "11px" }}>
                        {run.error_summary}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// src/components/admin/BackupSection.tsx
//
// 【設計意図】
// 設定画面「アプリ設定」カテゴリの「バックアップ」タブ。日次バックアップ
// （docs/dev/backup-design.md）フェーズ4：失敗しても誰も気づかない状態を解消するための
// 管理画面。全社スーパー管理者のみ（LoadingTipsSection.tsx と同じガードの書き方）。
//
// - 直近の実行状況（backup_runs 最新10件）
// - 現在の世代一覧（backup_objects の deleted_at IS NULL のもの）とダウンロード
// - 手動実行ボタン（backup-daily Edge Function を super-admin の JWT で呼ぶ）
//
// 🔴 .select() には必ず .limit() を付ける（src/lib/supabase/backupStore.ts 側で徹底済み）。
// このコンポーネント自身は直接 supabase.from(...) を呼ばず、必ず backupStore.ts 経由にする。

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, BackupRun, BackupObject } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { Card, SummaryTile, SummaryRow } from "../common/Card";
import { primaryBtnStyle, ghostBtnStyle } from "./adminStyles";
import {
  fetchRecentBackupRuns,
  fetchActiveBackupObjects,
  runBackupNow,
  requestSingleBackupDownloadUrl,
} from "../../lib/supabase/backupStore";
import { formatBytes, formatDurationMs, formatJstDateTime } from "../../lib/backup/backupFormat";

interface Props {
  currentUser: Member;
}

const STATUS_LABEL: Record<BackupRun["status"], string> = {
  running: "実行中",
  success: "成功",
  partial: "一部失敗",
  failed: "失敗",
};

const STATUS_STYLE: Record<BackupRun["status"], React.CSSProperties> = {
  running: { color: "var(--color-text-info)", background: "var(--color-bg-info)", border: "1px solid var(--color-border-info)" },
  success: { color: "var(--color-text-success)", background: "var(--color-bg-success)", border: "1px solid var(--color-border-success)" },
  partial: { color: "var(--color-text-warning)", background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)" },
  failed:  { color: "var(--color-text-danger)", background: "var(--color-bg-danger)", border: "1px solid var(--color-border-danger)" },
};

const RETENTION_LABEL: Record<string, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
  quarterly: "四半期",
};

const statusBadgeStyle = (status: BackupRun["status"]): React.CSSProperties => ({
  display: "inline-block", fontSize: "10.5px", padding: "1px 8px", borderRadius: "99px",
  fontWeight: 500,
  ...STATUS_STYLE[status],
});

export function BackupSection({ currentUser }: Props) {
  const groups = useAppStore(s => s.groups);
  const members = useAppStore(s => s.members);
  const isSuperAdmin = currentUser.is_super_admin === true;

  const groupNameById = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups]);
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.display_name])), [members]);

  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [objects, setObjects] = useState<BackupObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [runsData, objectsData] = await Promise.all([
        fetchRecentBackupRuns(),
        fetchActiveBackupObjects(),
      ]);
      setRuns(runsData);
      setObjects(objectsData);
      setFetchError(null);
    } catch (e: unknown) {
      setFetchError(formatErrorForUser("バックアップの状態の取得に失敗しました", e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleRunNow = async () => {
    if (running) return; // 二重押し防止
    setRunning(true);
    try {
      const result = await runBackupNow();
      const label = result.status === "success" ? "成功" : result.status === "partial" ? "一部失敗" : "失敗";
      showToast(
        `バックアップを実行しました（結果：${label}／run_id=${result.run_id}）`,
        result.status === "success" ? "success" : "error",
      );
      await reload();
    } catch (e: unknown) {
      showToast(formatErrorForUser("バックアップの手動実行に失敗しました", e), "error");
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = async (path: string) => {
    if (downloadingPath) return;
    setDownloadingPath(path);
    try {
      const result = await requestSingleBackupDownloadUrl(path);
      if (result.error || !result.signedUrl) {
        showToast(formatErrorForUser("ダウンロードURLの取得に失敗しました", new Error(result.error ?? "不明なエラー")), "error");
        return;
      }
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      showToast(formatErrorForUser("ダウンロードURLの取得に失敗しました", e), "error");
    } finally {
      setDownloadingPath(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 2 }}>
        🔒 バックアップの状態確認・実行は全社スーパー管理者のみ利用できます。
      </div>
    );
  }

  const latestSuccess = runs.find(r => r.status === "success");
  const activeCount = objects.length;
  const totalBytes = objects.reduce((sum, o) => sum + (o.bytes ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>バックアップ</h2>
        <button
          style={{ ...primaryBtnStyle, opacity: running ? 0.6 : 1, cursor: running ? "wait" : "pointer" }}
          disabled={running}
          onClick={() => void handleRunNow()}
        >
          {running ? "実行中…" : "▶ 今すぐ実行"}
        </button>
      </div>

      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
        日次バックアップ（毎日 JST 3:00 に自動実行）の実行状況と、現在保存されている世代の一覧です。詳細は
        docs/dev/backup-design.md を参照してください。
      </div>

      {fetchError && (
        <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
          {fetchError}
        </div>
      )}

      <SummaryRow>
        <SummaryTile
          label="最終成功"
          value={latestSuccess ? formatJstDateTime(latestSuccess.finished_at) : "なし"}
          tone={latestSuccess ? "success" : "danger"}
        />
        <SummaryTile label="現在の世代数" value={activeCount} tone="info" />
        <SummaryTile label="使用容量（世代合計）" value={formatBytes(totalBytes)} tone="accent" />
      </SummaryRow>

      {loading ? (
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>
      ) : (
        <>
          <Card title="直近の実行状況" badge={`最新${runs.length}件`}>
            {runs.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
                実行記録がまだありません。
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {runs.map(run => (
                  <div
                    key={run.id}
                    style={{
                      display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
                      padding: "8px 10px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)",
                      fontSize: "11.5px",
                    }}
                  >
                    <span style={statusBadgeStyle(run.status)}>{STATUS_LABEL[run.status]}</span>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                      {formatJstDateTime(run.started_at)}
                    </span>
                    <span style={{ color: "var(--color-text-tertiary)" }}>
                      {run.trigger === "manual" ? `手動（${run.triggered_by ? (memberNameById.get(run.triggered_by) ?? run.triggered_by) : "―"}）` : "自動"}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      部署数 {run.group_count ?? "—"}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {formatBytes(run.bytes_written)}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {formatDurationMs(run.duration_ms)}
                    </span>
                    {run.error_message && (
                      <span style={{ flexBasis: "100%", color: "var(--color-text-danger)", fontSize: "11px" }}>
                        {run.error_message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="現在の世代一覧" badge={`${objects.length}件`}>
            {objects.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
                現在有効な世代がありません。
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {objects.map(obj => (
                  <div
                    key={obj.path}
                    style={{
                      display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
                      padding: "8px 10px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)",
                      fontSize: "11.5px",
                    }}
                  >
                    <span style={{
                      fontSize: "10px", padding: "1px 7px", borderRadius: "99px",
                      background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                    }}>
                      {obj.scope === "full" ? "全体" : (obj.group_id ? (groupNameById.get(obj.group_id) ?? obj.group_id) : "部署不明")}
                    </span>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                      {formatJstDateTime(obj.taken_at)}
                    </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>
                      {formatBytes(obj.bytes)}
                    </span>
                    <span style={{ display: "flex", gap: "4px" }}>
                      {(obj.retention ?? []).map(tag => (
                        <span key={tag} style={{
                          fontSize: "9.5px", padding: "1px 6px", borderRadius: "99px",
                          background: "var(--color-bg-info)", color: "var(--color-text-info)",
                          border: "1px solid var(--color-border-info)",
                        }}>
                          {RETENTION_LABEL[tag] ?? tag}
                        </span>
                      ))}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button
                      style={{ ...ghostBtnStyle, opacity: downloadingPath === obj.path ? 0.6 : 1 }}
                      disabled={downloadingPath === obj.path}
                      onClick={() => void handleDownload(obj.path)}
                    >
                      {downloadingPath === obj.path ? "取得中…" : "ダウンロード"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

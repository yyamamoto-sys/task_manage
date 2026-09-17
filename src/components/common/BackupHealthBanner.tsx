// src/components/common/BackupHealthBanner.tsx
//
// 【設計意図】
// 日次バックアップ（docs/dev/backup-design.md）フェーズ4：Teamsに依存しない経路として
// 管理画面に必ず表示する健全性バナー（§8「管理画面バナーはTeamsに依存しない経路として
// 必ず実装する」）。SchemaHealthBanner.tsx と全く同じ流儀（非ブロッキング取得・
// 表示対象は管理者のみ・閉じても次回読み込みでまた表示する＝localStorageに保存しない）。
//
// - 判定ロジック自体は src/lib/backup/backupHealth.ts の resolveBackupHealth（純粋関数）。
//   このコンポーネントはデータ取得とその結果の解釈だけを担う。
// - テーブルが無い（マイグレーション未適用）・取得自体が失敗する場合は、黙って消えず
//   「確認できません」を表示する（Section 22のスキーマ検査バナーと同じ方針。
//   一次バックアップがまだ一度も無い正常な初期状態と、取得エラーを区別するため）。
// - 正常時（level: "none"）は何も表示しない。

import { useEffect, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { fetchLastBackupRunSuccessAt, fetchBackupExportsHealth } from "../../lib/supabase/backupStore";
import { resolveBackupHealth, type BackupHealthLevel } from "../../lib/backup/backupHealth";
import { formatElapsedHours, formatElapsedDays } from "../../lib/backup/backupFormat";

interface Props {
  currentUser: Member;
}

type BannerState =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "shown"; level: Exclude<BackupHealthLevel, "none">; hoursSinceLastRunSuccess: number | null; daysSinceLastExportSuccess: number | null };

export function BackupHealthBanner({ currentUser }: Props) {
  const isAdmin = currentUser.is_admin === true || currentUser.is_super_admin === true;
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setDismissed(false);
    (async () => {
      try {
        const [lastRunSuccessAt, exportsHealth] = await Promise.all([
          fetchLastBackupRunSuccessAt(),
          fetchBackupExportsHealth(),
        ]);
        if (cancelled) return;
        const result = resolveBackupHealth({
          lastRunSuccessAt,
          hasAnyExportRecord: exportsHealth.hasAnyRecord,
          lastExportSuccessAt: exportsHealth.lastSuccessAt,
          now: new Date(),
        });
        if (result.level === "none") {
          setState({ kind: "hidden" });
        } else {
          setState({
            kind: "shown",
            level: result.level,
            hoursSinceLastRunSuccess: result.hoursSinceLastRunSuccess,
            daysSinceLastExportSuccess: result.daysSinceLastExportSuccess,
          });
        }
      } catch {
        // テーブル未適用・RPC失敗等。黙って消さず「確認できません」を出す。
        if (!cancelled) setState({ kind: "unavailable" });
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, currentUser.id]);

  if (!isAdmin || dismissed) return null;
  if (state.kind === "hidden") return null;

  const tone = state.kind === "unavailable"
    ? "warning" as const
    : state.level === "red"
      ? "danger" as const
      : "warning" as const;

  const toneStyles = {
    danger: {
      background: "var(--color-bg-danger)",
      border: "1px solid var(--color-border-danger)",
      color: "var(--color-text-danger)",
    },
    warning: {
      background: "var(--color-bg-warning)",
      border: "1px solid var(--color-border-warning)",
      color: "var(--color-text-warning)",
    },
  }[tone];

  const title =
    state.kind === "unavailable"
      ? "バックアップの状態を確認できません"
      : state.level === "red"
        ? "🔴 一次バックアップが止まっている可能性があります"
        : "🟡 二次保管が遅れている可能性があります";

  const body =
    state.kind === "unavailable"
      ? "バックアップの管理テーブルが見つからないか、確認中にエラーが発生しました。マイグレーション（20260916_add_backup.sql）が適用済みか確認してください。"
      : state.kind === "shown" && state.level === "red"
        ? `一次バックアップ（backup_runs）の最終成功：${formatElapsedHours(state.hoursSinceLastRunSuccess)}。24時間以上成功していません。`
        : state.kind === "shown"
          ? `二次保管（backup_exports）の最終成功：${formatElapsedDays(state.daysSinceLastExportSuccess)}。3日以上成功していません。`
          : "";

  return (
    <div
      role="status"
      style={{
        position: "fixed", top: "16px", left: "16px", zIndex: 149,
        width: "min(380px, calc(100vw - 32px))",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
        padding: "12px 14px",
        fontSize: "12px",
        lineHeight: 1.5,
        ...toneStyles,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span style={{ flexShrink: 0, fontSize: "14px" }}>
          {state.kind === "unavailable" ? "⚠️" : state.level === "red" ? "🔴" : "🟡"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>{title}</div>
          <div style={{ opacity: 0.9 }}>{body}</div>
          <div style={{ marginTop: "6px", opacity: 0.75, fontSize: "10.5px" }}>
            詳細は 設定 → アプリ設定 → バックアップ で確認できます。
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          title="閉じる"
          style={{
            flexShrink: 0, background: "transparent", border: "none",
            color: "inherit", cursor: "pointer",
            fontSize: "14px", padding: 0, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

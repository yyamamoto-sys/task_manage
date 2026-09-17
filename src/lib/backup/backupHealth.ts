// src/lib/backup/backupHealth.ts
//
// 【設計意図】
// 管理画面バナー（BackupHealthBanner）の判定ロジックを純粋関数として切り出したもの。
// 正本は docs/dev/backup-design.md §8「通知」：
//   🔴 赤：一次バックアップ（backup_runs の最新 success）が24時間以上前
//   🟡 黄：二次保管（backup_exports の最新 success）が3日以上前。
//          ただし backup_exports が1件も無い場合（フェーズ5未実施）は何も出さない
//          （常時点灯して無視されるようになるのを防ぐため）
//
// 判定基準時刻（now）は引数で受け取り、関数内で new Date() を直接呼ばない
// （境界値テストを固定するため）。
//
// 優先順位：赤 > 黄 > 何も出さない（両方の条件を満たす場合は赤を優先する。
// 一次バックアップが止まっていることの方が、二次保管の遅延より緊急度が高いため）。

export interface BackupHealthInput {
  /** backup_runs の最新 status='success' の finished_at（ISO文字列）。一度も成功していなければ null */
  lastRunSuccessAt: string | null;
  /** backup_exports に1件でもレコードがあるか（フェーズ5未実施なら false） */
  hasAnyExportRecord: boolean;
  /**
   * backup_exports の最新 status='success' の reported_at（ISO文字列）。
   * hasAnyExportRecord=true でも一度も成功していなければ null。
   */
  lastExportSuccessAt: string | null;
  /** 判定基準時刻 */
  now: Date;
}

export type BackupHealthLevel = "red" | "yellow" | "none";

export interface BackupHealthResult {
  level: BackupHealthLevel;
  /** 一次バックアップの最終成功からの経過時間（時間）。一度も成功していなければ null */
  hoursSinceLastRunSuccess: number | null;
  /**
   * 二次保管の最終成功からの経過日数。
   * hasAnyExportRecord=false、または一度も成功していない場合は null。
   */
  daysSinceLastExportSuccess: number | null;
}

const RED_THRESHOLD_HOURS = 24;
const YELLOW_THRESHOLD_DAYS = 3;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function resolveBackupHealth(input: BackupHealthInput): BackupHealthResult {
  const { lastRunSuccessAt, hasAnyExportRecord, lastExportSuccessAt, now } = input;

  const hoursSinceLastRunSuccess = lastRunSuccessAt
    ? (now.getTime() - new Date(lastRunSuccessAt).getTime()) / MS_PER_HOUR
    : null;
  // 一度も成功していない（null）場合も「危険」として赤にする（設計書に明記は無いが、
  // 一次バックアップが一度も成功していない状態を放置しないための安全側の判断。
  // 詳細は作業報告の「設計書と食い違う判断をした箇所」参照）。
  const isRed = hoursSinceLastRunSuccess === null || hoursSinceLastRunSuccess >= RED_THRESHOLD_HOURS;

  const daysSinceLastExportSuccess =
    hasAnyExportRecord && lastExportSuccessAt
      ? (now.getTime() - new Date(lastExportSuccessAt).getTime()) / MS_PER_DAY
      : null;
  const isYellow =
    hasAnyExportRecord &&
    (lastExportSuccessAt === null || (daysSinceLastExportSuccess as number) >= YELLOW_THRESHOLD_DAYS);

  const level: BackupHealthLevel = isRed ? "red" : isYellow ? "yellow" : "none";

  return { level, hoursSinceLastRunSuccess, daysSinceLastExportSuccess };
}

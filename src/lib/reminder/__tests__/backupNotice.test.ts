// src/lib/reminder/__tests__/backupNotice.test.ts
//
// 日次バックアップの通知（v3.136・設計書 §6.2・フェーズ5.5）。文面に失敗理由を載せないこと・宛先が
// super_admin（削除済みを除く）で種類×チャネルの設定に従うこと・backup-daily が Teams を使わず
// _shared/webPush.ts で送ること。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_NOTICE_URL, buildBackupFailureNotice, buildBackupFinalizeFailureNotice, buildBackupWeeklySummaryNotice,
  selectBackupNoticeRecipients, toPushPayload,
} from "../../../../supabase/functions/_shared/backupNotice";
import type { KindPrefsLike } from "../../../../supabase/functions/_shared/notificationKinds";
import { extractOpenTarget } from "../deepLink";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("文面", () => {
  it("失敗：成功数と失敗した範囲だけを書き、例外メッセージは受け取らない", () => {
    const n = buildBackupFailureNotice({
      runId: 12, status: "partial", succeeded: 2, total: 3,
      failed: [{ scope: "full", groupId: null }], dateStr: "2026-10-07",
    });
    expect(n.kind).toBe("backup_failure");
    expect(n.title).toContain("一部失敗");
    expect(n.body).toContain("成功 2/3");
    expect(n.body).toContain("全体");
    expect(n.tag).toBe("backup-failure-2026-10-07");
    expect(buildBackupFailureNotice({
      runId: 1, status: "failed", succeeded: 0, total: 1, failed: [{ scope: "full", groupId: null }], dateStr: "d",
    }).title).toContain("失敗しました");
  });

  it("失敗した部署が多いときは5件まで並べて残りを件数にする", () => {
    const failed = Array.from({ length: 7 }, (_, i) => ({ scope: "group" as const, groupId: `g${i}` }));
    const n = buildBackupFailureNotice({ runId: 1, status: "partial", succeeded: 1, total: 8, failed, dateStr: "d" });
    expect(n.body).toContain("部署 g4");
    expect(n.body).not.toContain("部署 g5");
    expect(n.body).toContain("ほか2件");
  });

  it("後片付けの失敗・週次サマリ", () => {
    expect(buildBackupFinalizeFailureNotice(5, "d").kind).toBe("backup_failure");
    const w = buildBackupWeeklySummaryNotice(
      { successCount: 7, totalBytes: 3 * 1024 * 1024, totalOrphans: 0, totalDeleted: 2, lastExportDate: null }, "2026-10-12",
    );
    expect(w.kind).toBe("backup_weekly_summary");
    expect(w.body).toContain("成功 7件");
    expect(w.body).toContain("約3.0MB");
    expect(w.body).toContain("未設定");
  });

  it("クリック先は管理画面の「バックアップ」で、ディープリンクとして読める", () => {
    expect(extractOpenTarget(new URL(BACKUP_NOTICE_URL, "https://x.example").search)).toBe("admin-backup");
    const p = toPushPayload(buildBackupFinalizeFailureNotice(1, "d"));
    expect(p.url).toBe(BACKUP_NOTICE_URL);
  });
});

describe("宛先", () => {
  const members = [
    { id: "sa1", is_super_admin: true, is_deleted: false },
    { id: "sa2", is_super_admin: true, is_deleted: false },
    { id: "gone", is_super_admin: true, is_deleted: true },
    { id: "user", is_super_admin: false, is_deleted: false },
  ];
  const on = (p: Partial<KindPrefsLike> = {}): KindPrefsLike => ({ inapp_enabled: true, push_enabled: true, kind_channels: {}, ...p });

  it("super_admin（削除済みを除く）。行が無い人はアプリ内だけ（Windows は既定オフ）", () => {
    expect(selectBackupNoticeRecipients(members, new Map(), "backup_failure", "inapp")).toEqual(["sa1", "sa2"]);
    expect(selectBackupNoticeRecipients(members, new Map(), "backup_failure", "push")).toEqual([]);
  });

  it("種類×チャネルの個別設定に従う（週次サマリだけ外せる）", () => {
    const prefs = new Map<string, KindPrefsLike>([
      ["sa1", on({ kind_channels: { backup_weekly_summary: { push: false, inapp: false } } })],
      ["sa2", on()],
    ]);
    expect(selectBackupNoticeRecipients(members, prefs, "backup_weekly_summary", "push")).toEqual(["sa2"]);
    expect(selectBackupNoticeRecipients(members, prefs, "backup_weekly_summary", "inapp")).toEqual(["sa2"]);
    expect(selectBackupNoticeRecipients(members, prefs, "backup_failure", "push")).toEqual(["sa1", "sa2"]);
  });
});

describe("backup-daily の送り方（コメントを除いて走査）", () => {
  const code = readFileSync(join(ROOT, "supabase/functions/backup-daily/index.ts"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

  it("Web Push は共有の送信処理を使い、Teams の Webhook を読まない", () => {
    expect(code).toMatch(/sendToSubscriptions\(/);
    expect(code).toMatch(/from "\.\.\/_shared\/webPush\.ts"/);
    expect(code).not.toMatch(/TEAMS_WEBHOOK_URL/);
    expect(code).not.toMatch(/webpush\.sendNotification/);
  });

  it("失敗・後片付けの失敗・週次サマリの3か所から super_admin へ通知する", () => {
    expect(code.match(/await notifySuperAdmins\(/g)?.length).toBe(3);
  });
});

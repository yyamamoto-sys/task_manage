// src/lib/errors/__tests__/clientErrorMigration.test.ts
//
// 20261001c_notify_v2_client_errors.sql の権限・乱用対策を SQL の文面から検査する（実DBは vitest から起動できない）。
// Section 59：SQL コメント（-- 以降）を取り除いてから走査する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const strip = (sql: string) => sql.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = strip(readFileSync(join(ROOT, "supabase/migrations/20261001c_notify_v2_client_errors.sql"), "utf8"));
const SCHEMA = strip(readFileSync(join(ROOT, "supabase/schema.sql"), "utf8"));
const CLEANUP = readFileSync(join(ROOT, "supabase/migrations/20261001d_schedule_client_error_cleanup.sql"), "utf8");

/** CREATE POLICY 文（次の ; まで）を表ごとに集める（reminderRlsMigration.test.ts と同じ） */
function policiesOf(sql: string, table: string): string[] {
  const re = /CREATE POLICY\s+"[^"]+"\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/g;
  const out: string[] = [];
  for (const m of sql.matchAll(re)) if (m[1] === table) out.push(m[0]);
  return out;
}

function fnBody(sql: string, tag: string): string {
  const m = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql);
  if (!m) throw new Error(`関数本文が見つかりません: ${tag}`);
  return m[1];
}
const LOG_FN = fnBody(MIGRATION, "fn_log_client_error");

describe("エラー記録の権限（20261001c）", () => {
  it("3テーブルとも RLS を有効にしている", () => {
    for (const t of ["client_error_logs", "client_error_reporters", "notification_cursors"]) {
      expect(MIGRATION, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it("読むのは super_admin だけ（SELECT のみ・関数は (SELECT ...) で包む）。書き込みのポリシーは作らない", () => {
    for (const t of ["client_error_logs", "client_error_reporters"]) {
      const ps = policiesOf(MIGRATION, t);
      expect(ps, t).toHaveLength(1);
      expect(ps[0]).toMatch(/FOR SELECT TO authenticated/);
      expect(ps[0]).toContain("(SELECT public.current_member_is_super_admin())");
      expect(ps[0]).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    }
    expect(policiesOf(MIGRATION, "notification_cursors")).toHaveLength(0);
  });

  it("schema.sql にも同じポリシーが同期されている", () => {
    for (const t of ["client_error_logs", "client_error_reporters"]) {
      for (const p of policiesOf(MIGRATION, t)) expect(SCHEMA.includes(p), t).toBe(true);
    }
    expect(SCHEMA).toContain("$fn_log_client_error$");
    expect(SCHEMA).toContain("kind_channels    jsonb NOT NULL DEFAULT '{}'::jsonb");
  });

  it("記録の RPC は本人を current_member_id() で決め、匿名・未登録は例外で拒否する（引数で他人を名乗れない）", () => {
    expect(LOG_FN).toContain("v_member     text := public.current_member_id();");
    expect(LOG_FN).toMatch(/IF v_member IS NULL THEN\s+RAISE EXCEPTION/);
    expect(MIGRATION).not.toMatch(/log_client_error\([^)]*p_member/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.log_client_error\([^)]*\) FROM anon/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.log_client_error\([^)]*\) TO authenticated/);
    expect(MIGRATION).toMatch(/LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''\s+AS \$fn_log_client_error\$/);
  });

  it("🔴 乱用対策：同じ人・同じ fingerprint は1分に1回、新しい fingerprint は1人1時間50件まで", () => {
    expect(LOG_FN).toMatch(/IF v_rep_last > now\(\) - interval '1 minute' THEN\s+RETURN 'throttled';/);
    expect(LOG_FN.match(/first_seen > now\(\) - interval '1 hour';\s+IF v_new_hour >= 50 THEN\s+RETURN 'limited';/g)).toHaveLength(2);
  });

  it("🔴 送る内容を絞る：全ての文字列引数を伏せ字・切り詰めの関数に通す", () => {
    for (const arg of ["p_message, 500", "p_code, 60", "p_context, 200", "p_stack, 2000", "p_route, 200", "p_screen, 60"]) {
      expect(LOG_FN, arg).toContain(`public.redact_client_error_text(${arg})`);
    }
    expect(MIGRATION).toContain("'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[email]'");
  });

  it("アプリ内通知は新規・再発のときだけ、同じ fingerprint は1時間に1回、1人1時間10件まで", () => {
    expect(LOG_FN).toMatch(/IF v_notify AND \(v_log\.last_notified_at IS NULL OR v_log\.last_notified_at < now\(\) - interval '1 hour'\)/);
    expect(LOG_FN).toMatch(/WHERE m\.is_super_admin = true\s+AND m\.is_deleted = false/);
    expect(LOG_FN).toMatch(/AND n\.created_at > now\(\) - interval '1 hour'\) < 10;/);
    expect(LOG_FN).toContain("'/?open=admin-errors'");
  });

  it("解決済みにする RPC は super_admin 以外には何もしない", () => {
    const body = fnBody(MIGRATION, "fn_resolve_client_errors");
    expect(body).toMatch(/IF v_member IS NULL OR NOT COALESCE\(public\.current_member_is_super_admin\(\), false\) THEN\s+RETURN 0;/);
  });

  it("保持90日の削除ジョブは別ファイル・プレースホルダー無し（そのまま手で登録できる）", () => {
    expect(CLEANUP).toContain("delete from public.client_error_logs where last_seen < now() - interval '90 days';");
    expect(CLEANUP).not.toMatch(/<[A-Z_]+>/);
    expect(MIGRATION).not.toMatch(/cron\.schedule/);
  });

  it("検査自体が効いている：本人を引数で受け取る・1分の間引きが無い関数を検出する", () => {
    const bad = "v_member text := p_member_id; IF v_rep_last > now() - interval '1 second' THEN RETURN 'throttled';";
    expect(bad).not.toContain("v_member     text := public.current_member_id();");
    expect(bad).not.toMatch(/interval '1 minute' THEN\s+RETURN 'throttled';/);
  });
});

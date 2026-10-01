// src/lib/reminder/__tests__/reminderRlsMigration.test.ts
//
// 期限リマインドのマイグレーションの RLS を、SQL の文面から検査する（実DBは vitest から起動できないため）。
// Section 59 に従い、SQL コメント（-- 以降）を取り除いてから走査する。
// 守っていること：本人の行のみ（匿名・未登録は current_member_id() IS NOT NULL で弾く）・
// 関数呼び出しは (SELECT ...) で包む（Section 39）・書き込みのポリシーを作らない表に作っていない・
// claim_reminder_sends は service_role だけ。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const stripSqlComments = (sql: string) => sql.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = stripSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261001_web_push_reminders.sql"), "utf8"));
const SCHEMA = stripSqlComments(readFileSync(join(ROOT, "supabase/schema.sql"), "utf8"));

/** CREATE POLICY 文（次の ; まで）を表ごとに集める */
export function policiesOf(sql: string, table: string): string[] {
  const re = /CREATE POLICY\s+"[^"]+"\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/g;
  const out: string[] = [];
  for (const m of sql.matchAll(re)) if (m[1] === table) out.push(m[0]);
  return out;
}

const OWN_TABLES = ["notification_prefs", "push_subscriptions", "in_app_notifications"];
const ADMIN_TABLES = ["reminder_runs", "reminder_send_log"];
const OWN_GUARD = "(SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id())";

describe("期限リマインドの RLS（20261001_web_push_reminders.sql）", () => {
  it("5テーブルすべてで RLS を有効にしている", () => {
    for (const t of [...OWN_TABLES, ...ADMIN_TABLES]) {
      expect(MIGRATION, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it("本人の行だけの表は、全ポリシーが匿名を弾く式（Section 58）を USING に持つ", () => {
    for (const t of OWN_TABLES) {
      const ps = policiesOf(MIGRATION, t);
      expect(ps.length, t).toBeGreaterThan(0);
      for (const p of ps) expect(p.replace(/\s+/g, " "), t).toContain(OWN_GUARD);
    }
  });

  it("実行記録・送信記録は super_admin の SELECT だけ", () => {
    for (const t of ADMIN_TABLES) {
      const ps = policiesOf(MIGRATION, t);
      expect(ps, t).toHaveLength(1);
      expect(ps[0]).toMatch(/FOR SELECT/);
      expect(ps[0]).toContain("(SELECT public.current_member_is_super_admin())");
    }
  });

  it("アプリ内通知・購読には INSERT/UPDATE のポリシーを作らない（書き込みは service_role と RPC のみ）", () => {
    for (const t of ["in_app_notifications", "push_subscriptions"]) {
      for (const p of policiesOf(MIGRATION, t)) expect(p, t).not.toMatch(/FOR (INSERT|UPDATE|ALL)/);
    }
  });

  it("全開放（USING (true)）と、(SELECT ...) で包んでいない関数呼び出しが無い", () => {
    const all = [...OWN_TABLES, ...ADMIN_TABLES].flatMap(t => policiesOf(MIGRATION, t)).join("\n");
    expect(all).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    const unwrapped = all.match(/(?<!SELECT )public\.current_member_(id|is_super_admin)\(\)/g) ?? [];
    expect(unwrapped).toEqual([]);
  });

  it("1人1日1回の関数は service_role だけが実行できる", () => {
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_reminder_sends\(text\[\], date, bigint\) TO service_role/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.claim_reminder_sends\(text\[\], date, bigint\) FROM authenticated/);
    expect(MIGRATION).toMatch(/ON CONFLICT \(member_id, send_date\) DO NOTHING\s+RETURNING member_id/);
  });

  it("schema.sql にも同じポリシーが同期されている", () => {
    for (const t of [...OWN_TABLES, ...ADMIN_TABLES]) {
      for (const p of policiesOf(MIGRATION, t)) expect(SCHEMA.includes(p), `${t}: ${p.slice(0, 60)}`).toBe(true);
    }
  });

  it("検査自体が効いている：包んでいない呼び出しと匿名を弾かない式を検出する", () => {
    const bad = 'CREATE POLICY "x" ON public.notification_prefs FOR ALL TO authenticated USING (member_id = public.current_member_id());';
    const ps = policiesOf(bad, "notification_prefs");
    expect(ps).toHaveLength(1);
    expect(ps[0].replace(/\s+/g, " ")).not.toContain(OWN_GUARD);
    expect(ps[0].match(/(?<!SELECT )public\.current_member_(id|is_super_admin)\(\)/g)).toHaveLength(1);
    expect(policiesOf("-- " + bad, "notification_prefs")).toHaveLength(1);
    expect(policiesOf(stripSqlComments("-- " + bad), "notification_prefs")).toHaveLength(0);
  });
});

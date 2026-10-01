// src/lib/adminMessages/__tests__/adminMessageMigration.test.ts
//
// 20261001e_admin_messages.sql の権限・宛先範囲・乱用対策を SQL の文面から検査する（実DBは vitest から起動できない）。
// Section 59：SQL コメント（-- 以降）を取り除いてから走査する。
// あわせて、push-reminders のお知らせの即時送信が宛先をクライアントから受け取らないこと、
// お知らせの画面が HTML を解釈しないことをソースから検査する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_MESSAGE_BODY_MAX, ADMIN_MESSAGE_MAX_SELECTED, ADMIN_MESSAGE_PER_DAY, ADMIN_MESSAGE_PER_HOUR, ADMIN_MESSAGE_SUBJECT_MAX,
} from "../adminMessages";

const ROOT = join(__dirname, "..", "..", "..", "..");
const strip = (src: string) => src.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
const stripTs = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATION = strip(read("supabase/migrations/20261001e_admin_messages.sql"));
const SCHEMA = strip(read("supabase/schema.sql"));

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
const SEND = fnBody(MIGRATION, "fn_send_admin_message");
const ACK = fnBody(MIGRATION, "fn_acknowledge_admin_message");
const CLAIM = fnBody(MIGRATION, "fn_claim_admin_message_reminders");
const STATUS = fnBody(MIGRATION, "fn_admin_message_status");
const CANDIDATES = fnBody(MIGRATION, "fn_admin_message_candidates");

const FUNCTIONS: [string, string][] = [
  ["send_admin_message", "text, text, text, text, text\\[\\], boolean, date"],
  ["admin_message_candidates", ""],
  ["mark_admin_message_read", "bigint"],
  ["acknowledge_admin_message", "bigint"],
  ["list_sent_admin_messages", "integer"],
  ["admin_message_status", "bigint"],
  ["claim_admin_message_reminders", "bigint\\[\\]"],
];

describe("お知らせのテーブルと RLS（20261001e）", () => {
  it("2テーブルとも RLS を有効にし、SELECT のポリシーだけを持つ（書き込みは RPC のみ）", () => {
    for (const t of ["admin_messages", "admin_message_recipients"]) {
      expect(MIGRATION, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      const ps = policiesOf(MIGRATION, t);
      expect(ps.length, t).toBe(1);
      expect(ps[0], t).toMatch(/FOR SELECT TO authenticated/);
      expect(ps[0], t).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    }
  });

  it("受信者は自分の行だけ・super_admin は全件（関数は (SELECT ...) で包む＝Section 39）", () => {
    const [p] = policiesOf(MIGRATION, "admin_message_recipients");
    expect(p).toContain("(SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id())");
    expect(p).toContain("(SELECT public.current_member_is_super_admin())");
  });

  it("🔴 宛先の表のポリシーは admin_messages を参照しない（相互参照で RLS が無限再帰になるため）", () => {
    const [p] = policiesOf(MIGRATION, "admin_message_recipients");
    expect(p).not.toContain("admin_messages");
  });

  it("お知らせ本体は送信者・super_admin・宛先の本人だけが読める", () => {
    const [p] = policiesOf(MIGRATION, "admin_messages");
    expect(p).toContain("sender_id = (SELECT public.current_member_id())");
    expect(p).toContain("r.member_id = (SELECT public.current_member_id())");
  });

  it("件名・本文の上限が画面側の定数と同じ（CHECK 制約と RPC の両方）", () => {
    expect(MIGRATION).toContain(`char_length(subject) BETWEEN 1 AND ${ADMIN_MESSAGE_SUBJECT_MAX}`);
    expect(MIGRATION).toContain(`char_length(body) BETWEEN 1 AND ${ADMIN_MESSAGE_BODY_MAX}`);
    expect(SEND).toContain(`char_length(v_subject) > ${ADMIN_MESSAGE_SUBJECT_MAX}`);
    expect(SEND).toContain(`char_length(v_body) > ${ADMIN_MESSAGE_BODY_MAX}`);
  });

  it("期限は確認ボタンありのときだけ（CHECK 制約と RPC の両方）", () => {
    expect(MIGRATION).toContain("CHECK (due_date IS NULL OR requires_ack)");
    expect(SEND).toMatch(/p_due_date IS NOT NULL AND NOT coalesce\(p_requires_ack, false\)/);
  });
});

describe("全関数：SECURITY DEFINER・search_path 空・PUBLIC/anon から剥がす", () => {
  for (const [name, args] of FUNCTIONS) {
    it(name, () => {
      const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\)\\s*RETURNS[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = ''`);
      expect(MIGRATION).toMatch(head);
      expect(MIGRATION).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${args}\\) FROM PUBLIC;`));
      expect(MIGRATION).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${args}\\) FROM anon;`));
    });
  }

  it("期限前日の再通知（claim）は service_role だけ（authenticated からも剥がす）", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.claim_admin_message_reminders\(bigint\[\]\) FROM authenticated;/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_admin_message_reminders\(bigint\[\]\) TO service_role;/);
    expect(MIGRATION).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_admin_message_reminders\(bigint\[\]\) TO authenticated/);
  });
});

describe("🔴 宛先の範囲は send_admin_message が強制する", () => {
  it("一般メンバー（is_admin でも is_super_admin でもない）は例外", () => {
    expect(SEND).toMatch(/IF NOT v_is_super AND NOT v_is_admin THEN\s+RAISE EXCEPTION/);
  });

  it("全員宛ては super_admin だけ", () => {
    expect(SEND).toMatch(/IF p_target = 'all' THEN\s+IF NOT v_is_super THEN\s+RAISE EXCEPTION/);
  });

  it("部署の管理者は自分のホーム部署（members.group_id）だけ。current_member_is_admin()（兼務先でも true）は使わない", () => {
    expect(SEND).toContain("v_home_group := v_me.group_id;");
    expect(SEND).toMatch(/IF NOT v_is_super AND \(v_home_group IS NULL OR p_group_id <> v_home_group\) THEN\s+RAISE EXCEPTION/);
    expect(SEND).not.toContain("current_member_is_admin");
    expect(SEND).not.toContain("current_member_group_ids");
  });

  it("個人を選ぶ場合、ホーム部署の外・削除済みの人が1人でも含まれていたら送らない。上限100人", () => {
    expect(SEND).toMatch(/v_is_super\s+OR \(v_home_group IS NOT NULL AND \(m\.group_id = v_home_group OR v_home_group = ANY\(m\.group_ids\)\)\)/);
    expect(SEND).toMatch(/IF v_bad > 0 THEN\s+RAISE EXCEPTION/);
    expect(SEND).toContain(`cardinality(v_ids) > ${ADMIN_MESSAGE_MAX_SELECTED}`);
  });

  it("送信者本人は宛先に含めない・削除済みは含めない", () => {
    expect(SEND.match(/m\.id <> v_member/g)?.length).toBeGreaterThanOrEqual(2);
    expect(SEND).toContain("x <> v_member");
  });

  it("送信頻度の上限が画面側の定数と同じ", () => {
    expect(SEND).toContain(`v_hour >= ${ADMIN_MESSAGE_PER_HOUR} OR v_day >= ${ADMIN_MESSAGE_PER_DAY}`);
  });

  it("送信画面の候補は send_admin_message と同じ範囲（一般は0行・部署の管理者はホーム部署）", () => {
    expect(CANDIDATES).toMatch(/IF NOT coalesce\(v_me\.is_super_admin, false\) AND NOT coalesce\(v_me\.is_admin, false\) THEN\s+RETURN;/);
    expect(CANDIDATES).toContain("(m.group_id = v_me.group_id OR v_me.group_id = ANY(m.group_ids))");
  });

  it("宛先ごとの状況は送信者と super_admin だけ", () => {
    expect(STATUS).toMatch(/NOT coalesce\(public\.current_member_is_super_admin\(\), false\)\s+AND NOT EXISTS \(SELECT 1 FROM public\.admin_messages m WHERE m\.id = p_message_id AND m\.sender_id = v_member\)/);
  });
});

describe("届き方", () => {
  it("🔴 アプリ内通知は本人の設定（notification_prefs）を見ずに全宛先へ作る＝オフにできない", () => {
    expect(SEND).toMatch(/INSERT INTO public\.in_app_notifications \(member_id, kind, title, body, url, message_id\)\s+SELECT x, 'admin_message'/);
    expect(SEND).not.toContain("notification_prefs");
  });

  it("送信者へのまとめ通知は「送信者×お知らせ」の1行を差し替える（部分一意インデックス＋ON CONFLICT）", () => {
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_in_app_notifications_ack_summary\s+ON public\.in_app_notifications \(member_id, message_id\) WHERE kind = 'admin_message_ack'/);
    expect(ACK).toMatch(/ON CONFLICT \(member_id, message_id\) WHERE kind = 'admin_message_ack'\s+DO UPDATE SET/);
  });

  it("まとめ通知の文面と「未読に戻す」規則が adminMessageLogic.ts と同じ", () => {
    expect(ACK).toContain("'」を' || v_acked || '人が確認しました'");
    expect(ACK).toContain("'全員（' || v_total || '人）が確認しました'");
    expect(ACK).toContain("'残り' || (v_total - v_acked) || '人（宛先' || v_total || '人）'");
    expect(ACK).toContain("left(v_msg.subject, 30)");
    expect(ACK.match(/n\.read_at IS NULL OR v_all OR n\.created_at < now\(\) - interval '1 hour'/g)?.length).toBe(2);
  });

  it("確認は本人の行だけ・2回目は送信者へ通知しない（acknowledged_at IS NULL の行だけ更新し、無ければ戻る）", () => {
    expect(ACK).toMatch(/WHERE message_id = p_message_id AND member_id = v_member AND acknowledged_at IS NULL\s+RETURNING acknowledged_at INTO v_ack;/);
    expect(ACK).toMatch(/IF v_ack IS NULL THEN[\s\S]*?RETURN v_ack;\s+END IF;/);
  });

  it("期限前日の再通知は未確認・未再通知の人だけを reminded_at で確定（1人1回）", () => {
    expect(CLAIM).toContain("r.acknowledged_at IS NULL");
    expect(CLAIM).toContain("r.reminded_at IS NULL");
    expect(CLAIM).toContain("SET reminded_at = now()");
  });

  it("in_app_notifications の CHECK に admin_message と admin_message_ack", () => {
    expect(MIGRATION).toMatch(/in_app_notifications_kind_check\s+CHECK \(kind IN \([^)]*'admin_message', 'admin_message_ack'\)\)/);
  });
});

describe("schema.sql への同期", () => {
  it("全関数の本文がマイグレと同じ", () => {
    for (const tag of ["fn_send_admin_message", "fn_admin_message_candidates", "fn_mark_admin_message_read", "fn_acknowledge_admin_message",
      "fn_list_sent_admin_messages", "fn_admin_message_status", "fn_claim_admin_message_reminders"]) {
      expect(fnBody(SCHEMA, tag), tag).toBe(fnBody(MIGRATION, tag));
    }
  });
  it("テーブル定義の CHECK にも新しい種類を含む", () => {
    expect(SCHEMA).toContain("'client_error', 'admin_message', 'admin_message_ack'");
    expect(SCHEMA).toContain("ADD COLUMN IF NOT EXISTS message_id bigint REFERENCES public.admin_messages(id) ON DELETE CASCADE");
  });
});

describe("Edge Function（push-reminders）のお知らせの即時送信", () => {
  const src = stripTs(read("supabase/functions/push-reminders/index.ts"));
  const branch = /if \(isAdminMessage\) \{([\s\S]*?)\n {2}\}\n/.exec(src)?.[1] ?? "";

  it("🔴 送信者本人のお知らせでなければ 403", () => {
    expect(branch).toContain('msg.sender_id !== callerId');
    expect(branch).toMatch(/return json\(\{ error: "Forbidden", status: 403 \}/);
  });

  it("🔴 宛先はクライアントから受け取らない（body から読むのは messageId だけ・宛先は admin_message_recipients から）", () => {
    expect(branch).not.toMatch(/body\.(?!messageId)\w+/);
    expect(src).toMatch(/from\("admin_message_recipients"\)\.select\("member_id", o\)\.eq\("message_id", messageId\)/);
  });

  it("1通につき1回（push_dispatched_at が空のときだけ送る）", () => {
    expect(src).toMatch(/\.update\(\{ push_dispatched_at: new Date\(\)\.toISOString\(\) \}\)\s+\.eq\("id", messageId\)\.is\("push_dispatched_at", null\)/);
  });

  it("Windows は本人の設定（admin_message の push）に従う", () => {
    expect(src).toContain('"admin_message", "push"');
  });

  it("期限前日の再通知は休日スキップより後（平日だけ）", () => {
    expect(src.indexOf("runAdminMessageReminders(supabase, vapid, slot.date)")).toBeGreaterThan(src.indexOf("if (daySkip.skip && !isDryRun)"));
  });
});

describe("お知らせの画面は HTML を解釈しない", () => {
  for (const f of [
    "src/components/notifications/AdminMessageDialog.tsx",
    "src/components/notifications/InAppNotificationBell.tsx",
    "src/components/admin/AdminMessageSection.tsx",
  ]) {
    it(f, () => {
      expect(stripTs(read(f))).not.toContain("dangerouslySetInnerHTML");
    });
  }
});

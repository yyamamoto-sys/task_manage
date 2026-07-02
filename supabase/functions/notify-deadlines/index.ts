// supabase/functions/notify-deadlines/index.ts
//
// 【設計意図】
// 毎週月曜の朝、PJごとの「期限超過（本日含む）」「今週中に完了予定」タスクを
// まとめて Teams の共有チャンネルに1通投稿する（週次・全員向けレポート版）。
// pg_cron から net.http_post で起動される想定（ブラウザを開いていなくても届く）。
// - 対象：notify_pref に関係なく全メンバーの、未完了タスク全件（個人opt-in方式から
//   「チーム全体の状況レポート」に変更。個々人への私信ではなく全員が見てよい内容）
// - PJごとにセクションを分け、各PJ内で「🔴期限超過」「🟡今週中」の2カテゴリに分けて
//   「タスク名（担当者）」の形式で列挙する
// - 認証：x-cron-secret ヘッダが NOTIFY_CRON_SECRET と一致しないと 401（無差別起動の防止）
//
// 必要な Edge Function secrets（supabase secrets set ...）：
//   SUPABASE_URL（自動設定）/ SUPABASE_SERVICE_ROLE_KEY / TEAMS_WEBHOOK_URL / NOTIFY_CRON_SECRET
//
// 【現状の制約】マルチテナント（groups テーブル）には未対応。現状は全メンバーが単一グループ
// （grp-egg）のため group_id での絞り込みをしていない。将来複数グループが実運用に乗ったら、
// グループごとに Webhook 先を分けるか group_id でのフィルタが必要になる。
//
// 注意：Microsoft は受信Webhook（O365コネクタ）を2026年5月に完全廃止済み。本番は
// Power Automate の「Workflows」（Webhook要求受信→チャンネル投稿）で構築している。
// Workflows は MessageCard 形式をそのまま受理するため、本関数のペイロード形式は変更不要。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 集計の基準は JST（Asia/Tokyo）。サーバはUTCで動くため +9h して当日を求める。
function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function jstTodayStr(): string {
  return jstNow().toISOString().slice(0, 10);
}
// 今週の終わり（日曜）を JST で求める。0=日,1=月,...6=土
function jstWeekEndStr(): string {
  const d = jstNow();
  const dow = d.getUTCDay();
  const daysToSunday = (7 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

type TaskRow = {
  id: string;
  name: string;
  due_date: string;
  project_id: string | null;
  assignee_member_id: string | null;
  assignee_member_ids: string[] | null;
};

const NO_PJ_KEY = "__no_pj__";

Deno.serve(async (req: Request) => {
  // ===== 認証（共有シークレット） =====
  const secret = Deno.env.get("NOTIFY_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const webhookUrl = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (!webhookUrl) return json({ error: "TEAMS_WEBHOOK_URL not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const today = jstTodayStr();
  const weekEnd = jstWeekEndStr();

  // ===== 未完了・今週末（日曜）までに期限があるタスク全件 =====
  // ここには「期限超過（本日含む）」と「今週中に完了予定」の両方が含まれる。以降で振り分ける。
  const { data: tasks, error: tErr } = await supabase
    .from("tasks")
    .select("id, name, due_date, status, project_id, assignee_member_id, assignee_member_ids")
    .eq("is_deleted", false)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", weekEnd);
  if (tErr) return json({ error: "tasks query failed", detail: tErr.message }, 500);

  const { data: projects, error: pErr } = await supabase
    .from("projects").select("id, name").eq("is_deleted", false);
  if (pErr) return json({ error: "projects query failed", detail: pErr.message }, 500);

  const { data: members, error: mErr } = await supabase
    .from("members").select("id, display_name").eq("is_deleted", false);
  if (mErr) return json({ error: "members query failed", detail: mErr.message }, 500);

  const pjNameById = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const memberNameById = new Map((members ?? []).map((m) => [m.id as string, m.display_name as string]));

  const assigneeLabel = (t: TaskRow): string => {
    const ids = new Set<string>();
    if (t.assignee_member_id) ids.add(t.assignee_member_id);
    if (Array.isArray(t.assignee_member_ids)) for (const id of t.assignee_member_ids) ids.add(id);
    const names = [...ids].map((id) => memberNameById.get(id)).filter((n): n is string => !!n);
    return names.length > 0 ? names.join("/") : "未定";
  };

  // ===== PJごとに「期限超過（本日含む）」「今週中」に振り分け =====
  const byProject = new Map<string, { overdue: TaskRow[]; thisWeek: TaskRow[] }>();
  for (const t of (tasks ?? []) as TaskRow[]) {
    const key = t.project_id ?? NO_PJ_KEY;
    const bucket = byProject.get(key) ?? { overdue: [], thisWeek: [] };
    if (t.due_date <= today) bucket.overdue.push(t);
    else bucket.thisWeek.push(t);
    byProject.set(key, bucket);
  }

  const formatLines = (rows: TaskRow[]): string =>
    [...rows]
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((t) => `- ${t.name}（${assigneeLabel(t)}）`)
      .join("\n");

  const orderedKeys = [...byProject.keys()].sort((a, b) => {
    if (a === NO_PJ_KEY) return 1;
    if (b === NO_PJ_KEY) return -1;
    return (pjNameById.get(a) ?? "").localeCompare(pjNameById.get(b) ?? "", "ja");
  });

  const sections: { activityTitle: string; text: string }[] = [];
  let totalOverdue = 0;
  let totalThisWeek = 0;

  for (const key of orderedKeys) {
    const bucket = byProject.get(key)!;
    if (bucket.overdue.length === 0 && bucket.thisWeek.length === 0) continue;
    const pjName = key === NO_PJ_KEY ? "（PJ未設定）" : (pjNameById.get(key) ?? "（不明なPJ）");
    totalOverdue += bucket.overdue.length;
    totalThisWeek += bucket.thisWeek.length;

    const parts: string[] = [];
    if (bucket.overdue.length > 0) parts.push(`🔴 期限超過（本日含む）\n${formatLines(bucket.overdue)}`);
    if (bucket.thisWeek.length > 0) parts.push(`🟡 今週中に完了予定\n${formatLines(bucket.thisWeek)}`);
    sections.push({ activityTitle: `📁 ${pjName}`, text: parts.join("\n\n") });
  }

  if (sections.length === 0) return json({ posted: false, reason: "no target tasks" }, 200);

  const card = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "f59e0b",
    summary: `今週のタスクアラート（期限超過${totalOverdue}件・今週中${totalThisWeek}件）`,
    sections: [
      {
        activityTitle: `📋 今週のタスクアラート（${today} の週）`,
        activitySubtitle: `期限超過（本日含む）：${totalOverdue}件／今週中に完了予定：${totalThisWeek}件`,
      },
      ...sections,
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  if (!res.ok) {
    const detail = await res.text();
    return json({ posted: false, error: `Teams POST failed: ${res.status}`, detail }, 502);
  }

  return json({ posted: true, totalOverdue, totalThisWeek, projects: sections.length }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// supabase/functions/notify-deadlines/index.ts
//
// 【設計意図】
// 期限が近い／過ぎたタスクを、毎朝 Teams のチャンネルに「まとめ投稿」する（方式D・共有チャンネル版）。
// pg_cron から net.http_post で起動される想定（ブラウザを開いていなくても届く）。
// - 対象：notify_pref='teams' のメンバーに割り当てられた、未完了・期限切れ／本日期限のタスク
// - 担当者ごとにまとめて MessageCard（既存 KRレポート送信と同形式）を Teams 受信Webhook へ POST
// - 認証：x-cron-secret ヘッダが NOTIFY_CRON_SECRET と一致しないと 401（無差別起動の防止）
//
// 必要な Edge Function secrets（supabase secrets set ...）：
//   SUPABASE_URL（自動設定）/ SUPABASE_SERVICE_ROLE_KEY / TEAMS_WEBHOOK_URL / NOTIFY_CRON_SECRET
//
// 注意：Microsoft は受信Webhook（O365コネクタ）を段階的に廃止予定。将来は Power Automate の
// 「Workflows」へ移行する（その場合も投稿先URLを差し替えるだけで本関数のロジックは流用可能）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 集計の基準日は JST（Asia/Tokyo）。サーバはUTCで動くため +9h して当日を求める。
function jstTodayStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

  // ===== 通知対象メンバー（Teams希望） =====
  const { data: members, error: mErr } = await supabase
    .from("members")
    .select("id, display_name, teams_account, notify_pref")
    .eq("is_deleted", false)
    .eq("notify_pref", "teams");
  if (mErr) return json({ error: "members query failed", detail: mErr.message }, 500);
  if (!members || members.length === 0) {
    return json({ posted: false, reason: "no teams-pref members" }, 200);
  }

  // ===== 未完了・本日以前期限（=期限切れ＋本日）のタスク =====
  const { data: tasks, error: tErr } = await supabase
    .from("tasks")
    .select("id, name, due_date, status, project_id, assignee_member_id, assignee_member_ids")
    .eq("is_deleted", false)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", today);
  if (tErr) return json({ error: "tasks query failed", detail: tErr.message }, 500);

  const { data: projects } = await supabase.from("projects").select("id, name").eq("is_deleted", false);
  const pjName = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));

  // 担当者判定（単数FK or 配列カラムのどちらか）
  const assignedTo = (t: Record<string, unknown>, mid: string) =>
    t.assignee_member_id === mid ||
    (Array.isArray(t.assignee_member_ids) && (t.assignee_member_ids as string[]).includes(mid));

  // ===== 担当者ごとに集計してカードのセクションを作る =====
  const sections: { activityTitle: string; text: string }[] = [];
  let total = 0;
  for (const m of members) {
    const mine = (tasks ?? [])
      .filter((t) => assignedTo(t, m.id as string))
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    if (mine.length === 0) continue;
    const lines = mine.map((t) => {
      const due = String(t.due_date);
      const overdue = due < today;
      const pj = t.project_id ? (pjName.get(t.project_id as string) ?? "") : "";
      const mark = overdue ? "🔴 期限切れ" : "🟡 本日";
      const md = due.slice(5).replace("-", "/");
      return `- ${mark} ${md}　${t.name}${pj ? `（${pj}）` : ""}`;
    });
    total += mine.length;
    const who = m.teams_account ? `${m.display_name}（${m.teams_account}）` : (m.display_name as string);
    sections.push({ activityTitle: `👤 ${who}`, text: lines.join("\n") });
  }

  if (sections.length === 0) return json({ posted: false, reason: "no due tasks" }, 200);

  const card = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "f59e0b",
    summary: `本日の期限タスク ${total}件`,
    sections: [
      { activityTitle: `⏰ 本日の期限タスク（${today}）`, activitySubtitle: `期限切れ・本日期限：合計 ${total}件` },
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

  return json({ posted: true, total, sections: sections.length }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

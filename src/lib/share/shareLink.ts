// src/lib/share/shareLink.ts
//
// プロジェクト・ビュー・タスクのリンク共有（v3.192）。既存の `/?open=…`（deepLink.ts）と同じ形で、
//   PJ        `/?open=project&pid=<uuid>`
//   PJ＋ビュー `/?open=project&pid=<uuid>&view=<viewKey>`
//   タスク    `/?open=task&tid=<uuid>`
// を発行（build*）し、起動時に読む（extractShareTarget）。権限は新しく作らず、RLSで見えるかどうかだけで決める。
// アドレスバーは画面操作に追従させない（コピーで発行する方式のみ）。

/** リンクで指定できるビュー。ViewMode のうち、PJを開いた画面で使うもの（"admin" は設定パネルに移行済みなので除く） */
export const SHARE_VIEW_KEYS = ["dashboard", "kanban", "gantt", "list", "workload"] as const;
export type ShareViewKey = (typeof SHARE_VIEW_KEYS)[number];

export type ShareTarget =
  | { kind: "project"; projectId: string; view: ShareViewKey | null }
  | { kind: "task"; taskId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isShareViewKey(v: unknown): v is ShareViewKey {
  return typeof v === "string" && (SHARE_VIEW_KEYS as readonly string[]).includes(v);
}

function isUuid(v: string | null): v is string {
  return v !== null && UUID_RE.test(v);
}

export function buildProjectLink(origin: string, projectId: string, view?: ShareViewKey | null): string {
  const url = new URL("/", origin);
  url.searchParams.set("open", "project");
  url.searchParams.set("pid", projectId);
  if (view && isShareViewKey(view)) url.searchParams.set("view", view);
  return url.toString();
}

export function buildTaskLink(origin: string, taskId: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("open", "task");
  url.searchParams.set("tid", taskId);
  return url.toString();
}

/**
 * クエリ文字列から共有リンクの行き先を取り出す。id が UUID 形式でなければ null（無視）。
 * view は許可リストにあるものだけ採用し、未知の値は無視して PJ だけ開く。
 */
export function extractShareTarget(search: string): ShareTarget | null {
  const p = new URLSearchParams(search);
  const open = p.get("open");
  if (open === "project") {
    const pid = p.get("pid");
    if (!isUuid(pid)) return null;
    const view = p.get("view");
    return { kind: "project", projectId: pid, view: isShareViewKey(view) ? view : null };
  }
  if (open === "task") {
    const tid = p.get("tid");
    return isUuid(tid) ? { kind: "task", taskId: tid } : null;
  }
  return null;
}

/** 表示部署に入っていない行を開くとき、自分が選べる部署のうち行が属するものを1つ選ぶ（無ければ null） */
export function pickAccessibleGroupId(
  row: { group_id?: string | null; group_ids?: string[] | null },
  accessibleGroupIds: readonly string[],
): string | null {
  const own = [row.group_id, ...(row.group_ids ?? [])].filter((g): g is string => !!g);
  return own.find(g => accessibleGroupIds.includes(g)) ?? null;
}

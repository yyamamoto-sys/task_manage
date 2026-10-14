// src/lib/errors/errorCopyText.ts
//
// v3.151：ベルの「エラーをコピー」（super_admin 専用）。選んだエラーを Claude にそのまま貼れる Markdown にする純粋関数。
// 🔴 人を特定する情報（member_id・表示名・メール）は載せない。発生した人は人数だけ。
// 記録時にも伏せ字済みだが、コピー前にもう一度 redactSensitive を通す。
// 文面は日本語固定（Claude への依頼文であり、画面の言語に左右されないため）。

import { redactSensitive } from "./clientErrorLog";

export interface ErrorCopyInput {
  id: number;
  source: string;
  message: string;
  code: string | null;
  context: string | null;
  stack: string | null;
  route: string | null;
  screen: string | null;
  app_version: string | null;
  user_agent: string | null;
  first_seen: string;
  last_seen: string;
  count: number;
  reporter_count: number;
  resolved_at: string | null;
  last_notified_at?: string | null;
}

/**
 * 「新規で届いたエラー」の定義：未読の client_error 通知と同じ時刻に last_notified_at が更新されたエラー。
 * log_client_error は通知の作成と last_notified_at の更新を同じトランザクション（now() が同一）で行うため、
 * 通知の created_at と一致する。通知の行には fingerprint もエラーの id も無いので、この時刻で結ぶ。
 */
export function matchNewErrors<T extends { last_notified_at?: string | null }>(unreadNotifiedAt: string[], logs: T[]): T[] {
  const times = new Set(unreadNotifiedAt.map(s => new Date(s).getTime()).filter(n => !Number.isNaN(n)));
  return logs.filter(l => !!l.last_notified_at && times.has(new Date(l.last_notified_at).getTime()));
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** JST（UTC+9）の「YYYY-MM-DD HH:mm」 */
export function formatJst(iso: string | Date): string {
  const d = new Date((iso instanceof Date ? iso.getTime() : new Date(iso).getTime()) + 9 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 中身に含まれる最長のバッククォート列より1つ長い柵（最低3）。中身の ``` でコードブロックが崩れない */
export function fenceFor(text: string): string {
  let max = 0;
  for (const m of text.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return "`".repeat(Math.max(3, max + 1));
}

function block(text: string): string {
  const f = fenceFor(text);
  return `${f}text\n${text}\n${f}`;
}

function clean(v: string | null | undefined): string {
  const s = redactSensitive((v ?? "").trim());
  return s === "" ? "-" : s;
}

/** 見出し用：メッセージの1行目（先頭の空行を飛ばす・120字まで） */
export function firstLine(message: string): string {
  const line = redactSensitive(message).split(/\r?\n/).map(s => s.trim()).find(s => s !== "") ?? "(メッセージなし)";
  return Array.from(line).length > 120 ? Array.from(line).slice(0, 120).join("") + "…" : line;
}

export function buildErrorCopyText(logs: ErrorCopyInput[], opts: { now: Date; appVersion: string }): string {
  const head = [
    `AMP（アミタ業務管理）の画面エラー ${logs.length}件（コピー日時 ${formatJst(opts.now)} JST・アプリの版 v${opts.appVersion}）`,
    "以下のエラーの原因を調べて、対策を提案してください。",
  ].join("\n");
  const sections = logs.map((l, i) => {
    const message = redactSensitive(l.message ?? "");
    const stack = redactSensitive(l.stack ?? "").trim();
    return [
      `## ${i + 1}. ${firstLine(l.message ?? "")}`,
      `- 種類（source）：${clean(l.source)}／コード（code）：${clean(l.code)}`,
      `- 画面（screen）：${clean(l.screen)}／経路（route）：${clean(l.route)}`,
      `- アプリの版（app_version）：${clean(l.app_version)}`,
      `- 回数：${l.count}／発生した人数：${l.reporter_count}`,
      `- 最初の発生：${formatJst(l.first_seen)} JST／最後の発生：${formatJst(l.last_seen)} JST`,
      `- 状態：${l.resolved_at ? "解決済み" : "未解決"}`,
      `- 操作（context）：${clean(l.context)}`,
      `- ブラウザ（user_agent）：${clean(l.user_agent)}`,
      "### メッセージ全文",
      block(message),
      "### スタック",
      block(stack === "" ? "(スタックなし)" : stack),
    ].join("\n");
  });
  return [head, ...sections].join("\n\n") + "\n";
}

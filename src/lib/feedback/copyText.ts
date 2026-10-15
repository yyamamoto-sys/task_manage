// src/lib/feedback/copyText.ts
//
// 管理ページの「Claude 用にコピー」（v3.157・CLAUDE.md Section 82）。選んだご意見を、Claude にそのまま貼れる Markdown にする
// 純粋関数。errorCopyText.ts（v3.151）と同じ考え方：依頼文＋項目＋本文（コードブロック。柵は fenceFor）＋
// スナップショットを「人が読む形」と JSON の両方で出す。
//
// 🔴 送信者の ID・表示名・メールは載せない（入力の型にそもそも持たせない。テストで固定）。管理者メモも載せない
//    （管理者の社内向けの書き込みであり、依頼の材料ではない）。コピー前にもう一度 redactSensitive を通す。
// 🔴 本文・スナップショットには利用者の入力が含まれうる（伏せ字はメール・トークン類のみ）。貼り先は Claude のみとし、
//    他へ共有しない（依頼文の末尾にも明記する）。文面は日本語固定（Claude への依頼文のため。画面の言語に左右されない）。

import { redactSensitive } from "../errors/clientErrorLog";
import { fenceFor, firstLine, formatJst } from "../errors/errorCopyText";
import type { FeedbackSnapshot } from "./snapshot";
import { SNAPSHOT_SUMMARY_LABEL_JA, summarizeSnapshot } from "./snapshot";
import type { FeedbackKind, FeedbackSnapshotState, FeedbackStatus } from "./constants";

/** コピーの入力。🔴 member_id・名前・メール・admin_memo を持たない（型の段階で載せられない） */
export interface FeedbackCopyInput {
  id: number;
  kind: FeedbackKind;
  comment: string;
  screen: string | null;
  route: string | null;
  app_version: string | null;
  status: FeedbackStatus;
  created_at: string;
  snapshot: FeedbackSnapshot | null;
  snapshot_state: FeedbackSnapshotState;
}

export const KIND_LABEL_JA: Record<FeedbackKind, string> = {
  request: "要望", bug: "不具合", other: "その他", unspecified: "種類なし",
};
export const STATUS_LABEL_JA: Record<FeedbackStatus, string> = {
  new: "新規", in_progress: "対応中", done: "対応済み", wontfix: "見送り",
};
const SNAPSHOT_STATE_LABEL_JA: Record<FeedbackSnapshotState, string> = {
  attached: "付いています", off: "本人が付けませんでした", too_large: "大きすぎて付けられませんでした", purged: "保持期間（90日）を過ぎて消えました",
};

function block(text: string, lang = "text"): string {
  const f = fenceFor(text);
  return `${f}${lang}\n${text}\n${f}`;
}

function clean(v: string | null | undefined): string {
  const s = redactSensitive((v ?? "").trim());
  return s === "" ? "-" : s;
}

export function buildFeedbackCopyText(items: readonly FeedbackCopyInput[], opts: { now: Date; appVersion: string }): string {
  const head = [
    `AMP（アミタ業務管理）に届いた利用者のご意見 ${items.length}件（コピー日時 ${formatJst(opts.now)} JST・アプリの版 v${opts.appVersion}）`,
    "以下のご意見ごとに、本文と「画面の状況」から利用者が何をしようとして困ったのかを推定し、再現手順と改修案を提案してください。",
    "（本文・画面の状況には利用者の入力が含まれることがあります。この内容は Claude 以外へ共有しないでください。送信者は特定できない形にしています。）",
  ].join("\n");

  const sections = items.map((it, i) => {
    const comment = redactSensitive(it.comment ?? "").trim();
    const parts = [
      `## ${i + 1}. ${firstLine(it.comment ?? "")}`,
      `- 種類：${KIND_LABEL_JA[it.kind] ?? "-"}／状態：${STATUS_LABEL_JA[it.status] ?? "-"}／受信：${formatJst(it.created_at)} JST`,
      `- 画面（screen）：${clean(it.screen)}／経路（route）：${clean(it.route)}／アプリの版：${clean(it.app_version)}`,
      "### ご意見（本文）",
      block(comment === "" ? "(本文なし)" : comment),
    ];
    if (it.snapshot) {
      const summary = summarizeSnapshot(it.snapshot).map((l) => `- ${SNAPSHOT_SUMMARY_LABEL_JA[l.id]}：${redactSensitive(l.value)}`).join("\n");
      parts.push("### 画面の状況（人が読む形）", summary === "" ? "(なし)" : summary);
      parts.push("### 画面の状況（JSON）", block(redactSensitive(JSON.stringify(it.snapshot, null, 2)), "json"));
    } else {
      parts.push("### 画面の状況", `- ${SNAPSHOT_STATE_LABEL_JA[it.snapshot_state] ?? "-"}`);
    }
    return parts.join("\n");
  });
  return [head, ...sections].join("\n\n") + "\n";
}

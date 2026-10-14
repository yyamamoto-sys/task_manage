// src/lib/task/deliverable.ts
//
// タスクの「成果物」欄（tasks.deliverable）の純粋関数。
// 何をそのタスクの成果物とするかを自由に書く欄で、本文中の http/https の URL を📎リンクとして検出する。
//
//  - 開けるのは http/https だけ（javascript:・data:・file: 等は無視する。XSS・ローカルファイルの誘導を避ける）
//  - 📎の説明は「URL を除いた本文の先頭」（URL を除くのはツールチップを読みやすくするため）
//  - AIへは「URL を除いた説明」だけを渡す（社内URL・共有リンクの権限トークンを含みうるため）。
//    sanitizeComment と同じ伏せ字処理を通し、長さを切る。

import { sanitizeComment } from "../ai/sanitize";

/** AIへ渡す成果物の説明の最大文字数（コメントの送り方に合わせて短く切る） */
export const DELIVERABLE_AI_MAX_CHARS = 300;
/** 📎のツールチップに出す説明の最大文字数 */
export const DELIVERABLE_TOOLTIP_MAX_CHARS = 120;

// URL は「http(s):// または www. で始まり、空白・引用符・山括弧・バッククォート・全角の括弧類・読点で止まる」並び。
// 日本語など非 ASCII を含むパスも1つの URL として拾う（開くときは toOpenableUrl が encodeURI する）。
// 末尾の句読点・閉じ括弧は URL に含めない（文章中の「…https://x.com/a。」「（https://x.com/a）」を壊さないため。trimTrailing）。
// 🔴 javascript:・data:・file: は先頭条件に合わないので拾わない。
const URL_RE = /(?:https?:\/\/|(?<![A-Za-z0-9.])www\.)[^\s<>"'`（）「」『』【】〈〉《》、。，．]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?、。，．）)\]}'"」』】>]+$/;

function trimTrailing(raw: string): string {
  let u = raw;
  // 閉じ括弧は、URL の中に対応する開き括弧が無い場合だけ落とす（Wikipedia の `…_(x)` のような URL を壊さない）
  for (;;) {
    const m = TRAILING_PUNCT_RE.exec(u);
    if (!m) break;
    const last = u[u.length - 1];
    if (last === ")" && u.includes("(") && count(u, "(") >= count(u, ")")) break;
    if (last === "]" && u.includes("[") && count(u, "[") >= count(u, "]")) break;
    u = u.slice(0, -1);
  }
  return u;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** http/https として開ける URL かの確認（文字列として検出しても、URL として壊れていれば捨てる） */
export function isSafeHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return (p.protocol === "http:" || p.protocol === "https:") && p.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * 検出した文字列を、開ける URL にする。www. 始まりは https:// を補い、非 ASCII を含むときだけ encodeURI する
 * （すでに %エンコード済みの ASCII の URL は二重にエンコードしない）。開けないものは null。
 */
export function toOpenableUrl(raw: string): string | null {
  const withScheme = /^www\./i.test(raw) ? `https://${raw}` : raw;
  const hasNonAscii = [...withScheme].some(c => c.charCodeAt(0) > 127);
  const u = hasNonAscii ? encodeURI(withScheme) : withScheme;
  return isSafeHttpUrl(u) ? u : null;
}

/** 本文中の URL（出てきた順・重複なし。開ける形に正規化済み）。javascript: 等は含めない */
export function extractDeliverableUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = toOpenableUrl(trimTrailing(m[0]));
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** URL を取り除き、空白を詰めた本文（📎のツールチップ・AIへの送信用の下ごしらえ） */
export function stripDeliverableUrls(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(URL_RE, m => {
      const raw = trimTrailing(m);
      // 末尾の句読点は本文として残す
      return toOpenableUrl(raw) ? m.slice(raw.length) : m;
    })
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 📎のツールチップに出す説明（URL を除いた本文の先頭。空なら空文字） */
export function deliverableTooltipText(text: string | null | undefined): string {
  const body = stripDeliverableUrls(text).replace(/\s+/g, " ").trim();
  return body.length > DELIVERABLE_TOOLTIP_MAX_CHARS ? `${body.slice(0, DELIVERABLE_TOOLTIP_MAX_CHARS)}…` : body;
}

/**
 * AIへ渡す成果物の説明。URL を除去し、sanitizeComment と同じ伏せ字処理（社内パス・メールアドレス）を通し、
 * 長さを切る。空なら空文字（呼び出し側は空のときはキーごと省くか空文字のまま渡す）。
 * 🔴 AIへタスクの成果物を送る箇所は必ずこの関数を経由する（sanitizeCoverage.test.ts が検査する）。
 */
export function deliverableForAi(text: string | null | undefined): string {
  const body = sanitizeComment(stripDeliverableUrls(text)).replace(/\s+/g, " ").trim();
  return body.length > DELIVERABLE_AI_MAX_CHARS ? `${body.slice(0, DELIVERABLE_AI_MAX_CHARS)}…` : body;
}

/** 📎の表示情報（URL が無ければ null） */
export interface DeliverableLink {
  /** 押したときに開く URL（複数あれば最初の1件） */
  url: string;
  /** URL の総数（2以上なら「ほかN件は詳細画面から」と案内する） */
  total: number;
  /** ツールチップ本文（説明＋複数時の案内） */
  tooltip: string;
}

export function buildDeliverableLink(text: string | null | undefined): DeliverableLink | null {
  const urls = extractDeliverableUrls(text);
  if (urls.length === 0) return null;
  const desc = deliverableTooltipText(text);
  const more = urls.length > 1 ? `（ほか${urls.length - 1}件は詳細画面から開けます）` : "";
  const head = desc || "成果物のリンク";
  return { url: urls[0], total: urls.length, tooltip: `成果物：${head}${more}` };
}

// つなぎ先の候補（どのKRにもつながらない仕事 → KR）と「どう役立つか」の案のプロンプト・スキーマ・解釈（純粋関数）。
// 呼び出しは aiClient.ts（invokeAI・intent=okr-map-suggest）。結果は保存しない（画面を開き直すと消える）。s91 91-3。
//
// AIに渡すもの：KRの番号・題名・証拠として見るもの・段の基準文、PJ名と仕事の題名（sanitizeComment を通す）。担当者名は送らない。
import { sanitizeComment } from "../../../lib/ai/sanitize";
import { hasBands, parseJsonObject } from "./checkinAi";
import type { AiCandidate, KrDef } from "./types";

export interface SuggestKr {
  id: string;
  label: string;
  text: string;
  def: KrDef | null;
}

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const SUGGEST_SYSTEM_PROMPT = `あなたは、日々の仕事とチームのKR（成果の目標）のつながりを考える手伝いをします。
返答は指定のJSONスキーマに従います。仕事の題名とKRの文から無理なく言えることだけを書き、決めつけない言い方にします。
KRは KR1 のような番号で書き、一覧に無い番号を作りません。`;

function krLines(krs: SuggestKr[]): string {
  return krs
    .map((k) => {
      const lines = [`${k.label}：${k.text}`];
      if (k.def?.evidence) lines.push(`  証拠として見るもの：${k.def.evidence}`);
      if (hasBands(k.def)) lines.push(`  70の段：${k.def.bands[70] || "（未設定）"}`);
      return lines.join("\n");
    })
    .join("\n");
}

// ---------- つなぎ先の候補 ----------

export const CANDIDATES_SCHEMA: Record<string, unknown> = obj({ candidates: { type: "array", items: obj({ kr: str, reason: str }) } });

export function buildCandidatesText(krs: SuggestKr[], pjName: string, taskTitles: string[]): string {
  return [
    "次のPJの仕事は、いまどのKRにもつながっていません。役立ちそうなKRを最大3つ、理由を一言（30字以内）で挙げてください。どれにも役立ちそうにないときは空の配列にします。",
    "",
    "【KR】",
    krLines(krs),
    "",
    `【PJ】${sanitizeComment(pjName)}`,
    "【仕事の題名】",
    taskTitles.slice(0, 30).map((t) => `・${sanitizeComment(t)}`).join("\n") || "（なし）",
  ].join("\n");
}

export function parseCandidates(text: string, krs: SuggestKr[]): AiCandidate[] {
  const o = parseJsonObject(text);
  const byLabel = new Map(krs.map((k) => [k.label.replace(/\s/g, "").toUpperCase(), k.id]));
  const out: AiCandidate[] = [];
  for (const c of Array.isArray(o.candidates) ? o.candidates : []) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const krId = typeof r.kr === "string" ? byLabel.get(r.kr.replace(/\s/g, "").toUpperCase()) : undefined;
    if (!krId || out.some((x) => x.krId === krId)) continue;
    out.push({ krId, reason: typeof r.reason === "string" ? r.reason.trim() : "" });
  }
  return out.slice(0, 3);
}

// ---------- どう役立つか ----------

export const HOW_SCHEMA: Record<string, unknown> = obj({ options: { type: "array", items: str } });

export function buildHowText(kr: SuggestKr, pjName: string, taskTitle: string): string {
  return [
    "次の仕事が、このKRにどう役立つかの言い方の案を2〜3個出してください。1つ30字以内の一言で、それぞれ違う観点にします。",
    "",
    "【KR】",
    krLines([kr]),
    "",
    `【仕事】${sanitizeComment(taskTitle)}（PJ：${sanitizeComment(pjName)}）`,
  ].join("\n");
}

export function parseHowOptions(text: string): string[] {
  const o = parseJsonObject(text);
  const opts = (Array.isArray(o.options) ? o.options : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  return [...new Set(opts)].slice(0, 3);
}

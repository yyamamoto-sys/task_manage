// チェックイン資料1件を AI に読ませるときのプロンプト・構造化出力のスキーマ・返答の解釈（純粋関数）。
// 呼び出しは aiClient.ts（invokeAI・intent=okr-checkin-extract）。s91 91-3。
//
// AIに渡すもの：KRの番号・題名・段の基準文・証拠として見るもの・手がかりの定めといまの値・いまの見立て、
// 部署の仕事の題名・担当者名・PJ名（成果の記述と仕事の関連の推定にだけ使う）、メンバーの名前、資料の本文。
// 仕事の題名と資料の本文は sanitizeComment を通す（Section 6-4）。
import { sanitizeComment } from "../../../lib/ai/sanitize";
import { clampAssessment, stepBelow } from "./steps";
import type { BasisItem, BasisStatus, Hint, KrBands, KrDef, LearningKind, Resource, ResourceAssessment, Source } from "./types";

export interface CheckinAiKr {
  id: string;
  /** KR1 など */
  label: string;
  text: string;
  def: KrDef | null;
  hint: Hint | null;
  /** いまの見立て（無ければ null） */
  current: number | null;
}

export interface CheckinAiContext {
  krs: CheckinAiKr[];
  tasks: { id: string; title: string; assignee: string; pj: string }[];
  members: { id: string; name: string }[];
}

export interface CheckinResourceMeta {
  id: string;
  name: string;
  kind: string;
  checkinId: string;
}

/** 送る仕事の件数の上限（プロンプトが大きくなりすぎないように） */
export const MAX_TASKS_FOR_AI = 300;

const BAND_KEYS = [60, 70, 80, 90, 100] as const;

/** 送る仕事の並び：終わっていない仕事が先、完了は新しい順（上限で切れるときに最近の仕事を残す） */
export function orderTasksForAi<T extends { status: string; updated: string }>(tasks: T[]): T[] {
  const open = tasks.filter((t) => t.status !== "完了");
  const done = tasks.filter((t) => t.status === "完了").sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return [...open, ...done].slice(0, MAX_TASKS_FOR_AI);
}

/** 段の基準文が1つでもあるか（無いKRは見立てを出さない） */
export function hasBands(def: KrDef | null | undefined): def is KrDef {
  return !!def && BAND_KEYS.some((k) => (def.bands[k] ?? "").trim() !== "");
}

export const CHECKIN_SYSTEM_PROMPT = `あなたは、チームのチェックイン（OKRの振り返りの会）の資料を読み、KRごとの状況を整理するアシスタントです。
資料1件を読み、次の5つを取り出します。返答は指定のJSONスキーマに従います。

1. assessments（AIの見立て）：KRがいまどの段にいるか。
   - 資料の記述だけから決める。仕事の一覧・タスクの完了率は見立てに使わない。
   - 段の基準文が「未設定」のKRは出さない。資料にそのKRの記述が無いときも出さない。
   - value は 60 以上の整数。60 が出発点（最低値）で、そのKRが持つ最上段を超えない。
   - 60〜70 の間は、70 の基準への近づき具合から整数で決めてよい（例：63）。70 以上は、基準を満たした段の値（70・80・90・100）にする。
   - basis は「次の段の要件」を2〜4個。status は 確認できた／一部／まだ。quote は根拠になった資料の記述を40字以内でそのまま引く（まだ のときは空文字）。資料に無い文を作らない。
   - summary は1〜2文。責める言い方をしない。
2. hint_values（手がかりの数字）：手がかりの定めがあるKRで、資料に現在の値がはっきり書かれているときだけ。単位はKRの定めに合わせる。
3. learnings（学び・気づき）：kind は 分かったこと／次に試すこと。1件1文。
4. outcomes（成果の記述）：資料の中で、KRに関わる成果・変化を書いた箇所。change は増減の一言（例：「＋1社」）、excerpt は資料の短い引用。
   tasks には、その成果に関係しそうな仕事を「この部署の仕事」の番号（t1 など）で最大3件、推定の理由を一言そえて入れる。題名・担当・PJから無理なく言えるものだけ。無ければ空の配列。
5. decisions（決定事項と宿題）：kind は 決定／宿題。owner は担当者として書かれた人の名前（メンバーの一覧の表記。わからなければ空文字）。krs は関わるKRの番号（KR1 など）。

共通：
- kr は KR1 のような番号で書く。一覧に無い番号を作らない。
- page は資料の中の場所（例：p.3、スライド5、議事録の見出し）。わからなければ空文字。
- 資料に書かれていないことを推測で足さない。取り出すものが無い項目は空の配列にする。`;

function bandsText(bands: KrBands): string {
  return BAND_KEYS.filter((k) => (bands[k] ?? "").trim() !== "")
    .map((k) => `${k}：${bands[k]}`)
    .join(" ／ ");
}

/** AIへ送る本文（KR・仕事・メンバーの一覧と資料） */
export function buildCheckinUserText(ctx: CheckinAiContext, res: { name: string; kind: string }, body: string): string {
  const krLines = ctx.krs.map((k) => {
    const lines = [`${k.label}：${k.text}`];
    lines.push(`  段の基準：${hasBands(k.def) ? bandsText(k.def.bands) : "未設定"}`);
    if (k.def?.evidence) lines.push(`  証拠として見るもの：${k.def.evidence}`);
    if (k.hint) {
      lines.push(`  手がかりの数字：単位 ${k.hint.unit}、期首 ${k.hint.start}、目標 ${k.hint.target}（${k.hint.direction === "up" ? "増やす" : "減らす"}）、いまの値 ${k.hint.value}`);
    }
    lines.push(`  いまの見立て：${k.current ?? "なし"}`);
    return lines.join("\n");
  });
  const taskLines = ctx.tasks.slice(0, MAX_TASKS_FOR_AI).map((t, i) => `t${i + 1}｜${sanitizeComment(t.title)}｜${t.assignee || "担当なし"}｜${t.pj}`);
  return [
    "【KR】",
    krLines.join("\n") || "（なし）",
    "",
    "【この部署の仕事】（番号｜題名｜担当｜PJ）",
    taskLines.join("\n") || "（なし）",
    "",
    "【メンバー】",
    ctx.members.map((m) => m.name).filter(Boolean).join("、") || "（なし）",
    "",
    `【資料】${res.name}（${res.kind}）`,
    body ? sanitizeComment(body) : "（本文は添付の文書を見てください）",
  ].join("\n");
}

// ---------- 構造化出力のスキーマ ----------

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

export const BASIS_STATUSES: BasisStatus[] = ["確認できた", "一部", "まだ"];
export const LEARNING_KINDS: LearningKind[] = ["分かったこと", "次に試すこと"];

export const CHECKIN_SCHEMA: Record<string, unknown> = obj({
  assessments: arr(
    obj({
      kr: str,
      value: { type: "integer" },
      summary: str,
      basis: arr(obj({ requirement: str, status: { type: "string", enum: BASIS_STATUSES }, quote: str })),
      page: str,
    }),
  ),
  hint_values: arr(obj({ kr: str, value: { type: "number" }, page: str })),
  learnings: arr(obj({ kr: str, kind: { type: "string", enum: LEARNING_KINDS }, text: str, page: str })),
  outcomes: arr(obj({ kr: str, change: str, excerpt: str, page: str, tasks: arr(obj({ task: str, reason: str })) })),
  decisions: arr(obj({ kind: { type: "string", enum: ["決定", "宿題"] }, text: str, owner: str, krs: arr(str), page: str })),
});

// ---------- 返答の解釈 ----------

export const BROKEN_READING_MESSAGE = "AIの読み取り結果を解釈できませんでした。もう一度「読み取る」を押してください。続くときは資料を分けて読ませてください。";

/** 返答の文字列から JSON を取り出す（構造化出力なら本文そのまま。念のためコードブロックと前後の説明文を除く） */
export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(BROKEN_READING_MESSAGE);
  let v: unknown;
  try {
    v = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error(BROKEN_READING_MESSAGE);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(BROKEN_READING_MESSAGE);
  return v as Record<string, unknown>;
}

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []);
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const normKr = (v: string) => v.replace(/\s/g, "").toUpperCase();

/** 名前の表記ゆれ（空白・「さん」）を除いて照合する */
function memberIdByName(members: CheckinAiContext["members"], name: string): string | null {
  // \s は全角の空白も含む
  const n = name.replace(/\s|さん$/g, "");
  if (!n) return null;
  const exact = members.find((m) => m.name.replace(/\s/g, "") === n);
  if (exact) return exact.id;
  const part = members.filter((m) => {
    const mn = m.name.replace(/\s/g, "");
    return mn.startsWith(n) || n.startsWith(mn);
  });
  return part.length === 1 ? part[0].id : null;
}

/**
 * AIの返答を、資料1件分の読み取り結果（モックの Resource の形）にする。
 * 一覧に無いKR・仕事の番号は捨てる。段の基準文が無いKRの見立ては捨てる。値は 60〜最上段（70 以上は段の値）にそろえる
 */
export function parseCheckinReading(text: string, ctx: CheckinAiContext, meta: CheckinResourceMeta): Resource {
  const o = parseJsonObject(text);
  const krByLabel = new Map(ctx.krs.map((k) => [normKr(k.label), k]));
  const krOf = (v: unknown) => krByLabel.get(normKr(s(v)));
  const tasks = ctx.tasks.slice(0, MAX_TASKS_FOR_AI);
  const taskOf = (v: unknown): string | null => {
    const m = /^t(\d+)$/i.exec(s(v));
    const t = m ? tasks[Number(m[1]) - 1] : undefined;
    return t ? t.id : null;
  };
  const src = (page: unknown): Source => ({ doc: meta.name, page: s(page) });

  const assessments: ResourceAssessment[] = [];
  for (const a of list(o.assessments)) {
    const kr = krOf(a.kr);
    if (!kr || !hasBands(kr.def) || assessments.some((x) => x.krId === kr.id)) continue;
    const raw = typeof a.value === "number" ? a.value : Number(a.value);
    if (!Number.isFinite(raw)) continue;
    const clamped = clampAssessment(raw, kr.def.bands);
    const value = clamped >= 70 ? stepBelow(clamped, kr.def.bands) : clamped;
    const basis: BasisItem[] = list(a.basis)
      .map((b) => {
        const status = BASIS_STATUSES.includes(b.status as BasisStatus) ? (b.status as BasisStatus) : "まだ";
        return { requirement: s(b.requirement), status, quote: status === "まだ" ? "" : s(b.quote) };
      })
      .filter((b) => b.requirement !== "")
      .slice(0, 4);
    assessments.push({ krId: kr.id, assessment: { value, basis, summary: s(a.summary) }, source: src(a.page) });
  }

  const drafts = list(o.hint_values).flatMap((h) => {
    const kr = krOf(h.kr);
    const value = typeof h.value === "number" ? h.value : Number(h.value);
    return kr && kr.hint && Number.isFinite(value) ? [{ krId: kr.id, value, source: src(h.page) }] : [];
  });

  const learnings = list(o.learnings).flatMap((l) => {
    const kr = krOf(l.kr);
    const kind = LEARNING_KINDS.includes(l.kind as LearningKind) ? (l.kind as LearningKind) : null;
    return kr && kind && s(l.text) ? [{ krId: kr.id, kind, text: s(l.text), source: src(l.page) }] : [];
  });

  const notes = list(o.outcomes).flatMap((n, i) => {
    const kr = krOf(n.kr);
    if (!kr || (!s(n.excerpt) && !s(n.change))) return [];
    const links = list(n.tasks)
      .flatMap((t) => {
        const id = taskOf(t.task);
        return id ? [{ taskId: id, reason: s(t.reason) }] : [];
      })
      .filter((l, j, all) => all.findIndex((x) => x.taskId === l.taskId) === j)
      .slice(0, 3);
    // 資料をまたいだ同じ出来事の突き合わせは AI に任せない（資料ごとに別の記述として持つ）
    return [{ key: `${meta.id}-n${i}`, krId: kr.id, change: s(n.change), excerpt: s(n.excerpt), source: src(n.page), links }];
  });

  const decisions = list(o.decisions).flatMap((d) => {
    const kind: "決定" | "宿題" | null = d.kind === "決定" || d.kind === "宿題" ? d.kind : null;
    if (!kind || !s(d.text)) return [];
    const krIds = [...new Set((Array.isArray(d.krs) ? d.krs : []).map((k) => krOf(k)?.id).filter((x): x is string => !!x))];
    return [{ kind, text: s(d.text), ownerId: memberIdByName(ctx.members, s(d.owner)), source: src(d.page), krIds }];
  });

  return { id: meta.id, name: meta.name, kind: meta.kind, checkinId: meta.checkinId, drafts, assessments, learnings, notes, decisions };
}

/**
 * これを超える長さの資料は、読み取りに時間がかかり Edge Function の実行時間の上限に掛かりうる（実測前の目安）。
 * 読ませる前に止めはせず、分けて読ませる案内を出す
 */
export const LONG_RESOURCE_CHARS = 15000;

export function longResourceNotice(name: string, chars: number, truncatedNote?: string): string | null {
  const notes: string[] = [];
  if (truncatedNote) notes.push(truncatedNote);
  if (chars > LONG_RESOURCE_CHARS) notes.push(`長い資料です（約${Math.round(chars / 1000)}千字）。読み取りが途中で止まる・抜けがあるときは、前半と後半など${LONG_RESOURCE_CHARS / 1000}千字くらいずつに分けて読ませてください。会議の文字起こしなら、資料を読ませる画面の Copilot 用プロンプトでまとめてから読ませる方法もあります`);
  return notes.length > 0 ? `${name}：${notes.join("。")}` : null;
}

const SPLIT_HINT_RE = /546|WORKER_RESOURCE_LIMIT|WORKER_LIMIT|504|timeout|timed out|タイムアウト|途中で切れました/i;

/** 時間切れ・出力切れらしいエラーには、資料を分ける案内を添える */
export function withSplitHint(message: string): string {
  if (!SPLIT_HINT_RE.test(message) || message.includes("分けて")) return message;
  return `${message}\n資料が長いと時間切れになることがあります。前半と後半などに分けて、1件ずつ読ませてください。`;
}

export const emptyResourceMessage =(name: string) => `${name}：文字を読み取れませんでした（空の資料か、画像だけの資料です）。文字を選択できる形で保存し直してから読ませてください。`;
export const NO_KR_MESSAGE = "地図にKRがまだ無いため、資料を読ませられません。先に O・KR を登録してください。";

/** 読ませる前の確認。KRが無い・本文が空なら AI を呼ばずに止める（呼ぶと課金だけが発生する） */
export function checkReadable(ctx: CheckinAiContext, att: { fileName: string; isText: boolean; data: string }): void {
  if (ctx.krs.length === 0) throw new Error(NO_KR_MESSAGE);
  if (!att.data || (att.isText && att.data.trim() === "")) throw new Error(emptyResourceMessage(att.fileName));
}

/** okr_resources.reading に入れる形（資料の名前・回は列にある） */
export type ResourceReading = Pick<Resource, "drafts" | "assessments" | "learnings" | "notes" | "decisions">;

export function readingOf(r: Resource): ResourceReading & { version: 1 } {
  return { version: 1, drafts: r.drafts, assessments: r.assessments, learnings: r.learnings, notes: r.notes, decisions: r.decisions };
}

/** ファイル名から、画面に出す資料の種類 */
export function resourceKindOf(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pptx") return "PowerPoint";
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "Word";
  if (ext === "xlsx") return "Excel";
  if (ext === "html" || ext === "htm") return "HTML";
  return "テキスト";
}

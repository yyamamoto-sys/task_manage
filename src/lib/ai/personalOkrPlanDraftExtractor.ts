// src/lib/ai/personalOkrPlanDraftExtractor.ts
//
// 【設計意図】
// 個人OKR「前月をふまえて下書き」（翌月の計画ドラフト。v3.99・CLAUDE.md Section 24 Step P）の
// AI呼び出し。personalOkrReviewDraftExtractor.ts/personalOkrOutlookExtractor.tsと同じ作法
// （厳密なJSONで受け取り、手書きバリデーション・パース失敗時は1回だけ自己修正リトライ・
// stop_reason==="max_tokens"は明示的なエラーにしてリトライしない）を踏襲する。
//
// 🔴 入力（システムプロンプトに渡すuserメッセージ本文）は
// src/lib/personalOkr/planDraftContext.ts が組み立て済みの文字列をそのまま渡す
// （このファイル自身は文脈の組み立てを行わない＝関心の分離）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）：max_tokensは3072
// （4欄の文章＋バンド判定に16000/8192は不要。CLAUDE.md Section 6-1c）。
//
// 🔴 非2xxのときは data が null で本文は error.context にある（Section 15・
// feedback_supabase_edge_function_limits）。invokeAI()が既にbuildInvokeErrorMessage経由で
// これを処理しているため、このファイルではdataだけを見る実装をしない（invokeAIをそのまま使う）。

import { invokeAI } from "./invokeAI";
import { WEEKLY_IS_OPTIONAL_NOTICE } from "./weeklyOptionalNotice";
import { ACTUAL_WORK_COUNTS_NOTICE } from "./actualWorkNotice";
import type { PersonalKrBand } from "../localData/types";

// ===== 型定義 =====

export interface PersonalOkrPlanDraftPayload {
  positioning: string;
  activities: string;
  target_and_evidence: string;
  risks: string;
  band_target: PersonalKrBand | null;
  band_target_reason: string;
  /** この計画がどの記録に基づくかの短い箇条書き（0〜6件・貼り付け対象外） */
  basis: string[];
}

export interface PersonalOkrPlanDraftResult extends PersonalOkrPlanDraftPayload {
  model: string;
}

// ===== モデル・トークン上限 =====

/** personalOkrOutlookExtractor.ts/personalOkrReviewDraftExtractor.tsと同じ選定 */
const PLAN_DRAFT_MODEL = "claude-sonnet-4-6";

/** 🔴 max_tokens=3072。4欄の文章＋バンド判定のJSONに8192/16000は不要（Section 6-1c） */
const MAX_TOKENS_PLAN_DRAFT = 3072;

const TRUNCATED_MESSAGE =
  "計画の下書きが長すぎて途中で切れました。少し時間を置いてから再生成してください。";

const VALID_BANDS: readonly number[] = [60, 70, 80, 90, 100];

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたは個人OKRの「翌月の計画」の下書きを書くAIです。
四半期を通じたKRの達成基準から逆算し、過去月の実績・振り返り・上長からのフィードバックを踏まえて、
これから計画する月の計画を4つの欄に分けて書きます。

【書き方の方針】
- 四半期の達成基準（criteria）に対して「残り何か月で何を詰めるか」から逆算すること。
  月の計画を、四半期目標から切り離した単月の作業リストにしないこと。
- 過去月の振り返りで「できなかった」「積み残した」と書かれていることを、当月の計画へ具体的に引き継ぐこと。
- 上長コメントで指摘・要望されている点があれば、当月の計画に反映すること。反映した箇所は basis に書くこと。
- 「当月末の達成目標と証拠」は、月末時点で何がどうなっていれば達成と言えるかを、
  第三者が確認できる形（成果物・件数・状態）で書くこと。
- 【🔴絶対】渡されていない情報を憶測で補わないこと。特に、渡されていない数値目標・期日・関係者名を
  でっち上げてはならない。材料が乏しい欄は、短くてよいので分かっている範囲だけ書くこと。

【達成度バンドの定義】
60=この取り組みがなくても到達していた水準／70=介入による明確な改善・前進／80=第三者にも成果が明らか／
90=誰が見ても成功が明らかで革新的要素を含む／100=既存の発想・やり方では達成できない＝要革新。
3Qは基本的に90・100を置かない運用のため、band_target は60〜80を優先して提案すること。

【band_target の位置づけ・🔴重要】
band_target は「その月に狙う水準」の提案であって、評価の確定ではない。人が別途決める値を上書きする力は
持たない。判断材料が乏しければ null を返してよい。自己評価の割合（実績%）は一切書かないこと。

${WEEKLY_IS_OPTIONAL_NOTICE}

${ACTUAL_WORK_COUNTS_NOTICE}

【出力（厳密なJSONのみ。前後に説明文・コードブロックを一切付けない）】
- positioning: 位置づけ（当月このKRにどう取り組むかの位置づけ）。
- activities: 当月に取り組む内容。
- target_and_evidence: 当月末の達成目標と、その証拠。
- risks: リスクと依存関係。
- band_target: 60|70|80|90|100 のいずれか、または判断材料が乏しい場合はnull。
- band_target_reason: band_targetの提案根拠（1〜2文。band_targetがnullでも簡潔に理由を書くこと）。
- basis: この計画がどの記録に基づくかの短い箇条書き（0〜6件程度）。人が本文の根拠を確認するための
  ものであり、計画欄への反映対象ではない。

{
  "positioning": "...",
  "activities": "...",
  "target_and_evidence": "...",
  "risks": "...",
  "band_target": 70,
  "band_target_reason": "...",
  "basis": ["7月の振り返りで…と書かれているため", "上長コメントの…を反映"]
}`;

// ===== JSON解析・バリデーション =====

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(body) as T;
}

/** 文字列配列のうち非文字列要素・空文字はその要素だけ弾く（既存の抽出系と同じ流儀） */
function toStringArray(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map(v => v.trim());
}

/**
 * AIレスポンスをバリデーションする。
 * 🔴 4欄（positioning/activities/target_and_evidence/risks）すべてが空なら例外
 * （生成失敗として扱う）。1〜3欄が空なのは許容する（呼び出し元は空欄を反映時に触らない）。
 * band_target は 60|70|80|90|100 以外の値（65や"70"等）は弾いてnullに落とす（例外にしない）。
 * basisは0〜6件に切り詰める。余剰プロパティは読み取らないため自然に無視される。
 */
export function validatePersonalOkrPlanDraftPayload(data: unknown): PersonalOkrPlanDraftPayload {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;

  const positioning = typeof d.positioning === "string" ? d.positioning.trim() : "";
  const activities = typeof d.activities === "string" ? d.activities.trim() : "";
  const target_and_evidence = typeof d.target_and_evidence === "string" ? d.target_and_evidence.trim() : "";
  const risks = typeof d.risks === "string" ? d.risks.trim() : "";

  if (!positioning && !activities && !target_and_evidence && !risks) {
    throw new Error("計画の下書きが4欄とも空でした。生成に失敗した可能性があります。");
  }

  const band_target = typeof d.band_target === "number" && VALID_BANDS.includes(d.band_target)
    ? (d.band_target as PersonalKrBand)
    : null;

  const band_target_reason = typeof d.band_target_reason === "string" ? d.band_target_reason.trim() : "";

  const basis = toStringArray(d.basis).slice(0, 6);

  return { positioning, activities, target_and_evidence, risks, band_target, band_target_reason, basis };
}

/** 自己修正リトライ用の指示文（既存の抽出系と同じ作法） */
function buildRepairMessages(content: string, failedText: string, reason: string) {
  return [
    { role: "user" as const, content },
    { role: "assistant" as const, content: failedText },
    {
      role: "user" as const,
      content:
        `あなたの直前の出力はJSONとして解析できませんでした（エラー: ${reason}）。` +
        `同じ内容を、厳密に正しいJSONオブジェクトだけで出力し直してください。` +
        `二重引用符は \\" とエスケープし、日本語の引用は「」を使い、生の改行は入れず、` +
        `コードブロックや説明文は一切付けないこと。`,
    },
  ];
}

/**
 * 翌月の計画ドラフト（4欄＋狙いのバンド提案＋根拠）を1回の呼び出しで生成する。
 * contentText は src/lib/personalOkr/planDraftContext.ts の buildPlanDraftContext() が
 * 組み立て済みの文字列（546対策で総文字数を絞ってある）をそのまま渡すこと。
 */
export async function generatePersonalKrPlanDraft(contentText: string): Promise<PersonalOkrPlanDraftResult> {
  const res = await invokeAI(
    SYSTEM_PROMPT,
    [{ role: "user", content: contentText }],
    MAX_TOKENS_PLAN_DRAFT,
    "okr-personal-plan-draft",
    PLAN_DRAFT_MODEL,
  );
  if (res.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);

  const text = res.content[0].text;
  try {
    const raw = parseJsonSafe<unknown>(text);
    return { ...validatePersonalOkrPlanDraftPayload(raw), model: PLAN_DRAFT_MODEL };
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retry = await invokeAI(
      SYSTEM_PROMPT,
      buildRepairMessages(contentText, text, reason),
      MAX_TOKENS_PLAN_DRAFT,
      "okr-personal-plan-draft",
      PLAN_DRAFT_MODEL,
    );
    if (retry.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);
    const raw2 = parseJsonSafe<unknown>(retry.content[0].text);
    return { ...validatePersonalOkrPlanDraftPayload(raw2), model: PLAN_DRAFT_MODEL };
  }
}

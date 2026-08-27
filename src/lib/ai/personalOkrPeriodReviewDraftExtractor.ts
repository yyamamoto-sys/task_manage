// src/lib/ai/personalOkrPeriodReviewDraftExtractor.ts
//
// 【設計意図】
// 個人OKR「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// AI下書き（全体の振り返り本文）の呼び出し。personalOkrReviewDraftExtractor.ts（KR単位の
// 振り返り下書き・Phase 4）／personalOkrPlanDraftExtractor.ts（翌月の計画ドラフト・Step P）と
// 同じ作法（厳密なJSONで受け取り、手書きバリデーション・パース失敗時は1回だけ自己修正
// リトライ・stop_reason==="max_tokens"は明示的なエラーにしてリトライしない）を踏襲する。
//
// 🔴 D2相当（山本さんの判断の延長）：自己評価%・GM評価%・達成度バンドの数値をAIに書かせない。
// AIが出すのは全体の振り返り本文の下書きだけ（構造上そもそも数値用のフィールドを持たない）。
//
// 🔴 週ごとの目標設定・自己評価は任意の補助機能である（CLAUDE.md Section 24グランドルール）。
// WEEKLY_IS_OPTIONAL_NOTICEを必ず埋め込む。
//
// 🔴 max_tokens=3072（段落＋短い箇条書きに8192/16000は不要。CLAUDE.md Section 6-1c）。
// 入力（contextText）は src/lib/personalOkr/periodReviewDraftContext.ts が
// 546対策（各800字クリップ・総文字数10000字目安で決定的に削る）を済ませたものを渡すこと
// （このファイル自身は文脈の組み立てを行わない＝関心の分離）。

import { invokeAI } from "./invokeAI";
import { WEEKLY_IS_OPTIONAL_NOTICE } from "./weeklyOptionalNotice";
import { ACTUAL_WORK_COUNTS_NOTICE } from "./actualWorkNotice";

// ===== 型定義 =====

export interface PersonalOkrPeriodReviewDraftPayload {
  /** 全体の振り返り本文の段落（3〜8文程度、箇条書きにしない） */
  review_text: string;
  /** 本文の各主張がどのKR・どの月の記録に基づくかの短い箇条書き（貼り付け対象外・人の確認用） */
  basis: string[];
}

export interface PersonalOkrPeriodReviewDraftResult extends PersonalOkrPeriodReviewDraftPayload {
  model: string;
}

// ===== モデル・トークン上限 =====

/** personalOkrReviewDraftExtractor.ts/personalOkrPlanDraftExtractor.tsと同じ選定 */
const PERIOD_REVIEW_DRAFT_MODEL = "claude-sonnet-4-6";

/** 🔴 max_tokens=3072。段落＋短い箇条書きのJSONに8192/16000は不要（CLAUDE.md Section 6-1c）。 */
const MAX_TOKENS_PERIOD_REVIEW_DRAFT = 3072;

const TRUNCATED_MESSAGE =
  "下書きが長すぎて途中で切れました。少し時間を置いてから再生成してください。";

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたは個人OKRの「全体の振り返り」の下書きを書くAIです。
対象は個別のKRごとの振り返りではなく、複数のKRを横断した月全体・四半期全体としての
振り返りです。出力は本人が月末面談で使う、全体の自己評価・GM評価と合わせて記録する
地の文です。

${WEEKLY_IS_OPTIONAL_NOTICE}

${ACTUAL_WORK_COUNTS_NOTICE}

【🔴絶対に守ること】
自己評価の割合・GM評価の割合・達成度バンドの数値を一切書いてはならない。「[自己評価：…]」
のような角括弧表記も出力しない。数値の評価は人が決める。あなたが書くのは事実に基づく
文章の下書きだけである。

【入力について】
渡される情報は、対象期間に属する各KRの記録（振り返り本文・自己評価％・GM評価％・
GMコメント・計画の要点・機械集計済みのタスク件数）である。実際のタスクデータそのものでは
なく機械側で集計済みの要約であり、無い情報を憶測で補わないこと。

【書き方の方針】
- 個々のKRの内容を単純に並べるのではなく、この期間全体として何に取り組み、
  結果としてどうだったかを俯瞰して書くこと。
- 複数のKRに共通する傾向（順調に進んだ領域・遅れが出た領域等）があれば言及してよい。
- 特定のKRの詳細な内訳を長々と書かない（個別KRの振り返りは別の欄に記録済みのため）。

【出力（厳密なJSONのみ。前後に説明文・コードブロックを一切付けない）】
- review_text: 全体の振り返りの地の文の段落（3〜8文、箇条書きにしない）。数値評価を
  含めずに、取り組んだ内容と結果を具体的に書くこと。
- basis: review_textの各主張がどのKR・どの月の記録に基づくかの短い箇条書き
  （0〜8件程度）。これは貼り付け対象ではなく、人が本文の根拠を確認するためのものである。

{
  "review_text": "...",
  "basis": ["KR1（8月）：...", "..."]
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
 * AIレスポンスをバリデーションする。review_text は必須（下書きそのものが本機能の核心のため
 * 欠落時は例外を投げる）。basisの非文字列要素はその要素だけ弾く。余剰プロパティは
 * 読み取らないため自然に無視される（既存の抽出系クライアントと同じ流儀）。
 */
export function validatePersonalOkrPeriodReviewDraftPayload(data: unknown): PersonalOkrPeriodReviewDraftPayload {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;

  if (typeof d.review_text !== "string" || !d.review_text.trim()) {
    throw new Error("振り返りの下書き(review_text)が取得できませんでした。");
  }

  return {
    review_text: d.review_text.trim(),
    basis: toStringArray(d.basis),
  };
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
 * 全体の振り返り下書き（review_text＋basis）を1回の呼び出しで生成する。
 * contextText は src/lib/personalOkr/periodReviewDraftContext.ts の
 * buildPeriodReviewDraftContext() が組み立て済みの文字列（546対策で総文字数を絞ってある）を
 * そのまま渡すこと。
 */
export async function generatePersonalPeriodReviewDraft(contextText: string): Promise<PersonalOkrPeriodReviewDraftResult> {
  const res = await invokeAI(
    SYSTEM_PROMPT,
    [{ role: "user", content: contextText }],
    MAX_TOKENS_PERIOD_REVIEW_DRAFT,
    "okr-personal-period-review-draft",
    PERIOD_REVIEW_DRAFT_MODEL,
  );
  if (res.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);

  const text = res.content[0].text;
  try {
    const raw = parseJsonSafe<unknown>(text);
    return { ...validatePersonalOkrPeriodReviewDraftPayload(raw), model: PERIOD_REVIEW_DRAFT_MODEL };
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retry = await invokeAI(
      SYSTEM_PROMPT,
      buildRepairMessages(contextText, text, reason),
      MAX_TOKENS_PERIOD_REVIEW_DRAFT,
      "okr-personal-period-review-draft",
      PERIOD_REVIEW_DRAFT_MODEL,
    );
    if (retry.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);
    const raw2 = parseJsonSafe<unknown>(retry.content[0].text);
    return { ...validatePersonalOkrPeriodReviewDraftPayload(raw2), model: PERIOD_REVIEW_DRAFT_MODEL };
  }
}

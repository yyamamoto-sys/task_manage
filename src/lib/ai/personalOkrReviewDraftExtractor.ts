// src/lib/ai/personalOkrReviewDraftExtractor.ts
//
// 【設計意図】
// 個人OKRビュー「月末の振り返り下書き」（Phase 4・docs/dev/okr-redesign-plan.md §8・
// CLAUDE.md Section 24 Step M）のAI呼び出し。行き先はKintone「個人OKR_月次振返り記録」の
// 「振り返り」欄の地の文（貼り付け運用。Kintoneへの自動書き込みはしない）。
//
// 🔴 D2（山本さんの判断）：自己評価（%）・達成度バンドの数値をAIに書かせない。
// AIが出すのは文章の下書きだけで、数値の評価は人が決める（計画書§6「バンドは見通しであって
// 評価ではない」の延長）。システムプロンプトで明記し、バリデーションでも数値を出力に含めない
// （構造上review_textはstringのみで、band_ai相当のフィールド自体を持たない設計にしている）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）を踏まえる：
// - max_tokens は 2048（段落1つ＋短い箇条書きに4096以上は不要。Section 6-1c）。
// - モデルはpersonalOkrOutlookExtractor.tsと同じ選定（claude-sonnet-4-6）に倣う
//   （新しいモデル定数を勝手に増やさない＝各AI機能が同じ値で自分のローカル定数を持つ
//   既存の流儀を踏襲する）。
// - 渡す入力は buildPersonalOkrAiContextText（既存の共通組み立て）＋D5の機械計算材料
//   （src/lib/personalOkr/reviewMaterial.ts）だけ。タスクの生データは渡さない。
//
// 出力はokrImportExtractor.ts/personalOkrOutlookExtractor.tsと同じ作法（厳密なJSONで
// 受け取り、手書きバリデーション・パース失敗時は1回だけ自己修正リトライ・
// stop_reason==="max_tokens"は明示的なエラーにしてリトライしない）を踏襲する。

import { invokeAI } from "./invokeAI";
import { buildPersonalOkrAiContextText, type PersonalOkrAiContextInput } from "../personalOkr/personalOkrAiContext";
import type { ReviewMaterial } from "../personalOkr/reviewMaterial";

// ===== 型定義 =====

export interface PersonalOkrReviewDraftPayload {
  /** Kintone「振り返り」欄に貼る地の文の段落（3〜6文。箇条書きにしない） */
  review_text: string;
  /** 本文の各主張がどの週・どのタスクに基づくかの短い箇条書き（貼り付け対象外・人の確認用） */
  evidence: string[];
  /** 来月への申し送り（0〜2件・任意） */
  carryover: string[];
}

export interface PersonalOkrReviewDraftResult extends PersonalOkrReviewDraftPayload {
  model: string;
}

// ===== モデル・トークン上限 =====

/** personalOkrOutlookExtractor.tsのOUTLOOK_MODELと同じ選定（新しいモデル定数を増やさない） */
const REVIEW_DRAFT_MODEL = "claude-sonnet-4-6";

/** 🔴 max_tokens=2048。段落1つ＋短い箇条書きに4096以上は不要（CLAUDE.md Section 6-1c）。 */
const MAX_TOKENS_REVIEW_DRAFT = 2048;

const TRUNCATED_MESSAGE =
  "下書きが長すぎて途中で切れました。少し時間を置いてから再生成してください。";

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたは個人OKRの月次振り返りの「下書き」を書くAIです。
出力先はKintone「個人OKR_月次振返り記録」の「振り返り」欄に貼り付ける地の文です。

【🔴絶対に守ること】
自己評価の割合・達成度バンドの数値を一切書いてはならない。「[自己評価：…]」のような
角括弧表記も出力しない。数値の評価は人が決める。あなたが書くのは事実に基づく文章の
下書きだけである。

【入力について】
渡される情報は、実際のタスクデータそのものではなく機械側で集計済みの要約（件数）と、
週の目標状態・自己評価（◯達成／△一部／✕未達）・メモである。無い情報を憶測で補わないこと。

【出力（厳密なJSONのみ。前後に説明文・コードブロックを一切付けない）】
- review_text: 当月の取り組みを振り返る地の文の段落（3〜6文、箇条書きにしない）。
  何に取り組み、週の積み上げの結果どうだったか、うまくいった点・課題を、数値評価を含めずに
  具体的に書くこと。
- evidence: review_textの各主張がどの週・どのタスクに基づくかの短い箇条書き（0〜6件程度）。
  これは貼り付け対象ではなく、人が本文の根拠を確認するためのものである。
- carryover: 来月への申し送り（0〜2件。特に無ければ空配列）。

{
  "review_text": "...",
  "evidence": ["W2：...", "..."],
  "carryover": ["..."]
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
 * 欠落時は例外を投げる）。evidence/carryoverの非文字列要素はその要素だけ弾く。余剰プロパティは
 * 読み取らないため自然に無視される（既存の抽出系クライアントと同じ流儀）。
 */
export function validatePersonalOkrReviewDraftPayload(data: unknown): PersonalOkrReviewDraftPayload {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;

  if (typeof d.review_text !== "string" || !d.review_text.trim()) {
    throw new Error("振り返りの下書き(review_text)が取得できませんでした。");
  }

  return {
    review_text: d.review_text.trim(),
    evidence: toStringArray(d.evidence),
    carryover: toStringArray(d.carryover),
  };
}

/**
 * personal_kr_review_drafts.draft_json（DBから読み戻したunknown値）をUIで使える形に戻す。
 * 書き込み時にvalidatePersonalOkrReviewDraftPayloadを通した値のみ保存しているため通常は
 * 成功するが、想定外の形（他機能からの誤った書き込み等）が来た場合は例外を投げずnullを返す。
 */
export function readStoredReviewDraftPayload(json: unknown): PersonalOkrReviewDraftPayload | null {
  try {
    return validatePersonalOkrReviewDraftPayload(json);
  } catch {
    return null;
  }
}

/** 自己修正リトライ用の指示文（personalOkrOutlookExtractor.tsと同じ作法） */
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
 * D5：既存の buildPersonalOkrAiContextText（作業1・3と共通の文脈組み立て）に、機械計算済みの
 * 材料（reviewMaterial.ts）を追記する。共通の組み立て関数自体は変更しない
 * （Step Hの既存テスト・呼び出し元への影響を避ける）。
 */
function buildReviewDraftContextText(input: PersonalOkrAiContextInput, material: ReviewMaterial): string {
  const base = buildPersonalOkrAiContextText(input);
  const lines: string[] = [base, "", "【機械計算済みの材料（月次サマリー・自己評価％やバンドの数値は含まない）】"];
  lines.push(
    `- 週の自己評価内訳：◯${material.ratingCounts.o}／△${material.ratingCounts.t}／✕${material.ratingCounts.x}` +
    `（全${material.weeksTotal}週中・目標状態設定済み${material.weeksWithGoalSet}週・未評価${material.unratedWeekCount}週）`,
  );
  lines.push(
    `- 紐づくタスク：完了${material.completedTaskCount}件・未完了${material.incompleteTaskCount}件` +
    `（計${material.linkedTaskCount}件）`,
  );
  if (material.taskStats.delayedCount > 0 || material.taskStats.stagnantCount > 0 || material.taskStats.blockedCount > 0) {
    lines.push(
      `- うち遅延${material.taskStats.delayedCount}件・停滞${material.taskStats.stagnantCount}件・` +
      `先行待ち${material.taskStats.blockedCount}件`,
    );
  }
  return lines.join("\n");
}

/**
 * 月末の振り返り下書き（review_text＋evidence＋carryover）を1回の呼び出しで生成する。
 * 呼び出し元（personalOkrUiStore.runReviewDraft）は「input_fingerprintが前回と一致したら
 * 呼ばない」判定を済ませたうえでこの関数を呼ぶこと（このファイル自体はキャッシュ判定を
 * 行わない＝関心の分離。src/lib/personalOkr/reviewDraftRunner.ts参照）。
 */
export async function generatePersonalKrReviewDraft(
  input: PersonalOkrAiContextInput,
  material: ReviewMaterial,
): Promise<PersonalOkrReviewDraftResult> {
  const content = buildReviewDraftContextText(input, material);
  const res = await invokeAI(
    SYSTEM_PROMPT,
    [{ role: "user", content }],
    MAX_TOKENS_REVIEW_DRAFT,
    "okr-personal-review-draft",
    REVIEW_DRAFT_MODEL,
  );
  if (res.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);

  const text = res.content[0].text;
  try {
    const raw = parseJsonSafe<unknown>(text);
    return { ...validatePersonalOkrReviewDraftPayload(raw), model: REVIEW_DRAFT_MODEL };
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retry = await invokeAI(
      SYSTEM_PROMPT,
      buildRepairMessages(content, text, reason),
      MAX_TOKENS_REVIEW_DRAFT,
      "okr-personal-review-draft",
      REVIEW_DRAFT_MODEL,
    );
    if (retry.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);
    const raw2 = parseJsonSafe<unknown>(retry.content[0].text);
    return { ...validatePersonalOkrReviewDraftPayload(raw2), model: REVIEW_DRAFT_MODEL };
  }
}

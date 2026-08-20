// src/lib/personalOkr/reviewDraftRunner.ts
//
// 【設計意図】
// 「input_fingerprintが前回と一致したら再生成しない」という抑制ロジック（D4・
// docs/dev/okr-redesign-plan.md §5-2と同じ設計をPhase 4の振り返り下書きにも適用する）を、
// AI呼び出し自体（personalOkrReviewDraftExtractor.ts）から分離した純粋関数として持つ。
// outlookRunner.ts と同型（呼び出し元＝personalOkrUiStore.runReviewDraftが「DBから
// 取得済みの直近の下書き（cached）」と「今回の入力から計算したfingerprint」を渡し、
// この関数が「AIを呼ぶべきか／キャッシュを再利用すべきか」を決める）。
//
// analyze は呼び出し側が注入する（実際は generatePersonalKrReviewDraft を渡す）。これにより
// 「fingerprintが一致していればinvokeAIが呼ばれない／不一致なら呼ばれる」ことを、
// Supabase・invokeAIのどちらもモックせずに検証できる（outlookRunner.test.tsと同じ
// テスト容易性のための分離）。

import { v4 as uuidv4 } from "uuid";
import type { PersonalKrReviewDraft } from "../localData/types";
import type { PersonalOkrReviewDraftResult } from "../ai/personalOkrReviewDraftExtractor";

export interface RunPersonalKrReviewDraftParams {
  personalKrId: string;
  month: string;
  fingerprint: string;
  /** DBから取得済みの直近の下書き（無ければnull）。ensureReviewDraftLoaded相当の結果 */
  cached: PersonalKrReviewDraft | null;
  /** 「再生成」ボタン等の明示実行。trueならfingerprintが一致していても必ず呼ぶ */
  force: boolean;
  /** AI呼び出し本体（personalOkrReviewDraftExtractor.generatePersonalKrReviewDraftを注入する） */
  analyze: () => Promise<PersonalOkrReviewDraftResult>;
  idGenerator?: () => string;
  now?: () => string;
}

export interface RunPersonalKrReviewDraftResult {
  /** 実際にAI呼び出しを行ったか（falseならcachedをそのまま返しただけ） */
  ranAnalysis: boolean;
  draft: PersonalKrReviewDraft;
}

/**
 * 🔴 fingerprintが直近の保存値と一致し、forceでなければAIを呼ばずcachedをそのまま返す。
 * 一致しない、またはforceの場合のみ analyze() を呼び、新しい履歴行（INSERT用の行データ。
 * まだDBには書き込んでいない）を組み立てて返す。実際のINSERTは呼び出し元の責務。
 * 🔴 再生成（AI呼び出しを実際に行った）場合、edited_text/edited_atは常にnullで作る
 * （再生成＝作り直しのため、前回の人の編集内容は引き継がない。意図的な割り切り。
 * CLAUDE.md Section 24 Step M参照）。
 */
export async function runPersonalKrReviewDraft(
  params: RunPersonalKrReviewDraftParams,
): Promise<RunPersonalKrReviewDraftResult> {
  const { personalKrId, month, fingerprint, cached, force, analyze } = params;
  const idGenerator = params.idGenerator ?? uuidv4;
  const now = params.now ?? (() => new Date().toISOString());

  if (!force && cached && cached.input_fingerprint === fingerprint) {
    return { ranAnalysis: false, draft: cached };
  }

  const result = await analyze();
  const draft: PersonalKrReviewDraft = {
    id: idGenerator(),
    personal_kr_id: personalKrId,
    month,
    input_fingerprint: fingerprint,
    draft_json: { review_text: result.review_text, evidence: result.evidence, carryover: result.carryover },
    edited_text: null,
    edited_at: null,
    model: result.model,
    created_at: now(),
  };
  return { ranAnalysis: true, draft };
}

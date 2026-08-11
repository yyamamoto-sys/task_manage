// src/lib/personalOkr/outlookRunner.ts
//
// 【設計意図】
// 「input_fingerprintが前回と一致したら再解析しない」という抑制ロジック（Phase 3後半・
// docs/dev/okr-redesign-plan.md §5-2）を、AI呼び出し自体（personalOkrOutlookExtractor.ts）
// から分離した純粋関数として持つ。呼び出し元（personalOkrUiStore.runOutlookAnalysis）は
// 「DBから取得済みの直近の解析結果（cached）」と「今回の入力から計算したfingerprint」を渡し、
// この関数が「AIを呼ぶべきか／キャッシュを再利用すべきか」を決める。
//
// analyze は呼び出し側が注入する（実際は analyzePersonalKrOutlook を渡す）。これにより
// 「fingerprintが一致していればinvokeAIが呼ばれない／不一致なら呼ばれる」ことを、
// Supabase・invokeAIのどちらもモックせずに検証できる（テスト容易性のための分離）。

import { v4 as uuidv4 } from "uuid";
import type { PersonalKrOutlook } from "../localData/types";
import type { PersonalOkrOutlookResult } from "../ai/personalOkrOutlookExtractor";

export interface RunPersonalKrOutlookAnalysisParams {
  personalKrId: string;
  month: string;
  fingerprint: string;
  /** DBから取得済みの直近の解析結果（無ければnull）。ensureOutlookLoaded相当の結果 */
  cached: PersonalKrOutlook | null;
  /** 「再解析」ボタン等の明示実行。trueならfingerprintが一致していても必ず呼ぶ */
  force: boolean;
  /** AI呼び出し本体（personalOkrOutlookExtractor.analyzePersonalKrOutlookを注入する） */
  analyze: () => Promise<PersonalOkrOutlookResult>;
  idGenerator?: () => string;
  now?: () => string;
}

export interface RunPersonalKrOutlookAnalysisResult {
  /** 実際にAI呼び出しを行ったか（falseならcachedをそのまま返しただけ） */
  ranAnalysis: boolean;
  outlook: PersonalKrOutlook;
}

/**
 * 🔴 fingerprintが直近の保存値と一致し、forceでなければAIを呼ばずcachedをそのまま返す。
 * 一致しない、またはforceの場合のみ analyze() を呼び、新しい履歴行（INSERT用の行データ。
 * まだDBには書き込んでいない）を組み立てて返す。実際のINSERTは呼び出し元の責務。
 */
export async function runPersonalKrOutlookAnalysis(
  params: RunPersonalKrOutlookAnalysisParams,
): Promise<RunPersonalKrOutlookAnalysisResult> {
  const { personalKrId, month, fingerprint, cached, force, analyze } = params;
  const idGenerator = params.idGenerator ?? uuidv4;
  const now = params.now ?? (() => new Date().toISOString());

  if (!force && cached && cached.input_fingerprint === fingerprint) {
    return { ranAnalysis: false, outlook: cached };
  }

  const result = await analyze();
  const outlook: PersonalKrOutlook = {
    id: idGenerator(),
    personal_kr_id: personalKrId,
    month,
    input_fingerprint: fingerprint,
    outlook_json: { lead: result.lead, moves: result.moves, trade: result.trade },
    band_ai: result.band_ai,
    band_ai_reason: result.band_ai_reason,
    model: result.model,
    created_at: now(),
  };
  return { ranAnalysis: true, outlook };
}

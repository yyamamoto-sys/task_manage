// OKRの地図の AI 呼び出し（段階3）。すべて invokeAI() を通す（Section 6・16。直叩きしない・ai_usage_logs に残る）。
// ゲストでは作らない（OkrMapView が null を渡し、画面は固定データのまま動く。Section 23）。
// プロンプト・スキーマ・返答の解釈は checkinAi.ts／suggestAi.ts／kintone.ts の純粋関数にある。
import { assertNotTruncated } from "../../../lib/ai/assertNotTruncated";
import { checkConsultAttachFile, loadConsultAttachment } from "../../../lib/ai/consultationAttachmentLoader";
import { DEFAULT_CONSULT_MODEL } from "../../../lib/ai/consultModels";
import { buildMessageContent, invokeAI } from "../../../lib/ai/invokeAI";
import { extractOkrImportData, type OkrImportAnalysis } from "../../../lib/ai/okrImportExtractor";
import { buildCheckinUserText, CHECKIN_SCHEMA, CHECKIN_SYSTEM_PROMPT, checkReadable, longResourceNotice, parseCheckinReading, type CheckinAiContext, type CheckinResourceMeta } from "./checkinAi";
import { buildCandidatesText, buildHowText, CANDIDATES_SCHEMA, HOW_SCHEMA, parseCandidates, parseHowOptions, SUGGEST_SYSTEM_PROMPT, type SuggestKr } from "./suggestAi";
import type { AiCandidate, Resource } from "./types";

/** AI相談の本体と同じモデル（Sonnet 5.5。先頭の thinking ブロックは invokeAI が取り除く） */
export const OKR_MAP_MODEL = DEFAULT_CONSULT_MODEL;

export const TRUNCATED_CHECKIN_MESSAGE = "資料の読み取り結果が長すぎて途中で切れました。資料を分けて（例：前半と後半）読ませてください。";

export interface OkrMapAi {
  /** 資料1件を読む（文字の抽出 → AI）。結果は保存しない（保存は呼び出し側が repository で行う）。notice＝長い資料・先頭だけ読んだ等の案内 */
  readResource(file: File, ctx: CheckinAiContext, meta: CheckinResourceMeta): Promise<{ resource: Resource; notice: string | null }>;
  suggestCandidates(krs: SuggestKr[], pjName: string, taskTitles: string[]): Promise<AiCandidate[]>;
  suggestHow(kr: SuggestKr, pjName: string, taskTitle: string): Promise<string[]>;
  /** Kintone の OKR（PDF・テキスト）から O・KR・TF と段の基準文を読む */
  readKintone(file: File): Promise<OkrImportAnalysis>;
}

async function loadFile(file: File) {
  const check = checkConsultAttachFile(file);
  if (!check.ok) throw new Error(check.reason);
  return loadConsultAttachment(file);
}

export function createOkrMapAi(): OkrMapAi {
  return {
    async readResource(file, ctx, meta) {
      const att = await loadFile(file);
      checkReadable(ctx, att);
      const text = buildCheckinUserText(ctx, meta, att.isText ? att.data : "");
      const content = att.isText ? text : buildMessageContent(text, att);
      // 添付を伴う抽出なので max_tokens は 8192（s6 6-1c）。思考も数に入るので effort は low
      const res = await invokeAI(CHECKIN_SYSTEM_PROMPT, [{ role: "user", content }], 8192, "okr-checkin-extract", OKR_MAP_MODEL, {
        outputSchema: CHECKIN_SCHEMA,
        effort: "low",
      });
      assertNotTruncated(res, TRUNCATED_CHECKIN_MESSAGE);
      return { resource: parseCheckinReading(res.content[0].text, ctx, meta), notice: longResourceNotice(meta.name, att.isText ? att.data.length : 0, att.note) };
    },
    async suggestCandidates(krs, pjName, taskTitles) {
      const res = await invokeAI(SUGGEST_SYSTEM_PROMPT, [{ role: "user", content: buildCandidatesText(krs, pjName, taskTitles) }], 4096, "okr-map-suggest", OKR_MAP_MODEL, {
        outputSchema: CANDIDATES_SCHEMA,
        effort: "low",
      });
      return parseCandidates(res.content[0].text, krs);
    },
    async suggestHow(kr, pjName, taskTitle) {
      const res = await invokeAI(SUGGEST_SYSTEM_PROMPT, [{ role: "user", content: buildHowText(kr, pjName, taskTitle) }], 4096, "okr-map-suggest", OKR_MAP_MODEL, {
        outputSchema: HOW_SCHEMA,
        effort: "low",
      });
      return parseHowOptions(res.content[0].text);
    },
    async readKintone(file) {
      const att = await loadFile(file);
      if (att.isText && !att.data.trim()) throw new Error(`${file.name}：文字を読み取れませんでした。`);
      return extractOkrImportData({ transcript: att.isText ? att.data : "", attachment: att.isText ? null : att, withBands: true, model: OKR_MAP_MODEL });
    },
  };
}

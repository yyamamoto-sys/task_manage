// src/lib/ai/personalOkrOutlookExtractor.ts
//
// 【設計意図】
// 個人OKRビュー「これから」ブロックのAI部分（見立て・週ごとの一手・捨てる候補・
// バンドのAI判定）を1回の呼び出しで生成する（Phase 3後半・docs/dev/okr-redesign-plan.md
// §5-2「見立てとバンド判定は1回の呼び出しにまとめる」）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）を最優先で守る：
// - max_tokens は 4096（見立て＋週ごとの一手数件＋捨てる候補1件＋バンド判定のJSONに
//   16000/8192は不要。CLAUDE.md Section 6-1c）。
// - 渡す入力は personalOkrAiContext.ts が組み立てた「機械計算済みの要約」だけ
//   （紐づくタスクの生データは一切渡さない。件数のみ）。添付ファイルも使わない。
// - Supabase Edge Functionは関数ごとに実行時間の上限を上げられない。落ちたら分割か
//   入力削減しかない（今回はそもそも入力が小さいため、まず分割の必要が出ないよう
//   1回にまとめたうえで入力を絞ることを優先した）。
//
// 出力はokrImportExtractor.tsと同じ作法（厳密なJSONで受け取り、手書きバリデーション・
// パース失敗時は1回だけ自己修正リトライ・stop_reason==="max_tokens"は明示的なエラーにする）
// を踏襲する。

import { invokeAI } from "./invokeAI";
import { buildPersonalOkrAiContextText, type PersonalOkrAiContextInput } from "../personalOkr/personalOkrAiContext";
import type { PersonalKrBand } from "../localData/types";

// ===== 型定義 =====

export interface PersonalOkrOutlookMove {
  /** 対象の週ラベル（例"W2"、複数週のまとめ表記"W4・W5"も可） */
  week_label: string;
  /** 一手のタイトル */
  action: string;
  /** その一手が必要な理由 */
  reason: string;
}

export interface PersonalOkrOutlookPayload {
  /** 当月末の狙いと週の積み上げから見た現在地のギャップの見立て */
  lead: string;
  /** 残り週ごとの一手 */
  moves: PersonalOkrOutlookMove[];
  /** 間に合わせるための「捨てる候補」（無ければnull） */
  trade: string | null;
  /** 🔴 月の途中でも出す「見通し」。band_overrideを上書きする力は持たない（呼び出し元の責務） */
  band_ai: PersonalKrBand | null;
  band_ai_reason: string | null;
}

export interface PersonalOkrOutlookResult extends PersonalOkrOutlookPayload {
  model: string;
}

// ===== モデル・トークン上限 =====

/** 出力が小さく添付も無いため、既定モデル（Edge Function側のDEFAULT_MODEL）を明示的に指定する
 *  （546対策で個別機能ごとにモデルを切り替えた実績＝personalOkrImportExtractor.tsに揃え、
 *  「何のモデルで判定したか」をpersonal_kr_outlooks.modelに正確に記録するため）。 */
const OUTLOOK_MODEL = "claude-sonnet-4-6";

/** 🔴 max_tokens=4096。見立て(lead)＋週ごとの一手(moves・0〜4件程度)＋捨てる候補(trade)＋
 *  バンド判定(band_ai/band_ai_reason)のJSONに16000/8192は不要（CLAUDE.md Section 6-1c）。 */
const MAX_TOKENS_OUTLOOK = 4096;

const TRUNCATED_MESSAGE =
  "AIの解析結果が長すぎて途中で切れました。少し時間を置いてから再解析してください。";

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたは個人OKRの実行状況を分析し、当月の「これから」を短く言語化するAIです。
見立て・週ごとの一手・捨てる候補・達成度バンドの見通しを、1回の応答でまとめて返してください。

【達成度バンドの定義】
60=この取り組みがなくても到達していた水準／70=介入による明確な改善・前進／
80=第三者にも成果が明らか／90=誰が見ても成功が明らかで革新的要素を含む／
100=既存の発想・やり方では達成できない＝要革新。
3Qは基本的に90・100を置かない運用のため、band_aiは60〜80の範囲を優先して判定すること
（90・100は根拠が極めて強い場合のみ）。

【band_aiの位置づけ・🔴重要】
band_aiは月の途中でも出す「現時点の見通し」であり、評価の確定ではない。人が別途決める
「決定」を上書きする力は持たない（この判断は呼び出し元アプリの責務。あなたは見通しとして
最も妥当な値を判定するだけでよい）。

【入力について】
渡される情報は、実際のタスクデータそのものではなく機械側で集計済みの要約（件数）である。
無い情報（過去月の詳細、部署ナレッジ等）を憶測で補わないこと。分からないことは
band_ai_reasonやleadの中で「材料が乏しい」旨を述べてよい。

【出力（厳密なJSONのみ。前後に説明文・コードブロックを一切付けない）】
- lead: 当月末の狙いと、週の積み上げから見た現在地のギャップを2〜3文で述べる見立て。
  可能なら「今のままではバンド◯◯に着地する」という言い切りを含めること。
- moves: 残り週ごとの一手（配列。0〜4件程度。目標状態が未設定の週があれば、それを書く
  ことを一手として含めてよい）。各要素：
  - week_label: 対象の週ラベル
  - action: 一手のタイトル（10〜20字程度）
  - reason: その一手が必要な理由（1〜2文）
- trade: 間に合わせるための「捨てる候補」（1つ、無ければnull）。
- band_ai: 60|70|80|90|100 のいずれか、または判断材料が乏しい場合はnull。
- band_ai_reason: band_aiの判定根拠（1〜2文）。band_aiがnullの場合も、乏しい理由を簡潔に述べる。

{
  "lead": "...",
  "moves": [{ "week_label": "W2", "action": "...", "reason": "..." }],
  "trade": "..." | null,
  "band_ai": 70 | null,
  "band_ai_reason": "..." | null
}`;

// ===== JSON解析・バリデーション =====

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(body) as T;
}

const VALID_BANDS: readonly number[] = [60, 70, 80, 90, 100];

function validateMove(data: unknown): PersonalOkrOutlookMove | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const weekLabel = typeof d.week_label === "string" ? d.week_label.trim() : "";
  const action = typeof d.action === "string" ? d.action.trim() : "";
  if (!weekLabel || !action) return null; // 想定外の形（必須2項目を欠く）は弾く
  const reason = typeof d.reason === "string" ? d.reason.trim() : "";
  return { week_label: weekLabel, action, reason };
}

/**
 * AIレスポンスをバリデーションする。lead は必須（見立てそのものが本機能の核心のため
 * 欠落時は例外を投げる）。moves/trade/band_ai/band_ai_reason は欠落・型違いを
 * 想定外として弾き、null または空配列にフォールバックする（既存の抽出系クライアント
 * ＝personalOkrImportExtractor.tsのtoNullableString/toNullableNumberと同じ流儀）。
 * 余剰プロパティは読み取らないため自然に無視される。
 */
export function validatePersonalOkrOutlookPayload(data: unknown): PersonalOkrOutlookPayload {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;

  if (typeof d.lead !== "string" || !d.lead.trim()) {
    throw new Error("見立て(lead)が取得できませんでした。");
  }

  const moves: PersonalOkrOutlookMove[] = Array.isArray(d.moves)
    ? d.moves.map(validateMove).filter((m): m is PersonalOkrOutlookMove => m !== null)
    : [];

  const trade = typeof d.trade === "string" && d.trade.trim() ? d.trade.trim() : null;

  const band_ai = typeof d.band_ai === "number" && VALID_BANDS.includes(d.band_ai)
    ? (d.band_ai as PersonalKrBand)
    : null;

  const band_ai_reason = typeof d.band_ai_reason === "string" && d.band_ai_reason.trim()
    ? d.band_ai_reason.trim()
    : null;

  return { lead: d.lead.trim(), moves, trade, band_ai, band_ai_reason };
}

/**
 * personal_kr_outlooks.outlook_json（DBから読み戻したunknown値）をUIで使える形に戻す。
 * 書き込み時にvalidatePersonalOkrOutlookPayloadを通した値のみ保存しているため通常は
 * 成功するが、想定外の形（他機能からの誤った書き込み等）が来た場合は例外を投げず
 * nullを返す（表示側で「AIによる見立ては次の更新で入ります。」に自然にフォールバックする）。
 */
export function readStoredOutlookPayload(
  json: unknown,
): { lead: string; moves: PersonalOkrOutlookMove[]; trade: string | null } | null {
  try {
    const { lead, moves, trade } = validatePersonalOkrOutlookPayload(json);
    return { lead, moves, trade };
  } catch {
    return null;
  }
}

/** 自己修正リトライ用の指示文（personalOkrImportExtractor.tsと同じ作法） */
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
 * 個人KR「これから」ブロックのAI解析（見立て＋週ごとの一手＋捨てる候補＋バンド判定）を
 * 1回の呼び出しにまとめて実行する。呼び出し元（personalOkrUiStore.runOutlookAnalysis）は
 * 「input_fingerprintが前回と一致したら呼ばない」判定を済ませたうえでこの関数を呼ぶこと
 * （このファイル自体はキャッシュ判定を行わない＝関心の分離。src/lib/personalOkr/outlookRunner.ts参照）。
 */
export async function analyzePersonalKrOutlook(
  input: PersonalOkrAiContextInput,
): Promise<PersonalOkrOutlookResult> {
  const content = buildPersonalOkrAiContextText(input);
  const res = await invokeAI(SYSTEM_PROMPT, [{ role: "user", content }], MAX_TOKENS_OUTLOOK, "okr-personal-outlook", OUTLOOK_MODEL);
  if (res.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);

  const text = res.content[0].text;
  try {
    const raw = parseJsonSafe<unknown>(text);
    return { ...validatePersonalOkrOutlookPayload(raw), model: OUTLOOK_MODEL };
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retry = await invokeAI(
      SYSTEM_PROMPT,
      buildRepairMessages(content, text, reason),
      MAX_TOKENS_OUTLOOK,
      "okr-personal-outlook",
      OUTLOOK_MODEL,
    );
    if (retry.stop_reason === "max_tokens") throw new Error(TRUNCATED_MESSAGE);
    const raw2 = parseJsonSafe<unknown>(retry.content[0].text);
    return { ...validatePersonalOkrOutlookPayload(raw2), model: OUTLOOK_MODEL };
  }
}

// src/lib/ai/personalOkrImportExtractor.ts
//
// 【設計意図】
// Kintoneの「個人OKR設定フォーム」（個人四半期KR）または「個人OKR_月次振返り記録」
// （個人月次計画・振り返り）のPDF・テキストをAIに読ませ、現行アプリの個人OKR構造
// （personal_krs / personal_kr_months相当）に抽出する。okrImportExtractor.tsと同じ作法
// （PDFはdocumentブロックで添付・抽出結果はJSONで受け取り手書きバリデーション・
// 確認/編集は呼び出し元UIが担う・自己修正リトライ1回）を踏襲する。
//
// 【資料の種類を人に選ばせない】
// 山本さんの決定（2026-08-10・実装依頼）：種別（四半期OKRか月次振返りか）はAIに判定させる。
// ただし誤判定があり得るため、detected_doc_typeとして返し、確認画面で人が切り替えられる
// ようにする（呼び出し元UI・PersonalOkrImportModal.tsx側の責務）。
//
// 【kr_kindはAIに変換させない】
// AIには元のKintone表記（"グループKR1"等）をそのまま kr_kind_hint として返させ、
// personal_krs.kr_kind（固定enum）への変換は importFieldParse.ts の mapKrKindHint()
// （決定的な純粋関数）で行う。band_target・weight_pctの数値パースも同様に
// importFieldParse.ts側の責務（AIの出力は生の値のまま受け取る）。
//
// 【既存KRとの対応づけはこのファイルの範囲外】
// 抽出結果はあくまで「Kintoneに書かれていた内容」であり、既存personal_krsのどれに
// 対応させるかの判定・確定は importMatch.ts（候補提示）と呼び出し元UI（人の最終決定）の
// 責務。このファイルはKintone側の内容を読み取るところまでを担う。

import { invokeAI, buildMessageContent, type FileAttachment } from "./invokeAI";
import type { Quarter } from "../localData/types";

// ===== 型定義 =====

export type PersonalOkrDocType = "quarterly" | "monthly_review";

export interface PersonalOkrImportMonth {
  /** 「1か月目」〜「3か月目」列に対応。列の判定が付かない場合はnull（呼び出し元で人が選ぶ） */
  month_index: 1 | 2 | 3 | null;
  positioning: string | null;
  activities: string | null;
  target_and_evidence: string | null;
  risks: string | null;
  /** 単一の目標値が明記されている場合のみ数値。複数基準のルーブリックしか無い場合はnull */
  band_target: number | null;
  /** ウェイト欄の「※Nカ月目のみX%」の注記のXの値。注記が無ければnull */
  weight_override_pct: number | null;
  review_text: string | null;
  self_eval_pct: number | null;
  gm_eval_pct: number | null;
  gm_comment: string | null;
}

export interface PersonalOkrImportKr {
  /** "個人KR_1"等、Kintone側の項目名（人が見て原文と対応付けるためのラベル。DBには保存しない） */
  source_label: string | null;
  /** Kintoneの「KR種別」欄の原文（"グループKR1"〜"グループKR9"／"全般"／"全社共通"／"OM共通"／"AGM共通"／"リーダー共通"） */
  kr_kind_hint: string | null;
  /** "グループKR1／KR1-TF2 AAS"のような原文（グループKR・TFを人が選ぶ手がかり。要約しない） */
  group_kr_hint: string | null;
  label: string;
  weight_pct: number | null;
  category: string | null;
  activity: string | null;
  strength_role: string | null;
  weakness_role: string | null;
  criteria: string | null;
  supplement: string | null;
  months: PersonalOkrImportMonth[];
}

export interface PersonalOkrImportAnalysis {
  detected_doc_type: PersonalOkrDocType;
  fiscal_year: number | null;
  quarter: Quarter | null;
  krs: PersonalOkrImportKr[];
}

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたはKintoneの「個人OKR設定フォーム」（個人四半期KR）または
「個人OKR_月次振返り記録」（個人月次計画・振り返り）の画面PDF・テキストを解析し、
タスク管理アプリの個人OKR構造に変換するAIです。

【最初にやること：資料の種類を判定する】
- タイトルが「個人OKR設定フォーム」で「個人KR_1」「個人KR_1_ウェイト」等の欄が中心 → "quarterly"
- タイトルが「個人OKR_月次振返り記録」で「1か月目」「2か月目」「3か月目」の列・「振り返り」
  「自己評価」の語が中心 → "monthly_review"
判定結果を detected_doc_type に入れる（人が後で切り替えられるので迷ったらどちらかを選ぶ）。

【年度・四半期】
「年度」「対象Q」「Q」等の欄から fiscal_year（西暦の数値のみ。例2026）・quarter（"1Q"〜"4Q"）を
抽出する。不明はnull。

【KRの単位】
資料は「個人KR_1」「個人KR_2」…のブロック（最大8本＋備考欄）で構成される。各ブロックを
krs配列の1要素として抽出する。ブロックの項目名（例："個人KR_1"）は source_label に入れる。

【kr_kind_hint】
各KRブロックの直前にある「KR種別」または「KR種別_N」欄の値をそのまま転記する（変換しない）：
"グループKR1"〜"グループKR9" / "全般" / "全社共通" / "OM共通" / "AGM共通" / "リーダー共通"。
不明・空欄はnull。

【group_kr_hint】
KRタイトル行（例："個人KR_1（グループKR1｜AAS）"）の括弧内の全文をそのまま転記する
（例："グループKR1｜AAS"）。本文中に「KR1-TF2」等のTF番号付きの記載があれば、それも含めて
転記する（例："グループKR1／KR1-TF2 AAS"）。人がグループKR・TFを選ぶ手がかりに使うため、
要約せず原文のまま返す。group_kr以外のKR種別ではnullでよい。

【label】
タブに出す短い名前。KRタイトル行の括弧内の末尾の名称（上の例では"AAS"）を優先し、
無ければ source_label をそのまま使う。

【weight_pct】
「個人KR_N_ウェイト」欄、または月次振返り記録の「ウェイト」列の数値（%記号は除く）。不明はnull。

【本文6欄】category / activity / strength_role / weakness_role / criteria / supplement
- category ← ●対象業務カテゴリ
- activity ← ●実施内容（●対象業務内容も同義）
- strength_role ← ●得意領域の強化：（役割）
- weakness_role ← ●苦手領域の克服：（役割）
- criteria ← ●達成基準
- supplement ← ●補足（心持ちの変化／目指す存在等）
月次振返り記録では、これらは「KR_四半期OKRから転記」列に同じ内容が転記されているので、
そこから抽出してよい。原文の丸写しでよい（要約は必須ではない。長すぎる場合のみ要約する）。
「全社共通」のKR（勤怠管理）は10段階評価表がそのまま達成基準になっており6欄には分かれていない。
その場合は criteria に評価表の要点を入れ、他5欄はnullでよい。

【月次計画・振り返り（monthly_reviewのときのみ抽出。quarterlyのときは months は空配列でよい）】
月次振返り記録は、同じKRについて「分類＝計画」の行と「分類＝振り返り」の行が対になっている。
列見出し「1か月目」「2か月目」「3か月目」がそれぞれ month_index 1/2/3 に対応する。
同じ月・同じKRの「計画」欄と「振り返り」欄の内容を1つの months[] 要素にまとめる。

計画欄（分類＝計画の列内）から：
- positioning ← 【位置づけ】の文章
- activities ← ▼◯月に取り組む内容（計画）
- target_and_evidence ← ▼◯月末の達成目標と、その証拠（計画値）
- risks ← ▼リスクと依存関係
- weight_override_pct ← ウェイト欄の「※◯カ月目のみX%」の注記のXの数値（例："※1カ月目のみ25%"→25）。
  注記が無ければnull（＝四半期の基本ウェイトのまま）。
- band_target ← ▼◯月末 達成度バンド（計画）の欄。
  🔴重要：この欄は通常、60%/70%/80%（時に「90/100は設定しない」の注記付き）の複数の基準を
  並べたルーブリック（説明文）であり、「今月はこれを狙う」という単一の値が明記されていることは
  稀である。単一の目標値が本文中に明記されている場合だけ band_target に数値を入れ、複数基準の
  説明文しか無い場合は必ずnullを返す（推測して埋めない）。60/70/80/90/100以外の数値は使わない。

振り返り欄（分類＝振り返り の列内）から：
- review_text ← 「振り返り」の直後にある地の文（自由記述の段落）のみ。末尾の「[自己評価：…]」の
  角括弧表記や、その後に続く✔✖□のチェック済みバンド一覧・【〇〇コメント】は含めない。
- self_eval_pct ← 「[自己評価：XX%（本KR%）…]」の最初のXX%（本KR%そのもの。
  「*係数=Y%」のYではない）。
- gm_eval_pct ← 「→（人名）評価：YY%」のYY、または本文中に明記された当該KR単位のGM評価の数値。
  無ければnull（個人単位の月次面談まとめ「個人OKR達成度_GM評価」のような、KR単位ではない
  全体合計値はgm_eval_pctに入れない）。
- gm_comment ← 【（人名）コメント】として書かれた地の文。無ければnull。
✔/✖/□マークが並ぶバンド判定リストは、PDFの列レイアウトでチェック印と基準文がずれて
抽出されることがある信頼性の低い情報源のため、self_eval_pct/gm_eval_pctの抽出には使わない
（「[自己評価：]」の角括弧表記を優先する）。

【抽出しないもの】
- 「個人OKR月次評価（達成度）」「個人OKR 四半期評価（達成度）」セクションの月次面談まとめの
  合計値（特定のKRに紐づかない個人単位の総合評価のため）
- 「【7月限定KR】」のような、四半期の個人KR一覧に含まれない一時的なKR（krs配列に含めない）
- 役割等級要件・面談参考資料等の付録セクション

【最重要：JSONの厳格な作法（守らないとパースに失敗する）】
- 出力は厳密なJSONオブジェクトのみ。前後に説明文・コードブロック\`\`\`・注釈を一切付けない。
- 文字列値の中で二重引用符 " を使う必要がある場合は必ず \\" とエスケープする。
  ただし日本語の引用は原則 " ではなく「」『』を使い、ASCII二重引用符を値に含めないこと。
- 文字列値の中に生の改行を入れない（必要なら \\n を使うか、1行に要約する）。
- 末尾カンマを付けない。全てのプロパティ名・文字列値は二重引用符で囲む。
- 値が不明なときは文字列 "" ではなく null を使う（スキーマで null 許容のもの）。

{
  "detected_doc_type": "quarterly" | "monthly_review",
  "fiscal_year": 2026 | null,
  "quarter": "3Q" | null,
  "krs": [
    {
      "source_label": "個人KR_1" | null,
      "kr_kind_hint": "グループKR1" | null,
      "group_kr_hint": "グループKR1／KR1-TF2 AAS" | null,
      "label": "AAS",
      "weight_pct": 35 | null,
      "category": "..." | null,
      "activity": "..." | null,
      "strength_role": "..." | null,
      "weakness_role": "..." | null,
      "criteria": "..." | null,
      "supplement": "..." | null,
      "months": [
        {
          "month_index": 1 | null,
          "positioning": "..." | null,
          "activities": "..." | null,
          "target_and_evidence": "..." | null,
          "risks": "..." | null,
          "band_target": 70 | null,
          "weight_override_pct": 25 | null,
          "review_text": "..." | null,
          "self_eval_pct": 80 | null,
          "gm_eval_pct": 75 | null,
          "gm_comment": "..." | null
        }
      ]
    }
  ]
}`;

// ===== AI 抽出 =====

export interface ExtractPersonalOkrImportParams {
  /** テキスト貼り付け（PDF添付のみの場合は空文字） */
  transcript: string;
  /** PDF等の添付。テキストが無くても添付があれば解析可 */
  attachment?: FileAttachment | null;
}

/** AIが返した文字列からJSONオブジェクトを取り出してパースする（okrImportExtractor.tsと同じ方式） */
function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(body) as T;
}

const VALID_QUARTERS: readonly string[] = ["1Q", "2Q", "3Q", "4Q"];

function toNullableString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function toNullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function validateMonth(data: unknown): PersonalOkrImportMonth {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const monthIndexRaw = d.month_index;
  const monthIndex = monthIndexRaw === 1 || monthIndexRaw === 2 || monthIndexRaw === 3 ? monthIndexRaw : null;
  return {
    month_index: monthIndex,
    positioning: toNullableString(d.positioning),
    activities: toNullableString(d.activities),
    target_and_evidence: toNullableString(d.target_and_evidence),
    risks: toNullableString(d.risks),
    band_target: toNullableNumber(d.band_target),
    weight_override_pct: toNullableNumber(d.weight_override_pct),
    review_text: toNullableString(d.review_text),
    self_eval_pct: toNullableNumber(d.self_eval_pct),
    gm_eval_pct: toNullableNumber(d.gm_eval_pct),
    gm_comment: toNullableString(d.gm_comment),
  };
}

function validateKr(data: unknown, path: string): PersonalOkrImportKr {
  if (!data || typeof data !== "object") throw new Error(`${path}が不正な形式です。`);
  const d = data as Record<string, unknown>;
  const label = toNullableString(d.label) ?? toNullableString(d.source_label) ?? "（名称未設定）";
  return {
    source_label: toNullableString(d.source_label),
    kr_kind_hint: toNullableString(d.kr_kind_hint),
    group_kr_hint: toNullableString(d.group_kr_hint),
    label,
    weight_pct: toNullableNumber(d.weight_pct),
    category: toNullableString(d.category),
    activity: toNullableString(d.activity),
    strength_role: toNullableString(d.strength_role),
    weakness_role: toNullableString(d.weakness_role),
    criteria: toNullableString(d.criteria),
    supplement: toNullableString(d.supplement),
    months: Array.isArray(d.months) ? d.months.map(validateMonth) : [],
  };
}

/**
 * AIレスポンスをバリデーションする。detected_doc_typeが想定外の値のときは、
 * monthsに実質的な内容（review_text/self_eval_pct等）を持つKRが1件でもあれば
 * "monthly_review"、無ければ"quarterly"にフォールバックする（プロンプト逸脱への保険）。
 */
export function validatePersonalOkrImportAnalysis(data: unknown): PersonalOkrImportAnalysis {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.krs)) throw new Error("krsが取得できませんでした。");

  const krs = d.krs.map((kr, i) => validateKr(kr, `krs[${i}]`));

  let docType: PersonalOkrDocType;
  if (d.detected_doc_type === "quarterly" || d.detected_doc_type === "monthly_review") {
    docType = d.detected_doc_type;
  } else {
    const looksMonthly = krs.some(kr => kr.months.some(m =>
      m.review_text != null || m.self_eval_pct != null || m.gm_eval_pct != null));
    docType = looksMonthly ? "monthly_review" : "quarterly";
  }

  const fiscalYear = typeof d.fiscal_year === "number" && Number.isFinite(d.fiscal_year) ? d.fiscal_year : null;
  const quarter = typeof d.quarter === "string" && VALID_QUARTERS.includes(d.quarter) ? (d.quarter as Quarter) : null;

  return { detected_doc_type: docType, fiscal_year: fiscalYear, quarter, krs };
}

export async function extractPersonalOkrImportData(
  params: ExtractPersonalOkrImportParams,
): Promise<PersonalOkrImportAnalysis> {
  const userMessage = params.transcript
    || (params.attachment ? `（添付ファイル「${params.attachment.fileName}」をKintoneの個人OKR画面PDFとして参照してください）` : "");

  const content = buildMessageContent(userMessage, params.attachment ?? null);
  // 月次振返り記録は最大8KR×3か月×計画/振り返りと情報量が多いため、出力切れを避けるため
  // max_tokensを広めに取る（Edge Function側の上限は16384。CLAUDE.md Section 18）。
  const res = await invokeAI(SYSTEM_PROMPT, [{ role: "user", content }], 16000, "okr-personal-import");
  const text = res.content[0].text;

  try {
    return validatePersonalOkrImportAnalysis(parseJsonSafe<unknown>(text));
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const repairMessages = [
      { role: "user" as const, content },
      { role: "assistant" as const, content: text },
      {
        role: "user" as const,
        content:
          `あなたの直前の出力はJSONとして解析できませんでした（エラー: ${reason}）。` +
          `同じ内容を、厳密に正しいJSONオブジェクトだけで出力し直してください。` +
          `二重引用符は \\" とエスケープし、日本語の引用は「」を使い、生の改行は入れず、` +
          `コードブロックや説明文は一切付けないこと。`,
      },
    ];
    const retry = await invokeAI(SYSTEM_PROMPT, repairMessages, 16000, "okr-personal-import");
    return validatePersonalOkrImportAnalysis(parseJsonSafe<unknown>(retry.content[0].text));
  }
}

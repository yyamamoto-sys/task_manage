// src/lib/personalOkr/kintoneFormat.ts
//
// 【設計意図】
// Kintoneの「個人OKR_月次振返り記録」の見出し文字列（【位置づけ】／▼◯月に取り組む内容（計画）等）
// の**唯一の正本**。この見出しに触れる箇所は必ずここを経由させる：
//   ①「全文をコピー」機能（PersonalKrPanel.tsx等）が組み立てる出力テキスト
//   ②AI取込プロンプト（personalOkrImportExtractor.ts）が読み取り基準として説明する文言
//   ③決定的パーサ（kintoneTextParse.ts）が実際にマッチさせる正規表現
// の3箇所全て。
//
// 【なぜ1箇所に集約するか】
// このリポジトリでは「同じ文字列を複数箇所にコピペし、片方だけ直されて取り残される」事故が
// 繰り返し起きている（v3.85の4箇所コピペ・v3.98のpointerEvents欠落等）。見出し文字列は
// 「①で書く」「②で説明する」「③で読み戻す」の3者が一致していないとラウンドトリップ
// （アプリ→Kintone→アプリの取込）が成立しないため、他のどの文字列よりも一致が重要。
// 文字列を1箇所に持てば、そもそもズレようがない構造にする。
//
// 【③との整合をどう保つか（規則）】
// テンプレート文字列中の半角スペースは、③の正規表現化（headingRegexSource）で `\s*` に
// 変換する（決定的パーサの既存の緩さ＝Kintone側の列区切りでスペースの有無が揺れることへの
// 許容を保つため）。テンプレートに半角スペース以外の正規表現特殊文字は含めない
// （含める場合はescapeRegExpが自動でエスケープするため安全だが、意図的な緩さは
// スペースだけに限定している）。

/** テンプレート内で「実際の月番号に置き換わる箇所」を表すプレースホルダ。 */
const MONTH_TOKEN = "{M}";

const ACTIVITIES_TEMPLATE = `▼${MONTH_TOKEN}月に取り組む内容（計画）`;
const TARGET_TEMPLATE = `▼${MONTH_TOKEN}月末の達成目標と、その証拠（計画値）`;
const BAND_TEMPLATE = `▼${MONTH_TOKEN}月末 達成度バンド（計画）`;

/** 月番号を含まない見出し（そのまま定数として公開）。 */
export const HEADING_POSITIONING = "【位置づけ】";
export const HEADING_RISKS = "▼リスクと依存関係";

function buildHeading(template: string, month: number | string): string {
  return template.split(MONTH_TOKEN).join(String(month));
}

/** 月番号を含む見出し（実際の月番号を埋め込んで返す。コピー生成側で使う）。 */
export function headingActivities(month: number | string): string {
  return buildHeading(ACTIVITIES_TEMPLATE, month);
}
export function headingTargetAndEvidence(month: number | string): string {
  return buildHeading(TARGET_TEMPLATE, month);
}
export function headingBandTarget(month: number | string): string {
  return buildHeading(BAND_TEMPLATE, month);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** テンプレートを正規表現ソース文字列へ変換する（③決定的パーサ専用）。
 * MONTH_TOKENの箇所を`digitsPattern`（既定は数字1〜2桁のキャプチャグループ）に置き換え、
 * それ以外の部分はエスケープしたうえで、半角スペースだけは`\s*`（0個以上の空白）に緩める。 */
function headingRegexSource(template: string, digitsPattern: string): string {
  return template
    .split(MONTH_TOKEN)
    .map(part => escapeRegExp(part).replace(/ /g, "\\s*"))
    .join(digitsPattern);
}

const DEFAULT_DIGITS_PATTERN = "(\\d{1,2})";

/** 【位置づけ】の正規表現ソース（月番号を含まないためキャプチャグループなし）。 */
export function positioningHeadingRegexSource(): string {
  return escapeRegExp(HEADING_POSITIONING);
}
/** ▼リスクと依存関係の正規表現ソース（月番号を含まないためキャプチャグループなし）。 */
export function risksHeadingRegexSource(): string {
  return escapeRegExp(HEADING_RISKS);
}
/** ▼◯月に取り組む内容（計画）の正規表現ソース。既定で月番号を`(\d{1,2})`としてキャプチャする。 */
export function activitiesHeadingRegexSource(digitsPattern: string = DEFAULT_DIGITS_PATTERN): string {
  return headingRegexSource(ACTIVITIES_TEMPLATE, digitsPattern);
}
/** ▼◯月末の達成目標と、その証拠（計画値）の正規表現ソース。 */
export function targetHeadingRegexSource(digitsPattern: string = DEFAULT_DIGITS_PATTERN): string {
  return headingRegexSource(TARGET_TEMPLATE, digitsPattern);
}
/** ▼◯月末 達成度バンド（計画）の正規表現ソース。 */
export function bandHeadingRegexSource(digitsPattern: string = DEFAULT_DIGITS_PATTERN): string {
  return headingRegexSource(BAND_TEMPLATE, digitsPattern);
}

/** [自己評価：XX%] タグを組み立てる（Kintone取込パーサのSELF_EVAL_RE
 * `/\[自己評価[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/` が読み戻せる形）。 */
export function selfEvalTag(pct: number): string {
  return `[自己評価：${pct}%]`;
}

// ===== ①コピー生成：計画・振り返り =====

export interface KintonePlanCopyInput {
  positioning?: string | null;
  activities?: string | null;
  targetAndEvidence?: string | null;
  risks?: string | null;
  bandTarget?: number | null;
  /** 実際の月番号（1〜12）。month_indexではない。 */
  monthNumber: number;
}

/**
 * Kintoneの見出し形式で計画欄の全文コピー用テキストを組み立てる（山本さんの依頼・2026-08-26）。
 * 記入が無い項目は見出しごと省略する。全項目が空なら空文字列を返す
 * （呼び出し側はこれでボタンを非活性にする）。
 */
export function buildKintonePlanCopyText(input: KintonePlanCopyInput): string {
  const sections: string[] = [];

  const positioning = (input.positioning ?? "").trim();
  if (positioning) sections.push(`${HEADING_POSITIONING}\n${positioning}`);

  const activities = (input.activities ?? "").trim();
  if (activities) sections.push(`${headingActivities(input.monthNumber)}\n${activities}`);

  const targetAndEvidence = (input.targetAndEvidence ?? "").trim();
  if (targetAndEvidence) sections.push(`${headingTargetAndEvidence(input.monthNumber)}\n${targetAndEvidence}`);

  const risks = (input.risks ?? "").trim();
  if (risks) sections.push(`${HEADING_RISKS}\n${risks}`);

  if (input.bandTarget != null) {
    sections.push(`${headingBandTarget(input.monthNumber)}\n${input.bandTarget}%`);
  }

  return sections.join("\n\n");
}

export interface KintoneReviewCopyInput {
  reviewText?: string | null;
  selfEvalPct?: number | null;
}

/**
 * 振り返り欄の全文コピー用テキストを組み立てる。本文と自己評価%のどちらか片方だけでも破綻しない。
 * 両方空なら空文字列を返す。
 */
export function buildKintoneReviewCopyText(input: KintoneReviewCopyInput): string {
  const parts: string[] = [];
  const reviewText = (input.reviewText ?? "").trim();
  if (reviewText) parts.push(reviewText);
  if (input.selfEvalPct != null) parts.push(selfEvalTag(input.selfEvalPct));
  return parts.join("\n\n");
}

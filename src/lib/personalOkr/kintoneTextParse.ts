// src/lib/personalOkr/kintoneTextParse.ts
//
// 【設計意図（v3.56・トークン削減の主経路）】
// Kintoneの「個人OKR設定フォーム」「個人OKR_月次振返り記録」は全員が同じ画面構造を使う
// ため、本来はAIに構造を推測させる必要が無い（山本さんの指摘）。このファイルは
// personalOkrImportExtractor.ts の SYSTEM_PROMPT に書かれているラベル規則（角括弧表記・
// 「●」「▼」「【】」等の見出し語）だけを根拠に、決定的（ルールベース）にKintoneのテキストを
// 解析する。pdfjs等には依存しない純粋関数のみで構成し、vitestのnode環境で直接テストできる。
//
// 【出力型は既存のAI抽出結果と同じ】
// PersonalOkrImportAnalysis / PersonalOkrImportMonthlyAnalysis（personalOkrImportExtractor.ts
// で定義済み）をそのまま再利用する。新しい型を発明しない。ここでは import type のみを使う
// ため、personalOkrImportExtractor.ts（invokeAI経由でSupabaseに依存する）への実行時の依存は
// 生まれない（isolatedModules下でimport typeは完全に消去される）。
//
// 【実データが無いことの明記】
// 山本さんは実際のKintone帳票のテキストを持っていない。このファイルのラベル位置の想定
// （「ラベルの直後に値が続く」「同じ種類のフィールドは文書内で左上から右下の順に現れる」）は
// SYSTEM_PROMPTの記述とKintoneの一般的なフォーム構造から導いた仮説であり、実データでの
// 検証はできていない。そのため、この仮説から外れた実際のレイアウトに対しては誤読・
// 抽出漏れが起こり得る。この誤読を無害化するのが assessQuarterlyConfidence /
// assessMonthlyConfidence（confidence.ok=falseならAIへ黙ってフォールバックする。
// 呼び出し元は personalOkrImportExtractor.ts の extractPersonalOkrImportData()）。
//
// 【二重実装しない】
// ウェイト・達成度バンド・自己評価％等の数値正規化は importFieldParse.ts の
// parseWeightPct/parsePercentValue/parseBandValue をそのまま使う（新しい数値パースを
// このファイルで書かない）。kr_kind（enum）へのマッピングはこのファイルの責務外
// （AI抽出結果と同じく raw hint 文字列のまま返し、mapKrKindHint() は呼び出し元UIが
// 従来どおり Apply 時に適用する）。

import type {
  PersonalOkrDocType,
  PersonalOkrImportAnalysis,
  PersonalOkrImportKr,
  PersonalOkrImportMonth,
  PersonalOkrImportMonthlyAnalysis,
  PersonalOkrImportMonthlyKrGroup,
} from "../ai/personalOkrImportExtractor";
import type { Quarter } from "../localData/types";
import { parseBandValue, parseWeightPct, parsePercentValue } from "./importFieldParse";

// ===== 信頼度 =====

export interface KintoneParseConfidence {
  /** trueなら決定的パーサの結果を採用してよい。falseならAIにフォールバックすること。 */
  ok: boolean;
  krCount: number;
  /** ok=falseの理由（診断・ログ用。人には見せない想定だが将来の調査に残す）。 */
  reasons: string[];
}

/** KRが最低これだけ見つからなければ「読めた」とは言えない。 */
const MIN_KR_COUNT_FOR_CONFIDENCE = 1;
/** 本文6欄の充足率の下限。「全社共通」KRのように意図的に1/6欄しか埋まらない資料も混在するため、
 * 資料全体（全KR合算）のならしの比率で判定する（KR単位で厳格に見ると全社共通KRだけで
 * 弾かれてしまうため）。50%はKintoneの記述通り「ほぼ全欄が埋まっているはず」という想定に対して
 * 十分に保守側（半分埋まらなければ、レイアウトが想定と違う可能性が高いと判断する）。 */
const QUARTERLY_MIN_BODY_FILL_RATIO = 0.5;
/** 月次側は「計画はあるが振り返りはまだ」等、片側だけ埋まっている月が自然にあり得るため、
 * 四半期側より緩め（0.35）にする。 */
const MONTHLY_MIN_FIELD_FILL_RATIO = 0.35;

// ===== 文書種別・年度・四半期の検出 =====

const TITLE_QUARTERLY = "個人OKR設定フォーム";
const TITLE_MONTHLY = "個人OKR_月次振返り記録";

/**
 * SYSTEM_PROMPTに書かれた判定基準そのまま：
 * タイトル文字列があれば最優先。無ければ月次特有のマーカー（月見出し＋自己評価語）の有無で補助判定する。
 * 両方のタイトルが混在する等、判定できない場合はnull（呼び出し元は月次判定不明として保険的に扱う）。
 */
export function detectKintoneDocType(text: string): PersonalOkrDocType | null {
  const hasQuarterlyTitle = text.includes(TITLE_QUARTERLY);
  const hasMonthlyTitle = text.includes(TITLE_MONTHLY);
  if (hasMonthlyTitle && !hasQuarterlyTitle) return "monthly_review";
  if (hasQuarterlyTitle && !hasMonthlyTitle) return "quarterly";
  if (hasQuarterlyTitle && hasMonthlyTitle) return null;

  const looksMonthly = /[1-3]か月目/.test(text) && text.includes("自己評価");
  if (looksMonthly) return "monthly_review";
  if (/個人KR_1(?!_)/.test(text)) return "quarterly";
  return null;
}

const FISCAL_YEAR_LABEL_RE = /年度/;
const FISCAL_YEAR_VALUE_RE = /(20\d{2})/;
const QUARTER_LABEL_RE = /対象Q/;
const QUARTER_VALUE_RE = /([1-4])\s*Q/;

function firstKrHeadingIndex(text: string): number {
  const m = /個人KR_1(?!_)/.exec(text);
  return m ? m.index : text.length;
}

/** 「年度」「対象Q」欄からfiscal_year/quarterを取り出す。見つからなければnull（呼び出し元の
 * 既定値がそのまま使われるため、無理に埋めない）。 */
export function extractFiscalYearAndQuarter(text: string): { fiscalYear: number | null; quarter: Quarter | null } {
  const headerText = text.slice(0, firstKrHeadingIndex(text));

  let fiscalYear: number | null = null;
  const fyLabel = FISCAL_YEAR_LABEL_RE.exec(headerText);
  if (fyLabel) {
    const window = headerText.slice(fyLabel.index + fyLabel[0].length, fyLabel.index + fyLabel[0].length + 30);
    const fyValue = FISCAL_YEAR_VALUE_RE.exec(window);
    if (fyValue) fiscalYear = Number(fyValue[1]);
  }

  let quarter: Quarter | null = null;
  const qLabel = QUARTER_LABEL_RE.exec(headerText);
  const qWindow = qLabel
    ? headerText.slice(qLabel.index + qLabel[0].length, qLabel.index + qLabel[0].length + 15)
    : headerText;
  const qValue = QUARTER_VALUE_RE.exec(qWindow);
  if (qValue) quarter = `${qValue[1]}Q` as Quarter;

  return { fiscalYear, quarter };
}

// ===== KRブロックの分割（四半期・月次で共有） =====

const KR_HEADING_RE = /個人KR_([1-8])(?!_)/g;

interface KrSpan {
  krNumber: number;
  /** 見出し文字列そのものの開始位置 */
  start: number;
  /** 見出し文字列の直後（本文の開始位置） */
  bodyStart: number;
  /** 次の見出しの開始位置、または末尾 */
  end: number;
}

/** 「個人KR_1」〜「個人KR_8」の見出しでテキストをブロックに分割する。
 * 「個人KR_1_ウェイト」等の派生ラベルは(?!_)で除外する。同じ番号が複数回出現した場合は
 * 最初の出現のみを見出しとして扱う（想定外の重複はconfidence側で検出する）。 */
function findKrSpans(text: string): KrSpan[] {
  const heads: { krNumber: number; start: number; end: number }[] = [];
  const re = new RegExp(KR_HEADING_RE.source, "g");
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const krNumber = Number(m[1]);
    if (seen.has(krNumber)) continue;
    seen.add(krNumber);
    heads.push({ krNumber, start: m.index, end: m.index + m[0].length });
  }
  return heads.map((h, i) => ({
    krNumber: h.krNumber,
    start: h.start,
    bodyStart: h.end,
    end: i + 1 < heads.length ? heads[i + 1].start : text.length,
  }));
}

/** KR見出し行の括弧内（例："個人KR_1（グループKR1｜AAS）"）からgroup_kr_hint・labelを取り出す。
 * 括弧が見出しに直接続いていない場合はどちらもnull（呼び出し元がsource_labelにフォールバックする）。 */
function extractHeadingTitle(text: string, krNumber: number): { groupKrHint: string | null; label: string | null } {
  const re = new RegExp(`個人KR_${krNumber}(?!_)[ \\t]*[（(]([^）)]*)[）)]`);
  const m = re.exec(text);
  if (!m) return { groupKrHint: null, label: null };
  const hint = m[1].trim();
  if (!hint) return { groupKrHint: null, label: null };
  const parts = hint.split(/[／/｜|]/).map(s => s.trim()).filter(Boolean);
  const label = parts.length > 0 ? parts[parts.length - 1] : null;
  return { groupKrHint: hint, label };
}

// ===== 四半期KR（呼び出し1相当） =====

const KR_KIND_RE = /KR種別(?:_[1-8])?/g;
/** KR種別ラベルの探索窓（見出し直前の何文字まで遡って探すか）。前のKRブロックの終端は
 * 「次のKR見出しの開始位置」と同じ値になるため境界として使えない（findKrSpansの span.end は
 * 常に次の見出しの開始位置＝このKRの search 開始位置と一致し、範囲が空になってしまう）。
 * そのため境界に依存せず、見出し直前の固定長ウィンドウで探す（KR種別欄は「直前」にある前提の
 * ためこれで十分。KR本文が短い場合に前のKRの内容を誤って拾わないよう150文字程度に絞る）。 */
const KR_KIND_HINT_LOOKBACK_CHARS = 150;

/** KR見出しの直前にある「KR種別」または「KR種別_N」の値を取り出す（探索範囲は見出し直前の
 * 固定長ウィンドウ。同じ範囲に複数出現した場合は見出しに最も近い最後の出現を使う）。 */
function extractKrKindHint(text: string, headingStart: number): string | null {
  const windowStart = Math.max(0, headingStart - KR_KIND_HINT_LOOKBACK_CHARS);
  const window = text.slice(windowStart, headingStart);
  const re = new RegExp(KR_KIND_RE.source, "g");
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(window)) !== null) last = m;
  if (!last) return null;
  const after = window.slice(last.index + last[0].length);
  const line = after.split(/\r?\n/).find(l => l.trim().length > 0);
  return line ? line.trim() : null;
}

function extractKrWeightPct(text: string, span: KrSpan): number | null {
  const re = new RegExp(`個人KR_${span.krNumber}_ウェイト`);
  const spanText = text.slice(span.start, span.end);
  const m = re.exec(spanText);
  if (!m) return null;
  const after = spanText.slice(m.index + m[0].length, m.index + m[0].length + 30);
  const line = after.split(/\r?\n/).find(l => l.trim().length > 0) ?? "";
  return parseWeightPct(line);
}

type BodyFieldKey = "category" | "activity" | "strength_role" | "weakness_role" | "criteria" | "supplement";

const BODY_FIELD_DEFS: { key: BodyFieldKey; re: RegExp }[] = [
  { key: "category", re: /●対象業務カテゴリ/ },
  { key: "activity", re: /●(?:実施内容|対象業務内容)/ },
  { key: "strength_role", re: /●得意領域の強化(?:：（役割）)?/ },
  { key: "weakness_role", re: /●苦手領域の克服(?:：（役割）)?/ },
  { key: "criteria", re: /●達成基準/ },
  { key: "supplement", re: /●補足/ },
];

/** 本文6欄を「ラベル直後〜次に見つかったラベルの開始」までの値として抽出する。
 * 同じ欄のラベルが複数回見つかった場合は最初の出現のみを採用する。
 * 🔴 KR種別（次のKRブロックの直前ラベル）も境界としてだけ登録する（値としては使わない）。
 * これが無いと、このKRの最後の本文欄（多くは「●補足」）の値が、次のKRの直前にある
 * 「KR種別」欄の文字列まで飲み込んでしまう（spanはKR見出し単位でしか切っていないため）。 */
function extractBodyFields(text: string, span: KrSpan): Record<BodyFieldKey, string | null> {
  const spanText = text.slice(span.bodyStart, span.end);
  const hits: { key: BodyFieldKey | null; start: number; end: number }[] = [];
  for (const def of BODY_FIELD_DEFS) {
    const re = new RegExp(def.re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(spanText)) !== null) hits.push({ key: def.key, start: m.index, end: m.index + m[0].length });
  }
  {
    const re = new RegExp(KR_KIND_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(spanText)) !== null) hits.push({ key: null, start: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start);

  const values: Record<BodyFieldKey, string | null> = {
    category: null, activity: null, strength_role: null, weakness_role: null, criteria: null, supplement: null,
  };
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit.key === null || values[hit.key] != null) continue;
    const nextStart = i + 1 < hits.length ? hits[i + 1].start : spanText.length;
    const raw = spanText.slice(hit.end, nextStart).trim();
    values[hit.key] = raw || null;
  }
  return values;
}

export interface KintoneQuarterlyParseResult {
  analysis: PersonalOkrImportAnalysis;
  confidence: KintoneParseConfidence;
}

/** Kintoneの「個人OKR設定フォーム」（個人四半期KR）を決定的に解析する。
 * confidence.ok=false のときは呼び出し元が結果を使わずAIにフォールバックすること。 */
export function parseKintoneQuarterlyText(text: string): KintoneQuarterlyParseResult {
  const reasons: string[] = [];
  const docType = detectKintoneDocType(text);
  const { fiscalYear, quarter } = extractFiscalYearAndQuarter(text);
  const spans = findKrSpans(text);

  if (spans.length === 0) {
    return {
      analysis: { detected_doc_type: docType ?? "quarterly", fiscal_year: fiscalYear, quarter, krs: [] },
      confidence: { ok: false, krCount: 0, reasons: ["「個人KR_N」の見出しが見つかりませんでした"] },
    };
  }

  const numbers = spans.map(s => s.krNumber);
  const isAscendingFromOne = numbers[0] === 1 && numbers.every((n, i) => i === 0 || n > numbers[i - 1]);
  if (!isAscendingFromOne) reasons.push(`KR見出しの出現順が想定外です（検出順：${numbers.join(",")}）`);

  let filledFieldTotal = 0;
  let fieldSlotTotal = 0;
  let krsWithTitle = 0;

  const krs: PersonalOkrImportKr[] = spans.map(span => {
    const krKindHint = extractKrKindHint(text, span.start);
    const { groupKrHint, label } = extractHeadingTitle(text, span.krNumber);
    if (label) krsWithTitle++;
    const weightPct = extractKrWeightPct(text, span);
    const body = extractBodyFields(text, span);
    const bodyValues = Object.values(body);
    fieldSlotTotal += bodyValues.length;
    filledFieldTotal += bodyValues.filter(v => v != null).length;

    const sourceLabel = `個人KR_${span.krNumber}`;
    return {
      source_label: sourceLabel,
      kr_kind_hint: krKindHint,
      group_kr_hint: groupKrHint,
      label: label ?? sourceLabel,
      weight_pct: weightPct,
      category: body.category,
      activity: body.activity,
      strength_role: body.strength_role,
      weakness_role: body.weakness_role,
      criteria: body.criteria,
      supplement: body.supplement,
      months: [],
    };
  });

  const fillRatio = fieldSlotTotal > 0 ? filledFieldTotal / fieldSlotTotal : 0;
  if (fillRatio < QUARTERLY_MIN_BODY_FILL_RATIO) {
    reasons.push(`本文6欄の充足率が低すぎます（${Math.round(fillRatio * 100)}%）`);
  }
  if (krsWithTitle === 0) {
    reasons.push("KR見出しの括弧内（グループKR等の表記）を1件も抽出できませんでした");
  }

  const ok = reasons.length === 0 && spans.length >= MIN_KR_COUNT_FOR_CONFIDENCE;
  return {
    analysis: { detected_doc_type: docType ?? "quarterly", fiscal_year: fiscalYear, quarter, krs },
    confidence: { ok, krCount: spans.length, reasons },
  };
}

// ===== 月次計画・振り返り（呼び出し2相当） =====

type MonthlyFieldKey =
  | "positioning" | "activities" | "target_and_evidence" | "risks" | "band_target"
  | "weight_override_pct" | "review_marker" | "self_eval_pct" | "gm_eval_pct" | "gm_comment";

interface MonthlyHit {
  field: MonthlyFieldKey;
  start: number;
  end: number;
  /** activities/target_and_evidence/band_targetのように、ラベル自体に暦月（例："8月"）が
   * 埋め込まれているフィールドだけ持つ。埋め込みが無いフィールドはnull（出現順で月を割り振る）。 */
  calendarMonth: number | null;
  /** ウェイト特例・自己評価・GM評価のように、正規表現の捕捉グループでラベル＋値を一括取得できる
   * フィールド用。値を後段のラベル境界抽出に頼らない（ブラケット記法は位置がぶれやすいため）。 */
  inlineValue: string | null;
}

const ACTIVITIES_RE = /▼(\d{1,2})月に取り組む内容（計画）/g;
const TARGET_RE = /▼(\d{1,2})月末の達成目標と、その証拠（計画値）/g;
const BAND_RE = /▼(\d{1,2})月末\s*達成度バンド（計画）/g;
const POSITIONING_RE = /【位置づけ】/g;
const RISKS_RE = /▼リスクと依存関係/g;
// 「振返り」（りが無い）は月次振返り記録のタイトル表記のため対象外。「振り返り」（りが2つ）
// は分類欄・振り返り本文欄のラベルとして使われる表記でタイトルとは重複しない。
// 🔴 単語自体は自由記述の本文中に現れ得る（例："今月の振り返りとして…"）ため、行全体が
// 「振り返り」だけで構成されているとき（＝ラベル単体の行）に限定する。これを付けないと、
// ラベルの直後に続く本文自身の先頭付近に同じ単語が現れた場合に誤って2回ヒットしてしまう。
const REVIEW_MARKER_RE = /(?:^|\r?\n)[ \t]*振り返り[ \t]*(?:\r?\n|$)/gm;
const GM_COMMENT_MARKER_RE = /【[^】\n]{1,20}コメント】/g;
const WEIGHT_OVERRIDE_RE = /※\d{1,2}カ月目のみ\s*([0-9]{1,3})\s*[%％]/g;
const SELF_EVAL_RE = /\[自己評価[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/g;
const GM_EVAL_RE = /→[^\s：:【】]{1,20}評価[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/g;
const BAND_TOKEN_RE = /(\d{2,3})\s*[%％]/g;

function collectMonthlyHits(spanText: string): MonthlyHit[] {
  const hits: MonthlyHit[] = [];
  const pushAll = (re: RegExp, field: MonthlyFieldKey, calendarGroup?: number, valueGroup?: number) => {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(spanText)) !== null) {
      hits.push({
        field,
        start: m.index,
        end: m.index + m[0].length,
        calendarMonth: calendarGroup != null ? Number(m[calendarGroup]) : null,
        inlineValue: valueGroup != null ? m[valueGroup] : null,
      });
    }
  };
  pushAll(ACTIVITIES_RE, "activities", 1);
  pushAll(TARGET_RE, "target_and_evidence", 1);
  pushAll(BAND_RE, "band_target", 1);
  pushAll(POSITIONING_RE, "positioning");
  pushAll(RISKS_RE, "risks");
  pushAll(REVIEW_MARKER_RE, "review_marker");
  pushAll(GM_COMMENT_MARKER_RE, "gm_comment");
  pushAll(WEIGHT_OVERRIDE_RE, "weight_override_pct", undefined, 1);
  pushAll(SELF_EVAL_RE, "self_eval_pct", undefined, 1);
  pushAll(GM_EVAL_RE, "gm_eval_pct", undefined, 1);
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/** activities/target_and_evidence/band_targetに埋め込まれた暦月番号を集め、昇順に1,2,3を
 * 振る（quarterが分からなくても「四半期内の3か月」を相対順で特定できる。最大3件までに絞る）。 */
function computeMonthRankMap(spanText: string): Map<number, 1 | 2 | 3> {
  const months = new Set<number>();
  for (const re of [ACTIVITIES_RE, TARGET_RE, BAND_RE]) {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(spanText)) !== null) months.add(Number(m[1]));
  }
  const sorted = Array.from(months).sort((a, b) => a - b).slice(0, 3);
  const map = new Map<number, 1 | 2 | 3>();
  sorted.forEach((cal, i) => map.set(cal, (i + 1) as 1 | 2 | 3));
  return map;
}

/** 単一の達成度バンド値が明記されているときだけ数値を返す。0件（数値なし）・2件以上
 * （複数基準のルーブリック）はnull（SYSTEM_PROMPTと同じ「推測して埋めない」方針）。 */
function extractSingleBandNumber(raw: string | null): number | null {
  if (!raw) return null;
  const tokens: number[] = [];
  const re = new RegExp(BAND_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) tokens.push(Number(m[1]));
  if (tokens.length !== 1) return null;
  return parseBandValue(tokens[0]);
}

interface MonthAccumulator {
  positioning: string | null; activities: string | null; target_and_evidence: string | null;
  risks: string | null; band_target_raw: string | null; weight_override_raw: string | null;
  review_text: string | null; self_eval_raw: string | null; gm_eval_raw: string | null; gm_comment: string | null;
}

function emptyMonthAccumulator(): MonthAccumulator {
  return {
    positioning: null, activities: null, target_and_evidence: null, risks: null,
    band_target_raw: null, weight_override_raw: null, review_text: null,
    self_eval_raw: null, gm_eval_raw: null, gm_comment: null,
  };
}

/** ラベルに暦月が埋め込まれているフィールドはcomputeMonthRankMapの結果で月を判定する。
 * 埋め込みが無いフィールド（positioning/risks/review_marker/gm_comment/weight_override/
 * self_eval/gm_eval）は「そのフィールド種別のN番目の出現＝月インデックスN」という位置的な
 * 割り当てにフォールバックする（modal側の既存フォールバック `(i % 3) + 1` と同じ考え方）。
 * 🔴 実データが無いため、この位置的な割り当てが崩れる（列の順序が入れ替わる等の抽出結果）
 * 場合は誤った月に値が入る可能性がある。assessされたconfidenceが低ければ呼び出し元は
 * AIにフォールバックするため、誤った結果がそのまま採用されることはない。 */
function buildMonthsFromHits(spanText: string, hits: MonthlyHit[]): PersonalOkrImportMonth[] {
  const monthRankMap = computeMonthRankMap(spanText);
  const positionalCounters: Partial<Record<MonthlyFieldKey, number>> = {};
  const monthsByIndex = new Map<1 | 2 | 3, MonthAccumulator>();
  const ensure = (idx: 1 | 2 | 3) => {
    if (!monthsByIndex.has(idx)) monthsByIndex.set(idx, emptyMonthAccumulator());
    return monthsByIndex.get(idx)!;
  };

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    let monthIndex: 1 | 2 | 3 | null;
    if (hit.calendarMonth != null) {
      monthIndex = monthRankMap.get(hit.calendarMonth) ?? null;
    } else {
      const n = (positionalCounters[hit.field] ?? 0) + 1;
      positionalCounters[hit.field] = n;
      monthIndex = (((n - 1) % 3) + 1) as 1 | 2 | 3;
    }
    if (monthIndex == null) continue;
    const rec = ensure(monthIndex);
    const valueText = () => {
      const next = hits[i + 1];
      const to = next ? next.start : spanText.length;
      return spanText.slice(hit.end, to).trim();
    };
    switch (hit.field) {
      case "positioning": rec.positioning = valueText() || null; break;
      case "activities": rec.activities = valueText() || null; break;
      case "target_and_evidence": rec.target_and_evidence = valueText() || null; break;
      case "risks": rec.risks = valueText() || null; break;
      case "band_target": rec.band_target_raw = valueText() || null; break;
      case "weight_override_pct": rec.weight_override_raw = hit.inlineValue; break;
      case "review_marker": rec.review_text = valueText() || null; break;
      case "self_eval_pct": rec.self_eval_raw = hit.inlineValue; break;
      case "gm_eval_pct": rec.gm_eval_raw = hit.inlineValue; break;
      case "gm_comment": rec.gm_comment = valueText() || null; break;
    }
  }

  return Array.from(monthsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([monthIndex, rec]) => ({
      month_index: monthIndex,
      positioning: rec.positioning,
      activities: rec.activities,
      target_and_evidence: rec.target_and_evidence,
      risks: rec.risks,
      band_target: extractSingleBandNumber(rec.band_target_raw),
      weight_override_pct: parseWeightPct(rec.weight_override_raw),
      review_text: rec.review_text,
      self_eval_pct: parsePercentValue(rec.self_eval_raw),
      gm_eval_pct: parsePercentValue(rec.gm_eval_raw),
      gm_comment: rec.gm_comment,
    }));
}

export interface KintoneMonthlyParseResult {
  analysis: PersonalOkrImportMonthlyAnalysis;
  confidence: KintoneParseConfidence;
}

/** Kintoneの「個人OKR_月次振返り記録」を決定的に解析する。
 * confidence.ok=false のときは呼び出し元が結果を使わずAIにフォールバックすること。 */
export function parseKintoneMonthlyText(text: string): KintoneMonthlyParseResult {
  const spans = findKrSpans(text);
  if (spans.length === 0) {
    return { analysis: { krs: [] }, confidence: { ok: false, krCount: 0, reasons: ["「個人KR_N」の見出しが見つかりませんでした"] } };
  }

  const reasons: string[] = [];
  let totalMonths = 0;
  let filledFieldTotal = 0;
  let fieldSlotTotal = 0;

  const krs: PersonalOkrImportMonthlyKrGroup[] = spans.map(span => {
    const spanText = text.slice(span.bodyStart, span.end);
    const hits = collectMonthlyHits(spanText);
    const months = buildMonthsFromHits(spanText, hits);
    totalMonths += months.length;
    for (const month of months) {
      const values = [
        month.positioning, month.activities, month.target_and_evidence, month.risks,
        month.review_text, month.self_eval_pct, month.gm_eval_pct,
      ];
      fieldSlotTotal += values.length;
      filledFieldTotal += values.filter(v => v != null).length;
    }
    const { label } = extractHeadingTitle(text, span.krNumber);
    return { source_label: `個人KR_${span.krNumber}`, label, months };
  });

  if (totalMonths === 0) {
    reasons.push("月次フィールド（1か月目〜3か月目に相当する見出し）を1件も検出できませんでした");
  } else {
    const fillRatio = fieldSlotTotal > 0 ? filledFieldTotal / fieldSlotTotal : 0;
    if (fillRatio < MONTHLY_MIN_FIELD_FILL_RATIO) {
      reasons.push(`月次欄の充足率が低すぎます（${Math.round(fillRatio * 100)}%）`);
    }
  }

  const ok = reasons.length === 0;
  return { analysis: { krs }, confidence: { ok, krCount: spans.length, reasons } };
}

// ===== 確認画面向けの経路表示（人が「AIを使ったか」を確認できるようにする） =====

export type KintoneImportEngineSource = "deterministic" | "ai" | "none";

/** 山本さんが実機で「どちらの経路で読んだか」を確認できるようにする文言。
 * PersonalOkrImportModal.tsxのレビュー画面に必ず表示する（依頼の安全弁の要件）。 */
export function describeKintoneImportSource(
  quarterlySource: KintoneImportEngineSource,
  monthlySource: KintoneImportEngineSource,
): string {
  const bothAiOrNone = quarterlySource !== "deterministic" && monthlySource !== "deterministic";
  if (bothAiOrNone) return "🤖 AIで読み取りました";

  const bothDeterministicOrNone = quarterlySource !== "ai" && monthlySource !== "ai";
  if (bothDeterministicOrNone) return "⚙ 画面の構造から読み取りました（AI未使用）";

  if (quarterlySource === "deterministic" && monthlySource === "ai") {
    return "⚙🤖 個人KRの基本情報は画面の構造から、月次計画・振り返りはAIで読み取りました";
  }
  return "🤖⚙ 個人KRの基本情報はAIで、月次計画・振り返りは画面の構造から読み取りました";
}

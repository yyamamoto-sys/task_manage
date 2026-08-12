// src/lib/ai/personalOkrImportExtractor.ts
//
// 【設計意図】
// Kintoneの「個人OKR設定フォーム」（個人四半期KR）または「個人OKR_月次振返り記録」
// （個人月次計画・振り返り）のPDF・テキストをAIに読ませ、現行アプリの個人OKR構造
// （personal_krs / personal_kr_months相当）に抽出する。okrImportExtractor.tsと同じ作法
// （PDFはdocumentブロックで添付・抽出結果はJSONで受け取り手書きバリデーション・
// 確認/編集は呼び出し元UIが担う・自己修正リトライ1回）を踏襲する。
//
// 【呼び出しを2回に分ける（v3.46・2026-08-10）】
// v3.45でPDFのクライアント側テキスト抽出とmax_tokens=8192への引き下げを行ったが、その後も
// 546 WORKER_RESOURCE_LIMITが再発した（テキスト抽出自体は成功していた）。546はペイロードの
// サイズだけでなく「1回の呼び出しの実行時間」でも起きる（CLAUDE.md Section 19 ⑦・27）。
// 個人四半期KR（最大8本×6本文欄）と月次計画・振り返り（最大8本×3か月×計画/振り返り両方）を
// 1回の呼び出しで抽出すると生成量・処理時間が積み重なるため、これを2回の呼び出しに分割する。
//   呼び出し1（extractPersonalOkrQuarterlyData）：資料の種類の判定＋KR単位の基本情報
//     （KR種別・ラベル・ウェイト・6本文欄）。常に実行する（月次振返り記録でも6本文欄は
//     「KR_四半期OKRから転記」列に同じ内容が転記されているため、この呼び出しだけで拾える）。
//   呼び出し2（extractPersonalOkrMonthlyData）：月次の計画・振り返り。呼び出し1の
//     detected_doc_type が "monthly_review" のときだけ実行する（"quarterly" の資料には
//     月次情報が無いため呼ぶ意味が無い＝呼び出しを1回減らせる）。呼び出し1自体が失敗した
//     ときは種別が分からないため保険的に実行する（片方成功すれば見せられる状態にするため）。
// 2回の結果はmergePersonalOkrImportResults()（純粋関数）でマージする。どちらかが失敗しても
// 成功した方の結果を確認画面に出す（全部やり直しにしない。orchestratorのwarnings参照）。
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

import { invokeAI, buildMessageContent, type ContentBlock, type FileAttachment } from "./invokeAI";
import type { Quarter } from "../localData/types";
import {
  parseKintoneQuarterlyText, parseKintoneMonthlyText, detectKintoneDocType,
  type KintoneImportEngineSource,
} from "../personalOkr/kintoneTextParse";
import { trimKintoneImportText } from "../personalOkr/importTextTrim";

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

/** 呼び出し2（月次抽出）専用の軽量な型。KR単位の基本情報は呼び出し1で既に取得済みのため、
 * 突き合わせ用の識別子（source_label / label）とmonthsだけを持つ。 */
export interface PersonalOkrImportMonthlyKrGroup {
  source_label: string | null;
  label: string | null;
  months: PersonalOkrImportMonth[];
}

export interface PersonalOkrImportMonthlyAnalysis {
  krs: PersonalOkrImportMonthlyKrGroup[];
}

/** 解析の進捗（PersonalOkrImportModal.tsxがSaveProgressLoaderにそのまま渡せる形） */
export interface PersonalOkrImportProgress {
  current: number;
  total: number;
  label: string;
}

export interface PersonalOkrImportResult extends PersonalOkrImportAnalysis {
  /** 呼び出し1・2のどちらかが失敗した場合の警告文（両方成功時は空配列）。
   * 全滅ではないので処理は続行し、確認画面で人に見せる（全部やり直しにしない）。 */
  warnings: string[];
  /** 個人KRの基本情報（呼び出し1相当）を決定的パーサ（kintoneTextParse.ts）で読めたか、
   * AIにフォールバックしたか。確認画面に必ず表示する（v3.56・山本さんの依頼の安全弁）。
   * "none"は無い（四半期側は必ずどちらかの経路を通る）。 */
  quarterlySource: "deterministic" | "ai";
  /** 月次計画・振り返り（呼び出し2相当）の経路。"none"は月次情報自体が不要だった
   * （四半期OKRのみの資料と判定された）場合。 */
  monthlySource: "deterministic" | "ai" | "none";
  /** 実際にAIへ送信した文字数の合計（同じ本文を複数回送った場合は合算）。0=AIを一切使わなかった。 */
  aiSentCharCount: number;
  /** 添付・貼り付けから得られた元の文字数（トリム前）。画面の「元◯◯字→送信◯◯字」表示に使う。 */
  originalCharCount: number;
}

// ===== システムプロンプトの共通断片 =====

const PDF_CAVEAT = `【⚠️入力はPDFそのものではなく、レイアウト情報を失ったテキストです】
PDFが添付されている場合も、実際に渡されるのはクライアント側で抽出した本文テキストです
（画像・色・表の線・厳密な行列位置は失われており、行の順序や列の対応がずれて渡ってくることが
あります）。位置関係（「この位置にあるから計画欄」等）ではなく、見出し語・ラベル文言
（「1か月目」「振り返り」「[自己評価：]」等）を根拠に判断してください。`;

const EXCLUDE_NOTES = `【抽出しないもの】
- 「個人OKR月次評価（達成度）」「個人OKR 四半期評価（達成度）」セクションの月次面談まとめの
  合計値（特定のKRに紐づかない個人単位の総合評価のため）
- 「【7月限定KR】」のような、四半期の個人KR一覧に含まれない一時的なKR（krs配列に含めない）
- 役割等級要件・面談参考資料等の付録セクション`;

const JSON_STRICTNESS_RULES = `【最重要：JSONの厳格な作法（守らないとパースに失敗する）】
- 出力は厳密なJSONオブジェクトのみ。前後に説明文・コードブロック\`\`\`・注釈を一切付けない。
- 文字列値の中で二重引用符 " を使う必要がある場合は必ず \\" とエスケープする。
  ただし日本語の引用は原則 " ではなく「」『』を使い、ASCII二重引用符を値に含めないこと。
- 文字列値の中に生の改行を入れない（必要なら \\n を使うか、1行に要約する）。
- 末尾カンマを付けない。全てのプロパティ名・文字列値は二重引用符で囲む。
- 値が不明なときは文字列 "" ではなく null を使う（スキーマで null 許容のもの）。`;

// ===== システムプロンプト：呼び出し1（個人四半期KR＋資料種別判定） =====

const SYSTEM_PROMPT_QUARTERLY = `あなたはKintoneの「個人OKR設定フォーム」（個人四半期KR）または
「個人OKR_月次振返り記録」（個人月次計画・振り返り）の画面をテキストとして解析し、
タスク管理アプリの個人四半期KR構造（personal_krs相当）に変換するAIです。
月次の計画・振り返り欄（1か月目〜3か月目の内容）はこの呼び出しでは抽出しません
（判定結果によっては別の呼び出しで処理します）。この呼び出しでは資料の種類の判定と
KRごとの基本情報だけを正確に読み取ってください。

${PDF_CAVEAT}

【最初にやること：資料の種類を判定する】
- タイトルが「個人OKR設定フォーム」で「個人KR_1」「個人KR_1_ウェイト」等の欄が中心 → "quarterly"
- タイトルが「個人OKR_月次振返り記録」で「1か月目」「2か月目」「3か月目」の列・「振り返り」
  「自己評価」の語が中心 → "monthly_review"
判定結果を detected_doc_type に入れる（この判定結果によって、月次計画・振り返りを読み取る
別の呼び出しを行うかどうかを決めるため重要）。人が後で切り替えられるので迷ったらどちらかを選ぶ。

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

${EXCLUDE_NOTES}

${JSON_STRICTNESS_RULES}

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
      "supplement": "..." | null
    }
  ]
}`;

// ===== システムプロンプト：呼び出し2（月次計画・振り返り） =====
// detected_doc_type==="monthly_review" のときだけ呼ぶ（extractPersonalOkrImportData参照）。

const SYSTEM_PROMPT_MONTHLY = `あなたはKintoneの「個人OKR_月次振返り記録」画面をテキストとして
解析し、タスク管理アプリの個人月次計画・振り返り構造（personal_kr_months相当）に変換するAIです。
KRごとの基本情報（KR種別・ウェイト・達成基準等の6本文欄）は別の呼び出しで既に読み取っているため、
この呼び出しでは月次の計画・振り返り欄だけを読み取ってください。

${PDF_CAVEAT}

【KRの単位】
資料は「個人KR_1」「個人KR_2」…のブロック（最大8本＋備考欄）で構成される。各ブロックを
krs配列の1要素として抽出する。ブロックの項目名（例："個人KR_1"）を source_label に、
KRタイトル行の括弧内の末尾の名称（例："AAS"）を label に入れる（別の呼び出しの結果と
突き合わせる手がかりに使うため、同じKRブロックには必ず同じsource_label/labelを使うこと）。

【月次計画・振り返り】
同じKRについて「分類＝計画」の行と「分類＝振り返り」の行が対になっている。
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

${EXCLUDE_NOTES}

${JSON_STRICTNESS_RULES}

{
  "krs": [
    {
      "source_label": "個人KR_1" | null,
      "label": "AAS" | null,
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

// ===== システムプロンプト：1回にまとめる場合（v3.56・入力が小さいときだけ使う） =====
// SYSTEM_PROMPT_QUARTERLY・SYSTEM_PROMPT_MONTHLYの指示を1つに合体し、krs[]の各要素に
// months[]を内包させたJSONを1回で返させる。validatePersonalOkrImportAnalysis()は
// 元々krs[].months[]まで検証する実装のため、専用のバリデータは新設不要（そのまま再利用）。

const SYSTEM_PROMPT_COMBINED = `あなたはKintoneの「個人OKR設定フォーム」（個人四半期KR）または
「個人OKR_月次振返り記録」（個人月次計画・振り返り）の画面をテキストとして解析し、
タスク管理アプリの個人四半期KR構造（personal_krs相当）と月次計画・振り返り構造
（personal_kr_months相当）の両方に変換するAIです。通常はこれを2回の呼び出しに分けて
実行しますが、今回は入力が小さいため1回にまとめて実行します。

${PDF_CAVEAT}

【最初にやること：資料の種類を判定する】
- タイトルが「個人OKR設定フォーム」で「個人KR_1」「個人KR_1_ウェイト」等の欄が中心 → "quarterly"
- タイトルが「個人OKR_月次振返り記録」で「1か月目」「2か月目」「3か月目」の列・「振り返り」
  「自己評価」の語が中心 → "monthly_review"
判定結果を detected_doc_type に入れる。"quarterly" と判定した場合、各KRの months は
空配列（[]）でよい（四半期OKRのみの資料には月次の計画・振り返りが無いため）。

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
KRタイトル行（例："個人KR_1（グループKR1｜AAS）"）の括弧内の全文をそのまま転記する。
本文中に「KR1-TF2」等のTF番号付きの記載があれば、それも含めて転記する。要約せず原文のまま返す。

【label】
タブに出す短い名前。KRタイトル行の括弧内の末尾の名称を優先し、無ければsource_labelをそのまま使う。

【weight_pct】
「個人KR_N_ウェイト」欄、または月次振返り記録の「ウェイト」列の数値（%記号は除く）。不明はnull。

【本文6欄】category / activity / strength_role / weakness_role / criteria / supplement
- category ← ●対象業務カテゴリ
- activity ← ●実施内容（●対象業務内容も同義）
- strength_role ← ●得意領域の強化：（役割）
- weakness_role ← ●苦手領域の克服：（役割）
- criteria ← ●達成基準
- supplement ← ●補足（心持ちの変化／目指す存在等）
月次振返り記録では「KR_四半期OKRから転記」列に同じ内容が転記されているので、そこから
抽出してよい。「全社共通」のKR（勤怠管理）は10段階評価表がそのまま達成基準になっており
6欄には分かれていない。その場合はcriteriaに評価表の要点を入れ、他5欄はnullでよい。

【月次計画・振り返り（"monthly_review"のときだけpopulateする。"quarterly"なら空配列）】
同じKRについて「分類＝計画」の行と「分類＝振り返り」の行が対になっている。列見出し
「1か月目」「2か月目」「3か月目」がそれぞれmonth_index 1/2/3に対応する。

計画欄（分類＝計画の列内）から：
- positioning ← 【位置づけ】の文章
- activities ← ▼◯月に取り組む内容（計画）
- target_and_evidence ← ▼◯月末の達成目標と、その証拠（計画値）
- risks ← ▼リスクと依存関係
- weight_override_pct ← ウェイト欄の「※◯カ月目のみX%」の注記のXの値。無ければnull。
- band_target ← ▼◯月末 達成度バンド（計画）の欄。単一の目標値が本文中に明記されている
  場合だけ数値を入れ、複数基準の説明文しか無い場合は必ずnullを返す（推測して埋めない）。
  60/70/80/90/100以外の数値は使わない。

振り返り欄（分類＝振り返り の列内）から：
- review_text ← 「振り返り」の直後にある地の文（自由記述の段落）のみ。末尾の
  「[自己評価：…]」の角括弧表記やその後の✔✖□のチェック済みバンド一覧・
  【〇〇コメント】は含めない。
- self_eval_pct ← 「[自己評価：XX%（本KR%）…]」の最初のXX%（本KR%そのもの）。
- gm_eval_pct ← 「→（人名）評価：YY%」のYY。無ければnull。
- gm_comment ← 【（人名）コメント】として書かれた地の文。無ければnull。

${EXCLUDE_NOTES}

${JSON_STRICTNESS_RULES}

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

const TRUNCATED_COMBINED_MESSAGE =
  "抽出結果が長すぎて途中で切れました。四半期OKRと月次振返りを分けて取り込んでください。";

/**
 * 【1回にまとめる／2回に分割するの自動切替の閾値（v3.56）】
 * Section 19 ⑧・28の教訓：546 WORKER_RESOURCE_LIMITはペイロードのサイズだけでなく
 * 「1回の呼び出しの実行時間」でも起きる。実行時間は主に「入力の複雑さ×出力の生成量」に
 * 比例するため、入力が十分小さければ1回にまとめても安全と判断できる。
 * 既存の警告閾値（importCharWarning.ts の PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD=
 * 20000字。「40000字の上限内でも546が起きた」事実から安全側に倒した値）はあくまで
 * 「分割した呼び出しでも危険域に入り始める」というシグナルであり、1回にまとめる判断は
 * それよりさらに慎重であるべきなので、その半分（10000字）にする。
 * 🔴 この閾値を超える場合は必ず従来どおりの2回呼び出し（実行時間・入力トークンともに
 * 実績のある分割）に倒す。まとめ呼び出し自体が失敗した場合も同様に2回呼び出しへ
 * フォールバックする（extractPersonalOkrImportData参照）。
 */
export const PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS = 10000;

/** 1回にまとめて呼ぶ版（呼び出し1・2を統合）。needQuarterlyAi && needMonthlyAi かつ
 * 入力が PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS 以下のときだけ使う。単独でもテストできる。 */
export async function extractPersonalOkrCombinedData(
  params: ExtractPersonalOkrImportParams,
): Promise<PersonalOkrImportAnalysis> {
  const content = buildMessageContent(buildUserMessage(params), params.attachment ?? null);
  const raw = await invokeExtraction(SYSTEM_PROMPT_COMBINED, content, TRUNCATED_COMBINED_MESSAGE);
  return validatePersonalOkrImportAnalysis(raw);
}

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

function validateMonthlyKrGroup(data: unknown, path: string): PersonalOkrImportMonthlyKrGroup {
  if (!data || typeof data !== "object") throw new Error(`${path}が不正な形式です。`);
  const d = data as Record<string, unknown>;
  return {
    source_label: toNullableString(d.source_label),
    label: toNullableString(d.label),
    months: Array.isArray(d.months) ? d.months.map(validateMonth) : [],
  };
}

/**
 * 呼び出し1（quarterly）のレスポンスをバリデーションする。detected_doc_typeが想定外の値の
 * ときは、monthsに実質的な内容（review_text/self_eval_pct等）を持つKRが1件でもあれば
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

/** 呼び出し2（monthly）のレスポンスをバリデーションする。 */
export function validatePersonalOkrImportMonthlyAnalysis(data: unknown): PersonalOkrImportMonthlyAnalysis {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.krs)) throw new Error("krsが取得できませんでした。");
  return { krs: d.krs.map((kr, i) => validateMonthlyKrGroup(kr, `krs[${i}]`)) };
}

// ===== マージ（純粋関数。片方が空・片方が失敗・両方成功のいずれでも総取り扱いする） =====

/** monthlyのKRグループを、quarterly側の情報を持たない単独のPersonalOkrImportKrに変換する
 * （呼び出し1が失敗したときの最終手段。KR種別・ウェイト等は不明のままnullで返す）。 */
function monthlyGroupToKr(g: PersonalOkrImportMonthlyKrGroup): PersonalOkrImportKr {
  return {
    source_label: g.source_label,
    kr_kind_hint: null,
    group_kr_hint: null,
    label: g.label ?? g.source_label ?? "（名称未設定）",
    weight_pct: null,
    category: null,
    activity: null,
    strength_role: null,
    weakness_role: null,
    criteria: null,
    supplement: null,
    months: g.months,
  };
}

/** quarterly側のKR1件に対応するmonthly側グループのインデックスを探す
 * （source_label完全一致 → label完全一致の順。未使用=usedに入っていないものだけ対象）。 */
function findMatchingMonthlyGroupIndex(
  kr: PersonalOkrImportKr,
  groups: PersonalOkrImportMonthlyKrGroup[],
  used: Set<number>,
): number {
  for (let i = 0; i < groups.length; i++) {
    if (used.has(i)) continue;
    if (kr.source_label && groups[i].source_label && kr.source_label === groups[i].source_label) return i;
  }
  for (let i = 0; i < groups.length; i++) {
    if (used.has(i)) continue;
    if (kr.label && groups[i].label && kr.label === groups[i].label) return i;
  }
  return -1;
}

/**
 * 呼び出し1（quarterly）・呼び出し2（monthly）の結果をマージする純粋関数。
 * どちらかがnull（呼ばなかった、または失敗した）でも、成功した方の内容をそのまま返す
 * （全部やり直しにしない・extractPersonalOkrImportDataのwarningsと組で使う）。
 */
export function mergePersonalOkrImportResults(
  quarterly: PersonalOkrImportAnalysis | null,
  monthly: PersonalOkrImportMonthlyAnalysis | null,
): PersonalOkrImportAnalysis {
  if (!quarterly && !monthly) {
    return { detected_doc_type: "quarterly", fiscal_year: null, quarter: null, krs: [] };
  }
  if (!monthly) return quarterly!;
  if (!quarterly) {
    return {
      detected_doc_type: "monthly_review",
      fiscal_year: null,
      quarter: null,
      krs: monthly.krs.map(monthlyGroupToKr),
    };
  }

  const used = new Set<number>();
  const mergedKrs = quarterly.krs.map((kr, idx) => {
    let matchIdx = findMatchingMonthlyGroupIndex(kr, monthly.krs, used);
    // ラベルで対応が見つからない場合、同じ位置（idx）のKRブロックである可能性が高い
    // （両呼び出しは同じKintone画面を同じ順序で読むため）。位置合わせのフォールバック。
    if (matchIdx === -1 && idx < monthly.krs.length && !used.has(idx)) {
      matchIdx = idx;
    }
    if (matchIdx === -1) return kr;
    used.add(matchIdx);
    return { ...kr, months: monthly.krs[matchIdx].months };
  });

  // quarterly側に対応が見つからなかったmonthly側のグループはデータを失わないよう追加する
  const leftover = monthly.krs
    .map((g, i) => ({ g, i }))
    .filter(({ i }) => !used.has(i))
    .map(({ g }) => monthlyGroupToKr(g));

  return { ...quarterly, krs: [...mergedKrs, ...leftover] };
}

// ===== モデル選択（546対策） =====
// 【2026-08-11・山本さんの指示で haiku に切り替えた】
// v3.45（PDFのテキスト化でペイロード削減）・v3.46（呼び出しの2分割）を入れてもなお
// 546 WORKER_RESOURCE_LIMIT が続いたため、この取込に限って生成の速い haiku を使う。
// Supabase Edge Function は関数ごとに実行時間の上限を上げられないため、1回の呼び出しを
// 短くするしかなく、モデルの変更がその最後の手段になる（CLAUDE.md Section 19・28参照）。
//
// 🔴 影響範囲はこの取込（AIIntent="okr-personal-import"）だけ。他のAI機能は
// Edge Function側の既定（DEFAULT_MODEL="claude-sonnet-4-6"）のまま変わらない。
// "claude-haiku-4-5" は Edge Function の ALLOWED_MODELS に含まれるため、この1箇所の
// 変更だけで動く（ホワイトリスト外の値にすると既定へ黙ってフォールバックする点に注意）。
//
// 抽出の品質が落ちた場合は "claude-sonnet-4-6" に戻す。その場合は分割の粒度を
// さらに細かくする（月ごとに分ける等）方向で546を回避すること。
const PERSONAL_OKR_IMPORT_MODEL = "claude-haiku-4-5";

// max_tokens=8192（okrImportExtractor.tsと同じ値）。以前は16000だったが、PDFを添付した
// リクエストでEdge Functionのワーカーがリソース上限（546 WORKER_RESOURCE_LIMIT）で落ちる
// 事故が起きたため引き下げた（2026-08-10。CLAUDE.md Section 19参照。原因はmax_tokensの
// 大きさそのものではなくPDF添付との合算だが、実績のあるokrImportExtractor.tsに揃えておく）。
// 呼び出しを2回に分割した今も1回あたりの生成量は減る方向なので同じ値のままで足りる見込み。
const MAX_TOKENS_PERSONAL_OKR_IMPORT = 8192;

/** stop_reason==="max_tokens"（出力上限で途中切れ）のときにユーザーへ示す案内。呼び出しごとに
 * 案内文を分ける（呼び出しが既に分かれているため、これ以上どちらへ分けるべきかは案内できない）。 */
const TRUNCATED_QUARTERLY_MESSAGE =
  "個人KRの抽出結果が長すぎて途中で切れました。KRの件数を絞って取り込んでください。";
const TRUNCATED_MONTHLY_MESSAGE =
  "月次計画・振り返りの抽出結果が長すぎて途中で切れました。KRの件数を絞って取り込んでください。";

/** 自己修正リトライ用の指示文（okrImportExtractor.tsと同じ作法）。 */
function buildRepairMessages(content: string | ContentBlock[], failedText: string, reason: string) {
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

/** invokeAI呼び出し＋stop_reason検知＋自己修正リトライを1回分共通化する内部ヘルパー。
 * quarterly/monthlyどちらの呼び出しからも使う（呼び出し先が変わるのはsystem/contentのみ）。 */
async function invokeExtraction(
  system: string,
  content: string | ContentBlock[],
  truncatedMessage: string,
): Promise<unknown> {
  const res = await invokeAI(system, [{ role: "user", content }], MAX_TOKENS_PERSONAL_OKR_IMPORT, "okr-personal-import", PERSONAL_OKR_IMPORT_MODEL);
  // 出力切れ（max_tokens）はリトライしても同じ長さの壁にぶつかるだけなので、JSONパースを
  // 試みる前に明示的なエラーにする（consultationRunner.tsと同じ方針。黙って壊れたJSONの
  // パース失敗として扱わない）。
  if (res.stop_reason === "max_tokens") throw new Error(truncatedMessage);
  const text = res.content[0].text;

  try {
    return parseJsonSafe<unknown>(text);
  } catch (firstErr) {
    const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retry = await invokeAI(
      system,
      buildRepairMessages(content, text, reason),
      MAX_TOKENS_PERSONAL_OKR_IMPORT,
      "okr-personal-import",
      PERSONAL_OKR_IMPORT_MODEL,
    );
    if (retry.stop_reason === "max_tokens") throw new Error(truncatedMessage);
    return parseJsonSafe<unknown>(retry.content[0].text);
  }
}

function buildUserMessage(params: ExtractPersonalOkrImportParams): string {
  return params.transcript
    || (params.attachment ? `（添付ファイル「${params.attachment.fileName}」をKintoneの個人OKR画面PDFとして参照してください）` : "");
}

/** 呼び出し1：資料の種類の判定＋個人四半期KRの基本情報を抽出する。単独で呼べる（テスト容易性）。 */
export async function extractPersonalOkrQuarterlyData(
  params: ExtractPersonalOkrImportParams,
): Promise<PersonalOkrImportAnalysis> {
  const content = buildMessageContent(buildUserMessage(params), params.attachment ?? null);
  const raw = await invokeExtraction(SYSTEM_PROMPT_QUARTERLY, content, TRUNCATED_QUARTERLY_MESSAGE);
  return validatePersonalOkrImportAnalysis(raw);
}

/** 呼び出し2：月次計画・振り返りを抽出する。単独で呼べる（テスト容易性）。 */
export async function extractPersonalOkrMonthlyData(
  params: ExtractPersonalOkrImportParams,
): Promise<PersonalOkrImportMonthlyAnalysis> {
  const content = buildMessageContent(buildUserMessage(params), params.attachment ?? null);
  const raw = await invokeExtraction(SYSTEM_PROMPT_MONTHLY, content, TRUNCATED_MONTHLY_MESSAGE);
  return validatePersonalOkrImportMonthlyAnalysis(raw);
}

/**
 * 個人OKR取込のエントリーポイント（呼び出し元UI・PersonalOkrImportModal.tsxはこれだけを呼ぶ）。
 *
 * 【v3.56・決定的パーサを主経路にする】
 * Kintoneの帳票は全員同じ構造のため、AIに構造を推測させる必要が本来無い（山本さんの指摘）。
 * まず kintoneTextParse.ts の決定的パーサ（ルールベース・トークン消費ゼロ）を試し、
 * confidence.ok=true の部分だけAI呼び出しを省略する。四半期・月次のどちらか一方だけ決定的に
 * 読めた場合は、その部分だけAIをスキップする（部分適用。全部やり直しにしない）。
 * 両方とも決定的に読めた場合はAIを一切呼ばない（aiSentCharCount=0）。
 *
 * 決定的パーサが確信を持てなかった部分だけ、従来のAI呼び出し（呼び出し1・2の分割。
 * Section 19 ⑧・28の546対策）にフォールバックする。このとき、送信直前に
 * importTextTrim.ts でAIが使わない領域（付録・サマリー・一時的なKR）を削って送信量を
 * さらに減らす。両方がAI必須で、かつ削減後の本文が十分小さい場合だけ、1回にまとめた
 * 呼び出し（extractPersonalOkrCombinedData）に切り替える（Section 19 ⑧の再発を避けるため
 * 閾値を保守的に取る。PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS参照）。まとめ呼び出し
 * 自体が失敗した場合は、実績のある2回呼び出しへフォールバックする。
 */
export async function extractPersonalOkrImportData(
  params: ExtractPersonalOkrImportParams,
  onProgress?: (progress: PersonalOkrImportProgress) => void,
): Promise<PersonalOkrImportResult> {
  const originalCharCount = params.transcript?.length ?? 0;
  const hasTranscript = !!params.transcript && params.transcript.trim().length > 0;
  const warnings: string[] = [];
  let aiSentCharCount = 0;

  // ===== Step 1：決定的パーサを試す（純粋関数・トークン消費ゼロ） =====
  const detQuarterly = hasTranscript ? parseKintoneQuarterlyText(params.transcript) : null;
  const detMonthly = hasTranscript ? parseKintoneMonthlyText(params.transcript) : null;
  const detDocTypeHint = hasTranscript ? detectKintoneDocType(params.transcript) : null;

  let quarterly: PersonalOkrImportAnalysis | null = null;
  let quarterlySource: KintoneImportEngineSource = "ai";
  if (detQuarterly?.confidence.ok) {
    quarterly = detQuarterly.analysis;
    quarterlySource = "deterministic";
  }

  // 文書種別が分かっているか（決定的パーサが成功していればその判定結果、失敗時はタイトル検出の
  // ヒント）。"quarterly"と確定していれば月次は最初から不要（既存の最適化と同じ考え方）。
  const knownDocType: PersonalOkrDocType | null =
    quarterlySource === "deterministic" ? quarterly!.detected_doc_type : detDocTypeHint;
  const monthlyMightBeNeeded = knownDocType !== "quarterly";

  let monthly: PersonalOkrImportMonthlyAnalysis | null = null;
  let monthlySource: KintoneImportEngineSource = "none";
  if (monthlyMightBeNeeded && detMonthly?.confidence.ok) {
    monthly = detMonthly.analysis;
    monthlySource = "deterministic";
  }

  const needQuarterlyAi = quarterlySource === "ai";
  const needMonthlyAi = monthlyMightBeNeeded && monthlySource === "none";

  // ===== Step 2：両方とも決定的パーサで完了した場合はAIを一切呼ばない ===== //
  if (!needQuarterlyAi && !needMonthlyAi) {
    onProgress?.({ current: 1, total: 1, label: "抽出結果をまとめています" });
    return {
      ...mergePersonalOkrImportResults(quarterly, monthly),
      warnings, quarterlySource, monthlySource, aiSentCharCount, originalCharCount,
    };
  }

  // ===== Step 3：AIに渡す本文を削る（決定的パーサの成否とは無関係。送信量だけを減らす） ===== //
  const trimmed = hasTranscript ? trimKintoneImportText(params.transcript) : null;
  const textForAi = trimmed ? trimmed.trimmedText : params.transcript;
  const aiParams: ExtractPersonalOkrImportParams = { transcript: textForAi, attachment: params.attachment };

  // ===== Step 4：両方AIが必要で、かつ十分小さければ1回にまとめる ===== //
  if (needQuarterlyAi && needMonthlyAi && hasTranscript && textForAi.length <= PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS) {
    onProgress?.({ current: 0, total: 1, label: "個人KR・月次計画をまとめて抽出中" });
    try {
      const combined = await extractPersonalOkrCombinedData(aiParams);
      aiSentCharCount += textForAi.length;
      onProgress?.({ current: 1, total: 1, label: "抽出結果をまとめています" });
      return {
        ...combined,
        warnings, quarterlySource: "ai", monthlySource: "ai", aiSentCharCount, originalCharCount,
      };
    } catch (e) {
      // まとめ呼び出しが失敗した場合は、実績のある分割呼び出し（Step 5）へ確実にフォールバック
      // する（1回にまとめたこと自体が原因の失敗〔546等〕を、安全な経路でリトライする安全弁）。
      warnings.push(`まとめて抽出する呼び出しに失敗したため分割して再試行しました：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ===== Step 5：従来どおりの分割呼び出し（片方は決定的パーサ済みならスキップする） ===== //
  let quarterlyError: string | null = null;
  if (needQuarterlyAi) {
    onProgress?.({ current: 0, total: 2, label: "1/2 個人KRを抽出中" });
    try {
      quarterly = await extractPersonalOkrQuarterlyData(aiParams);
      aiSentCharCount += textForAi?.length ?? 0;
      quarterlySource = "ai";
    } catch (e) {
      quarterlyError = e instanceof Error ? e.message : String(e);
    }
  }

  // 呼び出し1(AI)がquarterlyと判定したら月次は不要（既存の最適化）。呼び出し1自体が失敗
  // した場合や決定的パーサ・タイトル検出のいずれからも種別が分からなかった場合は、
  // 保険的に月次も試みる（元の実装の「片方成功すれば見せられる状態にする」方針と同じ）。
  const stillNeedMonthlyAi =
    monthlySource === "none" && (quarterly === null || quarterly.detected_doc_type === "monthly_review");

  let monthlyError: string | null = null;
  if (stillNeedMonthlyAi) {
    onProgress?.({
      current: needQuarterlyAi ? 1 : 0,
      total: needQuarterlyAi ? 2 : 1,
      label: needQuarterlyAi ? "2/2 月次計画を抽出中" : "月次計画を抽出中",
    });
    try {
      monthly = await extractPersonalOkrMonthlyData(aiParams);
      aiSentCharCount += textForAi?.length ?? 0;
      monthlySource = "ai";
    } catch (e) {
      monthlyError = e instanceof Error ? e.message : String(e);
    }
    onProgress?.({ current: needQuarterlyAi ? 2 : 1, total: needQuarterlyAi ? 2 : 1, label: "抽出結果をまとめています" });
  } else {
    onProgress?.({ current: 1, total: 1, label: "抽出結果をまとめています" });
  }

  if (quarterly === null && monthly === null) {
    throw new Error(quarterlyError ?? monthlyError ?? "AI解析に失敗しました。");
  }

  if (quarterlyError) warnings.push(`個人KRの抽出に失敗しました：${quarterlyError}`);
  if (stillNeedMonthlyAi && monthlyError) warnings.push(`月次計画・振り返りの抽出に失敗しました：${monthlyError}`);

  return {
    ...mergePersonalOkrImportResults(quarterly, monthly),
    warnings, quarterlySource, monthlySource, aiSentCharCount, originalCharCount,
  };
}

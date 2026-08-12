// src/lib/personalOkr/importTextTrim.ts
//
// 【設計意図（v3.56・トークン削減その2）】
// AIにフォールバックする場合でも、personalOkrImportExtractor.ts の SYSTEM_PROMPT が
// 「抽出しないもの」（EXCLUDE_NOTES）として明示している領域は、そもそもAIも使っていない
// 内容である。これを送信前に機械的に削ることで、抽出精度に影響を与えずに入力トークンだけを
// 減らす（削る対象はSYSTEM_PROMPTが既に「使わない」と言っている項目の裏返しであり、新しい
// 判断基準を作らない）。
//
// 【安全側に倒す】
// 境界が曖昧な削り方（本文中の任意の「●」「▼」等で区切る等）はしない。見出し文字列そのものが
// 明確で、次の既知セクション境界（次のKR見出し・備考・付録見出し等）まで、または文末までを
// 削る範囲とする。迷うものは削らない（削りすぎない）。
//
// 【純粋関数のみ】pdfjs等に依存しない。vitestのnode環境で直接テストできる。

const SUMMARY_SECTION_HEADINGS = ["個人OKR月次評価（達成度）", "個人OKR 四半期評価（達成度）"];
const APPENDIX_HEADINGS_TO_TAIL = ["役割等級要件", "面談参考資料"];
const LIMITED_KR_HEADING_RE = /【\d{1,2}月限定KR】/;

// 削る範囲の終端を決めるための「次のセクションの始まり」マーカー。見出し語のみを対象にし、
// 本文中に現れやすい「●」「▼」等の本文ラベルは対象にしない（本文を誤って区切ってしまう
// リスクを避ける・安全側）。
const NEXT_SECTION_BOUNDARY_RE =
  /(個人KR_[1-8](?!_)|備考|役割等級要件|面談参考資料|個人OKR月次評価（達成度）|個人OKR\s*四半期評価（達成度）|【\d{1,2}月限定KR】)/;

/** 見出しから「次の既知セクション境界」または文末までを削る。見つからなければ何もしない。 */
function cutSectionFromHeadingToBoundary(text: string, headingIndex: number, headingLength: number): string {
  const rest = text.slice(headingIndex + headingLength);
  const boundary = NEXT_SECTION_BOUNDARY_RE.exec(rest);
  const cutEnd = boundary ? headingIndex + headingLength + boundary.index : text.length;
  return text.slice(0, headingIndex) + text.slice(cutEnd);
}

export interface KintoneTextTrimResult {
  trimmedText: string;
  originalCharCount: number;
  trimmedCharCount: number;
  /** 削除できたセクションの件数（診断用。何も削れなければ0）。 */
  removedSectionCount: number;
}

/**
 * AIに送信する直前にだけ適用する（決定的パーサ自体は元のテキストで動く。トリムは
 * 送信量を減らすためだけの前処理）。
 */
export function trimKintoneImportText(text: string): KintoneTextTrimResult {
  let result = text;
  let removedSectionCount = 0;

  // 1) 巻末の付録セクション（見出しから丸ごと末尾まで落とす。境界が最も明確で安全）
  for (const heading of APPENDIX_HEADINGS_TO_TAIL) {
    const idx = result.indexOf(heading);
    if (idx >= 0) {
      result = result.slice(0, idx);
      removedSectionCount++;
    }
  }

  // 2) 個人単位の合計値サマリーセクション（KR単位に紐づかないため抽出対象外）
  for (const heading of SUMMARY_SECTION_HEADINGS) {
    const idx = result.indexOf(heading);
    if (idx < 0) continue;
    result = cutSectionFromHeadingToBoundary(result, idx, heading.length);
    removedSectionCount++;
  }

  // 3) 【N月限定KR】の一時的なKRブロック（末尾から処理してindexのズレを避ける）
  const limitedMatches: RegExpExecArray[] = [];
  {
    const re = new RegExp(LIMITED_KR_HEADING_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(result)) !== null) limitedMatches.push(m);
  }
  for (const match of limitedMatches.reverse()) {
    result = cutSectionFromHeadingToBoundary(result, match.index, match[0].length);
    removedSectionCount++;
  }

  const trimmedText = result.trim();
  return {
    trimmedText,
    originalCharCount: text.length,
    trimmedCharCount: trimmedText.length,
    removedSectionCount,
  };
}

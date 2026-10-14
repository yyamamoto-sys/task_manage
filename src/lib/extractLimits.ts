// src/lib/extractLimits.ts
//
// 【設計意図・v3.145】
// 資料の抽出（Word/Excel/PowerPoint/テキスト）で共通に使う上限と小さな純関数。fflate に依存しない軽い
// ファイル。ooxmlCommon.ts（fflate を使う）から分けてあるのは、添付の受付判定側（起動時のバンドルに入る
// consultationAttachmentLoader.ts）が上限の値だけを使うために fflate を道連れにしないため（Section 19）。

/** 1回の相談で送る合計（30,000字）に余裕を足した、抽出の打ち切り文字数。 */
export const EXTRACT_CHAR_CAP = 35000;

/** 読み込みの負荷上限を超えたことを表す（利用者へそのまま見せてよい文言を持つ）。 */
export class OfficeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeLimitError";
  }
}

/** 文字列を n 文字（UTF-16単位）までで切る。サロゲートペアの途中では切らない。 */
export function truncateSafely(s: string, n: number): string {
  if (s.length <= n) return s;
  let end = n;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

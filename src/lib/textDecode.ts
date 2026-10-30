// src/lib/textDecode.ts
//
// 【設計意図・v3.145】
// テキストファイル（.txt/.csv 等）の先頭の一部を文字列にする。Excel が書き出す CSV は Shift_JIS が多く、
// UTF-8 として読むと文字化け（U+FFFD）になるため、化けた割合が高いときは Shift_JIS で読み直す。
// ブラウザ・Node のどちらでも動く純関数（DOM 非依存）。

/** UTF-8 として読んで U+FFFD が占める割合がこれを超えたら Shift_JIS を試す。 */
export const REPLACEMENT_RATIO_THRESHOLD = 0.01;

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++;
  return n;
}

/**
 * bytes を文字列にする。truncated が true のときは、末尾が文字の途中で切れているものとして
 * 不完全な末尾のバイトを捨てる。
 */
export function decodeTextBytes(bytes: Uint8Array, truncated: boolean): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(bytes, { stream: truncated });
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(bytes, { stream: truncated });
    }
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes, { stream: truncated });
  const bad = countReplacement(utf8);
  if (bad === 0 || bad / Math.max(utf8.length, 1) <= REPLACEMENT_RATIO_THRESHOLD) return utf8;
  try {
    const sjis = new TextDecoder("shift_jis").decode(bytes, { stream: truncated });
    return countReplacement(sjis) < bad ? sjis : utf8;
  } catch {
    return utf8;
  }
}

/**
 * 取り込み用（WBS の CSV 等）：UTF-8（BOM 有無）として厳密に読めなければ Shift_JIS で読み直す。
 * decodeTextBytes は「化けた割合が1%以下なら UTF-8 のまま」とする近似で、先頭の一部を読む用途向け。
 * こちらは全文を読むため、1文字でも UTF-8 として不正なら Shift_JIS（Excel・Redmine 日本語環境の CSV）とみなす。
 */
export function decodeTextBytesStrict(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

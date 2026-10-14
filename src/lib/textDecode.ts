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

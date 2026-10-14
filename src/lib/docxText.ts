// src/lib/docxText.ts
//
// 【設計意図】
// Word (.docx) ファイルから本文テキストを抽出する。Anthropic API は .docx を直接読めない（PDFは読める）ため、
// クライアント側でテキスト化してから AI に渡す。.docx は zip で、本文は word/document.xml。
// 段落（<w:p>）ごとに改行、テキスト断片（<w:t>）を連結、<w:br>/<w:tab> も反映する簡易抽出。
// 表組み等は罫線情報を捨ててセル内テキストだけ拾う（会議メモ用途には十分）。
// v3.145：zip の展開サイズ・件数に上限を設け、走査は線形（ooxmlCommon.ts）。取り出した文字が
// maxChars に達したらそこで打ち切る。

import {
  decodeXmlEntities, unzipEntries, decodeUtf8, forEachElement, collectText, truncateSafely, EXTRACT_CHAR_CAP,
} from "./ooxmlCommon";

export { isDocxFile } from "./officeFileKind";

const NOT_DOCX_MESSAGE = "Wordファイル（.docx）として読み取れませんでした。古い .doc 形式は非対応です。";

/** .docx のバイト列から本文テキストを抽出する。失敗時は例外を投げる。 */
export function extractDocxTextFromBytes(buf: Uint8Array, maxChars: number = EXTRACT_CHAR_CAP): string {
  const entries = unzipEntries(buf, n => n === "word/document.xml", NOT_DOCX_MESSAGE);
  const docXml = entries["word/document.xml"];
  if (!docXml) throw new Error("Wordファイルの本文（document.xml）が見つかりませんでした。");
  const xml = decodeUtf8(docXml);

  // 段落単位（<w:p>）。表のセルも <w:p> を含むので拾える。
  const lines: string[] = [];
  let total = 0;
  forEachElement(xml, "w:p", (_attrs, inner) => {
    const raw = collectText(inner, {
      textTag: "w:t",
      breaks: { "w:tab": "\t", "w:br": "\n", "w:cr": "\n" },
      maxChars,
    });
    const text = decodeXmlEntities(raw);
    for (const sub of text.split("\n")) lines.push(sub);
    total += text.length + 1;
    return total <= maxChars * 2;
  });
  // 連続する空行を1つにまとめてトリム
  const joined = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return truncateSafely(joined, maxChars);
}

/** .docx の File から本文テキストを抽出する。失敗時は例外を投げる。 */
export async function extractDocxText(file: File, maxChars: number = EXTRACT_CHAR_CAP): Promise<string> {
  return extractDocxTextFromBytes(new Uint8Array(await file.arrayBuffer()), maxChars);
}

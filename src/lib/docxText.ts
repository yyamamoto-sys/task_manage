// src/lib/docxText.ts
//
// 【設計意図】
// Word (.docx) ファイルから本文テキストを抽出する。Anthropic API は .docx を直接読めない（PDFは読める）ため、
// クライアント側でテキスト化してから AI に渡す。.docx は zip で、本文は word/document.xml。
// 段落（<w:p>）ごとに改行、テキスト断片（<w:t>）を連結、<w:br>/<w:tab> も反映する簡易抽出。
// 表組み等は罫線情報を捨ててセル内テキストだけ拾う（会議メモ用途には十分）。

import { unzipSync } from "fflate";

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** .docx の File から本文テキストを抽出する。失敗時は例外を投げる。 */
export async function extractDocxText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf);
  } catch {
    throw new Error("Wordファイル（.docx）として読み取れませんでした。古い .doc 形式は非対応です。");
  }
  const docXml = entries["word/document.xml"];
  if (!docXml) throw new Error("Wordファイルの本文（document.xml）が見つかりませんでした。");
  const xml = new TextDecoder("utf-8").decode(docXml);

  // 段落単位に分割（</w:p> の直前までが1段落）。表のセルも <w:p> を含むので拾える。
  const paragraphs = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    // <w:tab/> → タブ、<w:br/> / <w:cr/> → 改行
    const withBreaks = p.replace(/<w:tab\b[^>]*\/?>/g, "\t").replace(/<w:(?:br|cr)\b[^>]*\/?>/g, "\n");
    // <w:t ...>text</w:t> の中身を順に連結（属性 xml:space="preserve" 等は無視）
    const runs = [...withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]);
    const text = decodeXmlEntities(runs.join(""));
    if (text.includes("\n")) {
      // セル内に強制改行があった場合
      for (const sub of text.split("\n")) lines.push(sub);
    } else {
      lines.push(text);
    }
  }
  // 連続する空行を1つにまとめてトリム
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** ファイルが .docx かどうか（MIMEタイプ or 拡張子で判定）。 */
export function isDocxFile(file: File): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return (file.name.split(".").pop()?.toLowerCase() ?? "") === "docx";
}

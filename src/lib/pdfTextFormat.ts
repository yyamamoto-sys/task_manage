// src/lib/pdfTextFormat.ts
//
// 【設計意図】
// src/lib/pdfText.ts のうち、pdfjs-dist（ブラウザ専用ビルド。Node環境で単にimportする
// だけで `DOMMatrix is not defined` で例外になる）に依存しない純粋な部分だけをここに
// 分離する。vitest.config.ts の environment は "node"（chunkSizeGate.tsと同じ制約）のため、
// pdfjs-dist をトップレベルimportしているモジュールをテストファイルからimportすると
// その時点で落ちる。テキスト整形・空判定・拡張子判定はpdfjs-distを一切使わないので、
// ここに置くことでpdfText.ts全体をロードせずにテストできる。

/** ファイルが .pdf かどうか（MIMEタイプ or 拡張子で判定）。docxText.ts/htmlText.tsと同じ形。 */
export function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return (file.name.split(".").pop()?.toLowerCase() ?? "") === "pdf";
}

/** 抽出結果が実質空（文字を1つも含まない）かどうか。スキャン画像のみのPDF等の判定に使う。 */
export function isBlankExtractedText(text: string): boolean {
  return text.trim().length === 0;
}

/** 抽出結果が空だったときにユーザーへ示す案内文。 */
export const PDF_EMPTY_TEXT_MESSAGE =
  "このPDFからは文字を読み取れませんでした。テキストを貼り付けてお試しください。";

interface PdfTextItemLike {
  str: string;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return !!item && typeof item === "object" && "str" in item;
}

/**
 * 1ページ分のTextItem配列を本文テキストへ変換する。同じ行内の断片はスペースで連結し、
 * hasEOL（行末）で改行する。PDFの文字コード配置は列レイアウトを保持しないため、表組みの
 * 列がずれる可能性がある（呼び出し元・AIプロンプト側で「テキスト入力前提」に読ませる想定）。
 */
export function pageItemsToText(items: unknown[]): string {
  const lines: string[] = [];
  let current: string[] = [];
  for (const item of items) {
    if (!isTextItem(item)) continue;
    if (item.str) current.push(item.str);
    if (item.hasEOL) {
      lines.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) lines.push(current.join(" "));
  return lines.join("\n");
}

/**
 * 連続空白を1つに、各行をトリム、3行以上の空行を2行に圧縮する（htmlText.tsのnormalizeTextと
 * 同じ方針。全角スペース(U+3000)・NBSP(U+00A0)は文字コードでエスケープし、ソースコード中に
 * 生の不可視文字を書かない＝no-irregular-whitespaceの検出対象にしない）。
 */
export function normalizePdfText(text: string): string {
  return text
    .replace(/[ \t\u3000\u00A0]+/g, " ")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

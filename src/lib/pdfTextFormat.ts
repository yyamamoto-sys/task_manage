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

/**
 * 【v3.79・base64フォールバックのサイズ上限（統括レビューで追加）】
 * base64直送そのものが546 WORKER_RESOURCE_LIMITの原因だった実績（670KBのPDF→約894KB。
 * CLAUDE.md Section 19 ⑦）があるため、フォールバック先のbase64直送にも歯止めが要る。
 * 歯止めが無いと「テキスト層の無いPDFを添付→抽出失敗→大きいままbase64直送→546で原因不明の
 * 失敗」という、直しているはずが後退した状態になる（旧FileAttachButton.tsxのalertは
 * 「読み取れませんでした」という分かりやすい失敗だった。それを分かりにくい546に置き換えては
 * いけない）。
 *
 * 【閾値の根拠】670KBは「実際に落ちた値」であり「安全な上限」ではないため、その値自体を
 * 閾値にはしない。670KBの実に3割弱（十分な安全マージン）にあたる200KB（204800バイト）を
 * 閾値とする。670KBはPDF単体のサイズで、base64化すると約1.34倍（894KB）に膨らむ実績と、
 * Edge Function側にはこの他にもプロンプト本文・システムプロンプト等が同時に載ることを踏まえ、
 * 余裕を持って低めに倒した。
 */
export const PDF_BASE64_FALLBACK_MAX_BYTES = 200 * 1024; // 200KB

/** サイズの歯止めに引っかかったときにユーザーへ示す案内文（次に何をすればよいかが分かる形）。 */
export const PDF_TOO_LARGE_MESSAGE =
  "このPDFは文字を読み取れず、かつサイズが大きいため読み込めませんでした。" +
  "文字を選択できる状態で保存し直すか、内容をコピーしてテキスト欄に貼り付けてお試しください。";

/**
 * 【v3.79・PDF取込のクライアント側テキスト抽出フォールバック判定（純粋関数）】
 * PDFのテキスト抽出結果を実際にAIへ送るテキスト添付として使うか、従来のbase64直送
 * （PDFをdocumentブロックとしてそのままAIに読ませる経路）にフォールバックするか、
 * それとも（base64直送すら546の危険域に入るほど大きいため）読み込みを諦めるかを判定する。
 *
 * 抽出結果を使わずbase64にフォールバックする条件（CLAUDE.md Section 27・28・v3.79）：
 * - 抽出自体が例外を投げた場合（呼び出し側が catch した結果を `null` として渡す）
 * - 抽出はできたが結果が空文字・空白/改行のみの場合（スキャン画像のみのPDF等。テキスト層が
 *   無い将来のキャプチャ由来PDFを想定した安全網。isBlankExtractedTextをそのまま再利用する）
 *
 * ただし上記に該当してもファイルサイズが`PDF_BASE64_FALLBACK_MAX_BYTES`を超える場合は
 * `"too-large"`を返し、base64直送はしない（546を「分かりにくい失敗」として踏むより、
 * 「次に何をすればよいか」が分かる明示的な失敗にする）。抽出に成功した（テキストが使える）
 * 場合はサイズを問わず`"text"`——base64を一切送らないため546のリスク自体が無い。
 *
 * 山本さんに確認済みの前提は「取り込むPDFはブラウザの印刷機能で作られるためテキスト層が残る」
 * だが、将来キャプチャ由来のPDF（テキスト層なし）が混ざる可能性を潰すため、後退リスクを
 * ゼロにする安全網としてこの判定を挟む（Kintone取込の「決定的パーサ→AIフォールバック」
 * ＝Section 24 Step Kと同じ考え方）。
 */
export function resolvePdfFallbackSource(
  extractedText: string | null,
  fileSizeBytes: number,
): "text" | "base64" | "too-large" {
  if (extractedText !== null && !isBlankExtractedText(extractedText)) return "text";
  return fileSizeBytes > PDF_BASE64_FALLBACK_MAX_BYTES ? "too-large" : "base64";
}

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

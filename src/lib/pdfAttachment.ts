// src/lib/pdfAttachment.ts
//
// 【設計意図・v3.79】
// PDFをAIに添付するための「唯一の入口」。クライアント側でテキスト抽出し（pdfText.ts・
// Section 19 ⑦）、抽出結果が使えない場合だけ従来のbase64直送（documentブロック）に自動で
// フォールバックする。判定自体はpdfTextFormat.tsの純粋関数resolvePdfFallbackSourceに切り
// 出してあり、このファイルは「pdfjs-distでの抽出実行」「失敗時のbase64読み込み」という
// 副作用だけを担う。
//
// フォールバックを残す理由（CLAUDE.md Section 27・28参照）：取り込むPDFはブラウザの印刷
// 機能で作られる想定でテキスト層が残るが、将来キャプチャ由来のPDF（テキスト層なし）が
// 混ざる可能性がある。フォールバックを入れておけば後退のリスクをゼロにできる
// （Kintone取込の「決定的パーサ→AIフォールバック」＝Section 24 Step Kと同じ考え方）。
//
// フォールバックが発動したことは利用者に知らせない（黙って従来経路に落ちればよい）。
// 開発者が後から追えるようconsole.warnにだけ1行残す（i18n.ts等と同じ「[tag] ...」書式）。
// 抽出できた場合・フォールバックした場合のどちらでも、AIに渡る情報の意味は変わらない
// （buildMessageContent（invokeAI.ts）がisTextフラグを見て、テキスト添付ならプレーンテキスト
// として本文に追記し、base64添付ならdocumentブロックとして同梱する。呼び出し側の
// プロンプト構築コードは一切分岐不要）。
//
// pdfjs-dist（重量級・ブラウザ専用ビルド）はこのファイル内の関数本体からのみ動的import
// する。呼び出し側（FileAttachButton.tsx等）がこのモジュール自体を静的importしても、
// pdfjs-distのダウンロードは実際にPDFを処理するまで発生しない（CLAUDE.md Section 19：
// PDFを一度も添付しない人はこのチャンクをダウンロードしない）。

import type { FileAttachment } from "./ai/invokeAI";
import { resolvePdfFallbackSource, PDF_TOO_LARGE_MESSAGE } from "./pdfTextFormat";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = (reader.result as string) ?? "";
      const base64 = dataUrl.split(",")[1] ?? "";
      if (!base64) {
        reject(new Error("PDFの読み込みに失敗しました。"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("PDFの読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

/**
 * PDFファイルからAI添付用のFileAttachmentを組み立てる。
 * 1. クライアント側でテキスト抽出を試みる（pdfjs-dist・動的import）
 * 2. 抽出できれば isText:true のテキスト添付を返す（サイズを問わずbase64を一切送らない
 *    ため546のリスク自体が無い）
 * 3. 抽出結果が空、または抽出自体が例外を投げた場合は、ファイルサイズが
 *    `PDF_BASE64_FALLBACK_MAX_BYTES`以下なら黙って従来のbase64直送（isText:false・
 *    documentブロック）にフォールバックする
 * 4. 3の条件を満たしても、ファイルサイズが閾値を超える場合はbase64直送をせず、
 *    利用者に分かる形（`PDF_TOO_LARGE_MESSAGE`）で失敗させる（546を「原因不明の失敗」として
 *    踏むより、次に何をすればよいかが分かる明示的な失敗にする。v3.79・統括レビューで追加）
 *
 * base64読み込み自体が失敗した場合（FileReaderの読み込み失敗等）も例外を投げる
 * （これは呼び出し側がユーザーに見せるべき本当の失敗）。
 *
 * 3・4の判定（フォールバックか・too-largeか）は7画面（FileAttachButton.tsx経由の5画面＋
 * OkrImportModal.tsx／MeetingImportPanel.tsx）全てがこの関数を唯一の入口として共有するため、
 * 挙動が画面ごとにばらつくことはない（CLAUDE.md Section 37）。
 */
export async function buildPdfAttachment(file: File): Promise<FileAttachment> {
  let extractedText: string | null;
  try {
    const { extractPdfText } = await import("./pdfText");
    extractedText = await extractPdfText(file);
  } catch (e) {
    extractedText = null;
    console.warn(
      `[pdfAttachment] "${file.name}" のテキスト抽出に失敗しました: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const source = resolvePdfFallbackSource(extractedText, file.size);

  if (source === "text" && extractedText !== null) {
    return { fileName: file.name, mediaType: "text/plain", data: extractedText, isText: true };
  }

  if (source === "too-large") {
    console.warn(
      `[pdfAttachment] "${file.name}"（${file.size}バイト）はテキスト抽出に失敗し、` +
        `かつbase64直送の閾値を超えているため読み込みを中止します。`,
    );
    throw new Error(PDF_TOO_LARGE_MESSAGE);
  }

  const base64 = await readFileAsBase64(file);
  return { fileName: file.name, mediaType: "application/pdf", data: base64, isText: false };
}

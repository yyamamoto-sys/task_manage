// src/lib/pdfText.ts
//
// 【設計意図】
// PDF (.pdf) から本文テキストを抽出する。Anthropic APIはPDFをdocumentブロックで直接
// 読めるが、base64エンコードした添付をSupabase Edge Functionへ送るとペイロードが肥大化し
// （670KBのPDF→約894KB。req.json()でのパース＋JSON.stringifyでの再構築で複数コピーが
// メモリに載る）、ワーカーがリソース上限で落ちる事故が実際に起きた
// （546 WORKER_RESOURCE_LIMIT・2026-08-10。CLAUDE.md Section 19参照）。
// docxText.ts / htmlText.ts と同じ方針で、クライアント側でテキスト抽出してから軽量な
// テキスト添付として渡す（Supabaseは関数ごとにリソース上限を上げられないため、送る側を
// 軽くするのが唯一の解）。
//
// 【純粋なテキスト整形・空判定はpdfTextFormat.tsに分離】
// pdfjs-dist はブラウザ専用ビルドで、Node環境（vitestのenvironment:"node"）で単に
// importするだけで `DOMMatrix is not defined` になる。テキスト整形・空判定・拡張子判定は
// pdfjs-distを使わない純粋関数のため src/lib/pdfTextFormat.ts に分離し、そちらを
// このファイルが再エクスポートする（呼び出し元はpdfText.tsから import すればよい。
// テストだけpdfTextFormat.tsを直接importしてpdfjs-dist本体の読み込みを避ける）。
//
// 【セキュリティ（山本さんの承認条件・必ず全部守ること）】
// 1. isEvalSupported:false を明示指定する。pdfjs-distはPDF内の埋め込みJSを評価できる機能を
//    持ち、これが過去のCVE-2024-4367（サンドボックス脱出）の根本原因だった。テキスト抽出だけ
//    が目的でこの機能は不要なため、明示的に無効化する（下記「検証結果」コメント参照）。
// 2. worker・cmap・標準フォントは全てローカルにバンドルし、CDN（unpkg / mozilla.github.io等）
//    への外部リクエストを一切発生させない。workerは `?url` importでVite管理下の同一originの
//    静的アセットとして解決する（pdf.mjs内部が `new Worker(workerSrc, {type:"module"})` で
//    生成するため、same-originであることが重要）。cmap/標準フォントはvite.config.tsの
//    ensurePdfjsAssets()がnode_modulesからpublic/pdfjs/へコピーし、同一originで配信する
//    （pdfjs-dist自体にCDNフォールバックは無く、未設定時は例外を投げるだけなので、
//    ローカルURLを明示すること自体が「未設定→謎の挙動」を防ぐ意味も持つ）。
// 3. バージョンはpackage.jsonでキャレット無しの固定バージョンにする（package.json参照）。
//
// 【DL最小化（CLAUDE.md Section 19）】
// pdfjs-distは大きいライブラリのため、このモジュール自体をFileAttachButton.tsx側から
// 動的importする設計にしている（PDFを一度も添付しない人はこのチャンクを一切ダウンロード
// しない）。このファイル内で `import * as pdfjsLib from "pdfjs-dist"` を静的に書いても、
// 呼び出し元がこのモジュール自体を動的importする限り問題ない。

import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
// Viteの明示URLインポート（`?url`）。vite/client型（src/vite-env.d.ts経由）でdefault=string宣言済み。
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { isBlankExtractedText, normalizePdfText, pageItemsToText, PDF_EMPTY_TEXT_MESSAGE, isPdfFile } from "./pdfTextFormat";

export { isPdfFile, isBlankExtractedText, normalizePdfText, pageItemsToText, PDF_EMPTY_TEXT_MESSAGE };

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// 【セキュリティ対処1の検証結果・2026-08-10】
// isEvalSupported（CVE-2024-4367の原因だった、PDF内のPostScript関数をeval/Functionコンストラクタで
// コンパイルする経路を制御するオプション）は、固定した pdfjs-dist 6.2.108 では型定義
// （DocumentInitParameters）にも存在せず、pdf.mjs・pdf.worker.mjs をgrepしても
// `eval(` / `new Function(` が1件も出現しない（＝危険なeval経路自体がライブラリから削除されて
// おり、フラグで塞ぐ対象が無い。フラグより強い「経路の撤去」で解決済み）。将来 pdfjs-dist を
// アップグレードしてこの経路が復活した場合に備え、型を拡張して明示的に false を渡しておく
// （現バージョンでは実行時に何も読まれない防御的な指定）。
type GetDocumentParamsWithEvalFlag = Parameters<typeof pdfjsLib.getDocument>[0] & {
  isEvalSupported?: boolean;
};

/**
 * .pdf の File から本文テキストを抽出する。抽出結果が空（スキャン画像のみ等）の場合は
 * PDF_EMPTY_TEXT_MESSAGE を例外として投げる。パース自体に失敗した場合も例外を投げる。
 */
export async function extractPdfText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());

  const params: GetDocumentParamsWithEvalFlag = {
    data: buf,
    isEvalSupported: false,
    // セキュリティ対処2：cmap・標準フォントをローカル（同一origin）から読む
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  };
  // destroy()はPDFDocumentProxyではなくPDFDocumentLoadingTask（getDocument()の戻り値）側の
  // メソッドのため、loadingTaskの参照をfinallyまで保持する。
  const loadingTask = pdfjsLib.getDocument(params);

  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch {
    throw new Error("PDFファイルとして読み取れませんでした。");
  }

  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(pageItemsToText(content.items));
    }
    const text = normalizePdfText(pageTexts.join("\n\n"));
    if (isBlankExtractedText(text)) throw new Error(PDF_EMPTY_TEXT_MESSAGE);
    return text;
  } finally {
    await loadingTask.destroy();
  }
}

// src/lib/fileAttachMediaType.ts
//
// 【設計意図】
// FileAttachButton.tsx のファイル種別判定ロジック（.docx/.html/.pdfはそれぞれ専用の抽出処理
// （docxText.ts/htmlText.ts/pdfText.ts）へ早期returnし、それ以外だけがここに到達する）の
// うち、拡張子からのMIMEタイプ推定・対応形式判定を純粋関数として切り出す。
// FileAttachButton.tsx自体（.tsx・React部品）には既存テストが無かったため、判定ロジックを
// ここに分離してテストできるようにする（CLAUDE.md指示どおり）。

/** テキストとして扱う添付のMIMEタイプ一覧（.txt/.md/.csv/.html。.docxは専用抽出のためここに含めない）。 */
export const TEXT_MEDIA_TYPES = ["text/plain", "text/markdown", "text/csv", "text/html"];
/** 画像として扱う添付のMIMEタイプ一覧。 */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * MIMEタイプ未設定のファイルに対し、拡張子からMIMEタイプを推定する。
 * .docx/.html/.pdf はこの表に含めない（それぞれ専用の抽出処理へ早期returnされ、
 * この関数に到達する前に処理が完了しているため。到達したら空文字を返す＝非対応扱い）。
 */
export function resolveMediaType(file: { type: string; name: string }): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown", csv: "text/csv", txt: "text/plain", html: "text/html",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif",
  };
  return map[ext] ?? "";
}

/** テキスト・画像のいずれかのMIMEタイプに一致するか（対応形式かどうか）。 */
export function isSupportedMediaType(mediaType: string): boolean {
  return TEXT_MEDIA_TYPES.includes(mediaType) || IMAGE_MEDIA_TYPES.includes(mediaType);
}

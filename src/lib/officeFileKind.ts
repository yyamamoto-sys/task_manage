// src/lib/officeFileKind.ts
//
// 【設計意図・v3.145】
// ファイルの種類の判定だけを置く軽いファイル。fflate などの抽出処理に依存しない。
// 判定のためだけに docxText.ts・xlsxText.ts 等を静的importすると、利用者が一度も添付しなくても
// 起動時のバンドルに抽出コード（fflate）が入ってしまう（CLAUDE.md Section 19）。
// 抽出本体は呼び出し側が必要になったときに動的importする。

export interface FileLike {
  type: string;
  name: string;
}

function extOf(file: FileLike): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function isDocxFile(file: FileLike): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return extOf(file) === "docx";
}

export function isXlsxFile(file: FileLike): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return true;
  return extOf(file) === "xlsx";
}

export function isPptxFile(file: FileLike): boolean {
  if (file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return true;
  return extOf(file) === "pptx";
}

export function isHtmlFile(file: FileLike): boolean {
  if (file.type === "text/html") return true;
  const ext = extOf(file);
  return ext === "html" || ext === "htm";
}

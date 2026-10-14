// src/lib/ai/consultationAttachmentLoader.ts
//
// 【設計意図・v3.144】
// AI相談の添付ファイルの受付判定と読み込み（Word/Excel/PowerPoint/PDF/HTML/テキストの抽出）。
// 抽出系（fflate・pdfjs）を静的importするため、apiClient 等から読み込まれる consultationAttachment.ts とは
// 分けてある（起動時のバンドルを膨らませない・Section 19）。ConsultationPanel からだけ使う。

import type { FileAttachment } from "./invokeAI";
import { isPdfPassthrough, MAX_CONSULT_PDF_BYTES } from "./consultationAttachment";
import { TEXT_MEDIA_TYPES, resolveMediaType } from "../fileAttachMediaType";
import { isDocxFile, extractDocxText } from "../docxText";
import { isHtmlFile, extractHtmlText } from "../htmlText";
import { isXlsxFile } from "../xlsxText";
import { isPptxFile } from "../pptxText";
import { isPdfFile } from "../pdfTextFormat";

export const CONSULT_ATTACHMENT_ACCEPT = ".docx,.xlsx,.pptx,.pdf,.html,.htm,.txt,.md,.csv";

const LEGACY_EXTENSIONS = ["doc", "xls", "ppt"];

export type ConsultFileCheck = { ok: true } | { ok: false; reason: string };

/** 添付できる形式か。画像・旧形式・未対応形式は理由つきで断る。 */
export function checkConsultAttachFile(file: { type: string; name: string }): ConsultFileCheck {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (LEGACY_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `${file.name}：旧形式（.${ext}）は読み取れません。Office で新しい形式（.docx／.xlsx／.pptx）に保存し直してから添付してください。`,
    };
  }
  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return {
      ok: false,
      reason: `${file.name}：AI相談には画像を添付できません（文字だけを送ってトークンを節約する仕組みのため）。画像の内容は文章にして入力してください。`,
    };
  }
  if (isDocxFile(file as File) || isXlsxFile(file) || isPptxFile(file) || isPdfFile(file as File) || isHtmlFile(file as File)) {
    return { ok: true };
  }
  if (TEXT_MEDIA_TYPES.includes(resolveMediaType(file))) return { ok: true };
  return {
    ok: false,
    reason: `${file.name}：この形式は添付できません。対応しているのは Word（.docx）・Excel（.xlsx）・PowerPoint（.pptx）・PDF・HTML・テキスト（.txt／.md／.csv）です。`,
  };
}

/** 追加できない理由。追加できるなら null（PDFのまま送る添付の合計サイズ制限）。 */
export function checkCanAddAttachment(existing: FileAttachment[], incoming: FileAttachment): string | null {
  if (!isPdfPassthrough(incoming)) return null;
  const bytesOf = (a: FileAttachment) => Math.floor((a.data.length * 3) / 4);
  const used = existing.filter(isPdfPassthrough).reduce((s, a) => s + bytesOf(a), 0);
  if (used + bytesOf(incoming) > MAX_CONSULT_PDF_BYTES) {
    return `${incoming.fileName}：文字を読み取れないPDFをそのまま送れる合計サイズ（200KB）を超えるため追加できません。文字を選択できる状態で保存し直すか、内容を文章にして入力してください。`;
  }
  return null;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`${file.name}：読み込みに失敗しました。`));
    reader.readAsText(file, "utf-8");
  });
}

/** ファイルを読んで添付に変換する。形式の可否は呼び出し側が checkConsultAttachFile で済ませておく。 */
export async function loadConsultAttachment(file: File): Promise<FileAttachment> {
  const asText = (text: string): FileAttachment => ({
    fileName: file.name, mediaType: "text/plain", data: text, isText: true,
  });
  if (isDocxFile(file)) return asText(await extractDocxText(file));
  if (isHtmlFile(file)) return asText(await extractHtmlText(file));
  if (isXlsxFile(file)) {
    const { extractXlsxText } = await import("../xlsxText");
    return asText(await extractXlsxText(file));
  }
  if (isPptxFile(file)) {
    const { extractPptxText } = await import("../pptxText");
    return asText(await extractPptxText(file));
  }
  if (isPdfFile(file)) {
    const { buildPdfAttachment } = await import("../pdfAttachment");
    return buildPdfAttachment(file);
  }
  return asText(await readAsText(file));
}

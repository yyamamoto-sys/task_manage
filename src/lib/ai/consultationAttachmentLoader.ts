// src/lib/ai/consultationAttachmentLoader.ts
//
// 【設計意図・v3.144】
// AI相談の添付ファイルの受付判定と読み込み（Word/Excel/PowerPoint/PDF/HTML/テキストの抽出）。
// apiClient 等から読み込まれる consultationAttachment.ts とは分けてある（Section 19）。
// 【v3.145】ファイルの種類の判定は fflate に依存しない officeFileKind.ts を使い、抽出本体
// （docx・html・xlsx・pptx・pdf）はすべて必要になったときに動的importする。これで添付しない利用者は
// 起動時に抽出コードをダウンロードしない。読み込みの負荷にも上限を持つ（ファイル容量・テキストは先頭から必要分だけ）。

import type { FileAttachment } from "./invokeAI";
import { isPdfPassthrough, MAX_CONSULT_PDF_BYTES } from "./consultationAttachment";
import { TEXT_MEDIA_TYPES, resolveMediaType } from "../fileAttachMediaType";
import { isDocxFile, isXlsxFile, isPptxFile, isHtmlFile } from "../officeFileKind";
import { isPdfFile } from "../pdfTextFormat";
import { decodeTextBytes } from "../textDecode";
import { EXTRACT_CHAR_CAP, truncateSafely } from "../extractLimits";

export const CONSULT_ATTACHMENT_ACCEPT = ".docx,.xlsx,.pptx,.pdf,.html,.htm,.txt,.md,.csv";

/** 1ファイルの容量の上限（バイト）。超えたら読まずに断る。 */
export const MAX_CONSULT_FILE_BYTES = 20 * 1024 * 1024;

/** テキストファイルから先頭に読むバイト数（UTF-8 は1文字最大4バイト。抽出の上限文字数ぶんを確保する）。 */
export const TEXT_READ_BYTES = EXTRACT_CHAR_CAP * 4;

/** HTMLから先頭に読むバイト数（タグが多く、本文は少ないため大きめに取る）。 */
export const HTML_READ_BYTES = 2 * 1024 * 1024;

const LEGACY_EXTENSIONS = ["doc", "xls", "ppt"];

export type ConsultFileCheck = { ok: true } | { ok: false; reason: string };

interface FileInfo {
  type: string;
  name: string;
  size?: number;
}

/** 添付できる形式・大きさか。画像・旧形式・未対応形式・大きすぎるファイルは理由つきで断る。 */
export function checkConsultAttachFile(file: FileInfo): ConsultFileCheck {
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
  const supported =
    isDocxFile(file) || isXlsxFile(file) || isPptxFile(file) || isPdfFile(file as File) || isHtmlFile(file) ||
    TEXT_MEDIA_TYPES.includes(resolveMediaType(file));
  if (!supported) {
    return {
      ok: false,
      reason: `${file.name}：この形式は添付できません。対応しているのは Word（.docx）・Excel（.xlsx）・PowerPoint（.pptx）・PDF・HTML・テキスト（.txt／.md／.csv）です。`,
    };
  }
  if (typeof file.size === "number" && file.size > MAX_CONSULT_FILE_BYTES) {
    return {
      ok: false,
      reason: `${file.name}：ファイルが大きすぎます（上限は${MAX_CONSULT_FILE_BYTES / 1024 / 1024}MB）。必要な部分だけを別のファイルに保存してから添付してください。`,
    };
  }
  return { ok: true };
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

/** 画面に出す補足を1つにまとめる。無ければ undefined。 */
export function joinNotes(notes: string[]): string | undefined {
  const filtered = notes.filter(n => n !== "");
  return filtered.length > 0 ? filtered.join("／") : undefined;
}

async function readHead(file: File, maxBytes: number): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const cut = file.size > maxBytes;
  const slice = cut ? file.slice(0, maxBytes) : file;
  return { bytes: new Uint8Array(await slice.arrayBuffer()), cut };
}

/** ファイルを読んで添付に変換する。形式・大きさの可否は呼び出し側が checkConsultAttachFile で済ませておく。 */
export async function loadConsultAttachment(file: File): Promise<FileAttachment> {
  const asText = (text: string, note?: string): FileAttachment => ({
    fileName: file.name, mediaType: "text/plain", data: text, isText: true, ...(note ? { note } : {}),
  });
  if (isDocxFile(file)) {
    const { extractDocxText } = await import("../docxText");
    const text = await extractDocxText(file);
    return asText(text, text.length >= EXTRACT_CHAR_CAP ? "大きい資料のため先頭だけを読みました" : undefined);
  }
  if (isXlsxFile(file)) {
    const { extractXlsxText } = await import("../xlsxText");
    const r = await extractXlsxText(file);
    return asText(r.text, joinNotes([
      r.skippedHiddenSheets > 0 ? `非表示のシート${r.skippedHiddenSheets}件は送りません` : "",
      r.truncated ? "大きい資料のため先頭だけを読みました" : "",
    ]));
  }
  if (isPptxFile(file)) {
    const { extractPptxText } = await import("../pptxText");
    const r = await extractPptxText(file);
    return asText(r.text, joinNotes([
      r.skippedHiddenSlides > 0 ? `非表示のスライド${r.skippedHiddenSlides}件は送りません` : "",
      r.truncated ? "大きい資料のため先頭だけを読みました" : "",
    ]));
  }
  if (isPdfFile(file)) {
    const { buildPdfAttachment } = await import("../pdfAttachment");
    return await buildPdfAttachment(file);
  }
  if (isHtmlFile(file)) {
    const { htmlStringToText } = await import("../htmlText");
    const { bytes, cut } = await readHead(file, HTML_READ_BYTES);
    const text = htmlStringToText(decodeTextBytes(bytes, cut));
    const capped = truncateSafely(text, EXTRACT_CHAR_CAP);
    return asText(capped, cut || capped.length < text.length ? "大きい資料のため先頭だけを読みました" : undefined);
  }
  const { bytes, cut } = await readHead(file, TEXT_READ_BYTES);
  const text = decodeTextBytes(bytes, cut);
  const capped = truncateSafely(text, EXTRACT_CHAR_CAP);
  return asText(capped, cut || capped.length < text.length ? "大きい資料のため先頭だけを読みました" : undefined);
}

// src/lib/wbsImport/wbsFileLoader.ts
//
// 【設計意図・v3.189】
// 選ばれたファイル（.xlsx／.md）を読んで WBS の解析結果にする。xlsx の解析（fflate）は使うときだけ
// 動的 import する（CLAUDE.md Section 19。取り込まない利用者に読み込ませない）。
// 古い .xls・その他の形式は理由つきで断る。

import { isXlsxFile } from "../officeFileKind";
import { decodeTextBytes } from "../textDecode";
import { parseWbsMarkdown, parseWbsSheets, type WbsParseOutcome } from "./wbsParse";

export const WBS_IMPORT_ACCEPT = ".xlsx,.md,.markdown";

/** 1ファイルの容量の上限（バイト） */
export const MAX_WBS_FILE_BYTES = 10 * 1024 * 1024;

/** 取り込み元のシート優先名（複数シートのとき先に試す） */
export const WBS_PREFERRED_SHEET = "ガントチャート";

export async function loadWbsFile(file: File): Promise<WbsParseOutcome> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size > MAX_WBS_FILE_BYTES) {
    return { ok: false, error: `${file.name}：ファイルが大きすぎます（上限は${MAX_WBS_FILE_BYTES / 1024 / 1024}MB）。` };
  }
  try {
    if (isXlsxFile(file)) {
      const { extractXlsxGrids } = await import("../xlsxGrid");
      const sheets = extractXlsxGrids(new Uint8Array(await file.arrayBuffer()), WBS_PREFERRED_SHEET);
      return parseWbsSheets(sheets);
    }
    if (ext === "md" || ext === "markdown") {
      return parseWbsMarkdown(decodeTextBytes(new Uint8Array(await file.arrayBuffer()), false));
    }
  } catch (e) {
    return { ok: false, error: `${file.name}：読み取れませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。` };
  }
  if (ext === "xls") {
    return { ok: false, error: `${file.name}：旧形式（.xls）は読み取れません。Excel で .xlsx に保存し直してください。` };
  }
  return { ok: false, error: `${file.name}：この形式は取り込めません。対応しているのは .xlsx と、同じ列の表を持つ Markdown（.md）です。` };
}

/** 新しいPJの名前の初期値：ファイルの1行目のタイトル → 無ければファイル名（拡張子と末尾の日付・連番を除く） */
export function defaultProjectName(title: string | null, fileName: string): string {
  if (title && title.trim() !== "") return title.trim();
  return fileName.replace(/\.[^.]+$/, "").trim() || "WBS取込";
}

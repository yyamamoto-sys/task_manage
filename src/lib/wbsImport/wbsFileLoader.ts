// src/lib/wbsImport/wbsFileLoader.ts
//
// 【設計意図・v3.189／v3.198 拡張】
// 選ばれたファイルを読んで「取り込み元（WbsSource）」にする。形式ごとに行き先が違う：
//  - rows  ：固定列テンプレート（.xlsx／.md）。そのまま確認画面へ
//  - items ：MS Project XML（.xml）。階層・依存まで読めているので、グループ化の切替だけで確認画面へ
//  - table ：各種ツールの CSV／テンプレートに合わない .xlsx。列の対応づけ画面を挟む
// xlsx の解析（fflate）は使うときだけ動的 import する（CLAUDE.md Section 19。取り込まない利用者に読み込ませない）。
// この関数群自体も WbsImportModal（lazyWithRetry）の中にあり、取り込む人だけがダウンロードする。
// 古い .xls・.mpp・その他の形式は理由つきで断る。

import { isXlsxFile } from "../officeFileKind";
import { decodeTextBytes, decodeTextBytesStrict } from "../textDecode";
import { detectDelimiter, parseDelimited } from "./wbsCsv";
import { tableFromGrid, type WbsTable } from "./wbsColumns";
import type { WbsHierarchyMode, WbsItem } from "./wbsItems";
import { parseMspdi } from "./wbsMspdi";
import { parseWbsMarkdown, parseWbsSheets, type WbsCell, type WbsParseResult } from "./wbsParse";

export const WBS_IMPORT_ACCEPT = ".xlsx,.md,.markdown,.xml,.csv,.tsv,.txt";

/** 1ファイルの容量の上限（バイト） */
export const MAX_WBS_FILE_BYTES = 10 * 1024 * 1024;

/** 取り込み元のシート優先名（複数シートのとき先に試す） */
export const WBS_PREFERRED_SHEET = "ガントチャート";

export type WbsSource =
  | { kind: "rows"; result: WbsParseResult }
  | { kind: "items"; title: string | null; items: WbsItem[]; mode: WbsHierarchyMode; warnings: string[] }
  | { kind: "table"; title: string | null; table: WbsTable };

export type WbsLoadOutcome = { ok: true; source: WbsSource } | { ok: false; error: string };

const fail = (error: string): WbsLoadOutcome => ({ ok: false, error });

/** 行×列から対応づけ用の表を作る。作れなければ null */
export function sourceFromGrid(grid: WbsCell[][]): WbsSource | null {
  const table = tableFromGrid(grid);
  return table ? { kind: "table", title: null, table } : null;
}

/** バイト列と拡張子から読む（File に依存しない部分。テストはこちらを使う） */
export async function loadWbsBytes(name: string, bytes: Uint8Array): Promise<WbsLoadOutcome> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (bytes.length > MAX_WBS_FILE_BYTES) {
    return fail(`${name}：ファイルが大きすぎます（上限は${MAX_WBS_FILE_BYTES / 1024 / 1024}MB）。`);
  }
  try {
    if (ext === "xlsx") {
      const { extractXlsxGrids } = await import("../xlsxGrid");
      const sheets = extractXlsxGrids(bytes, WBS_PREFERRED_SHEET);
      const out = parseWbsSheets(sheets);
      if (out.ok) return { ok: true, source: { kind: "rows", result: out.result } };
      for (const sh of sheets) {
        const src = sourceFromGrid(sh.rows);
        if (src) return { ok: true, source: src };
      }
      return fail(`${name}：${out.error}`);
    }
    if (ext === "md" || ext === "markdown") {
      const out = parseWbsMarkdown(decodeTextBytes(bytes, false));
      return out.ok ? { ok: true, source: { kind: "rows", result: out.result } } : fail(`${name}：${out.error}`);
    }
    if (ext === "xml") {
      const out = parseMspdi(decodeTextBytesStrict(bytes));
      if (!out.ok) return fail(`${name}：${out.error}`);
      return { ok: true, source: { kind: "items", title: out.result.title, items: out.result.items, mode: "depth", warnings: out.result.warnings } };
    }
    if (ext === "csv" || ext === "tsv" || ext === "txt") {
      const text = decodeTextBytesStrict(bytes);
      const grid = parseDelimited(text, ext === "tsv" ? "\t" : detectDelimiter(text));
      const src = sourceFromGrid(grid);
      return src ? { ok: true, source: src } : fail(`${name}：見出し行とデータ行を読み取れませんでした。区切り文字（, タブ ;）で列が分かれた表を選んでください。`);
    }
  } catch (e) {
    return fail(`${name}：読み取れませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。`);
  }
  if (ext === "mpp") {
    return fail(`${name}：MS Project の .mpp は直接読めません。MS Project で「名前を付けて保存」→「XML 形式」で保存してから、その .xml を選んでください。`);
  }
  if (ext === "xls") {
    return fail(`${name}：旧形式（.xls）は読み取れません。Excel で .xlsx に保存し直してください。`);
  }
  return fail(`${name}：この形式は取り込めません。対応しているのは .xlsx・.md（テンプレートの表）、MS Project の XML（.xml）、CSV（.csv・.tsv・.txt）です。`);
}

export async function loadWbsFile(file: File): Promise<WbsLoadOutcome> {
  if (file.size > MAX_WBS_FILE_BYTES) {
    return fail(`${file.name}：ファイルが大きすぎます（上限は${MAX_WBS_FILE_BYTES / 1024 / 1024}MB）。`);
  }
  if (!/\.xlsx$/i.test(file.name) && isXlsxFile(file)) {
    // 拡張子が違っても中身が xlsx のとき（既存の判定を踏襲）
    return loadWbsBytes(`${file.name}.xlsx`, new Uint8Array(await file.arrayBuffer()));
  }
  return loadWbsBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

/** 新しいPJの名前の初期値：ファイルの1行目のタイトル → 無ければファイル名（拡張子と末尾の日付・連番を除く） */
export function defaultProjectName(title: string | null, fileName: string): string {
  if (title && title.trim() !== "") return title.trim();
  return fileName.replace(/\.[^.]+$/, "").trim() || "WBS取込";
}

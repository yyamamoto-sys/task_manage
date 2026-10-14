// src/lib/ooxmlCommon.ts
//
// 【設計意図】
// Office Open XML（.docx/.xlsx/.pptx）の抽出で共通に使う純関数。XMLパーサは使わず、
// docxText.ts と同じ「文字列の簡易走査」で抜き出す（新しい外部ライブラリを入れない）。
//
// 【走査は線形にする（v3.145）】
// `<row>[\s\S]*?</row>` のような「閉じタグまで遅延一致」の正規表現は、閉じタグを欠く入力
// （`<row>` を大量に並べる等）で2乗の時間になり、画面が固まる。そのため開始タグ・終了タグを
// indexOf で順に探す走査（forEachElement／collectText）に置き換えた。閉じタグが見つからなければ
// そこで走査を打ち切る（以降を探し直さない）。
//
// 【読み込みの負荷に上限を持つ（v3.145）】
// zip は宣言された展開後サイズ（originalSize）を見て、必要なエントリだけを展開し、合計・件数に
// 上限を設ける。超えたら OfficeLimitError で拒否する。

import { unzipSync } from "fflate";
import { EXTRACT_CHAR_CAP, OfficeLimitError, truncateSafely } from "./extractLimits";

export { EXTRACT_CHAR_CAP, OfficeLimitError, truncateSafely };

/** zip の展開後の合計サイズの上限（バイト）。 */
export const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024;
/** zip に含まれるエントリ数の上限。 */
export const MAX_ZIP_ENTRIES = 5000;

function codePointToString(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "�";
  return String.fromCodePoint(n);
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => codePointToString(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePointToString(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** タグの属性文字列から name="value" を取り出す（属性名の前方一致を避けるため空白区切りで探す）。 */
export function getXmlAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXmlEntities(m[1] ?? m[2] ?? "") : undefined;
}

// ===== zip =====

export interface ZipBudget {
  /** これまでに展開した（宣言サイズの）合計バイト数 */
  bytes: number;
}

export function createZipBudget(): ZipBudget {
  return { bytes: 0 };
}

const ZIP_TOO_BIG_MESSAGE = "ファイルが大きすぎて読み取れません（展開後のサイズが上限を超えています）。";
const ZIP_TOO_MANY_MESSAGE = "ファイルの構成が複雑すぎて読み取れません（部品の数が上限を超えています）。";

/** zip のエントリ名の一覧だけを取り出す（何も展開しない）。 */
export function listZipNames(buf: Uint8Array, failMessage: string): string[] {
  const names: string[] = [];
  try {
    unzipSync(buf, {
      filter: f => {
        names.push(f.name);
        if (names.length > MAX_ZIP_ENTRIES) throw new OfficeLimitError(ZIP_TOO_MANY_MESSAGE);
        return false;
      },
    });
  } catch (e) {
    if (e instanceof OfficeLimitError) throw e;
    throw new Error(failMessage);
  }
  return names;
}

/**
 * zip から filter に合うエントリだけを展開する。宣言された展開後サイズを budget に積み、
 * 合計が上限を超えたら展開せずに拒否する。
 */
export function unzipEntries(
  buf: Uint8Array,
  filter: (name: string) => boolean,
  failMessage: string,
  budget: ZipBudget = createZipBudget(),
): Record<string, Uint8Array> {
  let seen = 0;
  try {
    return unzipSync(buf, {
      filter: f => {
        seen += 1;
        if (seen > MAX_ZIP_ENTRIES) throw new OfficeLimitError(ZIP_TOO_MANY_MESSAGE);
        if (!filter(f.name)) return false;
        budget.bytes += f.originalSize;
        if (f.originalSize > MAX_ZIP_TOTAL_BYTES || budget.bytes > MAX_ZIP_TOTAL_BYTES) {
          throw new OfficeLimitError(ZIP_TOO_BIG_MESSAGE);
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof OfficeLimitError) throw e;
    throw new Error(failMessage);
  }
}

export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** .rels の Id → Target。 */
export function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  forEachElement(xml, "Relationship", attrs => {
    const id = getXmlAttr(attrs, "Id");
    const target = getXmlAttr(attrs, "Target");
    if (id !== undefined && target !== undefined) map.set(id, target);
  });
  return map;
}

/** rels の Target（相対・絶対）を zip 内のパスに解決する。baseDir は rels の対象ファイルがあるディレクトリ（例 "xl"）。 */
export function resolveRelTarget(baseDir: string, target: string): string {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** ファイル名の末尾の数字（slide12.xml → 12）。 */
export function trailingNumber(path: string): number {
  const m = /(\d+)\.xml$/.exec(path);
  return m ? Number(m[1]) : 0;
}

// ===== 線形の走査 =====

interface OpenTag {
  name: string;
  attrs: string;
  /** 開始タグの直後の位置 */
  end: number;
  selfClose: boolean;
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58;
}
function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46;
}

/** xml[i] が '<' のとき、要素の開始タグを読む。"skip"＝開始タグではない／"eof"＝閉じていない（以降は読めない）。 */
function readOpenTag(xml: string, i: number): OpenTag | "skip" | "eof" {
  if (!isNameStart(xml.charCodeAt(i + 1))) return "skip";
  let j = i + 1;
  while (j < xml.length && isNameChar(xml.charCodeAt(j))) j++;
  const name = xml.slice(i + 1, j);
  let quote = 0;
  let k = j;
  for (; k < xml.length; k++) {
    const ch = xml.charCodeAt(k);
    if (quote) {
      if (ch === quote) quote = 0;
    } else if (ch === 34 || ch === 39) {
      quote = ch;
    } else if (ch === 62) {
      break;
    }
  }
  if (k >= xml.length) return "eof";
  const selfClose = xml.charCodeAt(k - 1) === 47;
  return { name, attrs: xml.slice(j, selfClose ? k - 1 : k), end: k + 1, selfClose };
}

/** 名前が tag の要素を前から順に callback へ渡す（入れ子は想定しない）。false を返すと打ち切る。 */
export function forEachElement(
  xml: string,
  tag: string,
  callback: (attrs: string, inner: string) => boolean | void,
): void {
  const open = "<" + tag;
  const close = "</" + tag + ">";
  let i = 0;
  for (;;) {
    i = xml.indexOf(open, i);
    if (i < 0) return;
    const t = readOpenTag(xml, i);
    if (t === "eof") return;
    if (t === "skip" || t.name !== tag) {
      i += 1;
      continue;
    }
    let inner = "";
    let next = t.end;
    if (!t.selfClose) {
      const c = xml.indexOf(close, t.end);
      if (c < 0) return;
      inner = xml.slice(t.end, c);
      next = c + close.length;
    }
    if (callback(t.attrs, inner) === false) return;
    i = next;
  }
}

/** 最初に現れる名前が tag の開始タグの属性文字列（閉じタグは探さない）。無ければ undefined。 */
export function findOpenTagAttrs(xml: string, tag: string): string | undefined {
  const open = "<" + tag;
  let i = 0;
  for (;;) {
    i = xml.indexOf(open, i);
    if (i < 0) return undefined;
    const t = readOpenTag(xml, i);
    if (t === "eof") return undefined;
    if (t !== "skip" && t.name === tag) return t.attrs;
    i += 1;
  }
}

export interface CollectTextOptions {
  /** テキストを持つ要素名（例 "w:t"・"a:t"・"t"） */
  textTag: string;
  /** この要素は中身ごと読み飛ばす（例 ふりがな "rPh"）。skipWhen で絞れる */
  skipTag?: string;
  skipWhen?: (attrs: string) => boolean;
  /** この要素に出会ったら挿入する文字（例 { "w:br": "\n" }） */
  breaks?: Record<string, string>;
  /** 集めた文字が超えたら打ち切る（UTF-16単位） */
  maxChars?: number;
}

/** textTag の中身を前から連結して返す（デコード前の生の文字列）。 */
export function collectText(xml: string, opts: CollectTextOptions): string {
  const { textTag, skipTag, skipWhen, breaks, maxChars } = opts;
  const textClose = "</" + textTag + ">";
  const skipClose = skipTag ? "</" + skipTag + ">" : "";
  let out = "";
  let i = 0;
  for (;;) {
    i = xml.indexOf("<", i);
    if (i < 0) break;
    const t = readOpenTag(xml, i);
    if (t === "eof") break;
    if (t === "skip") {
      i += 1;
      continue;
    }
    if (t.name === textTag) {
      if (t.selfClose) {
        i = t.end;
      } else {
        const c = xml.indexOf(textClose, t.end);
        if (c < 0) break;
        out += xml.slice(t.end, c);
        i = c + textClose.length;
      }
      if (maxChars !== undefined && out.length > maxChars) break;
      continue;
    }
    if (skipTag && t.name === skipTag && (!skipWhen || skipWhen(t.attrs))) {
      if (t.selfClose) {
        i = t.end;
      } else {
        const c = xml.indexOf(skipClose, t.end);
        if (c < 0) break;
        i = c + skipClose.length;
      }
      continue;
    }
    if (breaks && Object.prototype.hasOwnProperty.call(breaks, t.name)) out += breaks[t.name];
    i = t.end;
  }
  return out;
}

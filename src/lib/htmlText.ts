// src/lib/htmlText.ts
//
// 【設計意図】
// HTML (.html / .htm) ファイルから本文テキストを抽出する。AI に raw HTML を渡すと
// タグやスタイルでトークンを浪費し誤読も招くため、クライアント側で body の textContent を
// 取り出して整形してから渡す。docxText.ts と同じく「ブラウザ環境前提（DOMParser 使用）」。
// script / style は本文ではないので除去する。

/** ファイルが .html / .htm かどうか（拡張子 or MIMEタイプで判定）。 */
export function isHtmlFile(file: File): boolean {
  if (file.type === "text/html") return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "html" || ext === "htm";
}

/**
 * .html / .htm の File から本文テキストを抽出する。
 * FileReader でテキストを読み込み、DOMParser でパースして script/style を除去し、
 * body（無ければ document 全体）の textContent を整形（連続空白・空行を圧縮）して返す。
 * ブラウザ環境前提（DOMParser）。失敗時は例外を投げる。
 */
export async function extractHtmlText(file: File): Promise<string> {
  const raw = await readFileAsText(file);
  return htmlStringToText(raw);
}

/** HTML 文字列を本文テキストへ変換する（テスト容易化のため分離）。 */
export function htmlStringToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // 本文ではない要素を除去
  doc.querySelectorAll("script, style, noscript, template").forEach(el => el.remove());
  const root = doc.body ?? doc.documentElement;
  const text = root?.textContent ?? "";
  return normalizeText(text);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve((ev.target?.result as string) ?? "");
    reader.onerror = () => reject(new Error("HTMLファイルの読み込みに失敗しました。"));
    reader.readAsText(file, "utf-8");
  });
}

/** 連続空白を1つに、各行をトリム、3行以上の空行を2行に圧縮する。 */
function normalizeText(text: string): string {
  // 半角/タブ/全角スペース(U+3000)/NBSP(U+00A0) をまとめて半角スペース1つに圧縮する。
  return text
    .replace(/[ \t\u3000\u00A0]+/g, " ")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// src/lib/wbsImport/miniXml.ts
//
// 【設計意図・v3.198】
// MS Project XML（MSPDI）を読むための小さな XML 解析。DOMParser を使わない理由：
//  - テストの実行環境（vitest の node）に DOMParser が無く、jsdom を足さずに純粋関数として検証したい
//  - 外部実体・DTD を一切展開しない（DOCTYPE は読み飛ばす）ので、巨大実体展開などの攻撃面が無い
// 要素名は名前空間の接頭辞を落としたローカル名にする（既定の名前空間でも接頭辞つきでも同じに読める）。
// 属性は読まない（MSPDI は値を子要素のテキストに持つ）。

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

function localName(raw: string): string {
  const i = raw.indexOf(":");
  return i >= 0 ? raw.slice(i + 1) : raw;
}

/** 解析に失敗したら Error を投げる（呼び出し側が利用者向けの文言にする） */
export function parseXml(input: string): XmlNode {
  const src = input.replace(/^\uFEFF/, "");
  const root: XmlNode = { name: "#document", children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XML のコメントが閉じていません");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XML の CDATA が閉じていません");
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XML の宣言が閉じていません");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      // DOCTYPE：内部サブセット（[ ... ]）があればその終わりまで。実体は展開しない
      let depth = 0;
      let k = lt + 2;
      for (; k < n; k++) {
        const c = src[k];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (k >= n) throw new Error("XML の DOCTYPE が閉じていません");
      i = k + 1;
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt + 2);
      if (end < 0) throw new Error("XML の終了タグが閉じていません");
      const name = localName(src.slice(lt + 2, end).trim());
      const top = stack[stack.length - 1];
      if (stack.length < 2 || top.name !== name) throw new Error(`XML の要素の対応が合いません（</${name}>）`);
      stack.pop();
      i = end + 1;
    } else {
      // 開始タグ。属性値の中の > を飛ばしながら終わりを探す
      let k = lt + 1;
      let quote = "";
      for (; k < n; k++) {
        const c = src[k];
        if (quote) { if (c === quote) quote = ""; } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (k >= n) throw new Error("XML の開始タグが閉じていません");
      let body = src.slice(lt + 1, k);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const name = localName(body.trim().split(/\s+/)[0] ?? "");
      if (name === "") throw new Error("XML の要素名が空です");
      const node: XmlNode = { name, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = k + 1;
    }
  }
  if (stack.length !== 1) throw new Error("XML が途中で終わっています（閉じていない要素があります）");
  const top = root.children[0];
  if (!top) throw new Error("XML に要素がありません");
  return top;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter(c => c.name === name);
}

export function childText(node: XmlNode, name: string): string {
  const c = node.children.find(x => x.name === name);
  return c ? c.text.trim() : "";
}

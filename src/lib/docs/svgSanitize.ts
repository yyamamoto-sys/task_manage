// src/lib/docs/svgSanitize.ts
//
// 【設計意図】ガイドの図解 SVG の許可リスト方式サニタイザ。
// 入力を「トークンに分解して許可した要素・属性だけを自前で組み直す」ので、入力の生の文字列は
// 出力に一切通らない（正規表現で危険なものを消す旧方式は、属性の区切り・実体参照・CSS のエスケープで抜けた）。
// 要素・属性の値はすべて復号してから検査し、エスケープし直して出力する。ブラウザの HTML パーサの解釈差
// （mXSS）が入り込む余地が無いよう、出力は常に正規化した形になる。
// DOMParser を使わないのは、テスト環境（vitest・node）に DOM が無く、実装と同じ経路を検証できないため。
//
// 捨てるもの：<style>・<script>・<foreignObject>・<set>・<animate*>・<use>・<a>・<image> など許可外の要素
// （子孫ごと）、ルート <svg> 以外の最上位ノード、</svg> の後ろ、コメント・CDATA・処理命令・DOCTYPE、
// on* 属性、# で始まらない href、url()・@・バックスラッシュ・expression を含む style 宣言。

export const SVG_ALLOWED_ELEMENTS = new Set([
  "svg", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path",
  "text", "tspan", "title", "desc", "defs", "marker", "linearGradient", "radialGradient", "stop",
]);

export const SVG_ALLOWED_ATTRIBUTES = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "dx", "dy",
  "width", "height", "d", "points", "transform", "viewBox", "preserveAspectRatio", "xmlns",
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "fill-opacity", "stroke-opacity", "stop-color", "stop-opacity", "offset",
  "font-size", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing",
  "style", "id", "class", "role", "aria-label", "aria-hidden",
  "marker-start", "marker-mid", "marker-end", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
  "gradientUnits", "gradientTransform", "href", "xlink:href",
]);

const STYLE_ALLOWED_PROPS = new Set([
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "text-anchor",
  "dominant-baseline", "letter-spacing", "stop-color", "stop-opacity",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc"]);
const VOID_FALLBACK_MAX_ITER = 200000;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/** 値に制御文字・Unicode の書式文字（ゼロ幅等）が混ざる場合は不正として捨てる */
function hasOddChars(s: string): boolean {
  return /[^\P{Cc}\t\n\r]|[\p{Cf}\p{Zl}\p{Zp}]/u.test(s);
}

const SAFE_FUNC_RE = /^(?:var|rgb|rgba|hsl|hsla)$/i;

/** スタイルの値：数値・色名・# 色・%・カンマ・var(--…)・rgb()/hsl() だけを許す */
function isSafeStyleValue(v: string): boolean {
  if (v === "" || v.length > 200) return false;
  if (/[\\@<>{}"';]/.test(v) || /url\s*\(|expression|javascript|import/i.test(v)) return false;
  if (!/^[A-Za-z0-9\s#%.,()\-_]*$/.test(v)) return false;
  const funcs = v.match(/[A-Za-z-]+\s*\(/g) ?? [];
  return funcs.every(f => SAFE_FUNC_RE.test(f.replace(/\s*\($/, "")));
}

export function sanitizeStyleAttribute(raw: string): string {
  const out: string[] = [];
  for (const decl of raw.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!STYLE_ALLOWED_PROPS.has(prop)) continue;
    if (!isSafeStyleValue(value)) continue;
    out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

function isSafePaintValue(v: string): boolean {
  if (hasOddChars(v) || v.length > 300) return false;
  // url() は同一文書内の #id だけ（グラデーション・マーカー）
  const urls = v.match(/url\s*\([^)]*\)?/gi) ?? [];
  if (urls.some(u => !/^url\(\s*#[A-Za-z0-9_-]+\s*\)$/i.test(u))) return false;
  return !/[\\<>]|expression|javascript|@import/i.test(v);
}

function sanitizeAttr(name: string, rawValue: string): string | null {
  if (!SVG_ALLOWED_ATTRIBUTES.has(name)) return null;
  const value = decodeEntities(rawValue);
  if (hasOddChars(value)) return null;
  if (name === "style") {
    const s = sanitizeStyleAttribute(value);
    return s === "" ? null : s;
  }
  if (name === "href" || name === "xlink:href") {
    return /^#[A-Za-z0-9_-]+$/.test(value.trim()) ? value.trim() : null;
  }
  if (name === "xmlns") return value === "http://www.w3.org/2000/svg" ? value : null;
  if (!isSafePaintValue(value)) return null;
  return value;
}

interface Tag {
  closing: boolean;
  selfClosing: boolean;
  name: string;
  attrs: Array<[string, string]>;
  end: number;
}

/** s[start] === "<" から、タグ 1 つを HTML/XML 寄りの寛容な規則で読む。読めなければ null */
function readTag(s: string, start: number): Tag | null {
  let i = start + 1;
  let closing = false;
  if (s[i] === "/") { closing = true; i++; }
  const nameStart = i;
  while (i < s.length && /[A-Za-z0-9:_-]/.test(s[i])) i++;
  if (i === nameStart) return null;
  const name = s.slice(nameStart, i);
  const attrs: Array<[string, string]> = [];
  let selfClosing = false;
  while (i < s.length) {
    while (i < s.length && /[\s/]/.test(s[i])) {
      if (s[i] === "/" && /^\/\s*>/.test(s.slice(i, i + 4))) selfClosing = true;
      i++;
    }
    if (s[i] === ">") return { closing, selfClosing, name, attrs, end: i + 1 };
    if (i >= s.length) return null;
    const aStart = i;
    while (i < s.length && !/[\s/=>]/.test(s[i])) i++;
    const aName = s.slice(aStart, i);
    while (i < s.length && /\s/.test(s[i])) i++;
    let value = "";
    if (s[i] === "=") {
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        if (close < 0) return null;
        value = s.slice(i + 1, close);
        i = close + 1;
      } else {
        const vStart = i;
        while (i < s.length && !/[\s>]/.test(s[i])) i++;
        value = s.slice(vStart, i);
      }
    }
    if (aName) attrs.push([aName, value]);
  }
  return null;
}

/** 許可した要素・属性だけで組み直した SVG 文字列を返す。ルートが <svg> でなければ空文字列 */
export function sanitizeSvg(src: string): string {
  const s = src;
  const out: string[] = [];
  const stack: string[] = []; // 出力に含めた要素の開きタグ
  let skipDepth = 0; // 許可外要素の内側にいる間の深さ
  let started = false;
  let done = false;
  let i = 0;
  let guard = 0;

  while (i < s.length && !done && guard++ < VOID_FALLBACK_MAX_ITER) {
    const lt = s.indexOf("<", i);
    const textEnd = lt < 0 ? s.length : lt;
    if (textEnd > i) {
      const t = s.slice(i, textEnd);
      const top = stack[stack.length - 1];
      if (skipDepth === 0 && top && TEXT_ELEMENTS.has(top)) {
        const dec = decodeEntities(t);
        if (!hasOddChars(dec)) out.push(escapeText(dec));
      }
      i = textEnd;
      if (lt < 0) break;
    }
    if (s.startsWith("<!--", i)) {
      const e = s.indexOf("-->", i + 4);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      const e = s.indexOf("]]>", i + 9);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith("<?", i) || s.startsWith("<!", i)) {
      const e = s.indexOf(">", i + 2);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    const tag = readTag(s, i);
    if (!tag) { i += 1; continue; }
    i = tag.end;
    const lname = tag.name.toLowerCase();
    // 名前の大文字小文字は viewBox 等の属性とは別に、要素は許可リストの綴りで照合する
    const elName = [...SVG_ALLOWED_ELEMENTS].find(e => e.toLowerCase() === lname) ?? null;

    if (tag.closing) {
      if (skipDepth > 0) { skipDepth--; continue; }
      if (elName && stack.includes(elName)) {
        while (stack.length) {
          const t = stack.pop() as string;
          out.push(`</${t}>`);
          if (t === elName) break;
        }
        if (stack.length === 0) done = true;
      }
      continue;
    }

    if (skipDepth > 0) {
      if (!tag.selfClosing) skipDepth++;
      continue;
    }
    if (!started) {
      if (elName !== "svg") { // ルートが svg でない最上位ノードは、子孫ごと捨てる
        if (RAW_TEXT_ELEMENTS.has(lname) && !tag.selfClosing) {
          const e = s.toLowerCase().indexOf(`</${lname}`, i);
          i = e < 0 ? s.length : e;
        } else if (!tag.selfClosing) {
          skipDepth++;
        }
        continue;
      }
      started = true;
    } else if (elName === "svg") {
      // 入れ子の svg は許さない
      if (!tag.selfClosing) skipDepth++;
      continue;
    }
    if (!elName) {
      if (RAW_TEXT_ELEMENTS.has(lname) && !tag.selfClosing) {
        const e = s.toLowerCase().indexOf(`</${lname}`, i);
        i = e < 0 ? s.length : e;
        continue;
      }
      if (!tag.selfClosing) skipDepth++;
      continue;
    }

    const seen = new Set<string>();
    const attrs: string[] = [];
    for (const [rawName, rawValue] of tag.attrs) {
      const allowedName = [...SVG_ALLOWED_ATTRIBUTES].find(a => a.toLowerCase() === rawName.toLowerCase());
      if (!allowedName || seen.has(allowedName)) continue;
      const v = sanitizeAttr(allowedName, rawValue);
      if (v === null) continue;
      seen.add(allowedName);
      attrs.push(`${allowedName}="${escapeAttr(v)}"`);
    }
    out.push(`<${elName}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    if (tag.selfClosing) {
      out.push(`</${elName}>`);
      if (elName === "svg") done = true;
    } else {
      stack.push(elName);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return started ? out.join("") : "";
}

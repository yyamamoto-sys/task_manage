// src/__tests__/miniDom.ts
//
// テスト用の最小 DOM（v3.135）。jsdom 等の依存を足さずに、react-dom の createRoot で
// コンポーネントを実際に描画し、effect の実行回数（取得の回数）を数えるためのもの。
// 描画・属性・style・テキストの出し入れと EventTarget だけを持つ。クリックは React の props の
// onClick を直接呼ぶ（イベントの伝播は再現しない）。
// 🔴 react-dom より先に import すること（react-dom は読み込み時に window の有無を見る）。

type AnyRecord = Record<string, unknown>;

class MiniNode extends EventTarget {
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  ownerDocument: MiniDocument | null = null;
  nodeType = 1;
  nodeName = "";

  get firstChild(): MiniNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): MiniNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): MiniNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild<T extends MiniNode>(c: T): T {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore<T extends MiniNode>(c: T, ref: MiniNode | null): T {
    if (!ref) return this.appendChild(c);
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c);
    return c;
  }
  removeChild<T extends MiniNode>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  contains(n: MiniNode | null): boolean {
    for (let cur = n; cur; cur = cur.parentNode) if (cur === this) return true;
    return false;
  }
  get textContent(): string { return this.childNodes.map(c => c.textContent).join(""); }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument!.createTextNode(v));
  }
}

class MiniText extends MiniNode {
  constructor(public data: string) { super(); this.nodeType = 3; this.nodeName = "#text"; }
  get nodeValue() { return this.data; }
  set nodeValue(v: string) { this.data = v; }
  override get textContent() { return this.data; }
  override set textContent(v: string) { this.data = v; }
}

class MiniComment extends MiniNode {
  constructor(public data: string) { super(); this.nodeType = 8; this.nodeName = "#comment"; }
  override get textContent() { return ""; }
  override set textContent(_v: string) { /* コメントは表示しない */ }
}

export class MiniElement extends MiniNode {
  attributes = new Map<string, string>();
  style: AnyRecord = {
    setProperty(this: AnyRecord, k: string, v: string) { this[k] = v; },
    removeProperty(this: AnyRecord, k: string) { delete this[k]; },
  };
  namespaceURI = "http://www.w3.org/1999/xhtml";
  constructor(public tagName: string) { super(); this.nodeName = tagName; }
  setAttribute(k: string, v: unknown) { this.attributes.set(k, String(v)); }
  getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  hasAttribute(k: string) { return this.attributes.has(k); }
  removeAttribute(k: string) { this.attributes.delete(k); }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  focus() {}
  blur() {}
}

class MiniDocument extends MiniNode {
  body: MiniElement;
  documentElement: MiniElement;
  activeElement: MiniElement | null = null;
  visibilityState = "visible";
  constructor() {
    super();
    this.nodeType = 9;
    this.nodeName = "#document";
    this.ownerDocument = null;
    this.documentElement = this.createElement("HTML");
    this.body = this.createElement("BODY");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) {
    const el = new MiniElement(tag.toUpperCase());
    el.ownerDocument = this;
    return el;
  }
  createElementNS(_ns: string, tag: string) { return this.createElement(tag); }
  createTextNode(s: string) { const n = new MiniText(s); n.ownerDocument = this; return n; }
  createComment(s: string) { const n = new MiniComment(s); n.ownerDocument = this; return n; }
}

const doc = new MiniDocument();
const win = Object.assign(new EventTarget(), {
  document: doc,
  event: undefined,
  HTMLIFrameElement: class HTMLIFrameElement {},
  innerWidth: 1280,
  innerHeight: 800,
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  location: { href: "http://localhost/", search: "" },
});
const g = globalThis as unknown as AnyRecord;
g.window = win;
g.document = doc;
g.IS_REACT_ACT_ENVIRONMENT = true;

export const miniDocument = doc;

export function allElements(root: MiniNode = doc): MiniElement[] {
  const out: MiniElement[] = [];
  const walk = (n: MiniNode) => {
    if (n instanceof MiniElement) out.push(n);
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

/** React が要素に付ける props（onClick 等）を読む */
export function reactProps(el: MiniElement): AnyRecord {
  const key = Object.keys(el).find(k => k.startsWith("__reactProps$"));
  if (!key) throw new Error("React の要素ではありません");
  return (el as unknown as AnyRecord)[key] as AnyRecord;
}

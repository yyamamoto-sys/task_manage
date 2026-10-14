import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "../guideMarkdown";
import { sanitizeStyleAttribute } from "../svgSanitize";
import { GUIDE_SVGS } from "../guideAssets";

const wrap = (inner: string) => `<svg viewBox="0 0 10 10">${inner}</svg>`;

describe("sanitizeSvg（許可リスト方式）：レビューで抜けた入力", () => {
  it("属性の区切りが無い on*（引用符の直後）", () => {
    const s = sanitizeSvg(wrap('<rect x="1"onclick="alert(1)"/>'));
    expect(s).not.toMatch(/onclick/i);
    expect(s).toContain('<rect x="1">');
  });
  it("スラッシュ区切りの on*", () => {
    const s = sanitizeSvg(wrap("<rect/onclick=alert(1)/>"));
    expect(s).not.toMatch(/onclick|alert/i);
    expect(s).toContain("<rect>");
  });
  it("<set> で href を javascript: にする（数値文字参照）", () => {
    const s = sanitizeSvg(wrap('<a href="#x"><set attributeName="href" to="javascript&#58;alert(1)"/></a>'));
    expect(s).not.toMatch(/<set|<a\b|javascript|alert/i);
  });
  it("<animate> の values に実体参照で書いた javascript:", () => {
    const s = sanitizeSvg(wrap('<animate attributeName="href" values="jav&#x61;script:alert(1)"/><rect/>'));
    expect(s).not.toMatch(/animate|javascript|jav&|alert/i);
    expect(s).toContain("<rect>");
  });
  it("</svg> の後ろに続く iframe・ルート前の要素は捨てる", () => {
    const s = sanitizeSvg(`<iframe srcdoc="<script>1</script>"></iframe><svg><rect/></svg><iframe srcdoc="<script>alert(1)</script>"></iframe><img src=x onerror=alert(1)>`);
    expect(s).not.toMatch(/iframe|srcdoc|script|img|onerror/i);
    expect(s.startsWith("<svg")).toBe(true);
    expect(s.endsWith("</svg>")).toBe(true);
  });
  it("style 内の url(\\68ttps://…) と @\\69mport（CSS のエスケープ）", () => {
    const a = sanitizeSvg(wrap('<rect style="fill:url(\\68ttps://evil.example/x);stroke:var(--color-border-primary)"/>'));
    expect(a).not.toMatch(/url|evil|\\/i);
    expect(a).toContain("stroke:var(--color-border-primary)");
    const b = sanitizeSvg(wrap('<rect style="@\\69mport url(//e.com/a.css);fill:red"/>'));
    expect(b).not.toMatch(/import|e\.com|@|\\/i);
    expect(b).toContain("fill:red");
  });
  it("<style>・<script>・<foreignObject>・<use>・<image>・<a> は子孫ごと捨てる", () => {
    const s = sanitizeSvg(wrap(
      '<style>.a{fill:url(#g)}</style><script>"</svg><b>"</script><foreignObject><div onclick="x()">hi</div></foreignObject><use href="#a"/><image href="https://e.com/a.png"/><a href="https://e.com"><text>keep?</text></a><rect/>',
    ));
    expect(s).not.toMatch(/style|script|foreignObject|<use|image|<a\b|keep|<div|e\.com/i);
    expect(s).toContain("<rect>");
  });
  it("href は # で始まるものだけ（グラデーション参照など）", () => {
    const s = sanitizeSvg(wrap('<linearGradient id="g" href="#base"/><linearGradient id="h" href="https://e.com/x"/><linearGradient id="i" xlink:href="javascript:alert(1)"/>'));
    expect(s).toContain('href="#base"');
    expect(s).not.toMatch(/e\.com|javascript/);
  });
  it("属性値の url() は同一文書の #id だけ", () => {
    const s = sanitizeSvg(wrap('<rect fill="url(#g)"/><rect fill="url(https://e.com/p)"/><rect marker-end="url(&#35;m)"/>'));
    expect(s).toContain('fill="url(#g)"');
    expect(s).toContain('marker-end="url(#m)"');
    expect(s).not.toMatch(/e\.com/);
  });
  it("テキスト内の生タグ・実体参照はエスケープされて残る", () => {
    const s = sanitizeSvg(wrap("<text>&lt;b&gt;1&amp;2 &#60;script&#62;</text>"));
    expect(s).not.toContain("<b>");
    expect(s).not.toContain("<script>");
    expect(s).toContain("&lt;b&gt;1&amp;2 &lt;script&gt;");
  });
  it("属性値の引用符・タグ文字はエスケープされ、属性から抜け出せない", () => {
    const s = sanitizeSvg(wrap('<rect id=\'a" onclick="alert(1)\'/>'));
    expect(s).toMatch(/<rect id="[^"]*"><\/rect>/); // 属性は id の 1 つだけ。引用符は &quot; になり値の中に閉じ込められる
    expect(s).toContain("&quot;");
  });
  it("コメント・CDATA・DOCTYPE・処理命令は捨てる", () => {
    const s = sanitizeSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><!-- c --><svg><![CDATA[<script>1</script>]]><rect/></svg>`);
    expect(s).toBe("<svg><rect></rect></svg>");
  });
  it("入れ子の svg・ルートが svg でない入力", () => {
    expect(sanitizeSvg("<div><svg><rect/></svg></div>")).toBe("");
    expect(sanitizeSvg(wrap('<svg onload="x()"><rect/></svg>'))).not.toMatch(/onload/);
    expect(sanitizeSvg("hello")).toBe("");
  });
});

describe("sanitizeStyleAttribute", () => {
  it("var(--color-*)・currentColor・数値・色名・# 色だけ残す", () => {
    expect(sanitizeStyleAttribute("fill:var(--color-bg-info); stroke : currentColor; stroke-width:1.5; opacity:.5; fill-opacity:50%")).toBe(
      "fill:var(--color-bg-info);stroke:currentColor;stroke-width:1.5;opacity:.5;fill-opacity:50%",
    );
    expect(sanitizeStyleAttribute("fill:#fff;stroke:red")).toBe("fill:#fff;stroke:red");
  });
  it("許可外のプロパティ・url(・@・バックスラッシュ・expression・未知の関数は宣言ごと捨てる", () => {
    expect(sanitizeStyleAttribute("position:fixed;fill:red")).toBe("fill:red");
    expect(sanitizeStyleAttribute("fill:url(#g)")).toBe("");
    expect(sanitizeStyleAttribute("fill:u\\72l(#g)")).toBe("");
    expect(sanitizeStyleAttribute("fill:expression(alert(1))")).toBe("");
    expect(sanitizeStyleAttribute("fill:calc(1px + 2px)")).toBe("");
    expect(sanitizeStyleAttribute("fill:red;;@import 'x'")).toBe("fill:red");
  });
});

describe("実在の図解 SVG は見た目に必要な要素・属性を失わない", () => {
  const entries = Object.entries(GUIDE_SVGS);
  it("図解が取り込めている（11本）", () => {
    expect(entries.length).toBe(11);
  });
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  for (const [path, src] of entries) {
    it(`${path.split("/").pop()}`, () => {
      const out = sanitizeSvg(src);
      for (const tag of ["svg", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "title", "desc", "defs", "marker", "linearGradient", "radialGradient", "stop"]) {
        expect(count(out, new RegExp(`<${tag}[\\s>]`, "g")), `<${tag}> の数`).toBe(count(src, new RegExp(`<${tag}[\\s/>]`, "g")));
      }
      expect(count(out, /style="/g)).toBe(count(src, /style="/g));
      expect(count(out, /var\(--color-/g)).toBe(count(src, /var\(--color-/g));
      expect(count(out, /font-size="/g)).toBe(count(src, /font-size="/g));
      expect(count(out, /text-anchor="/g)).toBe(count(src, /text-anchor="/g));
      expect(out).toMatch(/viewBox="[^"]+"/);
      // 文字列の中身（text の内容）も変わらない
      const texts = (s: string) => [...s.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      expect(texts(out)).toEqual(texts(src));
    });
  }
});

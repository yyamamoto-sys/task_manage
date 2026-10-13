import { describe, it, expect } from "vitest";
import {
  parseGuideMarkdown, parseInline, resolveLink, resolveRelative, resolveImage, sanitizeSvg,
  type Block,
} from "../guideMarkdown";
import { listDocs } from "../manifest";
import { GUIDE_SVGS } from "../guideAssets";

const SLUGS = new Set(["02_modes/okr/01_x", "03_roles/admin", "00_overview", "02_modes/consultation"]);
const has = (s: string) => SLUGS.has(s);

describe("parseGuideMarkdown：ブロック", () => {
  it("見出し・段落・水平線・コードブロック", () => {
    const b = parseGuideMarkdown("# A\n\n## B\n### C\n本文1\n本文2\n\n---\n\n```ts\nconst x = 1;\n| not | table |\n```\n");
    expect(b.map(x => x.t)).toEqual(["heading", "heading", "heading", "para", "hr", "code"]);
    expect((b[0] as Extract<Block, { t: "heading" }>).level).toBe(1);
    expect((b[3] as Extract<Block, { t: "para" }>).c).toEqual([{ t: "text", v: "本文1\n本文2" }]);
    const code = b[5] as Extract<Block, { t: "code" }>;
    expect(code.lang).toBe("ts");
    expect(code.v).toContain("| not | table |");
  });

  it("GFM 表：ヘッダ・本文行・揃え指定を無視・セル内のリンクと太字", () => {
    const b = parseGuideMarkdown("| 名前 | 説明 |\n|:---|---:|\n| **a** | [x](./y.md) |\n| b \\| c | `d` |\n\n後続");
    expect(b.map(x => x.t)).toEqual(["table", "para"]);
    const t = b[0] as Extract<Block, { t: "table" }>;
    expect(t.header).toEqual([[{ t: "text", v: "名前" }], [{ t: "text", v: "説明" }]]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toEqual([{ t: "bold", c: [{ t: "text", v: "a" }] }]);
    expect(t.rows[0][1][0]).toMatchObject({ t: "link", href: "./y.md" });
    expect(t.rows[1][0]).toEqual([{ t: "text", v: "b | c" }]);
  });

  it("区切り行のない | は表にしない", () => {
    const b = parseGuideMarkdown("| a | b |\n本文");
    expect(b.map(x => x.t)).toEqual(["para"]);
  });

  it("箇条書き：番号付き・1段ネスト・継続行", () => {
    const b = parseGuideMarkdown("1. 手順A\n2. 手順B\n  - 補足1\n  - 補足2\n    続き\n3. 手順C\n\n- x\n* y");
    expect(b.map(x => x.t)).toEqual(["list", "list"]);
    const l = (b[0] as Extract<Block, { t: "list" }>).list;
    expect(l.ordered).toBe(true);
    expect(l.items).toHaveLength(3);
    expect(l.items[1].children?.ordered).toBe(false);
    expect(l.items[1].children?.items).toHaveLength(2);
    expect(l.items[1].children?.items[1].c).toEqual([{ t: "text", v: "補足2" }, { t: "text", v: "\n続き" }]);
    const u = (b[1] as Extract<Block, { t: "list" }>).list;
    expect(u.ordered).toBe(false);
    expect(u.items).toHaveLength(2);
  });

  it("引用：複数行を1つの注意枠にまとめる", () => {
    const b = parseGuideMarkdown("> **注意** 保存してください\n> 二行目\n\n本文");
    expect(b.map(x => x.t)).toEqual(["quote", "para"]);
    const q = b[0] as Extract<Block, { t: "quote" }>;
    expect(q.c[0]).toMatchObject({ t: "bold" });
  });

  it("画像は独立行だけ image ブロックになる", () => {
    const b = parseGuideMarkdown("![図の説明](../_img/a.svg)\n\n文中 ![x](a.svg) は文字のまま");
    expect(b[0]).toEqual({ t: "image", alt: "図の説明", src: "../_img/a.svg" });
    expect(b[1].t).toBe("para");
  });

  it("CRLF・閉じていないコードブロックでも落ちない", () => {
    const b = parseGuideMarkdown("# T\r\n\r\n```\r\ncode\r\n");
    expect(b.map(x => x.t)).toEqual(["heading", "code"]);
  });
});

describe("parseInline", () => {
  it("行内コード・太字・リンクを順に分解する", () => {
    expect(parseInline("a `b` **c** [d](e.md) f")).toEqual([
      { t: "text", v: "a " },
      { t: "code", v: "b" },
      { t: "text", v: " " },
      { t: "bold", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "link", href: "e.md", c: [{ t: "text", v: "d" }] },
      { t: "text", v: " f" },
    ]);
  });
  it("コード内のリンク記法は解釈しない", () => {
    expect(parseInline("`[x](y)`")).toEqual([{ t: "code", v: "[x](y)" }]);
  });
});

describe("リンク解決", () => {
  const cur = "02_modes/okr/00_cycle.md";
  it("http(s) は外部リンク", () => {
    expect(resolveLink("https://example.com/a", cur, has)).toEqual({ kind: "external", href: "https://example.com/a" });
    expect(resolveLink("http://example.com", cur, has).kind).toBe("external");
  });
  it("相対 .md は slug に解決（./ と ../・#見出し付き）", () => {
    expect(resolveLink("./01_x.md", cur, has)).toEqual({ kind: "doc", slug: "02_modes/okr/01_x" });
    expect(resolveLink("../consultation.md", cur, has)).toEqual({ kind: "doc", slug: "02_modes/consultation" });
    expect(resolveLink("../../03_roles/admin.md#section", cur, has)).toEqual({ kind: "doc", slug: "03_roles/admin" });
    expect(resolveLink("../../00_overview.md", cur, has)).toEqual({ kind: "doc", slug: "00_overview" });
  });
  it("解決できないものは none（存在しない・ルートの外・ディレクトリ・mailto・.md以外）", () => {
    expect(resolveLink("./nothing.md", cur, has).kind).toBe("none");
    expect(resolveLink("../../../dev/x.md", cur, has).kind).toBe("none");
    expect(resolveLink("../../06_troubleshooting/", cur, has).kind).toBe("none");
    expect(resolveLink("mailto:a@b.c", cur, has).kind).toBe("none");
    expect(resolveLink("javascript:alert(1)", cur, has).kind).toBe("none");
    expect(resolveLink("#only-hash", cur, has).kind).toBe("none");
    expect(resolveLink("../_img/a.svg", cur, has).kind).toBe("none");
  });
  it("resolveRelative：ルート直下の記事から ../ は null", () => {
    expect(resolveRelative("00_overview.md", "../x.md")).toBeNull();
    expect(resolveRelative("00_overview.md", "./01_onboarding/first-day.md")).toBe("01_onboarding/first-day.md");
  });
});

describe("画像解決", () => {
  const svgs = { "/docs/guides/_img/a.svg": "<svg></svg>" };
  it("存在する SVG を相対パスから引く", () => {
    expect(resolveImage("../_img/a.svg", "02_modes/x.md", svgs)).toBe("<svg></svg>");
    expect(resolveImage("../../_img/a.svg", "02_modes/okr/x.md", svgs)).toBe("<svg></svg>");
  });
  it("存在しない・SVG でない・ルートの外は null", () => {
    expect(resolveImage("../_img/none.svg", "02_modes/x.md", svgs)).toBeNull();
    expect(resolveImage("../_img/a.png", "02_modes/x.md", svgs)).toBeNull();
    expect(resolveImage("../../../a.svg", "02_modes/x.md", svgs)).toBeNull();
  });
  it("見本 SVG が実在し、参照パスから引ける", () => {
    expect(resolveImage("../_img/sample-flow.svg", "_meta/conventions.md", GUIDE_SVGS)).toContain("<svg");
  });
});

describe("sanitizeSvg", () => {
  it("script・foreignObject・on* 属性・外部 href・外部 CSS 参照を除去し、通常の要素は残す", () => {
    const dirty = `<?xml version="1.0"?><svg viewBox="0 0 10 10" onload="x()">
<script>alert(1)</script><script src="//e.com/a.js"/>
<foreignObject><div>hi</div></foreignObject>
<a href="https://evil.example/" xlink:href='http://evil.example/'><text onclick="y()" style="fill:var(--color-brand)">t</text></a>
<use href="#local"/><image href="javascript:alert(1)"/>
<style>@import url(https://e.com/a.css); .a{fill:url(https://e.com/p)} .b{fill:url(#grad)}</style>
<rect onmouseover=evil() width="1" height="1" style="fill:var(--color-bg-info)"/></svg>`;
    const s = sanitizeSvg(dirty);
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/foreignObject/i);
    expect(s).not.toMatch(/\son[a-z]+\s*=/i);
    expect(s).not.toMatch(/evil\.example/);
    expect(s).not.toMatch(/javascript:/i);
    expect(s).not.toMatch(/@import/);
    expect(s).not.toMatch(/https?:\/\/e\.com/);
    expect(s).not.toMatch(/<\?xml/);
    expect(s).toContain('href="#local"');
    expect(s).toContain("url(#grad)");
    expect(s).toContain("var(--color-brand)");
    expect(s).toContain("var(--color-bg-info)");
    expect(s).toContain("<rect");
  });
  it("見本 SVG は除去で内容が変わらない", () => {
    const src = Object.entries(GUIDE_SVGS).find(([k]) => k.endsWith("sample-flow.svg"))?.[1] ?? "";
    expect(src.length).toBeGreaterThan(0);
    const out = sanitizeSvg(src);
    expect(out).toContain("var(--color-bg-info)");
    expect(out).toContain("<text");
    expect(out).toContain("currentColor");
    expect(out).not.toMatch(/font-family/);
  });
});

describe("既存ガイド全本のパース", () => {
  const docs = listDocs();
  it("ガイドが取り込めている", () => {
    expect(docs.length).toBeGreaterThan(10);
  });
  for (const d of docs) {
    it(`${d.slug} は例外なくパースでき、リンクは外部/doc/none のいずれかに解決される`, () => {
      const blocks = parseGuideMarkdown(d.body);
      expect(blocks.length).toBeGreaterThan(0);
      const walk = (inl: ReturnType<typeof parseInline>) => {
        for (const x of inl) {
          if (x.t === "link") {
            expect(["external", "doc", "none"]).toContain(resolveLink(x.href, d.path, has).kind);
            walk(x.c);
          } else if (x.t === "bold") walk(x.c);
        }
      };
      for (const b of blocks) {
        if (b.t === "para" || b.t === "heading" || b.t === "quote") walk(b.c);
        if (b.t === "table") [b.header, ...b.rows].forEach(r => r.forEach(walk));
      }
    });
  }
  it("表の生文字（| a | b |）がガイド本文の段落に残らない", () => {
    for (const d of docs) {
      for (const b of parseGuideMarkdown(d.body)) {
        if (b.t === "para") {
          const txt = b.c.map(x => (x.t === "text" ? x.v : "")).join("");
          expect(txt).not.toMatch(/^\s*\|.*\|\s*$/m);
        }
      }
    }
  });
});

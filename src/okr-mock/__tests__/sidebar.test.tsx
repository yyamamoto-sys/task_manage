import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import App from "../App";
import { assessInit, okrItems } from "../fixtures";
import { panelNarrowPx, sidebarKrRows, sidebarWidth, switchPage } from "../nav";
import type { InitialView } from "../state";
import { currentAssessment, type CurrentAssessment } from "../steps";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const sidebarOf = (h: string) => h.slice(h.indexOf('<aside class="mk-sidebar'), h.indexOf("</aside>", h.indexOf('<aside class="mk-sidebar')));
const krItems = okrItems.filter((i) => i.kind === "kr");
const assess = Object.fromEntries(krItems.map((k) => [k.id, currentAssessment(assessInit[k.id] ?? [])])) as Record<string, CurrentAssessment | null>;

describe("サイドバー：メニューとページの切替", () => {
  it("チームのページでは「チーム」が aria-current=page。「わたし」には付かない。わたしのページでは逆", () => {
    const team = sidebarOf(html({ mode: "team" }));
    expect(team).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*チーム/s);
    expect(team.match(/aria-current="page"/g)?.length).toBe(1);
    const self = sidebarOf(html({ mode: "self" }));
    expect(self.match(/aria-current="page"/g)?.length).toBe(1);
    expect(self).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*わたし/s);
    expect(self).toContain("本人だけ");
  });
  it("ページを切り替えると詳細は閉じる。同じページを押しても何も変えない", () => {
    const open = { mode: "team" as const, sel: { type: "kr" as const, id: "kr1" } };
    expect(switchPage(open, "self")).toEqual({ mode: "self", sel: null });
    expect(switchPage(open, "team")).toBe(open);
  });
  it("上部の「表示の切替」と「資料を読ませる」ボタンは廃止。資料はサイドバーに一本化", () => {
    for (const h of [html(), html({ mode: "self" })]) {
      const head = h.slice(h.indexOf("<header"), h.indexOf("</header>"));
      expect(h).not.toContain("表示の切替");
      expect(head).not.toContain("資料を読ませる");
      expect(head).toContain("O・KRの取り込み");
      expect(sidebarOf(h)).toContain("資料を読ませる");
    }
  });
  it("計画モードは押せない見た目（aria-disabled と理由の title）。検索とAIツールも見た目だけ", () => {
    const s = sidebarOf(html());
    expect(s).toContain('aria-disabled="true"');
    expect(s.match(/title="モックでは OKR モードだけ動きます"/g)?.length).toBe(3);
    expect(s).toContain("OKRモード（選択中）");
    expect(s).toContain("AIツールを開く");
    expect(s).toContain("検索...");
  });
  it("下段はアバターと版だけ", () => {
    const s = sidebarOf(html());
    expect(s).toContain("mock v14");
    expect(s).toContain("見ている人：鈴木");
  });
});

describe("サイドバー：KR 行", () => {
  it("KRごとに見立ての値が出る。前回から動いたKRだけ「+2」のような小さな添え書き（色で良し悪しを付けない）", () => {
    const rows = sidebarKrRows(okrItems, assess);
    expect(rows.map((r) => r.id)).toEqual(krItems.map((k) => k.id));
    const s = sidebarOf(html());
    for (const r of rows) {
      expect(r.value).not.toBeNull();
      expect(s).toContain(`>${r.value}</span>`);
      if (r.tag) expect(s).toContain(`>${r.tag}</small>`);
      else expect(r.tag).toBeNull();
    }
    expect(rows.some((r) => r.tag !== null)).toBe(true);
    expect(s).not.toMatch(/mk-sb-tag"[^>]*style/);
  });
  it("見立てが無いKRは値の代わりに「—」。読み上げも「なし」", () => {
    const rows = sidebarKrRows(okrItems, { ...assess, kr2: null });
    const kr2 = rows.find((r) => r.id === "kr2")!;
    expect(kr2.value).toBeNull();
    expect(kr2.tag).toBeNull();
    expect(kr2.aria).toBe("KR2 地域拠点の稼働率を80%にする：AIの見立て なし。押すと詳細を開きます");
  });
  it("aria-label は「KR1 …：AIの見立て 66、前回から +2。押すと詳細を開きます」の形。title は KR の全文", () => {
    const rows = sidebarKrRows(okrItems, assess);
    const kr1 = rows.find((r) => r.id === "kr1")!;
    expect(kr1.aria).toMatch(/^KR1 共創パートナー企業を30社にする：AIの見立て \d+、前回から (\+\d+|−\d+|変わらず|前回なし)。押すと詳細を開きます$/);
    const s = sidebarOf(html());
    expect(s).toContain(`aria-label="${kr1.aria}"`);
    expect(s).toContain('title="KR1 共創パートナー企業を30社にする"');
  });
  it("KR を開いているとき、その行が強調される（開いていない行は強調されない）。詳細パネルにもそのKRが出る", () => {
    for (const mode of ["team", "self"] as const) {
      const h = html({ mode, sel: { type: "kr", id: "kr2" } });
      const s = sidebarOf(h);
      expect(s.match(/mk-sb-btn mk-sb-kr is-active/g)?.length).toBe(1);
      expect(s).toMatch(/is-active"[^>]*aria-label="KR2 /);
      expect(h).toContain("KRの詳細");
      expect(h).toContain("このKRにつながる仕事");
    }
    expect(sidebarOf(html())).not.toContain("mk-sb-kr is-active");
  });
  it("利用の広がり（1人だけ・一部のPJ）でも、KR行に見立ての値が出る", () => {
    const rows = sidebarKrRows(okrItems, assess);
    for (const initial of [{ reach: "solo", viewerId: "m3" }, { reach: "pjs" }, { reach: "solo", viewerId: "m1", mode: "self" }] as InitialView[]) {
      const s = sidebarOf(html(initial));
      for (const r of rows) expect(s).toContain(`>${r.value}</span>`);
    }
  });
});

describe("サイドバー：資料と折りたたみ", () => {
  it("「資料を読ませる」で引き出しが開く：どちらのページでもボタンがあり、開いた状態では DocDrawer が出る", () => {
    for (const mode of ["team", "self"] as const) {
      expect(sidebarOf(html({ mode }))).toContain("📄");
      expect(html({ mode })).not.toContain("読ませる資料");
      expect(html({ mode, drawerOpen: true })).toContain("読ませる資料");
    }
  });
  it("折りたたみ（48px）：すべてのボタンが aria-label を持ち、文字は出ない。KR は点だけ（title にラベルと値）", () => {
    const s = sidebarOf(html({ collapsed: true }));
    expect(s).toContain("sidebar");
    expect(s).toContain("is-collapsed");
    const buttons = s.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) expect(b).toContain("aria-label=");
    expect(s).toContain('aria-label="メニューを開く"');
    expect(s).toContain("👥");
    expect(s).toContain("👤");
    expect(s).not.toContain("mk-sb-label");
    expect(s).not.toContain("mock v14");
    expect(s).toMatch(/title="KR1：AIの見立て \d+/);
    expect(html({ collapsed: true })).toContain("mk-app is-sb-collapsed");
    expect(sidebarOf(html())).toContain('aria-label="メニューを閉じる"');
  });
  it("幅：既定 160px・折りたたみ 48px。図＋詳細（360px）が並ぶ境目はサイドバーの分だけ後ろにずれる", () => {
    expect(sidebarWidth(false)).toBe(160);
    expect(sidebarWidth(true)).toBe(48);
    expect(panelNarrowPx(false)).toBe(1373);
    expect(panelNarrowPx(true)).toBe(1261);
    expect(panelNarrowPx(false)).toBeGreaterThan(1280 - 1);
    const css = readFileSync(join(process.cwd(), "src", "okr-mock", "mock4.css"), "utf-8");
    expect(css).toContain("@media (max-width: 1373px)");
    expect(css).toContain("@media (max-width: 1261px)");
  });
});

describe("ページの中身の分担と文言", () => {
  it("チームのページに FocusCard・振り返りは無く、わたしのページにある。知らせはチームのページから「わたし」へ誘導する", () => {
    const team = html({ mode: "team" });
    const self = html({ mode: "self" });
    for (const w of ["今週ここに力を", "今週の振り返り", "期のまとめを出す"]) {
      expect(team).not.toContain(w);
      expect(self).toContain(w);
    }
    expect(team).toContain("決定事項と宿題");
    expect(self).not.toContain("決定事項と宿題");
  });
  it("画面にも文言にも「消化」「Kintone（正）」「「自分」表示」が残っていない", () => {
    const dir = join(process.cwd(), "src", "okr-mock");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        if (statSync(p).isDirectory()) return n === "__tests__" ? [] : files(p);
        return /\.(ts|tsx)$/.test(n) ? [p] : [];
      });
    for (const f of files(dir)) {
      const t = readFileSync(f, "utf-8");
      expect(t, f).not.toContain("消化");
      expect(t, f).not.toContain("Kintone（正）");
      expect(t, f).not.toContain("Kintoneが正です");
      expect(t, f).not.toContain("を正として");
      expect(t, f).not.toContain("「自分」表示");
    }
    for (const h of [html(), html({ mode: "self" }), html({ sel: { type: "kr", id: "kr1" } }), html({ mode: "self", sel: { type: "kr", id: "kr3" } })]) {
      expect(h).not.toContain("消化");
      expect(h).not.toContain("「自分」表示");
    }
    expect(html({ sel: { type: "kr", id: "kr1" } })).toMatch(/完了 \d+％/);
  });
});

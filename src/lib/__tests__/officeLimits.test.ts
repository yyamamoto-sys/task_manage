// 資料抽出の負荷上限・線形走査・非表示シート/スライドの除外（v3.145）の回帰テスト。
// 修正前（v3.144）のコードに対して実行すると、上限・打ち切り・線形・非表示除外の各テストが赤くなる。

import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractXlsxTextFromBytes } from "../xlsxText";
import { extractPptxTextFromBytes } from "../pptxText";
import { extractDocxTextFromBytes } from "../docxText";
import { decodeXmlEntities, EXTRACT_CHAR_CAP, MAX_ZIP_ENTRIES } from "../ooxmlCommon";

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const o: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) o[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(o);
}

const WORKBOOK_2 = `<workbook xmlns:r="x"><sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS_2 = `<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>`;
const sheetOf = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const rowOf = (n: number, text: string) => `<row r="${n}"><c r="A${n}" t="inlineStr"><is><t>${text}</t></is></c></row>`;

describe("上限：展開サイズ・エントリ数", () => {
  it("展開後の合計が50MBを超える xlsx は読まずに拒否する", () => {
    const big = " ".repeat(51 * 1024 * 1024);
    const buf = zip({ "xl/worksheets/sheet1.xml": big });
    expect(() => extractXlsxTextFromBytes(buf)).toThrow(/大きすぎ/);
  });

  it("エントリ数が上限を超える zip は拒否する", () => {
    const files: Record<string, string> = { "xl/worksheets/sheet1.xml": sheetOf(rowOf(1, "x")) };
    for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i++) files[`junk/${i}.txt`] = "";
    expect(() => extractXlsxTextFromBytes(zip(files))).toThrow(/部品の数/);
  });

  it("docx も展開サイズの上限を超えたら拒否する", () => {
    const buf = zip({ "word/document.xml": " ".repeat(51 * 1024 * 1024) });
    expect(() => extractDocxTextFromBytes(buf)).toThrow(/大きすぎ/);
  });
});

describe("打ち切り：取り出した文字が上限に達したら残りを読まない", () => {
  it("xlsx：1枚目で上限を超えたら2枚目は出力に含まない・全体も上限以内", () => {
    let rows = "";
    for (let i = 1; i <= 6000; i++) rows += rowOf(i, "あいうえおかきくけこ");
    const buf = zip({
      "xl/workbook.xml": WORKBOOK_2, "xl/_rels/workbook.xml.rels": RELS_2,
      "xl/worksheets/sheet1.xml": sheetOf(rows),
      "xl/worksheets/sheet2.xml": sheetOf(rowOf(1, "二枚目の目印")),
    });
    const text = extractXlsxTextFromBytes(buf);
    expect(text.length).toBeLessThanOrEqual(EXTRACT_CHAR_CAP);
    expect(text).not.toContain("二枚目の目印");
    expect(text.startsWith("■ A\n")).toBe(true);
  });

  it("pptx：スライドが多くても上限以内で止まる", () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 400; i++) {
      files[`ppt/slides/slide${i}.xml`] = `<p:sld><a:p><a:r><a:t>${"あ".repeat(300)}</a:t></a:r></a:p></p:sld>`;
    }
    const text = extractPptxTextFromBytes(zip(files));
    expect(text.length).toBeLessThanOrEqual(EXTRACT_CHAR_CAP);
    expect(text).not.toContain("【スライド 400】");
  });

  it("docx：段落が多くても上限以内", () => {
    let p = "";
    for (let i = 0; i < 5000; i++) p += `<w:p><w:r><w:t>${"あ".repeat(50)}</w:t></w:r></w:p>`;
    const text = extractDocxTextFromBytes(zip({ "word/document.xml": `<w:document>${p}</w:document>` }));
    expect(text.length).toBeLessThanOrEqual(EXTRACT_CHAR_CAP);
  });
});

describe("閉じタグを欠く入力でも線形で終わる（ReDoS対策）", () => {
  it("xlsx：<row> を2万個並べても1秒以内", () => {
    const buf = zip({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${"<row>".repeat(20000)}` });
    const t0 = performance.now();
    extractXlsxTextFromBytes(buf);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("xlsx：<c> を閉じない行・<si> を閉じない共有文字列も1秒以内", () => {
    const buf = zip({
      "xl/sharedStrings.xml": `<sst>${"<si>".repeat(20000)}`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row>${"<c>".repeat(20000)}</row></sheetData></worksheet>`,
    });
    const t0 = performance.now();
    extractXlsxTextFromBytes(buf);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("pptx：<a:p> を2万個並べても1秒以内", () => {
    const buf = zip({ "ppt/slides/slide1.xml": `<p:sld>${"<a:p>".repeat(20000)}` });
    const t0 = performance.now();
    extractPptxTextFromBytes(buf);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("docx：<w:p> / <w:t> を閉じなくても1秒以内", () => {
    const buf = zip({ "word/document.xml": `<w:document>${"<w:p><w:t>".repeat(20000)}` });
    const t0 = performance.now();
    extractDocxTextFromBytes(buf);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("非表示のシート・スライドは抽出しない", () => {
  it("xlsx：state=hidden / veryHidden のシートは除き、表示のシートだけ読む", () => {
    const workbook = `<workbook xmlns:r="x"><sheets>
      <sheet name="見える" sheetId="1" r:id="rId1"/>
      <sheet name="隠し" sheetId="2" state="hidden" r:id="rId2"/>
      <sheet name="深い隠し" sheetId="3" state="veryHidden" r:id="rId3"/></sheets></workbook>`;
    const rels = `<Relationships>
      <Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="t" Target="worksheets/sheet3.xml"/></Relationships>`;
    const buf = zip({
      "xl/workbook.xml": workbook, "xl/_rels/workbook.xml.rels": rels,
      "xl/worksheets/sheet1.xml": sheetOf(rowOf(1, "表示の内容")),
      "xl/worksheets/sheet2.xml": sheetOf(rowOf(1, "隠しの内容")),
      "xl/worksheets/sheet3.xml": sheetOf(rowOf(1, "深い隠しの内容")),
    });
    const text = extractXlsxTextFromBytes(buf);
    expect(text).toContain("表示の内容");
    expect(text).not.toContain("隠しの内容");
    expect(text).not.toContain("■ 隠し");
  });

  it("pptx：show=0 のスライドは除き、見出しの番号は元の順番のまま", () => {
    const buf = zip({
      "ppt/slides/slide1.xml": `<p:sld xmlns:a="x"><a:p><a:r><a:t>一枚目</a:t></a:r></a:p></p:sld>`,
      "ppt/slides/slide2.xml": `<p:sld show="0"><a:p><a:r><a:t>隠しスライド</a:t></a:r></a:p></p:sld>`,
      "ppt/slides/slide3.xml": `<p:sld><a:p><a:r><a:t>三枚目</a:t></a:r></a:p></p:sld>`,
    });
    const text = extractPptxTextFromBytes(buf);
    expect(text).toContain("一枚目");
    expect(text).toContain("三枚目");
    expect(text).not.toContain("隠しスライド");
    expect(text).toContain("【スライド 3】");
  });
});

describe("xlsx：右端の遠い列・行末の空セル", () => {
  it("遠い列に値があっても連続する空セルのタブは最大に詰める", () => {
    const row = `<row r="1"><c r="A1" t="inlineStr"><is><t>左</t></is></c><c r="CV1" t="inlineStr"><is><t>右</t></is></c></row>`;
    const text = extractXlsxTextFromBytes(zip({ "xl/worksheets/sheet1.xml": sheetOf(row) }));
    const line = text.split("\n")[1];
    expect(line).toBe("左" + "\t".repeat(21) + "右");
  });

  it("行末の空セルは出さず、値の無い行は詰める", () => {
    const rows =
      `<row r="1"><c r="A1" t="inlineStr"><is><t>値</t></is></c><c r="B1"/><c r="C1" t="inlineStr"><is><t></t></is></c></row>` +
      `<row r="2"><c r="A2"/><c r="B2"/></row>`;
    const text = extractXlsxTextFromBytes(zip({ "xl/worksheets/sheet1.xml": sheetOf(rows) }));
    expect(text).toBe("■ シート1\n値");
  });
});

describe("XMLエンティティ", () => {
  it("範囲外の文字参照は置換文字にして続行する（例外にしない）", () => {
    expect(decodeXmlEntities("a&#99999999;b")).toBe("a�b");
    expect(decodeXmlEntities("a&#xD800;b&#x110000;c")).toBe("a�b�c");
    expect(decodeXmlEntities("&#65;&#x42;")).toBe("AB");
  });

  it("&amp;lt; は &lt;（二重にデコードしない）", () => {
    expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("xlsx：セルの種類・属性の欠け・workbook.xml が無いとき", () => {
  it("t=e（エラー値）・t=str（数式の文字列結果）・&amp;lt; を正しく読む", () => {
    const row =
      `<row r="1"><c r="A1" t="e"><v>#DIV/0!</v></c><c r="B1" t="str"><f>A1&amp;"x"</f><v>結果&amp;lt;</v></c></row>`;
    const text = extractXlsxTextFromBytes(zip({ "xl/worksheets/sheet1.xml": sheetOf(row) }));
    expect(text).toBe("■ シート1\n#DIV/0!\t結果&lt;");
  });

  it("r 属性が無いセルは出現順に並べる", () => {
    const row = `<row><c t="inlineStr"><is><t>一</t></is></c><c t="inlineStr"><is><t>二</t></is></c></row>`;
    const text = extractXlsxTextFromBytes(zip({ "xl/worksheets/sheet1.xml": sheetOf(row) }));
    expect(text).toBe("■ シート1\n一\t二");
  });

  it("workbook.xml が無いときはシートを番号順（sheet2 の次が sheet10）に並べる", () => {
    const buf = zip({
      "xl/worksheets/sheet10.xml": sheetOf(rowOf(1, "十")),
      "xl/worksheets/sheet2.xml": sheetOf(rowOf(1, "二")),
      "xl/worksheets/sheet1.xml": sheetOf(rowOf(1, "一")),
    });
    expect(extractXlsxTextFromBytes(buf)).toBe("■ シート1\n一\n\n■ シート2\n二\n\n■ シート10\n十");
  });
});

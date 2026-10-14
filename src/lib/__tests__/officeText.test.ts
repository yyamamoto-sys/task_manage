import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractXlsxTextFromBytes } from "../xlsxText";
import { extractPptxTextFromBytes } from "../pptxText";

function zip(files: Record<string, string>): Uint8Array {
  const o: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) o[k] = strToU8(v);
  return zipSync(o);
}

describe("extractXlsxTextFromBytes", () => {
  const workbook = `<workbook xmlns:r="x"><sheets><sheet name="売上 &amp; 計画" sheetId="1" r:id="rId2"/><sheet name="メモ" sheetId="2" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
  const sst = `<sst><si><t>品目</t></si><si><r><t>りんご</t></r><r><t xml:space="preserve"> A</t></r><rPh><t>リンゴ</t></rPh></si><si/><si><t>メモ内容</t></si></sst>`;
  const sheet2 = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
    <row r="2"></row>
    <row r="3"><c r="A3"><v>45000</v></c><c r="B3"><f>A3*2</f><v>90000</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="inlineStr"><is><t>x&lt;y</t></is></c></row>
    <row r="4"><c r="A4" s="2"/></row>
  </sheetData></worksheet>`;
  const sheet1 = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row></sheetData></worksheet>`;
  const buf = zip({
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": rels,
    "xl/sharedStrings.xml": sst,
    "xl/worksheets/sheet1.xml": sheet1,
    "xl/worksheets/sheet2.xml": sheet2,
  });

  it("シート名（workbook順）の見出し・タブ区切り・数式の計算結果・空行詰め・ふりがな除外", () => {
    expect(extractXlsxTextFromBytes(buf)).toBe(
      "■ 売上 & 計画\n品目\t\tりんご A\n45000\t90000\tTRUE\tx<y\n\n■ メモ\nメモ内容",
    );
  });

  it("xlsx でない zip は例外", () => {
    expect(() => extractXlsxTextFromBytes(zip({ "a.txt": "x" }))).toThrow();
    expect(() => extractXlsxTextFromBytes(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("extractPptxTextFromBytes", () => {
  const pres = `<p:presentation xmlns:r="x"><p:sldIdLst><p:sldId id="256" r:id="rId5"/><p:sldId id="257" r:id="rId4"/></p:sldIdLst></p:presentation>`;
  const presRels = `<Relationships><Relationship Id="rId4" Type="t" Target="slides/slide1.xml"/><Relationship Id="rId5" Type="t" Target="slides/slide2.xml"/></Relationships>`;
  const slide = (lines: string[]) =>
    `<p:sld>${lines.map(l => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}<a:p><a:fld type="slidenum"><a:t>9</a:t></a:fld></a:p></p:sld>`;
  const buf = zip({
    "ppt/presentation.xml": pres,
    "ppt/_rels/presentation.xml.rels": presRels,
    "ppt/slides/slide1.xml": slide(["二枚目 &amp; 補足", "本文"]),
    "ppt/slides/slide2.xml": slide(["表紙"]),
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId1" Type="t" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
    "ppt/notesSlides/notesSlide7.xml": slide(["話すこと"]),
  });

  it("表示順（presentation.xml）・段落ごと・ノート・スライド番号除外", () => {
    expect(extractPptxTextFromBytes(buf)).toBe(
      "【スライド 1】\n表紙\n\n【スライド 2】\n二枚目 & 補足\n本文\n（ノート）\n話すこと",
    );
  });

  it("presentation.xml が無ければ番号順", () => {
    const b = zip({
      "ppt/slides/slide2.xml": slide(["B"]),
      "ppt/slides/slide10.xml": slide(["C"]),
      "ppt/slides/slide1.xml": slide(["A"]),
    });
    expect(extractPptxTextFromBytes(b)).toBe("【スライド 1】\nA\n\n【スライド 2】\nB\n\n【スライド 3】\nC");
  });

  it("pptx でなければ例外", () => {
    expect(() => extractPptxTextFromBytes(zip({ "a.txt": "x" }))).toThrow();
  });
});

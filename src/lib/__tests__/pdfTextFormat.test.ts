// src/lib/__tests__/pdfTextFormat.test.ts
//
// pdfjs-dist本体（ブラウザ専用ビルド）に依存しない純粋関数だけをテストする。
// PDFの実パース自体はライブラリ依存かつvitestのenvironmentが"node"（DOM無し）のため、
// 実PDFを読むテストはここでは作らない（CLAUDE.md指示どおり）。

import { describe, it, expect } from "vitest";
import {
  isPdfFile,
  isBlankExtractedText,
  normalizePdfText,
  pageItemsToText,
  PDF_EMPTY_TEXT_MESSAGE,
} from "../pdfTextFormat";

describe("isPdfFile", () => {
  it("MIMEタイプがapplication/pdfならtrue", () => {
    const file = new File(["dummy"], "report", { type: "application/pdf" });
    expect(isPdfFile(file)).toBe(true);
  });

  it("拡張子が.pdfならtrue（MIMEタイプ未設定でも判定できる）", () => {
    const file = new File(["dummy"], "report.PDF", { type: "" });
    expect(isPdfFile(file)).toBe(true);
  });

  it("拡張子が.pdf以外ならfalse", () => {
    const file = new File(["dummy"], "report.docx", { type: "" });
    expect(isPdfFile(file)).toBe(false);
  });
});

describe("isBlankExtractedText", () => {
  it("空文字はtrue", () => {
    expect(isBlankExtractedText("")).toBe(true);
  });

  it("空白・改行のみはtrue（スキャン画像PDF等の判定用）", () => {
    expect(isBlankExtractedText("   \n\n\t  ")).toBe(true);
  });

  it("文字を含む場合はfalse", () => {
    expect(isBlankExtractedText("個人KR_1")).toBe(false);
  });
});

describe("normalizePdfText", () => {
  it("連続する半角スペース・タブ・全角スペースを1つの半角スペースに圧縮する", () => {
    expect(normalizePdfText("個人KR_1　　ウェイト\t\t35%")).toBe("個人KR_1 ウェイト 35%");
  });

  it("各行をトリムする", () => {
    expect(normalizePdfText("  行1  \n  行2  ")).toBe("行1\n行2");
  });

  it("3行以上の空行は2行に圧縮する", () => {
    expect(normalizePdfText("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("前後の空白をtrimする", () => {
    expect(normalizePdfText("\n\n本文\n\n")).toBe("本文");
  });
});

describe("pageItemsToText", () => {
  it("hasEOL:trueで改行し、同じ行内はスペースで連結する", () => {
    const items = [
      { str: "個人KR_1", hasEOL: false },
      { str: "AAS", hasEOL: true },
      { str: "ウェイト35%", hasEOL: true },
    ];
    expect(pageItemsToText(items)).toBe("個人KR_1 AAS\nウェイト35%");
  });

  it("最後のhasEOLが無い残りの断片も出力する", () => {
    const items = [
      { str: "1か月目", hasEOL: true },
      { str: "計画", hasEOL: false },
    ];
    expect(pageItemsToText(items)).toBe("1か月目\n計画");
  });

  it("str以外のプロパティを持つ項目（marked contentなど）は無視する", () => {
    const items = [
      { type: "beginMarkedContent" },
      { str: "本文", hasEOL: true },
    ];
    expect(pageItemsToText(items)).toBe("本文");
  });

  it("空文字のstrは連結時に無視する（空要素が並ばない）", () => {
    const items = [
      { str: "", hasEOL: false },
      { str: "テキスト", hasEOL: true },
    ];
    expect(pageItemsToText(items)).toBe("テキスト");
  });

  it("空配列は空文字を返す", () => {
    expect(pageItemsToText([])).toBe("");
  });
});

describe("PDF_EMPTY_TEXT_MESSAGE", () => {
  it("次に何をすればよいかが分かる文言になっている", () => {
    expect(PDF_EMPTY_TEXT_MESSAGE).toContain("読み取れませんでした");
    expect(PDF_EMPTY_TEXT_MESSAGE).toContain("貼り付けて");
  });
});

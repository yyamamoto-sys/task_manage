// src/lib/__tests__/fileAttachMediaType.test.ts
//
// FileAttachButton.tsx から切り出した判定ロジック（.docx/.html/.pdfの専用抽出処理を
// 早期returnした「残り」に対する拡張子推定・対応形式判定）の回帰テスト。
// PDF/Word/HTML添付を追加してもこの既存経路（画像・テキスト・非対応の判定）が
// 壊れていないことを確認する。

import { describe, it, expect } from "vitest";
import { resolveMediaType, isSupportedMediaType, TEXT_MEDIA_TYPES, IMAGE_MEDIA_TYPES } from "../fileAttachMediaType";

describe("resolveMediaType", () => {
  it("file.typeが設定されていればそれを優先する", () => {
    expect(resolveMediaType({ type: "image/png", name: "x.bin" })).toBe("image/png");
  });

  it("file.typeが空のときは拡張子から推定する（txt/md/csv/html/画像）", () => {
    expect(resolveMediaType({ type: "", name: "note.txt" })).toBe("text/plain");
    expect(resolveMediaType({ type: "", name: "note.md" })).toBe("text/markdown");
    expect(resolveMediaType({ type: "", name: "note.csv" })).toBe("text/csv");
    expect(resolveMediaType({ type: "", name: "note.html" })).toBe("text/html");
    expect(resolveMediaType({ type: "", name: "photo.png" })).toBe("image/png");
    expect(resolveMediaType({ type: "", name: "photo.JPG" })).toBe("image/jpeg");
    expect(resolveMediaType({ type: "", name: "photo.webp" })).toBe("image/webp");
    expect(resolveMediaType({ type: "", name: "photo.gif" })).toBe("image/gif");
  });

  it("拡張子が不明・非対応なら空文字を返す", () => {
    expect(resolveMediaType({ type: "", name: "archive.zip" })).toBe("");
  });

  it("拡張子が.pdf/.docxのファイルは、専用抽出処理へ早期returnされ元々この関数には到達しないが、\n" +
    "到達した場合でもマッピング表に含めていないため空文字（非対応）を返す", () => {
    expect(resolveMediaType({ type: "", name: "report.pdf" })).toBe("");
    expect(resolveMediaType({ type: "", name: "report.docx" })).toBe("");
  });
});

describe("isSupportedMediaType", () => {
  it("テキスト系MIMEタイプは対応", () => {
    for (const t of TEXT_MEDIA_TYPES) expect(isSupportedMediaType(t)).toBe(true);
  });

  it("画像系MIMEタイプは対応", () => {
    for (const t of IMAGE_MEDIA_TYPES) expect(isSupportedMediaType(t)).toBe(true);
  });

  it("空文字・未知のMIMEタイプは非対応", () => {
    expect(isSupportedMediaType("")).toBe(false);
    expect(isSupportedMediaType("application/zip")).toBe(false);
  });

  it("application/pdfは対応表に含めない（PDFは専用の抽出処理へ早期returnされ、この判定には来ない）", () => {
    expect(isSupportedMediaType("application/pdf")).toBe(false);
  });
});

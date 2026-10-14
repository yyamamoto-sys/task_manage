import { describe, it, expect } from "vitest";
import { decodeTextBytes } from "../textDecode";
import { resolveMediaType } from "../fileAttachMediaType";
import { checkConsultAttachFile, MAX_CONSULT_FILE_BYTES } from "../ai/consultationAttachmentLoader";

// 「こんにちは、テスト」の Shift_JIS バイト列
const SJIS_JA = [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x81, 0x41, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67];

describe("decodeTextBytes（文字コード）", () => {
  it("UTF-8 はそのまま読む（BOMは除く）", () => {
    const bytes = new TextEncoder().encode("﻿あいう,abc");
    expect(decodeTextBytes(bytes, false)).toBe("あいう,abc");
  });

  it("Shift_JIS の CSV は文字化けせず Shift_JIS で読み直す", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("a,b\n"), ...SJIS_JA]);
    expect(decodeTextBytes(bytes, false)).toBe("a,b\nこんにちは、テスト");
  });

  it("UTF-8 に不正なバイトが少し混じる程度なら UTF-8 のまま読む", () => {
    const body = new TextEncoder().encode("あ".repeat(300));
    const bytes = new Uint8Array([...body, 0xff]);
    const text = decodeTextBytes(bytes, false);
    expect(text.startsWith("あ".repeat(300))).toBe(true);
    expect(text.endsWith("�")).toBe(true);
  });

  it("途中で切った UTF-8 は、文字の途中の末尾バイトを捨てて化けさせない", () => {
    const full = new TextEncoder().encode("あい");
    const cut = full.slice(0, full.length - 1);
    expect(decodeTextBytes(cut, true)).toBe("あ");
  });

  it("UTF-16LE（BOMつき）も読める", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x42, 0x30, 0x44, 0x30]);
    expect(decodeTextBytes(bytes, false)).toBe("あい");
  });
});

describe("テキストの拡張子は file.type より優先する", () => {
  it("Windows で .csv の type が Excel の MIME になっていても text/csv", () => {
    expect(resolveMediaType({ type: "application/vnd.ms-excel", name: "data.csv" })).toBe("text/csv");
    expect(resolveMediaType({ type: "application/octet-stream", name: "memo.txt" })).toBe("text/plain");
    expect(resolveMediaType({ type: "", name: "table.tsv" })).toBe("text/csv");
  });

  it(".csv は type が Excel でも添付できる", () => {
    expect(checkConsultAttachFile({ type: "application/vnd.ms-excel", name: "data.csv", size: 10 }).ok).toBe(true);
  });

  it("画像の type は従来どおり優先される（拡張子が不明なとき）", () => {
    expect(resolveMediaType({ type: "image/png", name: "x.bin" })).toBe("image/png");
  });
});

describe("ファイル容量の上限", () => {
  it("20MBを超えるファイルは理由つきで断る", () => {
    const r = checkConsultAttachFile({ type: "", name: "big.txt", size: MAX_CONSULT_FILE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("20MB");
  });

  it("20MBちょうどは受け付ける", () => {
    expect(checkConsultAttachFile({ type: "", name: "ok.txt", size: MAX_CONSULT_FILE_BYTES }).ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { sanitizeComment } from "../sanitize";

describe("sanitizeComment", () => {
  it("空文字・undefined は空文字を返す", () => {
    expect(sanitizeComment("")).toBe("");
    expect(sanitizeComment(undefined as unknown as string)).toBe("");
  });

  it("通常の日本語コメントはそのまま返す", () => {
    const input = "明日までに資料を確認してください";
    expect(sanitizeComment(input)).toBe(input);
  });

  it("Windowsネットワークパス（\\\\server\\share）を除去する", () => {
    const input = "\\\\Fs02\\bumon\\資料.xlsx を確認";
    expect(sanitizeComment(input)).toBe("[ファイルパス省略] を確認");
  });

  it("UNCパス（//server/path）を除去する", () => {
    const input = "//fileserver/share/data.csv をダウンロード";
    expect(sanitizeComment(input)).toBe("[ファイルパス省略] をダウンロード");
  });

  it("Windowsローカルパス（C:\\...）を除去する", () => {
    const input = "C:\\Users\\yyamamoto\\Desktop\\file.txt にあります";
    expect(sanitizeComment(input)).toBe("[ファイルパス省略] にあります");
  });

  it("ドライブレター大文字小文字どちらも除去する", () => {
    expect(sanitizeComment("d:\\data\\x.csv")).toBe("[ファイルパス省略]");
    expect(sanitizeComment("Z:\\backup\\y.zip")).toBe("[ファイルパス省略]");
  });

  it("メールアドレスを除去する", () => {
    const input = "tanaka@example.com に送付してください";
    expect(sanitizeComment(input)).toBe("[メールアドレス省略] に送付してください");
  });

  it("複数のメールアドレスを全て除去する", () => {
    const input = "a@x.com と b.c+d@y.co.jp を CC";
    expect(sanitizeComment(input)).toBe("[メールアドレス省略] と [メールアドレス省略] を CC");
  });

  it("ネットワークパス・メールが混在しても全て除去する", () => {
    const input = "\\\\srv\\file.xlsx を tanaka@example.com に共有";
    expect(sanitizeComment(input)).toBe("[ファイルパス省略] を [メールアドレス省略] に共有");
  });

  it("URL（http/https）はそのまま残す（業務情報として有用）", () => {
    const input = "詳細は https://example.com/page を参照";
    expect(sanitizeComment(input)).toBe("詳細は https://example.com/page を参照");
  });

  it("前後の空白をトリムする", () => {
    expect(sanitizeComment("  hello  ")).toBe("hello");
  });
});

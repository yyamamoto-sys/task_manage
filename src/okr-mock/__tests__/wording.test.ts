import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("画面の文言（第10版）", () => {
  const files = sources(join(process.cwd(), "src", "okr-mock"));

  it("テスト以外のソースに、「効」（有効を除く）・C→B・「AI の見立て」（空白あり）が残っていない", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, "utf-8");
      expect(text.replace(/有効/g, ""), f).not.toContain("効");
      expect(text, f).not.toContain("C→B");
      expect(text, f).not.toContain("AI の見立て");
    }
  });
});

// ガイドの表示（GuideOverlay）が Esc で閉じ、背後のモーダルへ Esc を渡さないことの固定（v3.186）。
// jsdom が無いため、ソース走査（コメント除去後・CLAUDE.md Section 59）で検査する。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
}
const src = strip(readFileSync(join(__dirname, "..", "GuideOverlay.tsx"), "utf8"));

describe("GuideOverlay の Esc", () => {
  it("window の capture 段階で Esc を受けて閉じ、止める（closeOnEscapeAndStop）", () => {
    expect(src).toMatch(/closeOnEscapeAndStop\(e, \(\) => onCloseRef\.current\(\)\)/);
    expect(src).toMatch(/window\.addEventListener\("keydown", handler, true\)/);
    expect(src).toMatch(/window\.removeEventListener\("keydown", handler, true\)/);
  });

  it("role=dialog を持つ（useConfirmClose の isEscapeOwnedByOverlay が、背後のモーダルを閉じさせない）", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
  });
});

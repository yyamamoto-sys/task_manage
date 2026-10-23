// 添付の配線をソースで固定する（Reactのレンダリング基盤が無いため、useAIConsultation 等は走査で検査する）。
// コメントを除去してから走査する（CLAUDE.md Section 59：コメントに書いた語で検査が無力化されないように）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readStripped(rel: string): string {
  const src = readFileSync(resolve(__dirname, "../../../..", rel), "utf-8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
}

describe("useAIConsultation は履歴に添付の本文を積まない", () => {
  const src = readStripped("src/hooks/useAIConsultation.ts");

  it("ユーザー発話は buildUserTurnContent（マーカー行だけ）で作る", () => {
    expect(src).toContain("buildUserTurnContent(consultation, attachments)");
  });

  it("ユーザー発話に相談文そのままや添付本文を直接入れていない", () => {
    expect(src).not.toMatch(/role:\s*"user"\s+as const,\s*content:\s*consultation\s*,/);
    expect(src).not.toMatch(/content:\s*consultation\s*,/);
    expect(src).not.toMatch(/attachments\.map\([^)]*\.data/);
  });

  it("添付は runAIConsultation へそのまま渡す", () => {
    expect(src).toMatch(/runAIConsultation\([\s\S]*?attachments,\s*(logUsage,\s*)?\)/);
  });

  it("送信の成否を返す（失敗時に画面が添付を戻せる）", () => {
    expect(src).toMatch(/setCallState\("success"\);\s*return true;/);
    expect(src).toMatch(/setCallState\("error"\);\s*return false;/);
  });
});

describe("起動時のバンドルに抽出コード（fflate・pdfjs）を入れない（Section 19）", () => {
  const HEAVY = /(docxText|xlsxText|pptxText|htmlText|ooxmlCommon|pdfText\b|pdfAttachment)/;

  function staticImports(rel: string): string[] {
    const src = readStripped(rel);
    // 行頭が import で始まる静的import（動的import(...) は含まない）
    return [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
  }

  it.each([
    "src/lib/ai/consultationAttachment.ts",
    "src/lib/ai/consultationAttachmentLoader.ts",
    "src/lib/ai/apiClient.ts",
    "src/lib/ai/consultationRunner.ts",
    "src/lib/officeFileKind.ts",
    "src/lib/textDecode.ts",
    "src/lib/extractLimits.ts",
    "src/lib/fileAttachMediaType.ts",
    "src/components/consultation/ConsultAttachments.tsx",
    "src/components/consultation/ConsultationPanel.tsx",
  ])("%s は抽出本体を静的importしない", (rel) => {
    const heavy = staticImports(rel).filter(s => HEAVY.test(s));
    expect(heavy).toEqual([]);
  });

  it("officeFileKind.ts は何もimportしない（fflateに依存しない）", () => {
    expect(staticImports("src/lib/officeFileKind.ts")).toEqual([]);
  });

  it("抽出本体は読み込み側で動的importしている", () => {
    const src = readStripped("src/lib/ai/consultationAttachmentLoader.ts");
    for (const m of ["../docxText", "../xlsxText", "../pptxText", "../htmlText", "../pdfAttachment"]) {
      expect(src).toContain(`import("${m}")`);
    }
  });
});

describe("読み込み中の送信・同時読み込み・送信失敗時の扱い", () => {
  it("ConsultAttachments は読み込みを同時に1回だけにし、親へ読み込み中を伝える", () => {
    const src = readStripped("src/components/consultation/ConsultAttachments.tsx");
    expect(src).toContain("loadingRef.current");
    expect(src).toMatch(/if \(disabled \|\| files\.length === 0 \|\| loadingRef\.current\) return;/);
    expect(src).toContain("onLoadingChangeRef.current?.(true)");
    expect(src).toContain("onLoadingChangeRef.current?.(false)");
  });

  it("ConsultationPanel は読み込み中に送信できず、失敗したら添付を戻す", () => {
    const src = readStripped("src/components/consultation/ConsultationPanel.tsx");
    expect(src).toContain("!attachLoading");
    expect(src).toContain("disabled={!canSubmit}");
    expect(src).toMatch(/const ok = await submit\(/);
    expect(src).toMatch(/if \(!ok && sentAttachments\.length > 0\)/);
  });
});

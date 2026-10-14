// AIへ送る経路でタスクのコメントが sanitizeComment を通っていることの検査（CLAUDE.md Section 6-4）。
// PJ単体AI分析だけ素通しだった漏れの再発防止。

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const invokeAIMock = vi.fn();
vi.mock("../invokeAI", () => ({
  invokeAI: (...args: unknown[]) => invokeAIMock(...args),
}));

import { analyzeProject, type ProjectAnalysisInput } from "../projectAnalysisClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_DIR = path.resolve(__dirname, "..");

describe("PJ単体のAI分析：タスクのコメントは sanitizeComment を通して送る", () => {
  it("メールアドレス・ネットワークパスがプロンプトに含まれない", async () => {
    invokeAIMock.mockResolvedValue({ content: [{ text: "ok" }] });
    const input = {
      today: "2026-10-13",
      project: { name: "P", purpose: "", status: "active", start_date: "", end_date: "", owner_short_names: [] },
      members_short_names: [],
      milestones: [],
      tasks: [{
        name: "T", status: "todo", priority: null, due_date: null, start_date: null,
        estimated_hours: null, updated_at: null, completed_at: null, assignee_short_name: "",
        comment: String.raw`tanaka@example.com に送付 \\fs02\bumon\x.xlsx`,
      }],
    } as unknown as ProjectAnalysisInput;
    await analyzeProject(input);
    const sent = JSON.stringify(invokeAIMock.mock.calls[0][1]);
    expect(sent).not.toContain("tanaka@example.com");
    expect(sent).not.toContain("fs02");
    expect(sent).toContain("[メールアドレス省略]");
  });
});

describe("AIへ送る経路の網羅：タスクの comment を読む lib/ai のファイルは sanitizeComment を使う", () => {
  it("`.comment` を参照する送信系ファイルはすべて sanitizeComment を import している", () => {
    // applyProposal.ts は AI の提案を DB へ反映する側（送信ではない）ため対象外
    const exempt = new Set(["applyProposal.ts", "sanitize.ts"]);
    const offenders = fs.readdirSync(AI_DIR)
      .filter(f => f.endsWith(".ts") && !exempt.has(f))
      .filter(f => {
        const src = fs.readFileSync(path.join(AI_DIR, f), "utf-8");
        return /\b(?:t|task|tk)\.comment\b/.test(src) && !/import\s*\{[^}]*sanitizeComment[^}]*\}\s*from/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});

describe("AIへ送る経路の網羅：タスクの deliverable（成果物）は deliverableForAi を通す（v3.149）", () => {
  it("`.deliverable` を参照する送信系ファイルはすべて deliverableForAi を import している", () => {
    const offenders = fs.readdirSync(AI_DIR)
      .filter(f => f.endsWith(".ts") && f !== "applyProposal.ts" && f !== "systemPrompt.ts")
      .filter(f => {
        const src = fs.readFileSync(path.join(AI_DIR, f), "utf-8")
          .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
        return /\b(?:t|task|tk)\.deliverable\b/.test(src) && !/import\s*\{[^}]*deliverableForAi[^}]*\}\s*from/.test(src);
      });
    expect(offenders).toEqual([]);
  });
  it("payloadBuilder は成果物を deliverableForAi 経由でだけ載せる（URL を除去した説明のみ）", () => {
    const src = fs.readFileSync(path.join(AI_DIR, "payloadBuilder.ts"), "utf-8");
    expect(src).toContain("deliverable: deliverableForAi(task.deliverable)");
  });
});

// src/lib/ai/__tests__/systemPrompt.test.ts
//
// 【設計意図】
// add_project の「新規PJ作成ヒアリング・プロトコル」が全 consultation モードの
// システムプロンプトに行き渡っていることを機械保証する。
// RESPONSE_FORMAT / BASE_SYSTEM は各モードへ template literal で合成されるため、
// どこか1モードだけ取りこぼす事故を防ぐ（プロンプトはAI挙動の単一の真実なので、
// 文字列が落ちると静かに挙動が壊れる）。

import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPTS } from "../systemPrompt";

describe("systemPrompt: 新規PJ作成ヒアリング・プロトコル", () => {
  const prompts = Object.entries(SYSTEM_PROMPTS);

  it("全モードにヒアリング・プロトコルの見出しが含まれる", () => {
    for (const [type, prompt] of prompts) {
      expect(prompt, `${type} モードにヒアリング見出しが無い`).toContain(
        "新規PJ作成のヒアリング・プロトコル",
      );
    }
  });

  it("全モードでヒアリングが info アクションを使う指示を含む", () => {
    for (const [type, prompt] of prompts) {
      expect(prompt, `${type} モードに info ヒアリング指示が無い`).toContain(
        'action_type="info"',
      );
    }
  });

  it("全モードのJSONスキーマ例に info アクションが含まれる（parserと整合）", () => {
    for (const [type, prompt] of prompts) {
      expect(prompt, `${type} モードのスキーマ例に "info" が無い`).toContain(
        '"milestone" | "info" | "add_task"',
      );
    }
  });

  it("ヒアリングは最大2往復で打ち切る指示を含む", () => {
    for (const [type, prompt] of prompts) {
      expect(prompt, `${type} モードに打ち切り条件が無い`).toContain(
        "2 回ヒアリング質問をしている",
      );
    }
  });
});

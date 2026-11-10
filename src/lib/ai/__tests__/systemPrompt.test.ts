// src/lib/ai/__tests__/systemPrompt.test.ts
//
// 【設計意図】
// add_project の「新規PJ作成ヒアリング・プロトコル」が全 consultation モードの
// システムプロンプトに行き渡っていることを機械保証する。
// RESPONSE_FORMAT / BASE_SYSTEM は各モードへ template literal で合成されるため、
// どこか1モードだけ取りこぼす事故を防ぐ（プロンプトはAI挙動の単一の真実なので、
// 文字列が落ちると静かに挙動が壊れる）。

import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPTS, buildSystemPrompt, buildSystemPromptParts } from "../systemPrompt";
import type { ConsultationType } from "../types";

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

  it("JSONの書き方の注意と consultation_type の注記は持たない（構造化出力で形を強制・種類は AI に送らない）", () => {
    for (const [type, prompt] of prompts) {
      expect(prompt, type).not.toContain("JSONの厳格な作法");
      expect(prompt, type).not.toContain("JSON以外の文字列を返さない");
      expect(prompt, type).not.toContain("consultation_type");
    }
  });
});

describe("systemPrompt: キャッシュする本文と可変の追記の分離", () => {
  it("本文はボリューム・添付で変わらず、可変部分だけが変わる", () => {
    const a = buildSystemPromptParts("normal", false);
    const b = buildSystemPromptParts("detailed", true);
    expect(b.cached).toBe(a.cached);
    expect(a.variable).toBe("");
    expect(b.variable).toContain("回答ボリューム指定");
    expect(b.variable).toContain("添付資料の扱い");
    expect(b.cached).not.toContain("回答ボリューム指定");
  });

  it("本文＋追記は1本版（buildSystemPrompt）と同じ内容になる", () => {
    const parts = buildSystemPromptParts("short", true);
    const whole = buildSystemPrompt("change", "short", true);
    expect(whole.startsWith(parts.cached)).toBe(true);
    expect(whole.slice(parts.cached.length).trim()).toBe(parts.variable);
  });
});

describe("systemPrompt: 1本化と返答の書き方（v3.206）", () => {
  const types = Object.keys(SYSTEM_PROMPTS) as ConsultationType[];

  it("相談の種類によらず本文が同一（キャッシュのため・誤判定の役割指示を入れないため）", () => {
    const base = buildSystemPrompt("change", "normal");
    for (const t of types) expect(buildSystemPrompt(t, "normal"), t).toBe(base);
  });

  it("旧5モードの対応が小見出しとして残っている", () => {
    const p = buildSystemPrompt("change");
    for (const h of [
      "### 変更の影響を聞かれたとき",
      "### もしも〜の仮定のとき（is_simulation=true）",
      "### 現状診断を求められたとき",
      "### 締め切りに間に合うかを聞かれたとき",
      "### 停止・縮小を検討するとき",
    ]) expect(p).toContain(h);
  });

  it("締め切り日が無いときにエラーを返させない（画面は target_deadline を常に null で送る）", () => {
    const p = buildSystemPrompt("deadline_check");
    expect(p).not.toContain("締め切り日が指定されていません");
    expect(p).toContain("target_deadline が null なら、ユーザーの文面から締め切り日を読み取る");
  });

  it("コメント追記の提案は診断を求められたときに限る", () => {
    expect(buildSystemPrompt("diagnose")).toContain("診断を求められたときに限り");
  });

  it("アーカイブ済みの画面（なぜなぜ・計画タブ）や送っていない kr_sessions を案内しない", () => {
    const p = buildSystemPrompt("change");
    expect(p).not.toContain("「なぜなぜ」タブ");
    expect(p).not.toContain("「計画」タブ");
    expect(p).not.toContain("kr_sessions");
  });

  it("reply 欄・書式・タスク参照の書き方を指示している", () => {
    const p = buildSystemPrompt("change");
    expect(p).toContain('"reply":');
    expect(p).toContain("Markdownの表・見出し記号(#)・太字(**)は使わない");
    expect(p).toContain("タスク名(task_001)");
    expect(p).toContain("proposals は最大5件");
    expect(p).not.toContain("1行に要約する");
  });
});

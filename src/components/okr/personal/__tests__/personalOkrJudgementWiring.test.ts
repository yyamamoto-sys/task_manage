// src/components/okr/personal/__tests__/personalOkrJudgementWiring.test.ts
//
// 【設計意図】v3.180：画面側の配線（Reactレンダリングテスト基盤が無いためソース走査）。
// CLAUDE.md Section 59：コメント・文字列リテラルに書いた語で通らないよう、行頭コメントを除いて照合する。
// 修正前のソースに同じ検査を当てて赤くなることを確認済み。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .map(line => line.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}
const read = (rel: string) => strip(fs.readFileSync(path.resolve(__dirname, rel), "utf-8"));

describe("M54：KRタブ・月を切り替えたらAIパネルの会話履歴を作り直す", () => {
  it("PersonalOkrAiPanelにkeyを渡し、keyにKRと月の両方が含まれる", () => {
    const src = read("../PersonalOkrView.tsx");
    const m = src.match(/<PersonalOkrAiPanel\s+key=\{(`[^`]*`)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("selectedKrId");
    expect(m![1]).toContain("monthIndex");
  });
});

describe("M58：送信に失敗したら入力欄へ元の文を戻す", () => {
  it("フックは失敗時にrollbackLastUserTurnで巻き戻し、falseを返す", () => {
    const src = read("../../../../hooks/usePersonalOkrAiConsultation.ts");
    expect(src).toMatch(/setSession\(rollbackLastUserTurn\)/);
    expect(src).toMatch(/return false;/);
  });
  it("パネルはsubmitの結果がfalseのとき入力欄へ送った文を戻す", () => {
    const src = read("../PersonalOkrAiPanel.tsx");
    expect(src).toMatch(/const ok = await submit\(/);
    expect(src).toMatch(/if \(!ok\) setInputText\(/);
  });
});

describe("M56・M62：3つの下書きモーダルが数値評価の警告と未反映の確認を持つ", () => {
  const files = [
    "../PersonalOkrReviewDraftModal.tsx",
    "../PersonalOkrPeriodReviewDraftModal.tsx",
    "../PersonalOkrPlanDraftModal.tsx",
  ];
  for (const f of files) {
    it(`${path.basename(f)}：buildNumericEvalWarningで警告を出す`, () => {
      const src = read(f);
      expect(src).toContain("buildNumericEvalWarning(");
      expect(src).toMatch(/\{numericWarning && /);
    });
    it(`${path.basename(f)}：閉じる確認のdirtyに「下書きがあり未反映」を含める`, () => {
      const src = read(f);
      expect(src).toMatch(/hasUnappliedDraft(Text|Fields)\(/);
    });
  }
  it("PeriodReview・PlanDraftは反映した時点の内容を覚える（反映後は未反映にならない）", () => {
    expect(read("../PersonalOkrPeriodReviewDraftModal.tsx")).toContain("setAppliedText(text)");
    expect(read("../PersonalOkrPlanDraftModal.tsx")).toContain("setAppliedFields(fields)");
  });
});

describe("M55：保存失敗の下書き・解析結果に「保存し直す」を出す", () => {
  it("AheadBlockとReviewDraftModalに保存し直すボタンがある", () => {
    expect(read("../AheadBlock.tsx")).toContain("保存し直す");
    expect(read("../PersonalOkrReviewDraftModal.tsx")).toContain("保存し直す");
  });
});

describe("M61：全体タブの取得エラーは種類で表示を分ける", () => {
  it("未適用以外では原因の文言と再読み込みボタンを出す", () => {
    const src = read("../PersonalOverallView.tsx");
    expect(src).toContain('periodReviewsErrorKind === "other"');
    expect(src).toContain("再読み込み");
    expect(src).toContain("reloadPeriodReviews");
  });
});

describe("M63：取込の確認画面に空欄は今の値を残す旨を出す", () => {
  it("確認画面に1行の案内がある", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../PersonalOkrImportModal.tsx"), "utf-8")).toContain("空欄の項目は今の値を残します");
  });
  it("ウェイトの空欄を0に潰さずnullのまま渡す", () => {
    const src = read("../PersonalOkrImportModal.tsx");
    expect(src).toMatch(/weightPct: parseWeightPct\(d\.weightPct\),/);
    expect(src).not.toMatch(/weightPct: parseWeightPct\(d\.weightPct\) \?\? 0/);
  });
});

describe("M64：取込の再実行で新規KRの並び開始値を固定する", () => {
  it("nextDisplayOrderStartにロック済みの値を渡す（毎回の件数を直接渡さない）", () => {
    const src = read("../PersonalOkrImportModal.tsx");
    expect(src).toMatch(/nextDisplayOrderStart: orderStartLock\.value/);
    expect(src).not.toMatch(/nextDisplayOrderStart: existingKrsInPeriod\.length/);
  });
});

describe("M65：Appの復帰時の再取得（resync）に個人OKRも相乗りする", () => {
  it("resyncランナーの中でrequestPersonalOkrResyncを呼ぶ", () => {
    const src = read("../../../../App.tsx");
    expect(src).toMatch(/createResyncRunner\(\(\) => \{ void load\(\); requestPersonalOkrResync\(\); \}\)/);
  });
  it("個人OKRのストアは再取得の窓口を登録する（App.tsxはストアを静的importしない）", () => {
    expect(read("../../../../stores/personalOkrUiStore.ts")).toContain("setPersonalOkrResyncHandler(");
    expect(read("../../../../App.tsx")).not.toMatch(/from "\.\/stores\/personalOkrUiStore"/);
  });
});

describe("M67：週の紐づけ一覧が読めないときはモーダルを開かない", () => {
  it("ensureWeekTasksLoadedがfalseのときはsetLinkerより前にreturnし、再試行を出す", () => {
    const src = read("../PersonalKrPanel.tsx");
    const open = src.indexOf("const handleOpenLinker");
    const guard = src.indexOf("=== false", open);
    const setLinkerAt = src.indexOf("setLinker({", open);
    expect(guard).toBeGreaterThan(open);
    expect(setLinkerAt).toBeGreaterThan(guard);
    expect(src).toContain("再試行");
  });
});

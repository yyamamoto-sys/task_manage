// 【設計意図・v3.182】AI相談の送信まわりの配線（Reactレンダリング基盤が無いためソース走査）。
// CLAUDE.md Section 59：コメント・文字列リテラルに書いた語で通らないよう、行頭コメントと行末コメントを除いて照合する。
// 修正前のソースに同じ検査を当てて赤くなることを確認する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  const src = readFileSync(resolve(__dirname, "../../../..", rel), "utf-8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

const hook = read("src/hooks/useAIConsultation.ts");
const panel = read("src/components/consultation/ConsultationPanel.tsx");

/** submit の catch ブロック（try の対）。finally の手前まで */
function catchBlock(src: string): string {
  const i = src.indexOf("} catch (e) {");
  const j = src.indexOf("} finally {", i);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe("二重送信：返答待ちの間は submit を受け付けない", () => {
  it("submit は処理中フラグを見て、立っていれば何もしない", () => {
    expect(hook).toMatch(/if \(inFlightRef\.current\) return false;\s*inFlightRef\.current = true;/);
  });
  it("処理中フラグは finally で必ず下ろす", () => {
    expect(hook).toMatch(/\} finally \{\s*if \(generationRef\.current === generation\) inFlightRef\.current = false;/);
  });
});

describe("リセット：返答待ちの途中でリセットしたら、届いた返答で会話を復活させない", () => {
  it("reset は世代番号を進め、処理中フラグを下ろす", () => {
    expect(hook).toMatch(/generationRef\.current \+= 1;\s*inFlightRef\.current = false;/);
  });
  it("返答を受け取ったあと、世代が変わっていたら状態を更新せずに戻る", () => {
    const afterRun = hook.slice(hook.indexOf("await runAIConsultation("));
    expect(afterRun).toMatch(/if \(generationRef\.current !== generation\) return true;[\s\S]*?setProposals\(/);
  });
  it("失敗側でも世代が変わっていたら状態を更新しない", () => {
    expect(catchBlock(hook)).toMatch(/if \(generationRef\.current !== generation\) return true;/);
  });
});

describe("送信失敗：ユーザーのターンを履歴に残さず、入力欄へ元の文を戻す", () => {
  it("catch はセッション（ref・state）を更新しない", () => {
    const c = catchBlock(hook);
    expect(c).not.toContain("sessionRef.current");
    expect(c).not.toContain("setSession(");
  });
  it("catch はエラーを formatErrorForUser で整形する（AIError以外）", () => {
    expect(catchBlock(hook)).toContain("formatErrorForUser(");
  });
  it("パネルは失敗（submit が false）のとき入力欄へ送った文を戻す", () => {
    expect(panel).toMatch(/if \(!ok\) \{\s*setInputText\(cur => \(cur\.trim\(\) === "" \? text : cur\)\);/);
  });
  it("パネルは失敗時に提案の選択も戻す", () => {
    expect(panel).toMatch(/setSelectedProposalIds\(prev => \(prev\.size === 0 \? sentSelection : prev\)\)/);
  });
  it("エラー時に履歴の末尾を除外しない（巻き戻し済みで、末尾は前回の返答）", () => {
    const m = panel.match(/const omitTailCount =([\s\S]*?);/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('"error"');
  });
});

describe("AI使用量：解析に失敗した送信の分も記録する", () => {
  it("使用量の記録関数を runAIConsultation に渡す（戻り値からだけ記録しない）", () => {
    expect(hook).toMatch(/runAIConsultation\([\s\S]*?attachments,\s*logUsage,\s*\)/);
    expect(hook).not.toContain("result.usage");
    expect(hook).not.toContain("result.retryUsage");
  });
});

describe("ショートID：同じ会話のあいだ番号を保つ", () => {
  it("buildPayload へ前回までの対応を渡し、リセットで空に戻す", () => {
    expect(hook).toContain("prevShortIdMap: shortIdMapRef.current");
    expect(hook).toMatch(/shortIdMapRef\.current = new Map\(\);/);
  });
});

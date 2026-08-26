// src/components/okr/personal/__tests__/personalOkrRegistryWiring.test.ts
//
// 【設計意図】
// CLAUDE.md Section 46「明示保存の画面は、自分がアンマウントされうる経路すべてに対して
// 未保存の警告を持つ」の対象に、v3.100でPersonalKrPanel（計画欄）・MonthReviewBlock
// （振り返り欄）を追加した。TaskEditModal.tsx/TaskSidePanel.tsxが既に実装している
// 「registerUnsavedEditor/unregisterUnsavedEditorを対で呼ぶ」作法が、この2ファイルにも
// 実際に存在することをソース走査で固定する（modalStyles.test.ts等と同じ方式）。
//
// 【修正前に赤くなることを確認済み】このテストを実装する前（v3.99時点）のソースには
// registerUnsavedEditor自体の import・呼び出しが1つも無いため、実装前に実行すると
// 両ファイルとも失敗することを確認した。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");
}

describe("個人OKR：計画欄・振り返り欄がunsavedEditorRegistryへ登録/解除される（CLAUDE.md Section 46）", () => {
  it("PersonalKrPanel.tsxがregisterUnsavedEditor/unregisterUnsavedEditorを対で呼んでいる", () => {
    const source = readSource("../PersonalKrPanel.tsx");
    expect(source).toMatch(/import\s*\{[^}]*registerUnsavedEditor[^}]*\}\s*from\s*"[^"]*unsavedEditorRegistry"/);
    expect(source).toContain("registerUnsavedEditor(");
    expect(source).toContain("unregisterUnsavedEditor(");
  });

  it("PersonalKrPanel.tsxのdirty判定はcomputeMonthPlanDirtyを使う（判定を書き直さない）", () => {
    const source = readSource("../PersonalKrPanel.tsx");
    expect(source).toMatch(/import\s*\{[^}]*computeMonthPlanDirty[^}]*\}\s*from\s*"[^"]*monthPlanForm"/);
    expect(source).toContain("computeMonthPlanDirty(");
  });

  it("MonthReviewBlock.tsxがregisterUnsavedEditor/unregisterUnsavedEditorを対で呼んでいる", () => {
    const source = readSource("../MonthReviewBlock.tsx");
    expect(source).toMatch(/import\s*\{[^}]*registerUnsavedEditor[^}]*\}\s*from\s*"[^"]*unsavedEditorRegistry"/);
    expect(source).toContain("registerUnsavedEditor(");
    expect(source).toContain("unregisterUnsavedEditor(");
  });

  it("MonthReviewBlock.tsxは既存のcomputeMonthReviewDirty（dirty変数）をそのままgetterに使う（判定を二重化しない）", () => {
    const source = readSource("../MonthReviewBlock.tsx");
    // 既存の `dirty` 変数を計算するのは1箇所だけであること（新しい別のdirty計算を増やしていない）
    const dirtyComputeCount = (source.match(/computeMonthReviewDirty\(/g) ?? []).length;
    expect(dirtyComputeCount).toBe(1);
  });
});

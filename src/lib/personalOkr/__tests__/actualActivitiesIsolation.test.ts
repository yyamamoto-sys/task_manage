// src/lib/personalOkr/__tests__/actualActivitiesIsolation.test.ts
//
// 【設計意図・仕様書§W7】「列が存在しない状態で、計画欄・振り返り欄・バンド決定の保存が
// 成功すること」（W2の合否）を、コンポーネントテスト基盤（RTL等）が無いこの環境でも
// 機械的に固定する。
//
// 実現方法：actual_activitiesは、計画欄・振り返り欄・バンド決定の各保存ハンドラとは
// 完全に別の保存関数（handleSaveActualActivities）でしか送らない設計にした
// （PersonalKrPanel.tsx/MonthReviewBlock.tsx/PersonalPeriodReviewBlock.tsx参照）。
// この隔離が保たれている限り、actual_activities列の有無に関わらず既存3種の保存は
// 影響を受けない。これをソースの静的検査で固定する
// （dataset.test.tsの静的import禁止検査と同型の手法。この検査はコンパイル・実行はしない
// 代わりに、将来「ついでに」actual_activitiesを既存ハンドラのpatchへ混ぜてしまう変更を
// 機械的に検出する）。
//
// 🔴 この検査は「actual_activitiesという文字列が存在しないこと」ではなく「特定の関数の
// 本文の中に存在しないこと」を見る（ファイル全体からの単純な文字列不在チェックではない。
// 新設のhandleSaveActualActivities自体は当然この文字列を含むため、関数単位で見る必要がある）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ソースの中から `const <fnName> = async (...) => {` の直後の中括弧から、対応する
 * 閉じ括弧までの本文を抜き出す（波括弧の深さを数える素朴なブラケットマッチング。
 * 文字列リテラル中の `{`/`}` は本コードベースの対象関数には出現しない前提）。
 */
function extractFunctionBody(source: string, fnName: string): string {
  const marker = `const ${fnName} = async`;
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) throw new Error(`関数 ${fnName} が見つかりません（ファイル構造が変わった可能性があります）`);
  const braceStart = source.indexOf("{", startIdx);
  if (braceStart === -1) throw new Error(`関数 ${fnName} の開始 { が見つかりません`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`関数 ${fnName} の閉じ } が見つかりません`);
}

function readSource(relPath: string): string {
  return readFileSync(join(__dirname, "..", "..", "..", relPath), "utf-8");
}

describe("実施記録（actual_activities）は既存3種の保存ハンドラと完全に隔離されている（仕様書§W2・W7）", () => {
  it("PersonalKrPanel.tsx：handleSaveMonthPlan（計画欄）はactual_activitiesを送らない", () => {
    const source = readSource("components/okr/personal/PersonalKrPanel.tsx");
    const body = extractFunctionBody(source, "handleSaveMonthPlan");
    expect(body).not.toContain("actual_activities");
  });

  it("PersonalKrPanel.tsx：handleSetBandOverride（バンド決定）はactual_activitiesを送らない", () => {
    const source = readSource("components/okr/personal/PersonalKrPanel.tsx");
    const body = extractFunctionBody(source, "handleSetBandOverride");
    expect(body).not.toContain("actual_activities");
  });

  it("PersonalKrPanel.tsx：handleSaveReviewText（振り返り本文の編集保存）はactual_activitiesを送らない", () => {
    const source = readSource("components/okr/personal/PersonalKrPanel.tsx");
    const body = extractFunctionBody(source, "handleSaveReviewText");
    expect(body).not.toContain("actual_activities");
  });

  it("MonthReviewBlock.tsx：handleSave（振り返り欄）はactual_activitiesを送らない", () => {
    const source = readSource("components/okr/personal/MonthReviewBlock.tsx");
    const body = extractFunctionBody(source, "handleSave");
    expect(body).not.toContain("actual_activities");
  });

  it("PersonalPeriodReviewBlock.tsx：handleSave（全体の自己評価%・GM評価%・振り返り本文・GMコメント）はactual_activitiesを送らない", () => {
    const source = readSource("components/okr/personal/PersonalPeriodReviewBlock.tsx");
    const body = extractFunctionBody(source, "handleSave");
    expect(body).not.toContain("actual_activities");
  });

  it("🔴 対照確認：新設のhandleSaveActualActivitiesは実際にactual_activitiesを送っている（検査ロジック自体が正しく動くことの確認）", () => {
    const krPanelSource = readSource("components/okr/personal/PersonalKrPanel.tsx");
    expect(extractFunctionBody(krPanelSource, "handleSaveActualActivities")).toContain("actual_activities");
    const periodBlockSource = readSource("components/okr/personal/PersonalPeriodReviewBlock.tsx");
    expect(extractFunctionBody(periodBlockSource, "handleSaveActualActivities")).toContain("actual_activities");
  });
});

describe("ActualActivitiesBlock.tsx：未保存編集レジストリへの登録（CLAUDE.md Section 46・仕様書§W3）", () => {
  it("registerUnsavedEditor/unregisterUnsavedEditorを両方呼んでいる（コンポーネントテスト基盤が無いためソース検査で固定）", () => {
    const source = readSource("components/okr/personal/ActualActivitiesBlock.tsx");
    expect(source).toContain("registerUnsavedEditor(registryId");
    expect(source).toContain("unregisterUnsavedEditor(registryId)");
  });
});

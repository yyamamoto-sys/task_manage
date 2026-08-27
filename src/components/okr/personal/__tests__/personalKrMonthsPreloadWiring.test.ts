// src/components/okr/personal/__tests__/personalKrMonthsPreloadWiring.test.ts
//
// 【設計意図】
// v3.106のバグ修正（各月でOKRの比率を設定しても、未訪問のKRが四半期共通値へフォールバックし
// 「ウェイト合計 60%」のような誤った警告が出続ける）の配線をソース走査で固定する。
//
// - PersonalOkrView.tsxが対象期のKR一覧（activeKrs）が確定した時点で
//   ensurePeriodMonthsLoaded（対象期の全KR分を1クエリでまとめて先読みするアクション）を
//   呼んでいること。
// - ウェイト合計の警告表示（PersonalOkrView.tsx）と「全体」タブの読み込み中判定
//   （PersonalOverallView.tsx）が、同じ判定関数（krMonthScope.tsのareAllKrMonthsLoaded）を
//   使い回していること（同じ条件を各所に書き直さない。CLAUDE.md「判定ロジックは共通化して
//   2箇所で使い回す」の指示どおり）。
//
// 【修正前に赤くなることを確認済み】ensurePeriodMonthsLoaded・areAllKrMonthsLoadedの
// どちらも実装前は存在しない関数のため、import・呼び出しが1つも無く全項目が失敗した。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");
}

describe("個人OKR：対象期の全KR月レコード先読み（CLAUDE.md該当箇所・v3.106）", () => {
  it("PersonalOkrView.tsxがensurePeriodMonthsLoadedをimportし、KR一覧確定時に呼んでいる", () => {
    const source = readSource("../PersonalOkrView.tsx");
    expect(source).toContain("ensurePeriodMonthsLoaded");
    expect(source).toMatch(/ensurePeriodMonthsLoaded\(activeKrIds\)/);
  });

  it("PersonalOkrView.tsxのウェイト合計警告はareAllKrMonthsLoadedでゲートされている", () => {
    const source = readSource("../PersonalOkrView.tsx");
    expect(source).toMatch(/import\s*\{[^}]*areAllKrMonthsLoaded[^}]*\}\s*from\s*"[^"]*krMonthScope"/);
    expect(source).toMatch(/areAllKrMonthsLoaded\(monthActiveDisplayKrs,\s*displayMonthsByKr\)[\s\S]{0,80}isWeightTotalWarning/);
  });

  it("PersonalOverallView.tsxのloadingKrDataはareAllKrMonthsLoadedを使う（同じ条件を書き直していない）", () => {
    const source = readSource("../PersonalOverallView.tsx");
    expect(source).toMatch(/import\s*\{[^}]*areAllKrMonthsLoaded[^}]*\}\s*from\s*"[^"]*krMonthScope"/);
    expect(source).toMatch(/loadingKrData\s*=\s*krs\.length > 0 && !areAllKrMonthsLoaded\(krs,\s*monthsByKr\)/);
    // 旧実装（krs.some(kr => monthsByKr[kr.id] === undefined)の直書き）が残っていないこと
    expect(source).not.toContain("krs.some(kr => monthsByKr[kr.id] === undefined)");
  });
});

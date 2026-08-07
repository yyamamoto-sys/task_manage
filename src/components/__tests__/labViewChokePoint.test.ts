// src/components/__tests__/labViewChokePoint.test.ts
//
// 【設計意図】
// CLAUDE.md Section 20（v3.34・v3.35）の契約「ラボ系ビューの開閉は必ず choke point の
// ヘルパー（openLabView/closeLabViews）を通す」を、文章だけでなくテストで機械的に強制する。
// modalStyles.test.ts / labViewContainment.test.ts と同じ「ソース走査」方式（AST解析はしない）。
//
// 【背景（2026-08-07・統括レビュー指摘）】
// v3.34で`activeLabView`を単一stateに一本化した際、GraphView/CalendarLabView/MyPageViewが
// 持つ「タスク編集モーダルを開く」ための一時state（graphEditTaskId等）を、ビュー切替時に
// クリアし忘れると「どのビューから開いたか分からない浮遊モーダル」になる不具合が新たに
// 到達可能になった。この修正（v3.35）は`openLabView`/`closeLabViews`という2つのヘルパー
// だけに`setActiveLabView(`呼び出しを閉じ込めることで実現している。将来、誰かが
// `setActiveLabView(...)`を他の場所に直接書いてしまうと、この一時stateのクリア漏れが
// 再発する。そのような直接呼び出しをこのテストで検出する。
//
// 【判定方法】
// ファイル全体に現れる`setActiveLabView(`の出現回数と、`openLabView`/`closeLabViews`
// という2つの関数本体（`const <name> = (...) => { ... };`。2スペースインデントの`};`で
// 閉じる想定）の中に現れる`setActiveLabView(`の出現回数を突き合わせ、一致しなければ
// 「choke point の外で直接呼ばれている箇所がある」と判定する。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_LAYOUT_FILE = path.resolve(__dirname, "../layout/MainLayout.tsx");

const CHOKE_POINT_FUNCTIONS = ["openLabView", "closeLabViews"] as const;

/**
 * `const <name> = (...) => {` の開始位置から、その後最初に現れる「行頭2スペース＋`};`」
 * （＝コンポーネント本体トップレベルでの関数の閉じ）までを抽出する。
 */
function extractArrowFunctionBody(content: string, name: string): string {
  const startPattern = new RegExp(`const ${name} = \\([^)]*\\)(?::[^=]+)? => \\{`);
  const startMatch = startPattern.exec(content);
  if (!startMatch) {
    throw new Error(`extractArrowFunctionBody: "const ${name} = (...) => {" が見つかりません`);
  }
  const bodyStart = startMatch.index;
  const rest = content.slice(bodyStart);
  const endMatch = /\n {2}\};/.exec(rest);
  if (!endMatch) {
    throw new Error(`extractArrowFunctionBody: ${name} の閉じ（"\\n  };"）が見つかりません`);
  }
  return rest.slice(0, endMatch.index + endMatch[0].length);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("ラボ系ビューの開閉はchoke point（openLabView/closeLabViews）を必ず通る（CLAUDE.md Section 20）", () => {
  const content = fs.readFileSync(MAIN_LAYOUT_FILE, "utf-8");
  const NEEDLE = "setActiveLabView(";

  it("openLabView・closeLabViews の両方が存在し、本体が抽出できる（テスト自体の健全性チェック）", () => {
    for (const name of CHOKE_POINT_FUNCTIONS) {
      expect(() => extractArrowFunctionBody(content, name)).not.toThrow();
    }
  });

  it("MainLayout.tsx 内の setActiveLabView( 呼び出しは、すべて openLabView か closeLabViews の内部にある", () => {
    const totalCount = countOccurrences(content, NEEDLE);

    const countsInChokePoints = CHOKE_POINT_FUNCTIONS.map(name => {
      const body = extractArrowFunctionBody(content, name);
      return countOccurrences(body, NEEDLE);
    });
    const chokePointTotal = countsInChokePoints.reduce((a, b) => a + b, 0);

    if (totalCount !== chokePointTotal) {
      throw new Error(
        `[labViewChokePoint] MainLayout.tsx 内に setActiveLabView( の呼び出しが ${totalCount}件` +
        `見つかりましたが、openLabView/closeLabViews の内部にあるのは ${chokePointTotal}件でした。\n` +
        `理由：setActiveLabView を choke point の外で直接呼ぶと、ビュー切替時にクリアすべき` +
        `一時state（graphEditTaskId/calendarEditTaskId/calendarQuickAddDate/myPageEditTaskId）が` +
        `取り残され、「どのビューから開いたか分からない浮遊モーダル」が再発します` +
        `（CLAUDE.md Section 20参照）。\n` +
        `直し方：新しいラボビューを開く/切り替える処理は openLabView("id") を、閉じる処理は` +
        `closeLabViews() を呼んでください。`,
      );
    }
    // 各ヘルパーに最低1回ずつ setActiveLabView( があること（空実装への劣化を防ぐ）
    for (const count of countsInChokePoints) {
      expect(count).toBeGreaterThan(0);
    }
  });
});

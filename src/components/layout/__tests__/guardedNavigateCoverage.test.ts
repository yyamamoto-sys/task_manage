// src/components/layout/__tests__/guardedNavigateCoverage.test.ts
//
// 【設計意図】
// CLAUDE.md Section 46の契約「編集画面をアンマウントしうる画面遷移（viewMode/appMode/
// 部署/PJ/KR切替・ラボ系ビューの開閉・管理画面/ガイドの開閉）は、必ずguardedNavigate()を
// 経由して未保存編集の確認を行う」を、文章だけでなくテストで機械的に強制する。
// labViewChokePoint.test.ts / modalStyles.test.ts と同じ「ソース走査」方式（AST解析はしない）。
//
// 【判定方法】
// 「危険な生の状態変更」（RISKY_PATTERNS）が MainLayoutInner のソース全体に現れる回数と、
// 全ての `guardedNavigate(` 呼び出しの引数（アロー関数の本体）の中に現れる回数を突き合わせ、
// 一致しなければ「guardedNavigateの外で直接呼ばれている箇所がある」と判定する。
// labViewChokePoint.test.ts が「setActiveLabViewはopenLabView/closeLabViewsの中だけ」を
// 検査するのに対し、このテストは「その一段上＝openLabView/closeLabViews/setAppMode/
// setViewMode/setIsAdminOpen(true)/setIsGuideOpen(true) の“呼び出し”自体がguardedNavigateで
// 包まれているか」を検査する（openLabViewのように自分自身の定義の中でguardedNavigateする
// 「自己ガード関数」も、その定義自体がguardedNavigate(...)呼び出しを含むため、この走査で
// 自然にカウントされる）。
//
// 【スコープをMainLayoutInnerに限定する理由】
// 同じファイル内のSidebar関数は、MainLayoutInnerから渡された既にガード済みの関数
// （navSetViewMode等）をpropとして呼ぶだけであり（例：`onClick={() => setViewMode(view)}`は
// propの`setViewMode`＝実体は`navSetViewMode`）、MainLayoutInner自身の`setViewMode`とは
// 別の変数（同名のprop）を参照している。ファイル全体を素朴に走査すると、この安全な
// prop呼び出しまで「未ガード」と誤検知するため、`function Sidebar(`より前（＝
// MainLayoutInner本体）だけを対象にする。
//
// 【コメント文中の言及を除外する理由】
// このファイルのコメントには「closeLabViews()は...」のように、識別子+丸括弧の形で
// 仕組みを説明する記述が複数箇所にある。素朴な文字列カウントだとこれも「呼び出し」として
// 誤カウントするため、`//`以降を行ごとに除去してから数える。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_LAYOUT_FILE = path.resolve(__dirname, "../MainLayout.tsx");

/** 各行の `//` 以降を取り除く（このファイルの実際の使い方では文字列リテラル内に
 *  `//` を含む行が対象パターンと同居しないため、この単純な前処理で十分安全に機能する）。 */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map(line => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

/** `guardedNavigate(` の直後から、対応する閉じ括弧までを括弧の深さで抽出し、
 *  全出現分をまとめて返す（=「guardedNavigateで包まれている領域」の全文）。 */
function extractGuardedNavigateRegions(source: string): string {
  const marker = "guardedNavigate(";
  const regions: string[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = source.indexOf(marker, searchFrom);
    if (idx === -1) break;
    let depth = 1;
    let i = idx + marker.length;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    regions.push(source.slice(idx + marker.length, i));
    searchFrom = i;
  }
  return regions.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const MAIN_LAYOUT_INNER_END_MARKER = "\nfunction Sidebar(";

/** 画面遷移を引き起こす「危険な生の状態変更」。呼び出し側は必ずguardedNavigate内で呼ぶこと。 */
const RISKY_PATTERNS = [
  "setViewMode(",
  "setAppMode(",
  "closeLabViews(",
  "setIsAdminOpen(true)",
  "setIsGuideOpen(true)",
];

describe("編集画面をアンマウントしうる画面遷移は必ずguardedNavigate()を経由する（CLAUDE.md Section 46）", () => {
  const rawSource = fs.readFileSync(MAIN_LAYOUT_FILE, "utf-8");
  const endIdx = rawSource.indexOf(MAIN_LAYOUT_INNER_END_MARKER);

  it("テスト自体の健全性：MainLayoutInnerの終端マーカー（function Sidebar）が見つかる", () => {
    expect(endIdx).toBeGreaterThan(0);
  });

  const mainLayoutInnerSource = stripLineComments(rawSource.slice(0, endIdx));
  const guardedRegions = stripLineComments(extractGuardedNavigateRegions(rawSource.slice(0, endIdx)));

  it("テスト自体の健全性：guardedNavigate(の呼び出しが1件以上見つかる（空実装への劣化を防ぐ）", () => {
    expect(countOccurrences(mainLayoutInnerSource, "guardedNavigate(")).toBeGreaterThan(0);
  });

  for (const pattern of RISKY_PATTERNS) {
    it(`"${pattern}" の全出現は guardedNavigate(...) の中だけにある`, () => {
      const totalCount = countOccurrences(mainLayoutInnerSource, pattern);
      const guardedCount = countOccurrences(guardedRegions, pattern);

      if (guardedCount !== totalCount) {
        throw new Error(
          `[guardedNavigateCoverage] MainLayoutInner内に "${pattern}" の呼び出しが` +
          `${totalCount}件見つかりましたが、guardedNavigate(...)の中にあるのは${guardedCount}件` +
          `でした。\n` +
          `理由：この呼び出しは編集画面（TaskEditModal/TaskSidePanel）を含みうる画面を` +
          `アンマウントしうるため、未保存の変更を確認せずに実行すると無警告で編集内容が` +
          `失われます（CLAUDE.md Section 46参照）。\n` +
          `直し方：この呼び出しを含む処理全体を \`void guardedNavigate(() => { ... })\` で` +
          `包んでください。`,
        );
      }
      // このパターン自体が1回も使われなくなった（機能自体が削除された等）場合は
      // このit自体をCLAUDE.md/テストごと見直す（0件は「安全」の証明にならないため
      // 明示的にチェックする）
      expect(totalCount).toBeGreaterThan(0);
    });
  }
});

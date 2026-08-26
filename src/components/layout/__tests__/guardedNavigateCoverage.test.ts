// src/components/layout/__tests__/guardedNavigateCoverage.test.ts
//
// 【設計意図】
// CLAUDE.md Section 46の契約「編集画面をアンマウントしうる画面遷移（viewMode/appMode/
// 部署/PJ/KR切替・ラボ系ビューの開閉・管理画面/ガイドの開閉）は、必ずguardedNavigate()を
// 経由して未保存編集の確認を行う」を、文章だけでなくテストで機械的に強制する。
// labViewChokePoint.test.ts / modalStyles.test.ts と同じ「ソース走査」方式（AST解析はしない）。
//
// 【判定方法】
// 「危険な生の状態変更」（RISKY_PATTERNS）が対象範囲のソース全体に現れる回数と、
// 全ての `<guardMarker>(` 呼び出しの引数（アロー関数の本体）の中に現れる回数を突き合わせ、
// 一致しなければ「ガードの外で直接呼ばれている箇所がある」と判定する。
// labViewChokePoint.test.ts が「setActiveLabViewはopenLabView/closeLabViewsの中だけ」を
// 検査するのに対し、このテストは「その一段上＝openLabView/closeLabViews/setAppMode/
// setViewMode/setIsAdminOpen(true)/setIsGuideOpen(true) の“呼び出し”自体がガードで
// 包まれているか」を検査する（openLabViewのように自分自身の定義の中でガードする
// 「自己ガード関数」も、その定義自体がガード呼び出しを含むため、この走査で自然に
// カウントされる）。
//
// 【v3.100でPersonalOkrView.tsxを対象に追加】
// 個人OKRビュー内部のKR切替・月（対象期）切替・四半期切替も、TaskEditModal/TaskSidePanel
// を含みうる画面（PersonalKrPanel/MonthReviewBlock）をアンマウントしうる遷移起点のため、
// 同じ機械チェックの対象に加えた。PersonalOkrView.tsx単体の1コンポーネント関数のため、
// MainLayoutInnerのような「ファイル内の別関数を除外する」スコープ限定は不要（ファイル
// 全体をそのまま対象にする）。ガード関数名は`guardedSwitch`（MainLayoutの`guardedNavigate`
// と役割は同じだが、別ファイル・別の対象であることを名前で区別している）。
//
// 【個別のリスクパターンを「関数名＋引数」の具体的な文字列にしている理由（PersonalOkrView側）】
// setSelectedKrId/setMonthIndex/setQuarterは、KRタブ・月セレクト・四半期セレクトの
// ユーザー操作からだけでなく、他のstate変更に追従する内部の自動補正useEffect
// （例：四半期を変えたら対象期が変わり、選択中KRが新しい期に存在しなければ先頭のKRへ
// 自動的に補正する）からも呼ばれる。この自動補正は「既にガードされた操作（四半期切替）の
// 結果として起きる派生的な状態同期」であり、ユーザーが直接起こす独立した遷移ではない
// ため、二重にガードする対象ではない（そもそもuseEffect内で確認ダイアログを待つことは
// 構造的にできない）。そのため関数名だけでなく実際の引数まで含めた具体的な文字列
// （例：`setSelectedKrId(kr.id)`）をRISKY_PATTERNSに使い、自動補正呼び出し
// （`setSelectedKrId(displayKrs[0].id)`・`setSelectedKrId(null)`・
// `setMonthIndex(resolveDefaultMonthIndex(...))`）と区別している。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/** `<marker>(` の直後から、対応する閉じ括弧までを括弧の深さで抽出し、
 *  全出現分をまとめて返す（=「ガードで包まれている領域」の全文）。 */
function extractGuardedRegions(source: string, guardMarker: string): string {
  const marker = `${guardMarker}(`;
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

interface CoverageTarget {
  label: string;
  file: string;
  guardMarker: string;
  riskyPatterns: string[];
  /** ファイル全体ではなく先頭からこのマーカーの手前までだけを対象にする場合に指定する。 */
  scopeEndMarker?: string;
}

const TARGETS: CoverageTarget[] = [
  {
    label: "MainLayoutInner（viewMode/appMode/部署/ラボ/管理画面/ガイドの遷移）",
    file: path.resolve(__dirname, "../MainLayout.tsx"),
    guardMarker: "guardedNavigate",
    scopeEndMarker: "\nfunction Sidebar(",
    riskyPatterns: [
      "setViewMode(",
      "setAppMode(",
      "closeLabViews(",
      "setIsAdminOpen(true)",
      "setIsGuideOpen(true)",
    ],
  },
  {
    label: "PersonalOkrView（KR切替・月切替・四半期切替）",
    file: path.resolve(__dirname, "../../okr/personal/PersonalOkrView.tsx"),
    guardMarker: "guardedSwitch",
    riskyPatterns: [
      "setSelectedKrId(kr.id)",
      "setMonthIndex(Number(v) as 1 | 2 | 3)",
      "setQuarter(v as Quarter)",
    ],
  },
];

for (const target of TARGETS) {
  describe(`編集画面をアンマウントしうる画面遷移は必ずガードを経由する（CLAUDE.md Section 46）：${target.label}`, () => {
    const rawSource = fs.readFileSync(target.file, "utf-8");
    const scopedSource = target.scopeEndMarker
      ? (() => {
        const endIdx = rawSource.indexOf(target.scopeEndMarker!);
        if (endIdx <= 0) throw new Error(`[guardedNavigateCoverage] scopeEndMarker "${target.scopeEndMarker}" が見つかりません`);
        return rawSource.slice(0, endIdx);
      })()
      : rawSource;

    if (target.scopeEndMarker) {
      it(`テスト自体の健全性：${target.label}の終端マーカーが見つかる`, () => {
        expect(rawSource.indexOf(target.scopeEndMarker!)).toBeGreaterThan(0);
      });
    }

    const strippedSource = stripLineComments(scopedSource);
    const guardedRegions = stripLineComments(extractGuardedRegions(scopedSource, target.guardMarker));

    it(`テスト自体の健全性：${target.guardMarker}(の呼び出しが1件以上見つかる（空実装への劣化を防ぐ）`, () => {
      expect(countOccurrences(strippedSource, `${target.guardMarker}(`)).toBeGreaterThan(0);
    });

    for (const pattern of target.riskyPatterns) {
      it(`"${pattern}" の全出現は ${target.guardMarker}(...) の中だけにある`, () => {
        const totalCount = countOccurrences(strippedSource, pattern);
        const guardedCount = countOccurrences(guardedRegions, pattern);

        if (guardedCount !== totalCount) {
          throw new Error(
            `[guardedNavigateCoverage] ${target.label}内に "${pattern}" の呼び出しが` +
            `${totalCount}件見つかりましたが、${target.guardMarker}(...)の中にあるのは${guardedCount}件` +
            `でした。\n` +
            `理由：この呼び出しは編集画面（TaskEditModal/TaskSidePanel/PersonalKrPanel/` +
            `MonthReviewBlock）を含みうる画面をアンマウントしうるため、未保存の変更を` +
            `確認せずに実行すると無警告で編集内容が失われます（CLAUDE.md Section 46参照）。\n` +
            `直し方：この呼び出しを含む処理全体を \`void ${target.guardMarker}(() => { ... })\` で` +
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
}

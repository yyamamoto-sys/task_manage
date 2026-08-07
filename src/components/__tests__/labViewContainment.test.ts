// src/components/__tests__/labViewContainment.test.ts
//
// 【設計意図】
// CLAUDE.md Section 20（v3.33）の契約「全画面ラボ系ビューは position:"fixed" を使わず、
// メインエリア内に flex:1 で収める」を、文章だけでなくテストで機械的に強制する。
// modalStyles.test.ts / widgetContract.test.ts と同じ「ソース走査」方式（AST解析はしない）。
//
// 【検査1】src/ 配下のどのファイルにも「CSSカスタムプロパティ --app-sidebar-w への var() 参照」が
// 現れないこと（このテストファイル自身は自己言及になるため検査対象から除く）。
// この CSS カスタムプロパティは「ラボ系ビューが position:fixed の左端をサイドバー分ずらして
// 避ける」という旧方式のためだけに存在していた。新方式（position:fixedをやめてメインエリア内に
// 収める）ではこの手法自体が不要になったため、使用箇所ゼロを固定する。
// 【テストの粒度について】全ソースファイルを走査するが、it.each で1ファイル1テストには
// 展開しない（1件のテストに集約し、違反ファイルの配列を expect(offenders).toEqual([]) で
// 比較する）。このリポジトリはCHANGELOG.mdにテスト件数の増減を「変更規模のシグナル」として
// 記録しており、ソース走査1本をit.eachで展開すると数百件単位でテスト件数が水増しされ、
// 本来のシグナル（何をどれだけ変更したか）が埋もれてしまうため。失敗時は offenders 配列の
// 中身（違反ファイルのパス）がそのままvitestの差分に出るため、診断能力は落ちない。
//
// 【検査2】対象7ビューのファイルが、そのビュー本体の「root」で position:"fixed" を使っていない
// こと。ここでいう「root」とは、そのファイルがexportしているビュー本体コンポーネント
// （`export function <ファイル名と同じ名前>`）の関数本体を指す。
//
// 【判定方法（誤検知を避けるための設計）】
// ファイル全体を対象にすると、KrReportPanel/KrWhyPanel/KrQuarterPlanPanel のようにビュー本体
// とは別に「中央寄せモーダル」を持つファイル（例：MyPageView.tsx の AddWidgetModal）で
// 誤検知する可能性がある（Section 21 の契約上、中央寄せモーダルは position:fixed のままで正しい）。
// そこで、対象ファイルのソースを「`export function <ViewName>(` の開始位置」から
// 「その後最初に現れる、行頭（インデント無し）の `function `/`export function `/`export const `
// 宣言の直前」までに限定して抽出し、その範囲内だけを検査する。
// これにより、ビュー本体の関数の外（＝別のトップレベル関数として定義された中央寄せモーダル等）は
// 検査対象から自動的に除外される。実装前の事前検証で、この方式は今回の7ファイルに対して
// 誤検知ゼロ（MyPageView.tsx の AddWidgetModal・WidgetConfigModal 呼び出しを正しく除外し、
// かつビュー本体側の position:fixed 除去は正しく検出する）であることを確認済み。
//
// 【検出の限界（正直に書く）】
// ビュー本体の関数の中に「行頭インデント無しの function 宣言」を伴わない形で中央寄せモーダルを
// 直接ベタ書きした場合（＝modalStyles.ts を使わず生の position:"fixed" をビュー本体内に書いた
// 場合）は本テストが誤って失敗させる。ただしSection 21はそのようなケースでも modalStyles.ts の
// 使用を必須としており（コンポーネント側に生の "position:\"fixed\"" という文字列が残らない）、
// 契約に従っている限りこの限界が実際に問題になることはない。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../../");

/** 対象7ビュー：ファイルパス（src/ 相対）と、そこがexportしているビュー本体の関数名 */
const TARGET_VIEWS: { file: string; componentName: string }[] = [
  { file: "components/graph/GraphView.tsx", componentName: "GraphView" },
  { file: "components/lab/CalendarLabView.tsx", componentName: "CalendarLabView" },
  { file: "components/lab/ProjectStructureView.tsx", componentName: "ProjectStructureView" },
  { file: "components/lab/MyPageView.tsx", componentName: "MyPageView" },
  { file: "components/lab/KrReportPanel.tsx", componentName: "KrReportPanel" },
  { file: "components/lab/KrQuarterPlanPanel.tsx", componentName: "KrQuarterPlanPanel" },
  { file: "components/lab/KrWhyPanel.tsx", componentName: "KrWhyPanel" },
];

/** src/ 配下の全ファイル（node_modules は除く）。このテストファイル自身は、検査対象の
 *  文字列そのものを説明のために書かざるを得ず自己言及になるため、呼び出し側で除外する。 */
function listAllSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listAllSourceFiles(full, out);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SELF_FILE = "components/__tests__/labViewContainment.test.ts";

/**
 * `export function <componentName>(` の開始位置から、その後最初に現れる「行頭
 * （インデント無し）の function 宣言」の直前までを抽出する。見つからなければファイル末尾まで。
 */
function extractComponentBody(content: string, componentName: string): string {
  const startPattern = new RegExp(`export function ${componentName}\\(`);
  const startMatch = startPattern.exec(content);
  if (!startMatch) {
    throw new Error(`extractComponentBody: "export function ${componentName}(" が見つかりません`);
  }
  const bodyStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(bodyStart);
  const nextTopLevelDecl = /\n(export function |export const |function )/.exec(rest);
  const bodyEnd = nextTopLevelDecl ? bodyStart + nextTopLevelDecl.index : content.length;
  return content.slice(startMatch.index, bodyEnd);
}

describe("全画面ラボ系ビュー契約：--app-sidebar-w を使う実装が残っていない（CLAUDE.md Section 20）", () => {
  const NEEDLE = "var(--app-sidebar-w";

  it("src/ 配下のどのファイルにも \"var(--app-sidebar-w\" が含まれていない", () => {
    const offenders = listAllSourceFiles(SRC_DIR)
      .map(f => path.relative(SRC_DIR, f).replace(/\\/g, "/"))
      .filter(relPath => relPath !== SELF_FILE)
      .filter(relPath => fs.readFileSync(path.join(SRC_DIR, relPath), "utf-8").includes(NEEDLE));

    // 違反ファイルのパスをそのまま配列で比較する。失敗時はvitestが配列の差分（=違反ファイル一覧）を
    // そのままエラーメッセージに出すため、it.eachで1ファイル1テストに展開しなくても
    // 「どのファイルが違反しているか」の診断能力は落ちない（CHANGELOGのテスト件数記録が
    // ソース走査1本の展開数で埋もれるのを避けるため、2026-08-07に it.each から集約に変更）。
    expect(offenders).toEqual([]);
  });
});

describe("全画面ラボ系ビュー契約：ビュー本体のrootが position:\"fixed\" を使っていない（CLAUDE.md Section 20）", () => {
  it("検出対象の7ファイルすべてが存在し、対象コンポーネントの宣言が見つかる（テスト自体の健全性チェック）", () => {
    for (const { file, componentName } of TARGET_VIEWS) {
      const content = fs.readFileSync(path.join(SRC_DIR, file), "utf-8");
      expect(() => extractComponentBody(content, componentName)).not.toThrow();
    }
  });

  it.each(TARGET_VIEWS)("$file の $componentName 本体が position:\"fixed\" を使っていない", ({ file, componentName }) => {
    const content = fs.readFileSync(path.join(SRC_DIR, file), "utf-8");
    const body = extractComponentBody(content, componentName);
    if (/position:\s*"fixed"/.test(body)) {
      throw new Error(
        `[labViewContainment] ${file} の ${componentName} 本体に position:"fixed" が見つかりました。\n` +
        `理由：全画面ラボ系ビューが position:"fixed" を使うと、#root の角丸クリップ（overflow:hidden）` +
        `の対象外（position:fixedはビューポート基準で描画されるため）になり、丸縁の外にはみ出します` +
        `（CLAUDE.md Section 20参照）。\n` +
        `直し方：root を position を持たない flex 子要素（flex:1, minWidth:0, minHeight:0）にし、` +
        `PC ではメインエリア内（MainLayout.tsx の labOverlay）に、モバイルでは呼び出し側の ` +
        `MobileFullscreenOverlay で全画面表示にしてください。\n` +
        `本当に中央寄せモーダル（Section 21対象）を追加したいだけなら、modalStyles.ts の ` +
        `modalOverlayStyle() を使い、ビュー本体の関数の外（別のトップレベル関数）に定義してください。`,
      );
    }
  });
});

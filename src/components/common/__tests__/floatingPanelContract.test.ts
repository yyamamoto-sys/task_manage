// src/components/common/__tests__/floatingPanelContract.test.ts
//
// 【設計意図・2026-08-26】
// 「トリガーに追従する小さいポップオーバー」（CustomSelect / InlineEditAssignee /
// ProjectRowMenu / MentionTextarea）が、コピペで増えたときに1箇所だけ直って他が
// 取り残される事故を機械的に防ぐ。
//
// 【この検査が生まれた不具合（2026-08-26）】
// リストモードの担当者ドロップダウンで「スクロールできない・選びたい人を選べない」。
// 原因は v3.85（commit aedb241）で InlineEditAssignee のパネルを
// `position:absolute`（#root の子孫）から `createPortal(document.body)` へ移したとき、
// 同時に移した他の3ファイルには付いていた `pointerEvents:"auto"` を**このファイルだけ
// 付け忘れた**こと。`src/styles/globals.css` の `body { pointer-events: none }`（外周の
// 余白帯でクリックを通すための指定）は**継承プロパティ**なので、body直下に生えた
// Portal要素は明示的に打ち消さない限りヒットテストの対象外になる。
// 結果、ホイールがパネルを素通りして下のリストが動き、capture の scroll リスナが
// 「パネル外のスクロール」と判定してドロップダウンを閉じていた。
//
// 【検査の方針】
// 「書き方が揃っているか」ではなく「守りたい結果」に寄せる：
//   A) body直下にPortalする要素は、必ずポインタイベントを受け取れる状態にする
//   B) 祖先のスクロールで問答無用に閉じる実装を残さない（＝目的の項目に手を伸ばしている
//      最中に閉じない）
// A は DOM が無いと本当の意味では検証できないため、値としての `pointerEvents:"auto"` の
// 有無をソース走査で見る（この不具合を実際に検出できる形になっている）。

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...listTsxFiles(full)); continue; }
    if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function toPosixRelative(full: string): string {
  return full.slice(process.cwd().length + 1).split(sep).join(posix.sep);
}

/**
 * body直下へのPortalだがポインタイベントの面倒を子コンポーネントが見るため対象外にするファイル。
 * 追加するときは「なぜ対象外か」を必ず書くこと。
 */
const POINTER_EVENTS_EXCLUDED: Record<string, string> = {
  // Portal の中身は <Suspense><GanttPreviewPanel/></Suspense> であり、
  // GanttPreviewPanel.tsx 自身のルートが pointerEvents:"auto" を持つ。
  "src/components/consultation/ConsultationPanel.tsx":
    "Portalの直下が別コンポーネントで、そちら側のルートが pointerEvents:auto を持つ",
};

describe("body直下へPortalする要素はポインタイベントを受け取れること", () => {
  it("createPortal(..., document.body) を持つ全ファイルが pointerEvents:\"auto\" を明示している", () => {
    const offenders: string[] = [];
    for (const full of listTsxFiles(SRC_ROOT)) {
      const src = readFileSync(full, "utf8");
      if (!src.includes("createPortal")) continue;
      if (!src.includes("document.body")) continue;
      const rel = toPosixRelative(full);
      if (rel in POINTER_EVENTS_EXCLUDED) continue;
      if (/pointerEvents:\s*"auto"/.test(src)) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `body { pointer-events: none }（globals.css）は継承されるため、body直下のPortal要素は\n` +
      `pointerEvents:"auto" を明示しないとクリック・ホバー・ホイールを一切受け取れない。\n` +
      `未指定のファイル:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

/** トリガー追従型ポップオーバーを持つ4ファイル（コピペ家族） */
const POPOVER_FILES = [
  "src/components/common/InlineEditAssignee.tsx",
  "src/components/common/CustomSelect.tsx",
  "src/components/project/ProjectRowMenu.tsx",
  "src/components/common/MentionTextarea.tsx",
];

describe("ポップオーバーは祖先のスクロールで即座に閉じないこと", () => {
  it.each(POPOVER_FILES)("%s が自前の『スクロールしたら閉じる』ハンドラを持たない", rel => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    // 自前で scroll を購読していれば、その中で閉じている可能性がある。
    // 位置追従は共有フック（useFloatingPanel）に集約し、各ファイルでは購読しない。
    expect(
      /addEventListener\(\s*"scroll"/.test(src),
      `${rel} が自前で scroll を購読している。位置追従・閉じる判定は useFloatingPanel に集約すること`,
    ).toBe(false);
  });

  it.each(POPOVER_FILES)("%s が共有フック useFloatingPanel を使っている", rel => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    expect(
      src.includes("useFloatingPanel"),
      `${rel} が useFloatingPanel を使っていない。位置計算・スクロール追従・スクロール連鎖の遮断が` +
      `1箇所に集約されていないと、また1箇所だけ直って他が取り残される`,
    ).toBe(true);
  });

  it.each(POPOVER_FILES)("%s が computeFloatingPanelPosition を直接呼んでいない", rel => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    expect(
      src.includes("computeFloatingPanelPosition("),
      `${rel} が位置計算を自前で呼んでいる。useFloatingPanel 経由に揃えること`,
    ).toBe(false);
  });
});

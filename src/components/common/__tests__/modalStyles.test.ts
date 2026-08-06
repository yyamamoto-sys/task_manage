// src/components/common/__tests__/modalStyles.test.ts
//
// 【設計意図】
// modalStyles.ts に書いた契約（CLAUDE.md Section 21）を、文章だけでなくテストで機械的に
// 強制する。widgetContract.test.ts と同じ「ソース走査」方式：src/**/*.tsx を読み、
// 「position:fixed かつ inset:0 で中央寄せ（alignItems:center + justifyContent:center）して
// いるオーバーレイ」を持つファイルが、modalStyles.ts をimportしているか、あるいは自前で
// maxHeight を持っているかを検査する。
//
// 【検出の限界（正直に書く）】
// - ファイル単位のテキスト走査であり、AST解析はしていない。同一ファイル内に複数のオーバーレイが
//   あり、片方だけ maxHeight を持つ場合は検出できない（widgetContract.test.ts と同じ限界）。
// - 横からのドロワー・サイドパネル（justifyContent:"flex-end" / alignItems:"stretch" 等）は
//   そもそも「alignItems:center + justifyContent:center」のパターンに一致しないため、
//   実際に確認した限り誤検知は出ていない（EXCLUDED_FILES は将来の検知強化に備えた保険）。
//
// 実装前の事前検証で、この検出パターンは src/ 全体（39ファイルがposition:fixedを使用）に対して
// 誤検知ゼロ（ドロワー・ラボ全画面ビュー・ツールチップは一致しない）だったことを確認済み。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../../../");

/**
 * 「対象外」と判断済みのファイル。横からのドロワー・サイドパネル・全画面ラボビュー・
 * 全画面プレビューシート・全画面認証系スクリーンなど、この契約（中央寄せモーダルが画面の
 * 上下に収まる）が意味を持たないもの。現状の検出パターン（alignItems:center +
 * justifyContent:center）はこれらに一致しないため実際には引っかからないが、将来パターンを
 * 強化したときに誤検知させないための明示的な保険として列挙する。
 */
const EXCLUDED_FILES = new Set<string>([
  // 横からのドロワー・サイドパネル（画面の高さいっぱいに出るのが正しい設計）
  "components/consultation/ConsultationPanel.tsx",
  "components/task/TaskSidePanel.tsx",
  "components/workload/MemberDetailPanel.tsx",
  "components/lab/KrReportPanel.tsx",
  "components/lab/KrQuarterPlanPanel.tsx",
  "components/lab/KrWhyPanel.tsx",
  "components/guide/GuideOverlay.tsx",
  "components/guide/HelpButton.tsx",
  "components/admin/OkrImportModal.tsx",
  "components/meeting/MeetingImportPanel.tsx",
  "components/okr/OkrDashboardView.tsx",
  // 全画面で作業するラボビュー（CLAUDE.md Section 20の対象。サイドバーを覆わない別の契約に従う）
  "components/lab/ProjectStructureView.tsx",
  "components/lab/MyPageView.tsx",
  "components/lab/CalendarLabView.tsx",
  "components/graph/GraphView.tsx",
  // 全画面プレビューシート（inset:0で高さ自体が画面ぴったりに固定され、箱が伸びる余地が無い）
  "components/consultation/GanttPreviewPanel.tsx",
  // 全画面の認証系スクリーン（ダイアログではなく画面そのもの。背後に隠すべきコンテンツが無い）
  "components/auth/SetupWizard.tsx",
  "components/auth/LoginScreen.tsx",
  "components/auth/AccessDeniedScreen.tsx",
  "components/auth/UserSelectScreen.tsx",
]);

/** src/ 配下の .tsx ファイル一覧（__tests__ ディレクトリ自身は除く）を再帰的に集める */
function listAllTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listAllTsxFiles(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** `position:"fixed" ... inset:0` の直後 WINDOW 文字以内に、alignItems:"center" と
 *  justifyContent:"center" が両方見つかれば「中央寄せオーバーレイ」と判定する。 */
const OVERLAY_INSET_PATTERN = /position:\s*"fixed"[\s\S]{0,80}?inset:\s*0/g;
const WINDOW = 260;

function hasCenteredFixedOverlay(content: string): boolean {
  let match: RegExpExecArray | null;
  OVERLAY_INSET_PATTERN.lastIndex = 0;
  while ((match = OVERLAY_INSET_PATTERN.exec(content))) {
    const windowText = content.slice(match.index, match.index + WINDOW);
    if (/alignItems:\s*"center"/.test(windowText) && /justifyContent:\s*"center"/.test(windowText)) {
      return true;
    }
  }
  return false;
}

const allFiles = listAllTsxFiles(SRC_DIR);
const candidateFiles = allFiles
  .map(f => ({ full: f, rel: path.relative(SRC_DIR, f).replace(/\\/g, "/") }))
  .filter(({ rel }) => !EXCLUDED_FILES.has(rel))
  .filter(({ full }) => hasCenteredFixedOverlay(fs.readFileSync(full, "utf-8")));

describe("モーダル契約：中央寄せオーバーレイは高さ上限を持つ（CLAUDE.md Section 21）", () => {
  it("検出ロジック自体の健全性チェック：中央寄せモーダルを持つファイルが1件以上見つかる", () => {
    expect(candidateFiles.length).toBeGreaterThan(0);
  });

  it.each(candidateFiles.map(f => f.rel))(
    "%s が modalStyles.ts を import しているか、自前で maxHeight を持っている",
    relPath => {
      const content = fs.readFileSync(path.join(SRC_DIR, relPath), "utf-8");
      const usesSharedStyles = /from\s+["'][^"']*modalStyles["']/.test(content);
      const hasMaxHeight = /maxHeight/.test(content);
      if (!usesSharedStyles && !hasMaxHeight) {
        throw new Error(
          `[modalStyles] ${relPath} は position:fixed; inset:0 で中央寄せしたオーバーレイを持ちますが、\n` +
          `箱の高さ上限（maxHeight）も共有スタイル（modalStyles.ts）も見つかりませんでした。\n` +
          `理由：箱に高さ上限が無いと、コンテンツの高さまで無制限に伸びて画面の上下を突き抜け、` +
          `保存ボタン等の操作ボタンに到達できなくなります` +
          `（2026-08-06にProjectCreateModalで実際にPJが作成できない不具合が発生）。\n` +
          `直し方：src/components/common/modalStyles.ts の modalOverlayStyle() / modalBoxStyle() / ` +
          `MODAL_BODY_STYLE / MODAL_FOOTER_STYLE を使ってください（CLAUDE.md Section 21参照）。\n` +
          `本当にこの契約の対象外（横からのドロワー等）なら、このテストファイルの EXCLUDED_FILES に ` +
          `理由付きで追加してください。`,
        );
      }
    },
  );
});

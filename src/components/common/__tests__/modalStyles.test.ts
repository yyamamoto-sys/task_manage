// src/components/common/__tests__/modalStyles.test.ts
//
// 【設計意図】
// modalStyles.ts に書いた契約（CLAUDE.md Section 21）を、文章だけでなくテストで機械的に
// 強制する。widgetContract.test.ts と同じ「ソース走査」方式：src/**/*.tsx を読み、
// 「position:fixed かつ inset:0 で中央寄せ（alignItems:center + justifyContent:center）して
// いるオーバーレイ」を持つファイルが、modalStyles.ts をimportしているか、あるいは自前で
// maxHeight を持っているかを検査する。
//
// 【2026-08-12・v3.64で追記】自前実装（modalStyles.ts を使わないファイル）が実際に9件見つかった
// ため全て共有スタイルへ移行した経緯（詳細はCLAUDE.md Section 21参照）
// このテストの「usesSharedStyles || hasMaxHeight」という当初の承認条件には見落としがあった。
// `AdminFormModal.tsx`（設定画面の「＋追加」フォーム）ほか `MilestoneAddModal.tsx` /
// `MilestoneEditModal.tsx` / `TodoDecomposeModal.tsx` / `WidgetConfigModal.tsx` /
// `DashboardView.tsx`（全PJ分析モーダル） / `ProjectKarte.tsx`（PJ分析モーダル） /
// `ChangeHistoryModal.tsx` / `ConfirmationDialogModal.tsx` の9ファイルが、`modalStyles.ts` を
// import せず、`position:"fixed"; alignItems:"center"; justifyContent:"center"` を自前で
// 書いていた。これらは「箱に `maxHeight`（90vh 等の固定値）を自前で持っている」ため、当初の
// 承認条件（`usesSharedStyles || hasMaxHeight`）を満たして**検査は通っていた**——つまり検出漏れ
// ではなく、**承認条件そのものが「中央寄せの手段」を見ていなかった**ことが原因だった
// （`maxHeight` があっても `alignItems:"center"` で中央寄せしていれば2026-08-12の不具合と
// 同じ穴が残る）。9ファイルとも `modalOverlayStyle()`/`modalBoxStyle()` へ移行して解決したため、
// 承認条件を `usesSharedStyles || (hasMaxHeight && hasMarginAuto)` に強化した（保険。今後
// 同種の自前実装が増えても、maxHeightだけでは通らないようにする）。
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
// 【v3.64時点】上記9ファイルの移行により、検出パターンに一致する箇所は現在0件（全て
// `modalOverlayStyle()`経由になったため、リテラルな `alignItems:"center"` がファイル内に残って
// いない）。0件は「不具合が直った」ことの証拠であり「検出が壊れた」わけではないため、健全性
// チェック（下記）は実ファイルではなく合成フィクスチャで検出ロジック自体を検証する形に変更した。

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
  // 【2026-08-10で削除】components/okr/OkrDashboardView.tsx はOKRモードのグループ側
  // アーカイブに伴い右ドロワー（概要・履歴オーバーレイ）を持たなくなり、position:"fixed"
  // 自体を一切使わなくなったため除外の意味が無くなった（旧グループ側の実装は
  // components/okr/GroupOkrDashboardArchived.tsx に保管。旧実装は justifyContent:"flex-end"
  // の右ドロワーで alignItems:"center" では中央寄せしていないため、このテストの検出パターン
  // にそもそも一致せず EXCLUDED_FILES への追加は不要）。
  // 【v3.33で削除】ProjectStructureView.tsx / MyPageView.tsx / CalendarLabView.tsx / GraphView.tsx は
  // CLAUDE.md Section 20の書き換えにより position:"fixed" を一切使わなくなったため、
  // このテストのパターン（position:"fixed"...inset:0）にそもそも一致しなくなった。除外リストに
  // 残すと「本来キャッチすべき将来の逆行（誰かがまた生の position:fixed を書いてしまう等）」を
  // 見逃す側の穴になるため、除外を外して素通しでテスト対象に戻す（labViewContainment.test.ts が
  // 別途 position:fixed の再発防止を検査する）。
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

/**
 * 【設計意図・v3.64追記】modalStyles.ts 自身（.ts のためこのファイル上部の .tsx 走査の対象外）が
 * 「alignItems:"center" 方式に戻っていないか」「margin:"auto" 方式を保っているか」を検査する。
 * 2026-08-12に実際に起きた不具合（縦の可視領域が狭い環境でタスク追加モーダルの上端が画面外に
 * 切れ、タスク名の入力欄に到達できない）の再発防止。alignItems:"center" は、箱がコンテナより
 * わずかでも大きくなった瞬間に上側のはみ出しが scroll で到達不能になる（下側は overflow:"auto"
 * で到達できるのに上側だけ非対称に到達不能という既知のCSS挙動）。margin:"auto" は空きが無い
 * ときに 0 へ縮退し箱が先頭（上端）に揃うため、この非対称性が起きない。
 *
 * 【検出の限界】ファイル内のJSDocコメントに `alignItems:"center"` という語自体が説明目的で
 * 現れるため、ファイル全体ではなく `return { ... };` のオブジェクトリテラル部分だけを
 * 正規表現で切り出して検査する（コメントの誤検知を避けるため）。
 */
function extractReturnObjectLiteral(source: string, functionName: string): string {
  const re = new RegExp(`function ${functionName}\\([^)]*\\)[^{]*\\{\\s*return\\s*\\{([\\s\\S]*?)\\};\\s*\\}`);
  const match = re.exec(source);
  if (!match) {
    throw new Error(`[modalStyles] ${functionName} の関数本体（return { ... };）が見つかりませんでした。関数の書き方が変わっていないか確認してください。`);
  }
  return match[1];
}

describe("モーダル契約：中央寄せの手段は margin:auto を用いる・alignItems:center に戻さない（CLAUDE.md Section 21・v3.64）", () => {
  const modalStylesSource = fs.readFileSync(path.join(SRC_DIR, "components/common/modalStyles.ts"), "utf-8");

  it("modalOverlayStyle() は alignItems:center / justifyContent:center で中央寄せしていない", () => {
    const body = extractReturnObjectLiteral(modalStylesSource, "modalOverlayStyle");
    expect(/alignItems/.test(body)).toBe(false);
    expect(/justifyContent/.test(body)).toBe(false);
  });

  it("modalBoxStyle() は margin:\"auto\" で中央寄せしている", () => {
    const body = extractReturnObjectLiteral(modalStylesSource, "modalBoxStyle");
    expect(/margin:\s*"auto"/.test(body)).toBe(true);
  });
});

describe("モーダル契約：中央寄せオーバーレイは高さ上限を持つ（CLAUDE.md Section 21）", () => {
  it("検出ロジック自体の健全性チェック：合成フィクスチャで中央寄せオーバーレイを検出できる", () => {
    // 【v3.64で実ファイル依存から合成フィクスチャに変更】9ファイルの移行により、実ファイルに
    // このアンチパターンが1件も残らなくなった（0件＝正常）ため、検出ロジック自体の健全性は
    // 実ファイルではなくこのテスト専用の文字列で確認する。
    const buggy = 'style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}';
    const safe = 'style={{ ...modalOverlayStyle(300) }}';
    const drawer = 'style={{ position: "fixed", inset: 0, display: "flex", alignItems: "stretch", justifyContent: "flex-end" }}';
    expect(hasCenteredFixedOverlay(buggy)).toBe(true);
    expect(hasCenteredFixedOverlay(safe)).toBe(false);
    expect(hasCenteredFixedOverlay(drawer)).toBe(false);
  });

  it("現時点で src/ 全体にこのアンチパターンを自前実装しているファイルが無いことを確認する（回帰検知）", () => {
    // 2026-08-12時点で9ファイルを modalStyles.ts へ移行し尽くした結果。新しく増えたら
    // 下の it.each で検出されテストが失敗する（0件のまま維持することが目標）。
    expect(candidateFiles.map(f => f.rel)).toEqual([]);
  });

  it.each(candidateFiles.map(f => f.rel))(
    "%s が modalStyles.ts を import しているか、自前で maxHeight と margin:auto の両方を持っている",
    relPath => {
      const content = fs.readFileSync(path.join(SRC_DIR, relPath), "utf-8");
      const usesSharedStyles = /from\s+["'][^"']*modalStyles["']/.test(content);
      const hasMaxHeight = /maxHeight/.test(content);
      const hasMarginAuto = /margin:\s*"auto"/.test(content);
      if (!usesSharedStyles && !(hasMaxHeight && hasMarginAuto)) {
        throw new Error(
          `[modalStyles] ${relPath} は position:fixed; inset:0 で中央寄せしたオーバーレイを持ちますが、\n` +
          `共有スタイル（modalStyles.ts）を使っておらず、自前実装も「高さ上限（maxHeight）」と\n` +
          `「margin:auto による中央寄せ」の両方を備えていません。\n` +
          `理由：箱に高さ上限が無いと、コンテンツの高さまで無制限に伸びて画面の上下を突き抜けます` +
          `（2026-08-06にProjectCreateModalで実際にPJが作成できない不具合が発生）。\n` +
          `さらに、alignItems:"center" で中央寄せすると、箱がコンテナよりわずかでも大きくなった` +
          `瞬間に上側のはみ出しがスクロールで到達不能になります` +
          `（2026-08-12にQuickAddTaskModalで実際にタスク名入力欄に到達できない不具合が発生。` +
          `9ファイルの自前実装が同じ穴を持っていたため全て移行した）。\n` +
          `直し方：src/components/common/modalStyles.ts の modalOverlayStyle() / modalBoxStyle() / ` +
          `MODAL_BODY_STYLE / MODAL_FOOTER_STYLE を使ってください（CLAUDE.md Section 21参照）。\n` +
          `本当にこの契約の対象外（横からのドロワー等）なら、このテストファイルの EXCLUDED_FILES に ` +
          `理由付きで追加してください。`,
        );
      }
    },
  );
});

/**
 * 【設計意図・v3.64追記】`modalOverlayStyle()` は中央寄せを一切行わないため（上記の変更）、
 * オーバーレイ側だけこの関数に乗せ替えて箱側を自前スタイルのまま放置すると、箱が
 * 「中央寄せされない（画面左上に張り付く）」という別の不具合になる（2026-08-12、
 * `ConfirmModal.tsx` と `MainLayout.tsx` の2箇所で実際に発生し、あわせて修正した）。
 * `modalOverlayStyle(` を呼んでいる全ファイルが、箱側で `modalBoxStyle(` または
 * 手書きの `margin:"auto"` のいずれかを併用していることを検査する。
 */
describe("モーダル契約：modalOverlayStyle() の利用者は箱を margin:auto で中央寄せしている（v3.64）", () => {
  const consumers = allFiles
    .map(f => ({ full: f, rel: path.relative(SRC_DIR, f).replace(/\\/g, "/") }))
    .filter(({ full }) => /modalOverlayStyle\(/.test(fs.readFileSync(full, "utf-8")));

  it("健全性チェック：modalOverlayStyle() の利用者が1件以上見つかる", () => {
    expect(consumers.length).toBeGreaterThan(0);
  });

  it.each(consumers.map(f => f.rel))(
    "%s は箱側で modalBoxStyle() または margin:\"auto\" を使って中央寄せしている",
    relPath => {
      const content = fs.readFileSync(path.join(SRC_DIR, relPath), "utf-8");
      const usesSharedBox = /modalBoxStyle\(/.test(content);
      const hasMarginAuto = /margin:\s*"auto"/.test(content);
      if (!usesSharedBox && !hasMarginAuto) {
        throw new Error(
          `[modalStyles] ${relPath} は modalOverlayStyle() を使っていますが、箱側に\n` +
          `modalBoxStyle() も margin:"auto" も見つかりませんでした。\n` +
          `modalOverlayStyle() は中央寄せを一切行わないため（CLAUDE.md Section 21・v3.64）、\n` +
          `箱側で中央寄せしないと画面左上に張り付いた見た目になります` +
          `（2026-08-12にConfirmModal.tsx/MainLayout.tsxで実際に発生し修正済み）。`,
        );
      }
    },
  );
});

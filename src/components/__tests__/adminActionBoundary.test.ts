// src/components/__tests__/adminActionBoundary.test.ts
//
// 【設計意図】v3.78 パートB②「admin専用アクションの越境」対応（CLAUDE.md参照）。
//
// saveGroup・saveObjective等のadmin専用14アクション（正確には15。
// src/lib/admin/adminOnlyActions.ts参照）は、appStore.ts側にisGuestMode()の直接ガードを
// 持たず、MainLayout.tsx の唯一のUI分岐（`(isAdminOpen && !isGuest) ? adminOverlay : ...`）
// でAdminView自体に到達できないことだけで安全になっている単一障害点。
// このテストは2つの独立した壊れ方をどちらも検知する：
//
// 【検査1】越境検知：ADMIN_ONLY_ACTIONSの各アクションの呼び出し元
//   （`useAppStore(s => s.<name>)` パターン）が、ADMIN_ONLY_ACTION_SURFACE_FILES
//   （AdminView.tsx／LoadingTipsSection.tsx／OkrImportModal.tsx）以外のファイルに
//   増えていないこと。新しい画面が誤ってこれらのアクションを呼び始めたら、
//   MainLayout.tsxのUI分岐が健全でも実害が出る（これが本当に守りたいこと）。
//
// 【検査2】単一防御点の健全性：MainLayout.tsxのAdminView描画分岐から `!isGuest` が
//   失われていないこと（source走査。modalStyles.test.ts と同じ方式）。
//
// このリポジトリにReactレンダリングテスト基盤が無いため（CLAUDE.md Section 24 Step H
// 「useAIConsultation.ts/useUndoStack.ts自体は...単体テストの対象外」と同じ制約）、
// 「ゲストが実際にAdminViewを開けないこと」自体は実機確認に委ねる。このテストは
// ソースコードの構造（越境・分岐の消失）が壊れたら気づける、という機械チェックに限定する。
//
// 【わざと壊して赤くなることを確認した記録（実装前）】
// ①検査1：AdminView.tsx以外のファイル（例：src/components/dashboard/DashboardView.tsx）に
//   一時的に `useAppStore(s => s.saveGroup)` を追記 → offendersに
//   "saveGroup: components/dashboard/DashboardView.tsx" が出てredになることを確認 → 削除して復元。
// ②検査2：MainLayout.tsxの `(isAdminOpen && !isGuest) ? adminOverlay` を
//   `isAdminOpen ? adminOverlay` に一時的に書き換え → redになることを確認 → 元に戻した。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_ONLY_ACTIONS, ADMIN_ONLY_ACTION_SURFACE_FILES } from "../../lib/admin/adminOnlyActions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../../");
const MAIN_LAYOUT_PATH = path.resolve(SRC_DIR, "components/layout/MainLayout.tsx");

const SELF_FILE_REL = "components/__tests__/adminActionBoundary.test.ts";

function listAllSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listAllSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function toRelPath(absPath: string): string {
  return path.relative(SRC_DIR, absPath).split(path.sep).join("/");
}

describe("admin専用アクションの越境検知（CLAUDE.md v3.78 パートB②）", () => {
  const allFiles = listAllSourceFiles(SRC_DIR);
  const surfaceSet = new Set<string>(ADMIN_ONLY_ACTION_SURFACE_FILES);

  it("ADMIN_ONLY_ACTIONSの呼び出し元は、宣言済みのAdminView系3ファイル以外に存在しない", () => {
    const offenders: string[] = [];
    for (const absPath of allFiles) {
      const relPath = toRelPath(absPath);
      if (relPath === SELF_FILE_REL) continue;
      if (relPath === "lib/admin/adminOnlyActions.ts") continue;
      if (relPath.includes("__tests__/")) continue;
      if (relPath === "stores/appStore.ts") continue; // 定義箇所自体は対象外
      if (surfaceSet.has(relPath)) continue; // 許された呼び出し元
      const content = fs.readFileSync(absPath, "utf8");
      for (const name of ADMIN_ONLY_ACTIONS) {
        const pattern = new RegExp(`useAppStore\\([a-zA-Z_$]+ => [a-zA-Z_$]+\\.${name}\\)`);
        if (pattern.test(content)) {
          offenders.push(`${name}: ${relPath}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ADMIN_ONLY_ACTION_SURFACE_FILESに列挙したファイルは実在する", () => {
    const missing = ADMIN_ONLY_ACTION_SURFACE_FILES.filter(
      rel => !fs.existsSync(path.resolve(SRC_DIR, rel)),
    );
    expect(missing).toEqual([]);
  });
});

describe("単一防御点の健全性：MainLayout.tsxのAdminView描画分岐（CLAUDE.md v3.78 パートB②）", () => {
  it("AdminViewを描画する分岐が isAdminOpen && !isGuest のままである", () => {
    const content = fs.readFileSync(MAIN_LAYOUT_PATH, "utf8");
    expect(content).toContain("(isAdminOpen && !isGuest) ? adminOverlay");
  });
});

// リストのその場追加の配線をソース走査で固定する（コンポーネントの描画テスト基盤が無いため）。
// コメントの文字列で無力化されないよう、コメント行を除いてから走査する（CLAUDE.md Section 59）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(dir, "../../..");
const code = (rel: string) =>
  fs.readFileSync(path.resolve(srcRoot, rel), "utf8")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

describe("FABの分岐（MainLayout）", () => {
  const s = code("components/layout/MainLayout.tsx");
  it("PC の FAB の「＋ タスクを追加」は常にポップアップ（リストの追加行へは渡さない）", () => {
    expect(s).not.toContain("requestListInlineAdd");
    expect(s).not.toContain("inlineAddRegistry");
    expect(s).toMatch(/onSelectTask=\{\(\) => \{\s*setIsFabMenuOpen\(false\);\s*setIsQuickAddOpen\(true\);\s*\}\}/);
  });
  it("Ctrl+K の「新規タスクを追加」とカレンダー等の他経路はポップアップのまま", () => {
    expect(s).toMatch(/onQuickAdd=\{\(\) => setIsQuickAddOpen\(true\)\}/);
  });
  it("FAB 用のレジストリは撤去済み", () => {
    expect(fs.existsSync(path.resolve(srcRoot, "lib/list/inlineAddRegistry.ts"))).toBe(false);
  });
});

describe("リストビュー（ListView）", () => {
  const s = code("components/list/ListView.tsx");
  it("追加行は PC 表（モバイルでない）かつ編集できるときだけ描画・登録する", () => {
    expect(s).toMatch(/const inlineAddEnabled = !isMobile && canGuestEdit\(/);
    expect(s).toMatch(/inlineAddEnabled && !isGroupCollapsed && \(\s*<ListInlineAddRow/);
    expect(s).not.toContain("registerListInlineAdd");
  });
  it("追加行はモバイルのカード表示側には無い（PC表の側にだけある）", () => {
    expect(s.indexOf("<ListInlineAddRow")).toBeGreaterThan(s.indexOf("PC：テーブル"));
  });
  it("折りたたまれたグループでは追加行を出さない", () => {
    expect(s).toMatch(/inlineAddEnabled && !isGroupCollapsed && \(\s*<ListInlineAddRow/);
  });
});

describe("下書きと未保存確認（useListInlineAdd）", () => {
  const s = code("components/list/useListInlineAdd.ts");
  it("名前が入った下書きがあるとき未保存編集レジストリに載る（Section 46）", () => {
    expect(s).toContain("registerUnsavedEditor(editorId");
    expect(s).toContain("unregisterUnsavedEditor(editorId)");
    expect(s).toContain("Object.values(drafts).some(isDraftDirty)");
  });
  it("作成は prepareNewTask を含む共通の登録処理を通る", () => {
    expect(s).toContain("createInlineSubmitter(");
    expect(code("lib/list/inlineAdd.ts")).toContain("prepareNewTask(");
    expect(code("components/task/QuickAddTaskModal.tsx")).toContain("prepareNewTask(");
  });
});

describe("追加行（ListInlineAddRow）", () => {
  const s = code("components/list/ListInlineAddRow.tsx");
  it("日本語入力の変換確定の Enter では登録しない", () => {
    expect(s).toContain("isComposing");
  });
  it("Esc でやめる・Enter で登録・aria-label を持つ", () => {
    expect(s).toContain('e.key === "Escape"');
    expect(s).toContain('e.key === "Enter"');
    expect(s).toContain("aria-label=");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// v3.194：サイドバーのプロジェクト見出しの作り直し・WBSインポートのヘッダー移設・一括操作バーの下部固定。
// ソース走査型（Section 59）：コメント・文字列で無力化されないよう、コメント行を除いてから照合する。
const SRC = join(__dirname, "..", "..", "..");
const read = (f: string) =>
  readFileSync(join(SRC, f), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("一括操作バーは画面下部に固定され、レイアウトに入らない", () => {
  const bar = read("components/task/BulkActionBar.tsx");
  it('position:"fixed" で描画し、z-index はモーダル(200)より下', () => {
    expect(bar).toMatch(/position:\s*"fixed"/);
    const z = bar.match(/BULK_BAR_Z_INDEX\s*=\s*(\d+)/);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeLessThan(200);
    expect(Number(z![1])).toBeGreaterThan(10);
  });
  it("PC は右下の FAB 分を左右対称に空けるため幅を制限する", () => {
    expect(bar).toMatch(/maxWidth:\s*`calc\(100vw - \$\{PC_SIDE_RESERVE_PX \* 2\}px\)`/);
  });
  it("リスト・カンバンは旧来の高さ可変ラッパー（行を押し下げる）を持たない", () => {
    for (const f of ["components/list/ListView.tsx", "components/kanban/KanbanView.tsx"]) {
      expect(read(f)).not.toMatch(/maxHeight: selectedIds\.size > 0/);
    }
  });
  it("リスト・カンバン・ガントは選択中だけ末尾に余白を足す", () => {
    for (const f of ["components/list/ListView.tsx", "components/kanban/KanbanView.tsx", "components/gantt/GanttView.tsx"]) {
      expect(read(f)).toMatch(/BULK_BAR_SCROLL_PAD_PX/);
    }
  });
  it("ガントは左右のスクロール領域に同じ高さの余白を足す（Section 80）", () => {
    const g = read("components/gantt/GanttView.tsx");
    expect((g.match(/data-gantt-bulkbar-pad style=\{\{ height: bulkBarPadPx/g) ?? []).length).toBe(2);
  });
});

describe("WBSインポートはヘッダー（ベルの左）へ移り、ガント・リストのときだけ出る", () => {
  const ml = read("components/layout/MainLayout.tsx");
  it('表示条件：計画モード・ゲスト以外・ガントまたはリスト', () => {
    expect(ml).toMatch(/const showImportWbsButton = !isGuest && appMode === "plan" && \(viewMode === "gantt" \|\| viewMode === "list"\)/);
  });
  it("PC は固定ベルと同じ箱の中でベルの直前に置く", () => {
    expect(ml).toMatch(/\{importWbsButton\(APP_BELL_SIZE_PC_PX\)\}\s*\{notificationBell\(APP_BELL_SIZE_PC_PX\)\}/);
  });
  it("サイドバーの見出しにはインポートボタンも全タスク／自分のみトグルも無い", () => {
    const i = ml.indexOf("function Sidebar(");
    const sidebar = ml.slice(i);
    expect(sidebar).not.toMatch(/onImportWbs\(null\)/);
    expect(sidebar).not.toMatch(/mineOnly|onToggleMineOnly/);
  });
});

describe("サイドバーのプロジェクト見出しは1行固定", () => {
  const ml = read("components/layout/MainLayout.tsx");
  it("見出し行は高さ固定・nowrap・省略で、wrap しない", () => {
    const i = ml.indexOf('onClick={togglePjOpen}');
    const region = ml.slice(i - 600, i + 1800);
    expect(region).toMatch(/height: "24px"/);
    expect(region).toMatch(/whiteSpace: "nowrap"/);
    expect(region).toMatch(/textOverflow: "ellipsis"/);
    expect(region).not.toMatch(/flexWrap: "wrap"/);
  });
});

describe("「担当タスクのみ／全タスク」フィルタは廃止された", () => {
  it("各ビューは mineOnly を受け取らない", () => {
    for (const f of [
      "components/dashboard/DashboardView.tsx", "components/kanban/KanbanView.tsx", "components/list/ListView.tsx",
      "components/gantt/GanttView.tsx", "components/gantt/GanttMobileView.tsx", "components/layout/MainLayout.tsx",
    ]) {
      expect(read(f)).not.toMatch(/\bmineOnly\b/);
    }
  });
  it("保存値（localStorage）を読む処理が残っていない", () => {
    expect(read("components/layout/MainLayout.tsx")).not.toMatch(/SIDEBAR_MY_PROJECTS_ONLY/);
  });
});

// キーボードショートカットの配線を、コメントを除去したソース走査で固定する（Section 59）。
// 描画テスト基盤が無いため、「3画面がフックを呼ぶ」「判定が共通ヘルパー経由」を文字列で押さえる。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../../..");
const read = (p: string) =>
  readFileSync(resolve(SRC, p), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*\/\//.test(l))
    .join("\n");

describe("3画面が共通フックでJ/K・Enter・E・A・Dを受ける", () => {
  for (const f of ["components/list/ListView.tsx", "components/kanban/KanbanView.tsx", "components/gantt/GanttView.tsx"]) {
    it(`${f} は useTaskKeyboardNav を呼ぶ`, () => {
      expect(read(f)).toMatch(/useTaskKeyboardNav\(\{/);
    });
  }
  it("行・カード・バーに data-task-focus-id が付いている", () => {
    expect(read("components/list/ListView.tsx")).toMatch(/data-task-focus-id=\{task\.id\}/);
    expect(read("components/kanban/KanbanView.tsx")).toMatch(/data-task-focus-id=\{task\.id\}/);
    const parts = read("components/gantt/GanttParts.tsx");
    expect(parts).toMatch(/data-task-focus-id=\{taskId\}/);
    expect((parts.match(/data-task-focus-id=\{task\.id\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("フックは共通の判定を通す", () => {
  const hook = read("hooks/useTaskKeyboardNav.ts");
  it("shouldIgnoreSingleKey を通し、isModalOpen を渡す", () => {
    expect(hook).toMatch(/shouldIgnoreSingleKey\(e,/);
    expect(hook).toMatch(/isModalOpen\(\)/);
  });
  it("E は toggleTaskDone（saveTask経路＋Undoトースト）を呼ぶ", () => {
    expect(hook).toMatch(/toggleTaskDone\(/);
  });
  it("↑↓は注目中のタスクがあるときだけ", () => {
    expect(hook).toMatch(/ArrowDown" && hasFocus/);
    expect(hook).toMatch(/ArrowUp" && hasFocus/);
  });
});

describe("MainLayout の ? と N", () => {
  const m = read("components/layout/MainLayout.tsx");
  it("共通の判定を通し、? は e.key で判定する", () => {
    expect(m).toMatch(/shouldIgnoreSingleKey\(e,/);
    expect(m).toMatch(/e\.key === "\?"/);
  });
  it("N は右下の＋と同じ setIsQuickAddOpen(true)・モバイルと詳細表示中は無効", () => {
    expect(m).toMatch(/isPlainLetter\(e, "n"\)/);
    expect(m).toMatch(/if \(isMobile \|\| isTaskSidePanelOpen\) return;/);
  });
});

describe("ConsultationPanel の Ctrl+Z は入力欄で実行しない", () => {
  it("共通判定 shouldRunConsultUndo を通し、キー判定を直書きしない", () => {
    const c = read("components/consultation/ConsultationPanel.tsx");
    expect(c).toMatch(/shouldRunConsultUndo\(e,/);
    expect(c).not.toMatch(/e\.key === "z"/);
  });
});

describe("詳細に A・D の移動先がある", () => {
  it("TaskSidePanel に data-shortcut-field=assignee/due", () => {
    const t = read("components/task/TaskSidePanel.tsx");
    expect(t).toMatch(/data-shortcut-field="assignee"/);
    expect(t).toMatch(/data-shortcut-field="due"/);
  });
});

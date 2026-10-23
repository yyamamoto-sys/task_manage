import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const code = (rel: string) =>
  readFileSync(resolve(__dirname, "../../..", rel), "utf-8")
    .split(/\r?\n/)
    .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

describe("保存の拒否を握る配線（M74・M78）", () => {
  it("ガントのバーのドラッグ確定は saveTask を直接 await しない", () => {
    const src = code("components/gantt/GanttView.tsx");
    expect(src).toContain("settleSingleSave");
    expect(src).not.toMatch(/await saveTask\(\{ \.\.\.task, (start_date: newDate|due_date: newDate|start_date: range)/);
    expect(src).not.toMatch(/await saveTask\(\{\s*\.\.\.task,\s*\.\.\.\(shift\.start/);
  });
  it("まとめてドラッグの元に戻すは settleUndoSaves を通す", () => {
    expect(code("hooks/useTaskDragReorder.ts")).toContain("settleUndoSaves");
  });
  it("一括操作の元に戻すは forEach で saveTask/restoreTask を投げ捨てない", () => {
    const src = code("hooks/useBulkTaskActions.ts");
    expect(src).not.toMatch(/forEach\([^)]*\)\s*=>\s*\{?\s*(const t = [^\n]*\n\s*)?(if \(t\) )?(saveTask|restoreTask)/);
    expect((src.match(/settleUndoSaves\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// タスクを1件削除する画面は、すべて deleteTaskWithUndo を通す（ストアの deleteTask 直呼びで
// 取り消しトーストが欠落した実績：右サイドパネル）。変更履歴セクションの onDelete は
// 「履歴からのUndo」自体なので対象外。
describe("タスク削除の経路", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const FILES = ["../../../components/task/TaskEditModal.tsx", "../../../components/task/TaskSidePanel.tsx"];
  for (const rel of FILES) {
    it(`${path.basename(rel)} の削除は deleteTaskWithUndo を使う`, () => {
      const src = fs.readFileSync(path.resolve(dir, rel), "utf8");
      expect(src).toContain("deleteTaskWithUndo(");
      const direct = src.split("\n").filter(l => /\bdeleteTask\(/.test(l) && !l.includes("onDelete="));
      expect(direct).toEqual([]);
    });
  }
});

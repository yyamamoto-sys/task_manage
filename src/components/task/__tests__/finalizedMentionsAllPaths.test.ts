// タスクのコメントを入力できる画面（MentionTextarea を使う画面）は、保存時に必ず
// finalized_mentions を確定する経路を通ること。通知は finalized_mentions の変化だけを見るため、
// 経路が欠けると @メンション通知が黙って飛ばない（サイドパネル・新規登録で実際に欠落していた）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(dir, "../../..");
const read = (rel: string) => fs.readFileSync(path.resolve(srcRoot, rel), "utf8");

function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(p, out); }
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("finalized_mentions を確定する経路", () => {
  it("保存ペイロードの組み立て（buildTaskUpdatePayload）が finalizedMentionsOf を使う", () => {
    expect(read("lib/taskEditPayload.ts")).toContain("finalizedMentionsOf(");
  });
  it("編集モーダル・サイドパネルは buildTaskUpdatePayload 経由で保存する", () => {
    expect(read("components/task/TaskEditModal.tsx")).toContain("buildTaskUpdatePayload(");
    expect(read("components/task/TaskSidePanel.tsx")).toContain("buildTaskUpdatePayload(");
  });
  it("新規登録モーダルは finalized_mentions を書く", () => {
    const s = read("components/task/QuickAddTaskModal.tsx");
    expect(s).toMatch(/finalized_mentions:\s*finalizedMentionsOf\(/);
  });
  it("サイドパネルのコメント欄は MentionTextarea（@候補入力）を使う", () => {
    const s = read("components/task/TaskSidePanel.tsx");
    expect(s).toContain("<MentionTextarea");
  });
  it("MentionTextarea でコメントを入力する画面は、上の3画面だけ（新設したら本テストに経路を追加する）", () => {
    const users = walk(srcRoot)
      .filter(f => fs.readFileSync(f, "utf8").includes("<MentionTextarea"))
      .map(f => path.relative(srcRoot, f).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual([
      "components/task/QuickAddTaskModal.tsx",
      "components/task/TaskEditModal.tsx",
      "components/task/TaskSidePanel.tsx",
    ]);
  });
});

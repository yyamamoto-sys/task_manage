// v3.179：カンバンのキー判定（モーダル・IME）・同じ列へのドロップ・保存失敗の扱いをソース走査で固定する
// （Section 59：コメント除去してから走査）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function read(rel: string): string {
  const raw = fs.readFileSync(path.join(SRC, rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}

describe("カンバン", () => {
  const view = read("components/kanban/KanbanView.tsx");

  it("Ctrl+A・Esc は共通判定（IME・モーダル表示中）を通し、複製モーダル表示中は登録しない", () => {
    expect(view).toMatch(/shouldIgnoreCommandKey\(e, \{ activeElement: document\.activeElement as HTMLElement \| null, modalOpen: isModalOpen\(\) \}\)/);
    expect(view).toMatch(/if \(editingTaskId \|\| addingStatus !== null \|\| showDuplicateModal\) return;/);
    expect(view).not.toMatch(/const isTyping = tag ===/);
  });
  it("同じ列へのドロップでは保存しない", () => {
    expect(view).toMatch(/if \(!task \|\| task\.status === newStatus\) return;/);
  });
  it("ドロップ時の単体保存の失敗を未処理の Promise 拒否にしない", () => {
    expect(view).toMatch(/saveTask\(\{ \.\.\.task, status: newStatus, updated_by: currentUser\.id \}\)\.catch\(\(\) => \{\}\)/);
  });
});

describe("ワークロード", () => {
  const view = read("components/workload/WorkloadView.tsx");
  it("選んでいたPJが一覧から消えたら全プロジェクトに戻す", () => {
    expect(view).toMatch(/const effectivePjFilter = pjFilter === "all" \|\| projects\.some\(p => p\.id === pjFilter\) \? pjFilter : "all"/);
    expect(view).toMatch(/t\.project_id === effectivePjFilter/);
    expect(view).toMatch(/value=\{effectivePjFilter\}/);
  });
});

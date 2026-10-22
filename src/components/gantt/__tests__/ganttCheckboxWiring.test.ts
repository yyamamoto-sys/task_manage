// v3.160：ガントの左列チェックボックスと一括操作の配線をソース走査で固定する（Section 59：コメント除去してから走査）。
// わざと壊して赤・戻して緑を確認済み。

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

describe("ガントのチェックボックス", () => {
  const view = read("components/gantt/GanttView.tsx");
  const parts = read("components/gantt/GanttParts.tsx");

  it("クリックは applyCheckboxClick（表示順 visibleOrderedTaskIds・親子連動トグル）を通り、選択 state を共有する", () => {
    expect(view).toMatch(/applyCheckboxClick\(prev, visibleOrderedTaskIds, selectionAnchorRef\.current, taskId, e\.shiftKey,/);
    expect(view).toMatch(/toggleTaskWithChildren\(p, id, allTasks\)/);
    expect(view).toMatch(/setSelectedTaskIds\(prev => \{\s*const r = applyCheckboxClick/);
  });
  it("3種の左列タスク行（PJ別・ToDo別・人別）にだけ配線し、プレビューには渡さない", () => {
    expect((view.match(/onCheckboxClick=\{rowCheckboxClick\}/g) ?? []).length).toBe(3);
    expect(view).toMatch(/const rowCheckboxClick = isPreview \? undefined : handleCheckboxClick/);
  });
  it("チェックボックスは onClick の MouseEvent を渡し（onChange でトグルしない）、行クリックへ伝播させない", () => {
    expect(parts).toMatch(/onClick=\{e => onCheckboxClick\(e, task\.id\)\}/);
    expect(parts).toMatch(/onMouseDown=\{e => \{ e\.stopPropagation\(\)/);
    expect(parts).not.toMatch(/onChange=\{\(\) => onCheckboxClick/);
    expect((parts.match(/<GanttRowCheckbox /g) ?? []).length).toBe(3);
  });
  it("見出し行（pj-header・section-header・todo-header・person-header）にはチェックボックスを置かない", () => {
    expect((parts.match(/data-gantt-row-checkbox/g) ?? []).length).toBe(1);
    expect(view).not.toMatch(/type="checkbox"/);
  });
});

describe("ガントの一括操作バー", () => {
  const view = read("components/gantt/GanttView.tsx");
  it("共有の BulkActionBar と useBulkTaskActions を使い、選択 state を渡す", () => {
    expect(view).toMatch(/useBulkTaskActions\(allTasks, members, selectedTaskIds, currentUser\.id, clearTaskSelection\)/);
    expect(view).toMatch(/<BulkActionBar\b/);
    expect(view).toMatch(/actions=\{bulkActions\}/);
    expect(view).toMatch(/orderedTaskIds=\{visibleOrderedTaskIds\}/);
  });
  it("プレビューでは出さず、ヘッダーとガント本体の間（FAB の bottomStack と別位置）に置く", () => {
    expect(view).toMatch(/\{!isPreview && selectedTaskIds\.size > 0 && \(\s*<BulkActionBar\b/);
  });
});

describe("ガントのショートカットと選択の後始末", () => {
  const view = read("components/gantt/GanttView.tsx");
  it("T・+-・Ctrl+A・Enter はモーダル表示中・入力中・IME変換中に発火しない（共通判定を通す）", () => {
    expect(view).toMatch(/shouldIgnoreCommandKey\(e, \{ activeElement: el, modalOpen: isModalOpen\(\) \}\)/);
    expect(view).not.toMatch(/tag === "INPUT" && !isRange/);
  });
  it("ボタン・チェックボックス上の Enter は詳細を開かない", () => {
    expect(view).toMatch(/if \(isInteractiveTarget\(el\)\) return;/);
  });
  it("消えたタスクは選択から外す（一括バーの件数と対象がずれない）", () => {
    expect(view).toMatch(/setSelectedTaskIds\(prev => pruneSelection\(prev, allTasks\)\)/);
  });
});

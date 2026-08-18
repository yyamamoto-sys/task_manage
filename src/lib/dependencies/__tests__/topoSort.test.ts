// src/lib/dependencies/__tests__/topoSort.test.ts
//
// 【v3.77バグ修正の回帰テスト】applyProposalWithConfirmation（date_change）が
// dialog.itemsをAIの返した順のまま反映すると、確認画面で利用者が確定した日付が
// B3自動リスケ連鎖に黙って上書きされることがあった（applyProposal.ts参照）。

import { describe, it, expect } from "vitest";
import { sortTaskIdsByDependencyOrder } from "../topoSort";

function dep(predecessor_task_id: string, successor_task_id: string, is_deleted = false) {
  return { predecessor_task_id, successor_task_id, is_deleted };
}

describe("sortTaskIdsByDependencyOrder", () => {
  it("依存が無ければ元の順序のまま返す", () => {
    expect(sortTaskIdsByDependencyOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("後続が先・先行が後の順で渡されても、先行を先に並べ替える", () => {
    // 元の並び：後続(b) → 先行(a)。a→bの依存がある。
    const result = sortTaskIdsByDependencyOrder(["b", "a"], [dep("a", "b")]);
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
    expect(result).toEqual(["a", "b"]);
  });

  it("鎖状の依存（a→b→c）を末尾から渡しても正しい順に並べ替える", () => {
    const result = sortTaskIdsByDependencyOrder(
      ["c", "b", "a"],
      [dep("a", "b"), dep("b", "c")],
    );
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("集合に含まれないタスクを介した依存は無視する（対象外のノードは辺の判定に使わない）", () => {
    // x（集合外）→a という依存があっても、集合内の順序には影響しない
    const result = sortTaskIdsByDependencyOrder(["a", "b"], [dep("x", "a"), dep("b", "a")]);
    // b→a の依存だけが有効。b が先。
    expect(result).toEqual(["b", "a"]);
  });

  it("論理削除済み（is_deleted:true）の依存は無視する", () => {
    const result = sortTaskIdsByDependencyOrder(["b", "a"], [dep("a", "b", true)]);
    // 削除済み依存は無視されるため、元の順序（b, a）のまま
    expect(result).toEqual(["b", "a"]);
  });

  it("依存関係が無いタスク同士は元の相対順序をできるだけ保つ", () => {
    const result = sortTaskIdsByDependencyOrder(["c", "b", "a"], []);
    expect(result).toEqual(["c", "b", "a"]);
  });

  it("循環データが混入していても無限ループ・例外にならず、元の順序のまま返す（安全側の割り切り）", () => {
    const result = sortTaskIdsByDependencyOrder(
      ["a", "b", "c"],
      [dep("a", "b"), dep("b", "c"), dep("c", "a")],
    );
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("並べ替え対象が空配列でも例外にならない", () => {
    expect(sortTaskIdsByDependencyOrder([], [dep("a", "b")])).toEqual([]);
  });

  it("複数の独立した依存（a→b、c→d）を混在した順で渡しても、それぞれ先行を先に並べる", () => {
    const result = sortTaskIdsByDependencyOrder(
      ["b", "d", "a", "c"],
      [dep("a", "b"), dep("c", "d")],
    );
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
    expect(result.indexOf("c")).toBeLessThan(result.indexOf("d"));
  });
});

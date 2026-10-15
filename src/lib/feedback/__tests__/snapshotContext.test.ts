// src/lib/feedback/__tests__/snapshotContext.test.ts
//
// v3.157：スナップショットの材料の登録所（pull 型）。登録・解除の対称性、同名キーの浅いマージ、
// 1つの getter の例外で他を止めないこと、古い getter の解除が新しい登録を消さないこと。

import { describe, expect, it, vi } from "vitest";
import { collectSnapshotContext, registerSnapshotProvider, snapshotProviderCount } from "../snapshotContext";

describe("snapshotContext", () => {
  it("登録した getter を送信時に呼ぶ（pull）。解除したら呼ばれない", () => {
    const before = snapshotProviderCount();
    const getter = vi.fn(() => ({ view: "list" }));
    const off = registerSnapshotProvider("t1", getter);
    expect(snapshotProviderCount()).toBe(before + 1);
    expect(getter).not.toHaveBeenCalled();
    expect(collectSnapshotContext().view).toBe("list");
    expect(getter).toHaveBeenCalledTimes(1);
    off();
    expect(snapshotProviderCount()).toBe(before);
    expect(collectSnapshotContext().view).toBeUndefined();
  });

  it("同じ最上位キー（selection 等）は浅くマージする（後から登録した側が同名のフィールドを上書き）", () => {
    const off1 = registerSnapshotProvider("a", () => ({ selection: { projectId: "pj-1", taskId: "old" } }));
    const off2 = registerSnapshotProvider("b", () => ({ selection: { taskId: "t-2", selectedCount: 2 }, listSettings: { groupBy: "project" } }));
    expect(collectSnapshotContext()).toEqual({
      selection: { projectId: "pj-1", taskId: "t-2", selectedCount: 2 },
      listSettings: { groupBy: "project" },
    });
    off1(); off2();
  });

  it("getter が例外を投げても他の材料を集める。null・配列の返り値は無視する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const offs = [
      registerSnapshotProvider("bad", () => { throw new Error("boom"); }),
      registerSnapshotProvider("null", () => null),
      registerSnapshotProvider("arr", () => [1, 2] as unknown as Record<string, unknown>),
      registerSnapshotProvider("ok", () => ({ mode: "plan" })),
    ];
    expect(collectSnapshotContext()).toEqual({ mode: "plan" });
    expect(warn).toHaveBeenCalled();
    offs.forEach(f => f());
    warn.mockRestore();
  });

  it("同じ id を登録し直したあと、古い登録の解除は新しい登録を消さない", () => {
    const offOld = registerSnapshotProvider("same", () => ({ view: "old" }));
    const offNew = registerSnapshotProvider("same", () => ({ view: "new" }));
    offOld();
    expect(collectSnapshotContext().view).toBe("new");
    offNew();
    expect(collectSnapshotContext().view).toBeUndefined();
  });
});

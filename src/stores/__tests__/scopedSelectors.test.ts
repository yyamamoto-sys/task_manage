import { describe, it, expect } from "vitest";
import { useAppStore, selectScopedTasks, selectScopedProjects } from "../appStore";

// 2026-07-03: selectScopedTasks/selectScopedProjects が毎回新しい配列を返すと、
// zustand v5（React の useSyncExternalStore 経由）が「state が変化し続けている」と
// 誤判定し、React error #185 (Maximum update depth exceeded) で全画面がクラッシュする
// 事故が本番で発生した。同じ state オブジェクトに対しては同じ配列参照を返すことを保証する。
describe("selectScopedTasks / selectScopedProjects のメモ化契約", () => {
  it("同じ state オブジェクトに対しては同じ配列参照を返す（useSyncExternalStore の必須要件）", () => {
    const state = useAppStore.getState();
    expect(selectScopedTasks(state)).toBe(selectScopedTasks(state));
    expect(selectScopedProjects(state)).toBe(selectScopedProjects(state));
  });

  it("store が実際に更新された後は新しい参照を返す（stale data を返さない）", () => {
    const before = selectScopedTasks(useAppStore.getState());
    useAppStore.setState({ tasks: [...useAppStore.getState().tasks] });
    const after = selectScopedTasks(useAppStore.getState());
    expect(before).not.toBe(after);

    const beforePjs = selectScopedProjects(useAppStore.getState());
    useAppStore.setState({ projects: [...useAppStore.getState().projects] });
    const afterPjs = selectScopedProjects(useAppStore.getState());
    expect(beforePjs).not.toBe(afterPjs);
  });
});

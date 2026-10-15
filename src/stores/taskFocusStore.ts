// src/stores/taskFocusStore.ts
//
// キーボードで「注目中」のタスク（J/K で動かす）。チェックボックスの選択（selectedIds）とは別概念で、
// 詳細を開く・完了にする・担当/期限へ飛ぶ操作の対象になる（v3.162）。ビューをまたいで1つだけ持つ。
import { create } from "zustand";

interface TaskFocusState {
  focusedTaskId: string | null;
  setFocusedTaskId: (id: string | null) => void;
}

export const useTaskFocusStore = create<TaskFocusState>(set => ({
  focusedTaskId: null,
  setFocusedTaskId: id => set(s => (s.focusedTaskId === id ? s : { focusedTaskId: id })),
}));

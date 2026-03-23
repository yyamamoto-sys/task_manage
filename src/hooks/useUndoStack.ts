// src/hooks/useUndoStack.ts
//
// 【設計意図】
// AI提案を「反映する」した後のUndo履歴を管理するHook。
// 最大5ステップ（MAX_STACK）を保持し、それを超えた場合は変更履歴モーダルから任意のステップに戻せる。
// stateの非同期性の問題を回避するために ref + state を組み合わせている。

import { useState, useRef } from "react";

// ===== 型定義 =====

export interface UndoSnapshot {
  id: string;           // uuid
  label: string;        // 例："日程変更 (3タスク)"
  appliedAt: string;    // ISO8601
  operations: UndoOperation[];
}

export type UndoOperation =
  | { type: "task_field"; taskId: string; field: string; oldValue: unknown }
  | { type: "task_restore"; taskId: string }   // 論理削除の取り消し
  | { type: "pj_restore"; pjId: string };       // PJ論理削除の取り消し

const MAX_STACK = 5;

// ===== Hook本体 =====

/**
 * 【設計意図】
 * UndoSnapshotのスタックを管理する。
 * pop()はstateの非同期性の問題があるため、stackRefを使って最新のスタックを確実に取得している。
 */
export function useUndoStack() {
  const [stack, setStack] = useState<UndoSnapshot[]>([]);
  const stackRef = useRef<UndoSnapshot[]>([]);

  const push = (snapshot: UndoSnapshot) => {
    const next = [snapshot, ...stackRef.current].slice(0, MAX_STACK);
    stackRef.current = next;
    setStack(next);
  };

  const pop = (): UndoSnapshot | null => {
    const current = stackRef.current;
    if (current.length === 0) return null;
    const top = current[0];
    const next = current.slice(1);
    stackRef.current = next;
    setStack(next);
    return top;
  };

  /**
   * 指定したidのsnapshotより新しいもの（先頭側）も含めて、
   * targetId以前（targetId込み）を全て削除する。
   * 複数undo（3つ前に戻すなど）に使用する。
   * 戻り値：実際に取り消すべきsnapshotの配列（新しい順）
   */
  const popUntil = (targetId: string): UndoSnapshot[] => {
    const current = stackRef.current;
    const targetIdx = current.findIndex(s => s.id === targetId);
    if (targetIdx < 0) return [];

    // targetIdx以前（インデックス0〜targetIdx）を全て取り出す
    const toUndo = current.slice(0, targetIdx + 1);
    const remaining = current.slice(targetIdx + 1);
    stackRef.current = remaining;
    setStack(remaining);
    return toUndo;
  };

  const remove = (id: string) => {
    const next = stackRef.current.filter(s => s.id !== id);
    stackRef.current = next;
    setStack(next);
  };

  return {
    stack,
    push,
    pop,
    popUntil,
    remove,
    // stackRef.currentはmutableなrefでありReactが変化を追跡しないため、
    // renderサイクルと同期されているstate(stack)を使う。
    canUndo: stack.length > 0,
  };
}

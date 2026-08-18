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
  | { type: "task_restore"; taskId: string }
  | { type: "task_delete"; taskId: string }
  | { type: "pj_restore"; pjId: string }
  | { type: "pj_delete"; pjId: string }
  | { type: "pj_field"; pjId: string; field: string; oldValue: unknown };

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
   * 【v3.77追加】先頭のsnapshotを取り除かずに読むだけ（DB反映の成否を確認してから
   * 取り除くための「先に実行→成功したら捨てる」パターンで使う。CLAUDE.md参照）。
   */
  const peek = (): UndoSnapshot | null => stackRef.current[0] ?? null;

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

  /**
   * 【v3.77追加】popUntilの「取り除かない」版。targetId以前（込み）を新しい順の配列で返すだけで
   * スタックは変更しない。DB反映を1件ずつ試し、成功した分だけ後から removeMany で取り除く用途。
   */
  const peekUntil = (targetId: string): UndoSnapshot[] => {
    const current = stackRef.current;
    const targetIdx = current.findIndex(s => s.id === targetId);
    if (targetIdx < 0) return [];
    return current.slice(0, targetIdx + 1);
  };

  const remove = (id: string) => {
    const next = stackRef.current.filter(s => s.id !== id);
    stackRef.current = next;
    setStack(next);
  };

  /** 【v3.77追加】複数idをまとめて取り除く（undoUntilの部分成功時、成功した分だけ取り除く用途）。 */
  const removeMany = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const next = stackRef.current.filter(s => !idSet.has(s.id));
    stackRef.current = next;
    setStack(next);
  };

  return {
    stack,
    push,
    pop,
    peek,
    popUntil,
    peekUntil,
    remove,
    removeMany,
    // stackRef.currentはmutableなrefでありReactが変化を追跡しないため、
    // renderサイクルと同期されているstate(stack)を使う。
    canUndo: stack.length > 0,
  };
}

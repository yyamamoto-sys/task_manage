// src/hooks/useTaskKeyboardNav.ts
//
// リスト・カンバン・ガント共通のキーボード操作（v3.162）。
//   J / ↓ = 次のタスクへ注目を動かす ／ K / ↑ = 前へ ／ Enter = 詳細を開く
//   E = 完了↔未完了（Undoトースト付き）／ A = 詳細を開いて担当欄へ ／ D = 詳細を開いて期限欄へ
//   Esc = 注目を外す
// 各ビューは「今の表示順のタスクid配列」と「詳細を開く関数」を渡すだけでよい。
// 発火条件は shouldIgnoreSingleKey（入力中・IME・モーダル・修飾キー）に統一。↑↓は注目中のタスクが
// あるときだけ効かせ、無いときはページのスクロールを奪わない。選択（Ctrl+A のチェック状態）には触れない。

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useTaskFocusStore } from "../stores/taskFocusStore";
import { showToast } from "../components/common/Toast";
import { isModalOpen } from "../lib/autoUpdate";
import {
  isInteractiveTarget, isPlainLetter, moveFocus, shouldIgnoreSingleKey,
} from "../lib/shortcuts/keys";
import { toggleTaskDone } from "../lib/shortcuts/toggleDone";
import {
  applyTaskFocusRing, focusDetailField, scrollTaskIntoView,
} from "../lib/shortcuts/taskFocusDom";

interface Options {
  /** false（モバイル・プレビュー等）なら何も発火しない */
  enabled: boolean;
  /** 詳細・追加モーダル等が開いている間は true（単キーを止める） */
  blocked: boolean;
  /** 今の表示順のタスクid（折りたたみ・フィルタで見えないものは含めない） */
  orderedIds: string[];
  onOpen: (taskId: string) => void;
  currentUserId: string;
  /** ゲストの編集可否。E はこれが false なら何もしない */
  canEdit: boolean;
}

export function useTaskKeyboardNav({ enabled, blocked, orderedIds, onOpen, currentUserId, canEdit }: Options): void {
  const focusedId = useTaskFocusStore(s => s.focusedTaskId);
  const setFocused = useTaskFocusStore(s => s.setFocusedTaskId);
  const saveTask = useAppStore(s => s.saveTask);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;

  useEffect(() => {
    applyTaskFocusRing(focusedId);
    if (!focusedId) return;
    const raf = requestAnimationFrame(() => scrollTaskIntoView(focusedId));
    return () => cancelAnimationFrame(raf);
  }, [focusedId]);

  // フィルタ・折りたたみで注目中のタスクが表示から消えたら注目を外す（見えない対象に E / Enter が効かないように）
  useEffect(() => {
    if (!enabled || focusedId === null) return;
    if (!orderedIds.includes(focusedId)) setFocused(null);
  }, [enabled, orderedIds, focusedId, setFocused]);

  // ビューを離れたら注目とリングを片付ける（無効なインスタンス＝ガントのAIプレビュー等は触らない）
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => () => {
    if (!enabledRef.current) return;
    useTaskFocusStore.getState().setFocusedTaskId(null);
    applyTaskFocusRing(null);
  }, []);

  useEffect(() => {
    if (!enabled || blocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreSingleKey(e, { activeElement: document.activeElement as HTMLElement | null, modalOpen: isModalOpen() })) return;
      const ids = idsRef.current;
      const current = useTaskFocusStore.getState().focusedTaskId;
      const hasFocus = current !== null && ids.includes(current);

      if (e.key === "Escape") {
        if (current !== null) setFocused(null);
        return;
      }
      if (isPlainLetter(e, "j") || (e.key === "ArrowDown" && hasFocus && !e.shiftKey)) {
        e.preventDefault();
        setFocused(moveFocus(ids, current, 1));
        return;
      }
      if (isPlainLetter(e, "k") || (e.key === "ArrowUp" && hasFocus && !e.shiftKey)) {
        e.preventDefault();
        setFocused(moveFocus(ids, current, -1));
        return;
      }
      if (!hasFocus || current === null) return;
      if (e.key === "Enter") {
        // ボタン等にフォーカスがあるときの Enter はその要素自身の動作に任せる（二重に開かない）
        if (e.repeat || isInteractiveTarget(document.activeElement as HTMLElement | null)) return;
        e.preventDefault();
        onOpen(current);
        return;
      }
      if (isPlainLetter(e, "e")) {
        e.preventDefault();
        if (e.repeat || !canEdit) return;
        void toggleTaskDone(current, {
          getTasks: () => useAppStore.getState().tasks,
          saveTask, showToast, userId: currentUserId,
        });
        return;
      }
      if (isPlainLetter(e, "a") || isPlainLetter(e, "d")) {
        e.preventDefault();
        if (e.repeat) return;
        onOpen(current);
        focusDetailField(isPlainLetter(e, "a") ? "assignee" : "due");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, blocked, onOpen, currentUserId, canEdit, saveTask, setFocused]);
}

// src/hooks/useConfirmClose.ts
//
// 【設計意図・v3.169・M53】
// 編集系モーダルの「未保存編集の保護」を1か所にまとめる。FeedbackModal.tsx（v3.157）と同じ作法：
// ①未保存編集レジストリ（Section 46）に dirty を登録し、②dirty のときだけ閉じる操作
// （背景クリック・閉じる/キャンセル・Esc）の前に confirmDialog（tone:"danger"）を挟む。
// dirty でなければ確認なしで閉じる（開いた直後に誤って出さない）。
// busy（保存中など）の間は閉じる操作自体を無視する。

import { useEffect, useRef } from "react";
import { useUnsavedEditor } from "./useUnsavedEditor";
import { confirmDialog } from "../lib/dialog";

export function useConfirmClose(opts: {
  dirty: boolean;
  busy?: boolean;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
}): () => Promise<void> {
  const { dirty, busy = false, message, confirmLabel = "破棄して閉じる", onClose } = opts;
  useUnsavedEditor(dirty);
  const confirmingRef = useRef(false);

  const requestClose = async () => {
    if (busy || confirmingRef.current) return;
    if (dirty) {
      confirmingRef.current = true;
      let ok = false;
      try {
        ok = await confirmDialog(message, { tone: "danger", confirmLabel });
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
      // 確認ダイアログ（ConfirmModal・role="dialog"）が前面に出ている間の Esc は、そちらへの操作として扱う
      if (document.querySelector('[role="dialog"]')) return;
      void requestCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return requestClose;
}

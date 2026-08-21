// src/components/common/Toast.tsx
// イベントベースのトースト通知。alert() の代替。
// showToast() をどこからでも呼び出せる。ToastContainer を App のルートに1つ置く。
// 第3引数 action を渡すと「元に戻す」等のアクションボタン付きトーストになる（表示時間も延長）。
//
// 【isUndo フラグ】action.isUndo:true を付けたトーストは、表示と同時に
// lastUndoStore へ「直前のUndoアクション」として登録される（Ctrl/Cmd+Z で発火する軽量版
// Undo・詳細は lastUndoStore.ts）。単なる情報系トーストの「戻す」ボタン等には付けないこと。

import { useState, useEffect, useRef } from "react";
import { setLastUndoAction, clearLastUndoAction } from "../../lib/lastUndoStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { TOAST_BOTTOM_PC_PX, TOAST_ITEM_MIN_HEIGHT_PX, computeAboveFabBottom, computeFabBottomMobile } from "../../lib/layout/bottomStack";
import { useUiLayoutStore } from "../../stores/uiLayoutStore";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** true の場合、このトーストの onClick を Ctrl/Cmd+Z の「直前のUndo」として登録する */
  isUndo?: boolean;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

let _nextId = 0;
const _listeners = new Set<(item: ToastItem) => void>();
const _dismissUndoListeners = new Set<() => void>();

export function showToast(message: string, type: ToastType = "success", action?: ToastAction) {
  const item: ToastItem = { id: _nextId++, message, type, action };
  if (action?.isUndo) setLastUndoAction(action.onClick);
  _listeners.forEach(fn => fn(item));
}

/** Ctrl/Cmd+Z でUndoを実行した後、画面に残っているUndoトーストを閉じる */
export function dismissUndoToasts(): void {
  _dismissUndoListeners.forEach(fn => fn());
}

const STYLE: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: "#16a34a", icon: "✓" },
  error:   { bg: "#dc2626", icon: "✕" },
  info:    { bg: "#3b82f6", icon: "ℹ" },
};

// アクション付きは読んで押す時間が要るため長めに表示する
const DURATION_MS = 2800;
const DURATION_WITH_ACTION_MS = 6000;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // 【v3.91】右下スタック（src/lib/layout/bottomStack.ts）のToast位置を使う。FABメニュー展開中でも
  // 開閉のたびに位置が動いてちらつかないよう、ショートカットボタンが最も高くなる「FABメニュー
  // 展開時」の位置を基準に常に静的に確保している（bottomStack.ts冒頭コメント参照）。
  // 【v3.95】モバイルはボトムナビの実測高さ（MainLayout.tsxがResizeObserverでuiLayoutStoreへ
  // 反映）からFAB本体のbottomを求め、その上端+クリアランスをToastの位置とする（残る2つの
  // 実依存の1つ・「ボトムナビ→FAB」の下流。ToastContainerはApp.tsx直下でMainLayoutとは
  // 別の場所にマウントされるため、この値はモジュール変数ではなくストア経由で受け取る）。
  const isMobile = useIsMobile();
  const mobileBottomNavHeightPx = useUiLayoutStore(s => s.mobileBottomNavHeightPx);
  const toastBottomPx = isMobile
    ? computeAboveFabBottom(computeFabBottomMobile(mobileBottomNavHeightPx))
    : TOAST_BOTTOM_PC_PX;

  useEffect(() => {
    const timers = timersRef.current;
    const handler = (item: ToastItem) => {
      setToasts(prev => [...prev, item]);
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== item.id));
        timers.delete(item.id);
      }, item.action ? DURATION_WITH_ACTION_MS : DURATION_MS);
      timers.set(item.id, timer);
    };
    _listeners.add(handler);
    // Ctrl/Cmd+Z 実行後、画面に残っている「元に戻す」付きトーストを閉じる
    const dismissUndo = () => {
      setToasts(prev => prev.filter(t => {
        if (!t.action?.isUndo) return true;
        const timer = timers.get(t.id);
        if (timer) { clearTimeout(timer); timers.delete(t.id); }
        return false;
      }));
    };
    _dismissUndoListeners.add(dismissUndo);
    return () => {
      _listeners.delete(handler);
      _dismissUndoListeners.delete(dismissUndo);
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div data-bottom-stack="toast" style={{
      position: "fixed", bottom: `${toastBottomPx}px`, right: "24px",
      zIndex: 10000, display: "flex", flexDirection: "column-reverse", gap: "8px",
      pointerEvents: "none",
    }}>
      {toasts.map(toast => {
        const s = STYLE[toast.type];
        return (
          <div
            key={toast.id}
            className="animate-toast-in"
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              // 【v3.95】固定heightからminHeightへ変更した。拡大率・最小フォントサイズ設定・
              // 長いメッセージの折返しでも切れないように、中身に応じて箱が伸びるようにする
              // （TOAST_ITEM_MIN_HEIGHT_PXは「最低保証の高さ」）。
              minHeight: `${TOAST_ITEM_MIN_HEIGHT_PX}px`,
              padding: "10px 16px",
              background: s.bg, color: "#fff",
              borderRadius: "var(--radius-md)",
              fontSize: "12px", fontWeight: "600",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              maxWidth: "320px",
              pointerEvents: toast.action ? "auto" : "none",
            }}
          >
            <span style={{ fontSize: "14px", flexShrink: 0 }}>{s.icon}</span>
            {toast.message}
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.onClick();
                  // クリックで実行済みのため、Ctrl/Cmd+Zでの二重発火を防ぐ
                  if (toast.action?.isUndo) clearLastUndoAction();
                  dismiss(toast.id);
                }}
                style={{
                  flexShrink: 0, marginLeft: "4px",
                  padding: "4px 10px", fontSize: "11px", fontWeight: "700",
                  background: "rgba(255,255,255,0.22)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  borderRadius: "var(--radius-sm)",
                  color: "#fff", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

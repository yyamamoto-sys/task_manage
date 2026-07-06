// src/components/common/Toast.tsx
// イベントベースのトースト通知。alert() の代替。
// showToast() をどこからでも呼び出せる。ToastContainer を App のルートに1つ置く。
// 第3引数 action を渡すと「元に戻す」等のアクションボタン付きトーストになる（表示時間も延長）。

import { useState, useEffect, useRef } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

let _nextId = 0;
const _listeners = new Set<(item: ToastItem) => void>();

export function showToast(message: string, type: ToastType = "success", action?: ToastAction) {
  const item: ToastItem = { id: _nextId++, message, type, action };
  _listeners.forEach(fn => fn(item));
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
    return () => {
      _listeners.delete(handler);
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
    <div style={{
      position: "fixed", bottom: "24px", right: "24px",
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
                onClick={() => { toast.action?.onClick(); dismiss(toast.id); }}
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

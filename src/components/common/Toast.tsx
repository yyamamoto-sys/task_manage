// src/components/common/Toast.tsx
// イベントベースのトースト通知。alert() の代替。
// showToast() をどこからでも呼び出せる。ToastContainer を App のルートに1つ置く。

import { useState, useEffect } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let _nextId = 0;
const _listeners = new Set<(item: ToastItem) => void>();

export function showToast(message: string, type: ToastType = "success") {
  const item: ToastItem = { id: _nextId++, message, type };
  _listeners.forEach(fn => fn(item));
}

const STYLE: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: "#16a34a", icon: "✓" },
  error:   { bg: "#dc2626", icon: "✕" },
  info:    { bg: "#3b82f6", icon: "ℹ" },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (item: ToastItem) => {
      setToasts(prev => [...prev, item]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== item.id));
      }, 2800);
    };
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

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
            }}
          >
            <span style={{ fontSize: "14px", flexShrink: 0 }}>{s.icon}</span>
            {toast.message}
          </div>
        );
      })}
    </div>
  );
}

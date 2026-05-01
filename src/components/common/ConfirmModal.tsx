// src/components/common/ConfirmModal.tsx
//
// 【設計意図】
// window.confirm() / alert() の代替となるカスタムモーダル。
// Teams WebView など window.confirm() が動作しない環境でも正常に動く。
//
// App.tsx のルートに1つだけマウントすること。
// dialog.ts の _registerModal() に自身を登録することで、
// confirmDialog() / alertDialog() 呼び出しをここで受け取る。

import { useState, useEffect, useCallback } from "react";
import { _registerModal } from "../../lib/dialog";

interface DialogState {
  open: boolean;
  message: string;
  type: "confirm" | "alert";
  resolve: ((value: boolean) => void) | null;
}

const CLOSED: DialogState = { open: false, message: "", type: "confirm", resolve: null };

export function ConfirmModal() {
  const [state, setState] = useState<DialogState>(CLOSED);

  useEffect(() => {
    _registerModal((message, type) =>
      new Promise<boolean>(resolve => {
        setState({ open: true, message, type, resolve });
      })
    );
  }, []);

  const handleClose = useCallback((result: boolean) => {
    state.resolve?.(result);
    setState(CLOSED);
  }, [state]);

  if (!state.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => handleClose(false)}
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="panel-slide-up"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          width: "100%", maxWidth: "340px",
          padding: "24px 20px 18px",
        }}
      >
        {/* アイコン */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: state.type === "alert" ? "var(--color-bg-warning)" : "var(--color-bg-danger)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "16px", marginBottom: "12px",
        }}>
          {state.type === "alert" ? "⚠" : "🗑"}
        </div>

        {/* メッセージ */}
        <p style={{
          fontSize: "13px", color: "var(--color-text-primary)",
          lineHeight: 1.6, marginBottom: "20px",
          whiteSpace: "pre-wrap",
        }}>
          {state.message}
        </p>

        {/* ボタン */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          {state.type === "confirm" && (
            <button
              onClick={() => handleClose(false)}
              style={{
                padding: "7px 16px", fontSize: "12px",
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
              }}
            >
              キャンセル
            </button>
          )}
          <button
            autoFocus
            onClick={() => handleClose(state.type === "confirm" ? true : false)}
            style={{
              padding: "7px 20px", fontSize: "12px", fontWeight: "500",
              background: state.type === "alert" ? "var(--color-bg-warning)" : "var(--color-bg-danger)",
              color: state.type === "alert" ? "var(--color-text-warning)" : "var(--color-text-danger)",
              border: `1px solid ${state.type === "alert" ? "var(--color-border-warning)" : "var(--color-border-danger)"}`,
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {state.type === "alert" ? "OK" : "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}

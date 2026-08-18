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
import { _registerModal, type ConfirmDialogOptions } from "../../lib/dialog";
import { useT } from "../../hooks/useT";
import { modalOverlayStyle, modalBoxStyle } from "./modalStyles";

interface DialogState {
  open: boolean;
  message: string;
  type: "confirm" | "alert";
  tone: "danger" | "neutral";
  confirmLabel?: string;
  resolve: ((value: boolean) => void) | null;
}

const CLOSED: DialogState = { open: false, message: "", type: "confirm", tone: "danger", confirmLabel: undefined, resolve: null };

/**
 * type/tone から見た目（アイコン・色）を決める。alertDialog の見た目（warning）は
 * Section 21・v3.76時点の既存仕様のまま変更しない。confirm の tone="neutral" は
 * 「削除ではない確認」であることが一目で分かるよう、破壊的操作用の赤・ゴミ箱とは
 * 別の配色（info・チェックマーク）にする。
 */
function resolveDialogVisual(type: "confirm" | "alert", tone: "danger" | "neutral") {
  if (type === "alert") {
    return { bg: "var(--color-bg-warning)", text: "var(--color-text-warning)", border: "var(--color-border-warning)", icon: "⚠" };
  }
  if (tone === "neutral") {
    return { bg: "var(--color-bg-info)", text: "var(--color-text-info)", border: "var(--color-border-info)", icon: "✓" };
  }
  return { bg: "var(--color-bg-danger)", text: "var(--color-text-danger)", border: "var(--color-border-danger)", icon: "🗑" };
}

export function ConfirmModal() {
  const t = useT();
  const [state, setState] = useState<DialogState>(CLOSED);

  useEffect(() => {
    _registerModal((message, type, opts?: ConfirmDialogOptions) =>
      new Promise<boolean>(resolve => {
        setState({ open: true, message, type, tone: opts?.tone ?? "danger", confirmLabel: opts?.confirmLabel, resolve });
      })
    );
  }, []);

  const handleClose = useCallback((result: boolean) => {
    state.resolve?.(result);
    setState(CLOSED);
  }, [state]);

  if (!state.open) return null;

  const visual = resolveDialogVisual(state.type, state.tone);
  const confirmLabel = state.confirmLabel
    ?? (state.type === "alert" || state.tone === "neutral" ? t("common.confirm.ok") : t("common.confirm.delete"));

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => handleClose(false)}
      className="animate-overlay"
      style={{ ...modalOverlayStyle(9999), background: "rgba(0,0,0,0.35)", padding: "16px" }}
    >
      {/* イベントバブリング防止用のラッパー（クリックしても何も起きない） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        onClick={e => e.stopPropagation()}
        className="animate-fadeIn"
        style={{
          ...modalBoxStyle("min(340px, 100%)"),
          overflow: "auto",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "24px 20px 18px",
        }}
      >
        {/* アイコン */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: visual.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "16px", marginBottom: "12px",
        }}>
          {visual.icon}
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
              {t("common.button.cancel")}
            </button>
          )}
          <button
            autoFocus
            onClick={() => handleClose(state.type === "confirm" ? true : false)}
            style={{
              padding: "7px 20px", fontSize: "12px", fontWeight: "500",
              background: visual.bg,
              color: visual.text,
              border: `1px solid ${visual.border}`,
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
